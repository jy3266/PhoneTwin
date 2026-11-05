/*
 * Phone Twin UWB anchor (1 of 4) — XIAO nRF52840 + DWM1000, plugged into the Raspberry Pi by USB.
 * Based on gwsylvia/Apeficiation arduino/4uwb_anchor (same ranging protocol and wiring).
 *
 * What is added for Phone Twin:
 *   - the Pi writes the vibration Unreal computed ("H,<0-255>,<contact 0|1>\n") to this USB serial port;
 *     the anchor puts it into every POLL_ACK, so the tag (no Wi-Fi) learns how strongly to vibrate.
 *   - data[] is 20 bytes: [18] = vibration 0-255, [19] = contact. Flash the tag from the same folder version.
 *
 * Serial out (to the Pi):  R,<sweep>,<anchor>,<range_m>,<rx_power_dbm>
 * Serial in  (from the Pi): H,<intensity 0-255>,<contact 0|1>
 *
 * Anchor positions are NOT set here. Put the anchors anywhere in the room and write their positions
 * (or tape-measured distances) into pi/anchors.json — the Pi does all position math.
 *
 * Pin mapping (XIAO nRF52840):
 *   D8 SCK, D9 MISO, D10 MOSI (HW SPI) · D0 CSN · D1 RSTn · D2 IRQ
 *   DWM1000 VCC <- dedicated external 3.3V regulator, common GND
 */

#include <SPI.h>
#include <DW1000.h>

// ---- SET PER BOARD BEFORE FLASHING (1-4) ----
#define ANCHOR_ID 1

const uint8_t PIN_RST = 1; // D1
const uint8_t PIN_IRQ = 2; // D2
const uint8_t PIN_SS  = 0; // D0

#define ANTENNA_DELAY 16384

enum class MessageType : uint8_t {
  POLL = 0,
  POLL_ACK = 1,
  RANGE = 2,
  RANGE_REPORT = 3,
  RANGE_FAILED = 255
};
volatile MessageType expectedMsgId = MessageType::POLL;
volatile boolean sentAck = false;
volatile boolean receivedAck = false;
boolean protocolFailed = false;
DW1000Time timePollSent;
DW1000Time timePollReceived;
DW1000Time timePollAckSent;
DW1000Time timePollAckReceived;
DW1000Time timeRangeSent;
DW1000Time timeRangeReceived;
DW1000Time timeComputedRange;

// data buffer: [0] type, [1..15] timestamps/range, [16] target anchor ID, [17] tag sweep counter,
//              [18] vibration 0-255, [19] contact (Phone Twin)
#define LEN_DATA 20
#define ID_BYTE 16
#define SWEEP_BYTE 17
#define HAPTIC_BYTE 18
#define CONTACT_BYTE 19
byte data[LEN_DATA];
uint32_t lastActivity;
uint32_t resetPeriod = 250;
uint16_t replyDelayTimeUS = 3000;

// vibration from the Pi; forgotten after HAPTIC_HOLD_MS so the tag stops if the Pi or Unreal stops
#define HAPTIC_HOLD_MS 500
uint8_t hapticLevel = 0, hapticContact = 0;
uint32_t hapticAt = 0;
char lineBuf[24];
uint8_t lineLen = 0;

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
  while (!Serial && millis() < 3000);
  Serial.print(F("### PhoneTwin UWB anchor, ID "));
  Serial.print(ANCHOR_ID);
  Serial.println(F(" ###"));

  DW1000.begin(PIN_IRQ, PIN_RST);
  pinMode(PIN_IRQ, INPUT_PULLDOWN);
  DW1000.select(PIN_SS);

  noInterrupts();
  DW1000.newConfiguration();
  DW1000.setDefaults();
  DW1000.setAntennaDelay(ANTENNA_DELAY);
  DW1000.setDeviceAddress(ANCHOR_ID);
  DW1000.setNetworkId(10);
  DW1000.enableMode(DW1000.MODE_LONGDATA_RANGE_LOWPOWER);
  DW1000.commitConfiguration();
  interrupts();

  char msg[128];
  DW1000.getPrintableNetworkIdAndShortAddress(msg);
  Serial.print(F("Network ID & Device Address: ")); Serial.println(msg);

  DW1000.attachSentHandler(handleSent);
  DW1000.attachReceivedHandler(handleReceived);
  receiver();
  noteActivity();
  setColor(false, false, false); // off = waiting for a poll
}

// "H,<level>,<contact>" from the Pi
void readPiLine() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
      continue;
    }
    lineBuf[lineLen] = 0;
    lineLen = 0;
    if (lineBuf[0] != 'H' || lineBuf[1] != ',') continue;
    int level = 0, contact = 0;
    if (sscanf(lineBuf + 2, "%d,%d", &level, &contact) >= 1) {
      hapticLevel = (uint8_t)constrain(level, 0, 255);
      hapticContact = contact ? 1 : 0;
      hapticAt = millis();
    }
  }
}

