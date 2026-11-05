/*
 * Phone Twin UWB tag (worn by the audience) — XIAO nRF52840 + DWM1000 + PCA9685 + 5 vibration motors.
 * Based on gwsylvia/Apeficiation arduino/uwb_tag_motors (same ranging protocol and wiring).
 *
 * The tag ranges to anchors 1..4 in turn (one "sweep"). Each anchor prints its range to the Raspberry Pi
 * over USB; the Pi solves the position and sends it to Unreal by OSC. The tag itself does no position math,
 * so anchor positions live in one place only (pi/anchors.json) and the anchors can go anywhere.
 *
 * Vibration: Unreal -> PTH1 -> Pi -> anchors (USB serial) -> POLL_ACK byte [18] -> this tag -> motors.
 *   level 0-255 = how close the nearest object is, [19] contact = touching (motors pulse).
 *   Nothing heard for SIGNAL_TIMEOUT_MS -> motors ramp down to 0 (or the idle rhythm if IDLE_RHYTHM is 1).
 *   Unreal only sends a level after the phone's "걷기 테스트 시작", so the motors stay quiet before that.
 *
 * Pin mapping (XIAO nRF52840):
 *   D8 SCK, D9 MISO, D10 MOSI (HW SPI) · D0 CSN · D1 RSTn · D2 IRQ
 *   D4 SDA, D5 SCL -> PCA9685 (0x40) · CH0..CH4 -> AO3400A gates -> PN-VM102 motors
 *   DWM1000 VCC <- dedicated external 3.3V regulator, common GND
 */

#include <SPI.h>
#include <DW1000.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_TinyUSB.h>

const uint8_t PIN_RST = 1; // D1
const uint8_t PIN_IRQ = 2; // D2
const uint8_t PIN_SS  = 0; // D0

#define ANTENNA_DELAY 16384
#define ANCHOR_COUNT 4
#define MAX_VALID_RANGE_M 12.0f
#define TAG_TIMEOUT_MS 50   // wait per anchor before skipping it

enum class MessageType : uint8_t {
  POLL = 0,
  POLL_ACK = 1,
  RANGE = 2,
  RANGE_REPORT = 3,
  RANGE_FAILED = 255
};
volatile MessageType expectedMsgId = MessageType::POLL_ACK;
volatile boolean sentAck = false;
volatile boolean receivedAck = false;
DW1000Time timePollSent;
DW1000Time timePollAckReceived;
DW1000Time timeRangeSent;

// data buffer: [0] type, [1..15] timestamps/range, [16] target anchor ID, [17] tag sweep counter,
//              [18] vibration 0-255, [19] contact (filled by the anchor in POLL_ACK)
#define LEN_DATA 20
#define ID_BYTE 16
#define SWEEP_BYTE 17
#define HAPTIC_BYTE 18
#define CONTACT_BYTE 19
byte data[LEN_DATA];
uint8_t sweepId = 0;
uint32_t lastActivity;
uint16_t replyDelayTimeUS = 3000;

uint8_t currentAnchor = 0;   // 0..3 -> anchor ID 1..4
uint8_t validMask = 0;       // anchors that answered this sweep (for the LED and serial monitor)
float ranges[ANCHOR_COUNT];

// ---------------------------------------------------------------- motors
#define IDLE_RHYTHM 0                      // 1 = the original slow staggered rhythm while no vibration is received
const unsigned long SIGNAL_TIMEOUT_MS = 600;
const uint16_t DUTY_MAX = 4095;            // PCA9685 12-bit
const uint16_t DUTY_MIN_RUN = 1300;        // lowest duty at which a PN-VM102 still spins (tune once wired)
const uint16_t RAMP_PER_STEP = 120;        // smooth changes, calm feel
const unsigned long STEP_INTERVAL_MS = 10;
const unsigned long CONTACT_PULSE_MS = 140;
const int MOTOR_COUNT = 5;
const int MOTOR_CH[MOTOR_COUNT] = { 0, 1, 2, 3, 4 };

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
uint16_t duty[MOTOR_COUNT], sentDuty[MOTOR_COUNT];
uint8_t hapticLevel = 0, hapticContact = 0;
unsigned long hapticAt = 0, lastStep = 0;

