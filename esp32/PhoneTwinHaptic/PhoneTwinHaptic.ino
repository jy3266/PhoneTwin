/*
  PhoneTwin Haptic — ESP32 wristband receiver
  -------------------------------------------
  The phone app sends ~30 UDP packets per second:
      PTH1,seq,valid,intensity(0-255),contact(0/1),objectId,distanceMm\n
  objectId: -1 none, 0 scanned surface, 1.. placed objects.  distanceMm: -1 when nothing in range.

  This sketch drives
    - a vibration motor (PWM through a transistor/MOSFET or motor driver — never straight from a GPIO)
    - an optional passive buzzer (pitch per object, louder when closer)
    - the on-board LED (on while in contact)
  and stops everything if no packet arrives for FAILSAFE_MS.
  Every 500 ms it answers the phone with  PTA1,lastSeq,rssi  so the app shows "ESP32 응답 OK".

  Board: any ESP32 (Arduino core 2.x or 3.x).  Serial monitor 115200 shows the IP to type into the app.
*/
#include <WiFi.h>
#include <WiFiUdp.h>

// ---------------- settings ----------------
#define USE_SOFT_AP 0                 // 1: ESP32 makes its own Wi-Fi "PhoneTwin-Haptic" (phone joins it, IP 192.168.4.1)
const char* WIFI_SSID = "YOUR_WIFI";  // used when USE_SOFT_AP == 0 (same network as the phone, 2.4 GHz)
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* AP_SSID   = "PhoneTwin-Haptic";
const char* AP_PASS   = "phonetwin123";   // 8+ chars

const uint16_t UDP_PORT   = 4210;
const int  PIN_MOTOR      = 25;   // PWM → transistor/MOSFET gate (or DRV8833/DRV2603 input)
const int  PIN_BUZZER     = 26;   // passive buzzer (set to -1 if not fitted)
const int  PIN_LED        = 2;    // on-board LED on most DevKits
const int  MOTOR_MIN_DUTY = 90;   // 0-255: duty where your motor just starts spinning
const int  MOTOR_MAX_DUTY = 255;
const uint32_t FAILSAFE_MS = 300;
// ------------------------------------------

WiFiUDP udp;
IPAddress phoneIp; uint16_t phonePort = 0;
uint32_t lastPacket = 0, lastReply = 0, lastSeq = 0;
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
    // ledcWriteTone sets 50% duty; scale it to make "closer = louder" (0..128 of 255).
    pwmDuty(PIN_BUZZER, CH_BUZZER, map(level, 0, 255, 4, 128));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pwmInit(PIN_MOTOR, CH_MOTOR, 20000);           // 20 kHz: inaudible motor PWM
  if (PIN_BUZZER >= 0) pwmInit(PIN_BUZZER, CH_BUZZER, 2000);
  outputs(0, false, -1);

#if USE_SOFT_AP
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("\nSoft AP \"%s\"  IP %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
#else
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                            // lower latency
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("\nWi-Fi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.printf("\nConnected. Type this IP into the phone app: %s\n", WiFi.localIP().toString().c_str());
#endif
  udp.begin(UDP_PORT);
  Serial.printf("Listening UDP %u\n", UDP_PORT);
}

void loop() {
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
  uint32_t now = millis();
  if (lastPacket && now - lastPacket > FAILSAFE_MS && intensity) { intensity = 0; contact = 0; outputs(0, false, -1); }
  if (phonePort && now - lastReply > 500) {
    lastReply = now;
    char out[48];
    int n = snprintf(out, sizeof(out), "PTA1,%lu,%d\n", (unsigned long)lastSeq, (int)WiFi.RSSI());
    udp.beginPacket(phoneIp, phonePort); udp.write((const uint8_t*)out, n); udp.endPacket();
  }
  static uint32_t lastLog = 0;
  if (now - lastLog > 1000) { lastLog = now; Serial.printf("seq %lu  intensity %d  contact %d  obj %d  dist %d mm\n", (unsigned long)lastSeq, intensity, contact, objectId, distanceMm); }
}
