#include <ESP32Servo.h>

// ---------- CONFIG ----------
const int PIN_ROTATE = 18;
const int PIN_TILT   = 19;
const int PIN_IR     = 34;
const bool IR_ACTIVE_LOW = true;

const int ROT_A = 0;                // plastic / paper
const int ROT_B = 90;               // metal / food
const int TILT_CENTER = 90;
const int TILT_LEFT   = 55;
const int TILT_RIGHT  = 125;

const int   STEP_DELAY_MS = 12;
const unsigned long SETTLE_MS = 800;
const unsigned long DUMP_HOLD_MS = 1500;
// -----------------------------

struct Bin { const char* name; int rot; int tilt; };
Bin bins[] = {
  {"plastic", ROT_A, TILT_LEFT},
  {"paper",   ROT_A, TILT_RIGHT},
  {"metal",   ROT_B, TILT_LEFT},
  {"food",    ROT_B, TILT_RIGHT},
};
const int NUM_BINS = sizeof(bins) / sizeof(bins[0]);

enum State { IDLE, ITEM_READY, SORTING };
State state = IDLE;

Servo rotServo, tiltServo;
int rotPos = ROT_A, tiltPos = TILT_CENTER;
unsigned long presentSince = 0;
unsigned long cooldownUntil = 0;
String rx = "";

bool irBlocked() {
  int v = digitalRead(PIN_IR);
  return IR_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
}

void moveSlow(Servo &s, int &cur, int target) {
  int dir = (target > cur) ? 1 : -1;
  while (cur != target) { cur += dir; s.write(cur); delay(STEP_DELAY_MS); }
}

void sortToBin(int i) {
  moveSlow(rotServo, rotPos, bins[i].rot);
  delay(300);
  moveSlow(tiltServo, tiltPos, bins[i].tilt);
  delay(DUMP_HOLD_MS);
  moveSlow(tiltServo, tiltPos, TILT_CENTER);
  moveSlow(rotServo, rotPos, ROT_A);
}

void reportState() {
  Serial.println(state == IDLE ? "IDLE" : state == ITEM_READY ? "READY" : "SORTING");
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd == "STATUS") { reportState(); return; }

  bool isSort = cmd.startsWith("SORT:");
  bool isTest = cmd.startsWith("TEST:");
  if (!isSort && !isTest) return;

  String bin = cmd.substring(5);
  if (isSort && state != ITEM_READY) { Serial.println("ERR:no item"); return; }
  if (isSort && bin == "reject") { return; }   

  for (int i = 0; i < NUM_BINS; i++) {
    if (bin == bins[i].name) {
      state = SORTING;
      Serial.println("SORTING");
      sortToBin(i);
      cooldownUntil = millis() + 1000;
      presentSince = 0;
      state = IDLE;
      Serial.println("DONE");
      Serial.println("IDLE");
      return;
    }
  }
  Serial.println("ERR:unknown bin");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_IR, INPUT);
  rotServo.setPeriodHertz(50);
  tiltServo.setPeriodHertz(50);
  rotServo.attach(PIN_ROTATE, 500, 2400);
  tiltServo.attach(PIN_TILT, 500, 2400);
  rotServo.write(rotPos);
  tiltServo.write(tiltPos);
  Serial.println("BOOT");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleCommand(rx); rx = ""; }
    else if (c != '\r') rx += c;
  }

  if (state == IDLE && millis() > cooldownUntil) {
    if (irBlocked()) {
      if (presentSince == 0) presentSince = millis();
      if (millis() - presentSince >= SETTLE_MS) { state = ITEM_READY; Serial.println("READY"); }
    } else {
      presentSince = 0;
    }
  } else if (state == ITEM_READY && !irBlocked()) {
    state = IDLE;
    presentSince = 0;
    Serial.println("IDLE");
  }
}