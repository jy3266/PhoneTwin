/*
  PhoneTwin UWB — ESP32 손목/손 장치 (v4)  ·  ESP32 hand/wrist device
  -------------------------------------------------------------------
  하는 일 / What it does
   1) UWB 위치 + IMU 회전을 30Hz로 언리얼 PC에 보냄          (PTE1 → UNREAL_IP:7777)
      Sends UWB position + IMU orientation to the Unreal PC at 30 Hz.
   2) 언리얼(또는 휴대폰)이 계산한 햅틱 세기를 받아 진동 모터 구동 (PTH1 ← :4210)
      Receives haptic strength computed by Unreal (or the phone) and drives the motor.
      거리가 가까울수록 intensity가 커지고 모터 PWM이 세집니다. 300ms 동안 패킷이 없으면 정지.
   3) 0.5초마다 PTH1 보낸 쪽으로 PTA1,lastSeq,rssi 응답 (앱/언리얼의 "응답 OK" 표시)

  규격 / Protocol (PROTOCOL.md)
    ESP32 → Unreal :  PTE1,seq,valid,x,y,z,yaw,pitch,roll\n
                      R 좌표: 미터, Z 위, 원점 = 바닥 테이프 A, +X = A→B, +Y = +X의 왼쪽(반시계 90°)
                      yaw = +X에서 반시계(도), pitch = 위로 들면 +, roll = 오른쪽으로 기울면 +
    Unreal → ESP32 :  PTH1,seq,valid,intensity(0-255),contact(0/1),objectId,distanceMm\n
    ESP32 → sender :  PTA1,lastSeq,rssi\n

  배선 / Wiring (예시)
    GPIO25 ─1kΩ─▶ NPN(2N2222) 베이스 또는 로직레벨 MOSFET 게이트 → 진동 모터 (모터 양단 1N4148 다이오드)
    GPIO26 ─ 수동 부저 ─ GND (선택, 없으면 PIN_BUZZER -1)
    GPIO2  = 보드 LED (접촉 시 켜짐)
    UWB (DW3000/DWM3000, DWM1000): SPI  SCK 18 · MISO 19 · MOSI 23 · CS 4 · RST 27 · IRQ 34   (모듈 라이브러리 예제에 맞춰 변경)
    IMU (BNO055 / MPU6050):       I2C  SDA 21 · SCL 22
    GPIO로 모터를 직접 구동하지 마세요. Never drive the motor straight from a GPIO.

  처음 시험 / First test
    DEMO_MOTION 1 이면 UWB/IMU 없이 A·B 사이 바닥 위 1.2m 높이에서 반지름 1m 원을 걷는 척합니다.
    With DEMO_MOTION 1 it fakes walking a 1 m circle, so Unreal can be tested without hardware.

  Board: any ESP32, Arduino core 2.x or 3.x. Serial 115200 shows the IP.
*/
#include <WiFi.h>
#include <WiFiUdp.h>
#include <math.h>

// ---------------- settings ----------------
#define USE_SOFT_AP 0                 // 1: ESP32가 "PhoneTwin-Haptic" Wi-Fi를 만듦 (PC·휴대폰이 여기에 접속, IP 192.168.4.1)
#define DEMO_MOTION 1                 // 1: UWB/IMU 없이 원을 그리며 움직이는 가짜 위치 / 0: 실제 센서
const char* WIFI_SSID = "YOUR_WIFI";  // 2.4 GHz, PC·휴대폰과 같은 네트워크
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* AP_SSID   = "PhoneTwin-Haptic";
const char* AP_PASS   = "phonetwin123";   // 8+ chars

const char* UNREAL_IP   = "192.168.0.100"; // 언리얼 PC의 IPv4 (명령 프롬프트 ipconfig). 브로드캐스트 x.x.x.255도 가능
const uint16_t UNREAL_PORT = 7777;
const uint16_t UDP_PORT    = 4210;         // PTH1 수신
const uint32_t SEND_PERIOD_MS = 33;        // ~30 Hz