#if IDLE_RHYTHM
// original Apeficiation rhythm: each motor ramps up, holds, ramps down, then waits; staggered starts
const unsigned long IDLE_HOLD_MS = 500, IDLE_PAUSE_MS = 22480, IDLE_STAGGER_MS = 5620, IDLE_RAMP_MS = 2560;
uint16_t idleDuty(int i, unsigned long now) {
  const unsigned long period = IDLE_RAMP_MS * 2 + IDLE_HOLD_MS + IDLE_PAUSE_MS;
  unsigned long t = (now + period - (i * IDLE_STAGGER_MS) % period) % period;
  if (t < IDLE_RAMP_MS) return (uint32_t)DUTY_MAX * t / IDLE_RAMP_MS;
  t -= IDLE_RAMP_MS;
  if (t < IDLE_HOLD_MS) return DUTY_MAX;
  t -= IDLE_HOLD_MS;
  if (t < IDLE_RAMP_MS) return DUTY_MAX - (uint32_t)DUTY_MAX * t / IDLE_RAMP_MS;
  return 0;
}
#endif

void setColor(bool r, bool g, bool b) {
  digitalWrite(LED_RED,   r ? LOW : HIGH);   // active-LOW RGB LED
  digitalWrite(LED_GREEN, g ? LOW : HIGH);
  digitalWrite(LED_BLUE,  b ? LOW : HIGH);
}

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  setColor(false, false, true); // blue = booting

  Serial.begin(115200);
  unsigned long serialWaitStart = millis();
  while (!Serial && millis() - serialWaitStart < 3000) delay(10);
  Serial.println(F("### PhoneTwin UWB tag + motors ###"));

  Wire.begin();
  Wire.beginTransmission(0x40);
  if (Wire.endTransmission() == 0) Serial.println(F("PCA9685 found at 0x40"));
  else Serial.println(F("PCA9685 NOT found - check SDA D4 / SCL D5"));
  pwm.begin();
  pwm.setPWMFreq(1000);
  for (int i = 0; i < MOTOR_COUNT; i++) { pwm.setPWM(MOTOR_CH[i], 0, 0); duty[i] = sentDuty[i] = 0; }

  DW1000.begin(PIN_IRQ, PIN_RST);
  pinMode(PIN_IRQ, INPUT_PULLDOWN);
  DW1000.select(PIN_SS);

  noInterrupts();
  DW1000.newConfiguration();
  DW1000.setDefaults();
  DW1000.setAntennaDelay(ANTENNA_DELAY);
  DW1000.setDeviceAddress(5);            // anchors use 1..4
  DW1000.setNetworkId(10);
  DW1000.enableMode(DW1000.MODE_LONGDATA_RANGE_LOWPOWER);
  DW1000.commitConfiguration();
  interrupts();

  DW1000.attachSentHandler(handleSent);
  DW1000.attachReceivedHandler(handleReceived);

  receiver();
  transmitPoll();
  noteActivity();
  setColor(false, false, false);
}

void loop() {
  updateMotors(millis());
  serviceUwb();
}

// ---------------------------------------------------------------- motors
uint16_t targetDuty(int i, unsigned long now) {
  bool fresh = now - hapticAt < SIGNAL_TIMEOUT_MS;
  if (!fresh || hapticLevel == 0) {
#if IDLE_RHYTHM
    if (!fresh) return idleDuty(i, now);
#endif
    return 0;
  }
  if (hapticContact) return ((now / CONTACT_PULSE_MS) & 1) ? DUTY_MAX : DUTY_MIN_RUN; // touching: pulse
  return DUTY_MIN_RUN + (uint32_t)(DUTY_MAX - DUTY_MIN_RUN) * hapticLevel / 255;
}

void updateMotors(unsigned long now) {
  if (now - lastStep < STEP_INTERVAL_MS) return;
  lastStep = now;
  for (int i = 0; i < MOTOR_COUNT; i++) {
    uint16_t want = targetDuty(i, now);
    bool snap = hapticContact && now - hapticAt < SIGNAL_TIMEOUT_MS;   // pulses must be crisp
    if (snap) duty[i] = want;
    else if (duty[i] < want) duty[i] = (want - duty[i] > RAMP_PER_STEP) ? duty[i] + RAMP_PER_STEP : want;
    else if (duty[i] > want) duty[i] = (duty[i] - want > RAMP_PER_STEP) ? duty[i] - RAMP_PER_STEP : want;
    if (duty[i] != sentDuty[i]) { pwm.setPWM(MOTOR_CH[i], 0, duty[i]); sentDuty[i] = duty[i]; }
  }
}