void loop() {
  readPiLine();
  int32_t curMillis = millis();
  if (!sentAck && !receivedAck) {
    if (curMillis - lastActivity > resetPeriod) {
      resetInactive();
    }
    return;
  }
  if (sentAck) {
    sentAck = false;
    MessageType msgId = static_cast<MessageType>(data[0]);
    if (msgId == MessageType::POLL_ACK) {
      DW1000.getTransmitTimestamp(timePollAckSent);
      noteActivity();
    }
  }
  if (receivedAck) {
    receivedAck = false;
    DW1000.getData(data, LEN_DATA);
    if (data[ID_BYTE] != ANCHOR_ID) {
      return; // addressed to another anchor
    }
    MessageType msgId = static_cast<MessageType>(data[0]);
    if (msgId != expectedMsgId) {
      protocolFailed = true;
    }
    if (msgId == MessageType::POLL) {
      protocolFailed = false;
      DW1000.getReceiveTimestamp(timePollReceived);
      expectedMsgId = MessageType::RANGE;
      transmitPollAck();
      noteActivity();
    }
    else if (msgId == MessageType::RANGE) {
      DW1000.getReceiveTimestamp(timeRangeReceived);
      expectedMsgId = MessageType::POLL;
      if (!protocolFailed) {
        timePollSent.setTimestamp(data + 1);
        timePollAckReceived.setTimestamp(data + 6);
        timeRangeSent.setTimestamp(data + 11);
        computeRangeAsymmetric();
        float distance = timeComputedRange.getAsMeters();
        byte sweep = data[SWEEP_BYTE];
        transmitRangeReport(distance);
        setColor(false, true, false); // green = range computed
        Serial.print("R,"); Serial.print(sweep);
        Serial.print(','); Serial.print(ANCHOR_ID);
        Serial.print(','); Serial.print(distance, 3);
        Serial.print(','); Serial.println(DW1000.getReceivePower(), 1);
      }
      else {
        setColor(true, false, false); // red = protocol failure
        transmitRangeFailed();
      }
      noteActivity();
    }
  }
}

void noteActivity() { lastActivity = millis(); }

void resetInactive() {
  expectedMsgId = MessageType::POLL;
  receiver();
  noteActivity();
}

void handleSent() { sentAck = true; }
void handleReceived() { receivedAck = true; }

void transmitPollAck() {
  DW1000.newTransmit();
  DW1000.setDefaults();
  data[0] = static_cast<byte>(MessageType::POLL_ACK);
  data[ID_BYTE] = ANCHOR_ID;
  bool fresh = millis() - hapticAt < HAPTIC_HOLD_MS;
  data[HAPTIC_BYTE] = fresh ? hapticLevel : 0;
  data[CONTACT_BYTE] = fresh ? hapticContact : 0;
  DW1000Time deltaTime = DW1000Time(replyDelayTimeUS, DW1000Time::MICROSECONDS);
  DW1000.setDelay(deltaTime);
  DW1000.setData(data, LEN_DATA);
  DW1000.startTransmit();
}

void transmitRangeReport(float curRangeMeters) {
  DW1000.newTransmit();
  DW1000.setDefaults();
  data[0] = static_cast<byte>(MessageType::RANGE_REPORT);
  memcpy(data + 1, &curRangeMeters, 4);
  data[ID_BYTE] = ANCHOR_ID;
  DW1000.setData(data, LEN_DATA);
  DW1000.startTransmit();
}

void transmitRangeFailed() {
  DW1000.newTransmit();
  DW1000.setDefaults();
  data[0] = static_cast<byte>(MessageType::RANGE_FAILED);
  data[ID_BYTE] = ANCHOR_ID;
  DW1000.setData(data, LEN_DATA);
  DW1000.startTransmit();
}

void receiver() {
  DW1000.newReceive();
  DW1000.setDefaults();
  DW1000.receivePermanently(true);
  DW1000.startReceive();
}

void computeRangeAsymmetric() {
  DW1000Time round1 = (timePollAckReceived - timePollSent).wrap();
  DW1000Time reply1 = (timePollAckSent - timePollReceived).wrap();
  DW1000Time round2 = (timeRangeReceived - timePollAckSent).wrap();
  DW1000Time reply2 = (timeRangeSent - timePollAckReceived).wrap();
  DW1000Time tof = (round1 * round2 - reply1 * reply2) / (round1 + round2 + reply1 + reply2);
  timeComputedRange.setTimestamp(tof);
}