const int  PIN_MOTOR      = 25;
const int  PIN_BUZZER     = 26;   // -1 if not fitted
const int  PIN_LED        = 2;
const int  MOTOR_MIN_DUTY = 90;   // 모터가 막 돌기 시작하는 duty (0-255)
const int  MOTOR_MAX_DUTY = 255;
const uint32_t FAILSAFE_MS = 300;
// ------------------------------------------

WiFiUDP udp;          // PTH1 in, PTA1 out
WiFiUDP poseUdp;      // PTE1 out
IPAddress unrealIp;
IPAddress phoneIp; uint16_t phonePort = 0;
uint32_t lastPacket = 0, lastReply = 0, lastSeq = 0, lastSend = 0, poseSeq = 0;
int intensity = 0, contact = 0, objectId = -1, distanceMm = -1;

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  void pwmInit(int pin, int ch, int freq) { ledcAttach(pin, freq, 8); }
  void pwmDuty(int pin, int ch, int duty) { ledcWrite(pin, duty); }
  void pwmTone(int pin, int ch, int freq) { ledcWriteTone(pin, freq); }
#else
  void pwmInit(int pin, int ch, int freq) { ledcSetup(ch, freq, 8); ledcAttachPin(pin, ch); }
  void pwmDuty(int pin, int ch, int duty) { ledcWrite(ch, duty); }
  void pwmTone(int pin, int ch, int freq) { ledcWriteTone(ch, freq); }
#endif
const int CH_MOTOR = 0, CH_BUZZER = 2;

// =====================================================================================
//  UWB trilateration helper (least squares).  Anchors are given in the R frame (metres).
//  UWB 모듈은 보통 "앵커까지의 거리"를 줍니다. 앵커 좌표와 거리로 위치를 구합니다.
//  - 3D: 앵커 4개 이상(높이가 서로 다르게). 2D: 앵커 3개 이상 + 태그 높이 고정(TAG_HEIGHT).
// =====================================================================================
struct Anchor { float x, y, z; };
// 예시: 앵커 0 = 테이프 A(원점), 앵커 1 = A→B 선 위 3m, 앵커 2·3 = 방 다른 모서리. 실제 위치로 바꾸세요.
Anchor ANCHORS[] = { {0.0f, 0.0f, 2.0f}, {3.0f, 0.0f, 2.0f}, {3.0f, 3.0f, 2.2f}, {0.0f, 3.0f, 1.0f} };
const int ANCHOR_COUNT = sizeof(ANCHORS) / sizeof(ANCHORS[0]);
const float TAG_HEIGHT = 1.2f;      // 2D 풀이 때 쓰는 손 높이 (m)

// Solves the 3x3 system M p = v (Cramer). Returns false if singular.
static bool solve3(const float M[3][3], const float v[3], float out[3]) {
  float det = M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  if (fabsf(det) < 1e-9f) return false;
  for (int c = 0; c < 3; c++) {
    float A[3][3];
    for (int r = 0; r < 3; r++) for (int k = 0; k < 3; k++) A[r][k] = (k == c) ? v[r] : M[r][k];
    out[c] = (A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1]) - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0]) + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0])) / det;
  }
  return true;
}

/*  Linearised least squares: subtract anchor 0's sphere equation from the others,
    |p - a_i|^2 = d_i^2  →  2 (a_i - a_0)·p = d_0^2 - d_i^2 + |a_i|^2 - |a_0|^2.
    use3d=false fixes z = TAG_HEIGHT and solves x,y (needs >= 3 anchors not on one line).
    dist[i] < 0 means "no range from anchor i" and is skipped. */