// ---------------------------------------------------------------- UWB ranging
void serviceUwb() {
  if (!sentAck && !receivedAck) {
    if (millis() - lastActivity > TAG_TIMEOUT_MS) finishAnchor(false, 0.0f);
    return;
  }
  if (sentAck) {
    sentAck = false;
    MessageType msgId = static_cast<MessageType>(data[0]);
    if (msgId == MessageType::POLL) {
      DW1000.getTransmitTimestamp(timePollSent);
    } else if (msgId == MessageType::RANGE) {
      DW1000.getTransmitTimestamp(timeRangeSent);
      noteActivity();
    }
  }
  if (receivedAck) {
    receivedAck = false;
    DW1000.getData(data, LEN_DATA);
    if (data[ID_BYTE] != currentAnchor + 1) return; // not from the anchor being polled
    MessageType msgId = static_cast<MessageType>(data[0]);
    if (msgId != expectedMsgId) { finishAnchor(false, 0.0f); return; }
    if (msgId == MessageType::POLL_ACK) {
      hapticLevel = data[HAPTIC_BYTE];       // vibration relayed by the anchor from the Pi
      hapticContact = data[CONTACT_BYTE];
      hapticAt = millis();
      DW1000.getReceiveTimestamp(timePollAckReceived);
      expectedMsgId = MessageType::RANGE_REPORT;
      transmitRange();
      noteActivity();
    } else if (msgId == MessageType::RANGE_REPORT) {
      float curRange;
      memcpy(&curRange, data + 1, 4);
      finishAnchor(true, curRange);
    } else if (msgId == MessageType::RANGE_FAILED) {
      finishAnchor(false, 0.0f);
    }
  }
}

void noteActivity() { lastActivity = millis(); }
void handleSent() { sentAck = true; }
void handleReceived() { receivedAck = true; }

void transmitPoll() {
  DW1000.newTransmit();
  DW1000.setDefaults();
  data[0] = static_cast<byte>(MessageType::POLL);
  data[ID_BYTE] = currentAnchor + 1;
  data[SWEEP_BYTE] = sweepId;
  DW1000.setData(data, LEN_DATA);
  DW1000.startTransmit();
}

void transmitRange() {
  DW1000.newTransmit();
  DW1000.setDefaults();
  data[0] = static_cast<byte>(MessageType::RANGE);
  data[ID_BYTE] = currentAnchor + 1;
  data[SWEEP_BYTE] = sweepId;
  DW1000Time deltaTime = DW1000Time(replyDelayTimeUS, DW1000Time::MICROSECONDS);
  timeRangeSent = DW1000.setDelay(deltaTime);
  timePollSent.getTimestamp(data + 1);
  timePollAckReceived.getTimestamp(data + 6);
  timeRangeSent.getTimestamp(data + 11);
  DW1000.setData(data, LEN_DATA);
  DW1000.startTransmit();
}

void receiver() {
  DW1000.newReceive();
  DW1000.setDefaults();
  DW1000.receivePermanently(true);
  DW1000.startReceive();
}

// LED: green = all 4 anchors answered, yellow = 3 (the Pi can still solve), red = fewer
void reportSweep() {
  int n = 0;
  for (int i = 0; i < ANCHOR_COUNT; i++) if (validMask & (1 << i)) n++;
  setColor(n < 4, n >= 3, false);
  Serial.print(F("sweep ")); Serial.print(sweepId);
  Serial.print(F(" ranges:"));
  for (int i = 0; i < ANCHOR_COUNT; i++) {
    Serial.print(' ');
    if (validMask & (1 << i)) Serial.print(ranges[i], 3); else Serial.print('-');
  }
  Serial.print(F("  vib ")); Serial.print(hapticLevel);
  Serial.println(hapticContact ? F(" contact") : F(""));
}

void finishAnchor(bool ok, float meters) {
  if (ok && meters >= 0.0f && meters <= MAX_VALID_RANGE_M) {
    ranges[currentAnchor] = meters;
    validMask |= (1 << currentAnchor);
  }
  currentAnchor++;
  if (currentAnchor >= ANCHOR_COUNT) {
    currentAnchor = 0;
    reportSweep();
    validMask = 0;
    sweepId++;
  }
  expectedMsgId = MessageType::POLL_ACK;
  transmitPoll();
  noteActivity();
}