bool trilaterate(const float* dist, bool use3d, float& x, float& y, float& z) {
  int base = -1;
  for (int i = 0; i < ANCHOR_COUNT; i++) if (dist[i] > 0) { base = i; break; }
  if (base < 0) return false;
  const Anchor& a0 = ANCHORS[base];
  float AtA[3][3] = {{0}}, Atb[3] = {0}; int rows = 0;
  for (int i = base + 1; i < ANCHOR_COUNT; i++) {
    if (dist[i] <= 0) continue;
    const Anchor& a = ANCHORS[i];
    float row[3] = { 2*(a.x - a0.x), 2*(a.y - a0.y), 2*(a.z - a0.z) };
    float rhs = dist[base]*dist[base] - dist[i]*dist[i] + (a.x*a.x + a.y*a.y + a.z*a.z) - (a0.x*a0.x + a0.y*a0.y + a0.z*a0.z);
    if (!use3d) { rhs -= row[2]*TAG_HEIGHT; row[2] = 0; }
    for (int r = 0; r < 3; r++) { Atb[r] += row[r]*rhs; for (int c = 0; c < 3; c++) AtA[r][c] += row[r]*row[c]; }
    rows++;
  }
  if (rows < (use3d ? 3 : 2)) return false;
  if (!use3d) AtA[2][2] = 1;   // z is fixed; keep the system non-singular
  float p[3];
  if (!solve3(AtA, Atb, p)) return false;
  x = p[0]; y = p[1]; z = use3d ? p[2] : TAG_HEIGHT;
  return isfinite(x) && isfinite(y) && isfinite(z);
}

// =====================================================================================
//  ▼▼▼ 팀원이 채울 부분 / PLUG YOUR SENSORS IN HERE ▼▼▼
// =====================================================================================
void sensorsBegin() {
  // UWB: DW3000(Makerfabs ESP32 UWB DW3000 등) 또는 DWM1000(arduino-dw1000) 라이브러리 초기화.
  //      태그로 설정하고 각 앵커와 TWR(Two-Way Ranging)을 반복합니다.
  // IMU: BNO055 (Adafruit_BNO055: 보정된 오일러각 바로 제공, 권장) 또는 MPU6050 (+ Madgwick 필터).
  //      Wire.begin(21, 22); bno.begin(); ...
}

/* R 좌표(미터, Z 위)로 손 위치를 돌려줍니다. 새 값이 없거나 실패하면 false.
   일반적인 구현:
     float d[ANCHOR_COUNT];               // 앵커별 거리(m), 못 받으면 -1
     for (int i = 0; i < ANCHOR_COUNT; i++) d[i] = rangeToAnchor(i);   // ← UWB 라이브러리의 TWR 결과
     return trilaterate(d, false, x, y, z);   // 2D 권장. 3D(true)는 앵커 높이 차이가 1m 이상일 때만 정확합니다
                                              // (위 예시 배치·2cm 거리 잡음에서 2D 오차 약 8cm, 3D 약 30cm)
   UWB 모듈이 이미 좌표를 계산해 준다면(DWM1001 RTLS 등) 그 좌표를 R 좌표로 바꿔 넣기만 하면 됩니다. */
bool readUwbPosition(float& x, float& y, float& z) {
#if DEMO_MOTION
  float t = millis() / 1000.0f * 0.4f;           // 한 바퀴 약 16초
  x = 1.5f + cosf(t); y = 1.0f + sinf(t); z = 1.2f;
  return true;
#else
  return false;   // TODO: UWB 거리 → trilaterate()
#endif
}

/* IMU 오일러각(도). yaw = +X에서 반시계, pitch = 위로 들면 +, roll = 오른쪽으로 기울면 +.
   IMU의 북쪽/정면과 R의 +X(A→B)가 다르면 YAW_OFFSET으로 맞추세요. BNO055 heading은 시계방향이므로 yaw = -heading. */
const float YAW_OFFSET = 0.0f;
bool readImu(float& yaw, float& pitch, float& roll) {
#if DEMO_MOTION
  float t = millis() / 1000.0f * 0.4f;
  yaw = t * 57.2958f + 90.0f;                    // 원의 진행 방향
  while (yaw > 180) yaw -= 360;
  pitch = -10.0f; roll = 0.0f;
  return true;
#else
  return false;   // TODO: IMU 읽기 후 yaw += YAW_OFFSET
#endif
}
// =====================================================================================

void outputs(int level, bool touching, int obj) {
  int duty = level <= 0 ? 0 : map(level, 1, 255, MOTOR_MIN_DUTY, MOTOR_MAX_DUTY);
  if (touching) duty = MOTOR_MAX_DUTY;
  pwmDuty(PIN_MOTOR, CH_MOTOR, duty);
  digitalWrite(PIN_LED, touching ? HIGH : LOW);
  if (PIN_BUZZER >= 0) {
    if (level <= 0) { pwmDuty(PIN_BUZZER, CH_BUZZER, 0); return; }
    int freq = obj <= 0 ? 660 : 440 * pow(2.0, (obj % 12) / 6.0);
    if (touching) freq = freq * 3 / 2;
    static int lastFreq = 0;
    if (freq != lastFreq) { pwmTone(PIN_BUZZER, CH_BUZZER, freq); lastFreq = freq; }
    pwmDuty(PIN_BUZZER, CH_BUZZER, map(level, 0, 255, 4, 128));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pwmInit(PIN_MOTOR, CH_MOTOR, 20000);
  if (PIN_BUZZER >= 0) pwmInit(PIN_BUZZER, CH_BUZZER, 2000);
  outputs(0, false, -1);
  sensorsBegin();

#if USE_SOFT_AP
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("\nSoft AP \"%s\"  IP %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
#else
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                            // 지연 줄이기 / lower latency
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("\nWi-Fi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.printf("\nConnected. ESP32 IP (앱/언리얼에 입력): %s\n", WiFi.localIP().toString().c_str());
#endif
  unrealIp.fromString(UNREAL_IP);
  udp.begin(UDP_PORT);
  poseUdp.begin(UDP_PORT + 1);
  Serial.printf("PTH1 listen :%u  ·  PTE1 → %s:%u%s\n", UDP_PORT, UNREAL_IP, UNREAL_PORT, DEMO_MOTION ? "  (DEMO_MOTION)" : "");
}

void receiveHaptics() {
  int size;
  while ((size = udp.parsePacket()) > 0) {
    char buf[96];
    int n = udp.read(buf, sizeof(buf) - 1); if (n <= 0) continue; buf[n] = 0;
    unsigned long seq; int valid, level, touch, obj, mm;
    if (sscanf(buf, "PTH1,%lu,%d,%d,%d,%d,%d", &seq, &valid, &level, &touch, &obj, &mm) == 6) {
      phoneIp = udp.remoteIP(); phonePort = udp.remotePort();
      lastPacket = millis(); lastSeq = seq;
      intensity = valid ? constrain(level, 0, 255) : 0;
      contact = valid && touch; objectId = obj; distanceMm = mm;
      outputs(intensity, contact, objectId);
    }
  }
}

void sendPose(uint32_t now) {
  if (now - lastSend < SEND_PERIOD_MS) return;
  lastSend = now;
  static float x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0;   // keep last good values
  bool ok = readUwbPosition(x, y, z);
  readImu(yaw, pitch, roll);
  char out[128];
  int n = snprintf(out, sizeof(out), "PTE1,%lu,%d,%.3f,%.3f,%.3f,%.1f,%.1f,%.1f\n",
                   (unsigned long)++poseSeq, ok ? 1 : 0, x, y, z, yaw, pitch, roll);
  poseUdp.beginPacket(unrealIp, UNREAL_PORT); poseUdp.write((const uint8_t*)out, n); poseUdp.endPacket();
}

void loop() {
  receiveHaptics();
  uint32_t now = millis();
  sendPose(now);
  if (lastPacket && now - lastPacket > FAILSAFE_MS && intensity) { intensity = 0; contact = 0; outputs(0, false, -1); }
  if (phonePort && now - lastReply > 500) {
    lastReply = now;
    char out[48];
    int n = snprintf(out, sizeof(out), "PTA1,%lu,%d\n", (unsigned long)lastSeq, (int)WiFi.RSSI());
    udp.beginPacket(phoneIp, phonePort); udp.write((const uint8_t*)out, n); udp.endPacket();
  }
  static uint32_t lastLog = 0;
  if (now - lastLog > 1000) { lastLog = now; Serial.printf("pose seq %lu · haptic seq %lu  intensity %d  contact %d  obj %d  dist %d mm\n", (unsigned long)poseSeq, (unsigned long)lastSeq, intensity, contact, objectId, distanceMm); }
  delay(1);
}
