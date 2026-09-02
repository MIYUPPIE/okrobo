// OKROBO car firmware: a differential-drive robot that speaks
// contracts/robot-serial/v0, so the same student program that drives the
// simulator drives this board.
//
// Board: ESP32 or Arduino (Uno/Nano/Mega). Set PIN_* below for your wiring.
// Upload with the Arduino IDE or arduino-cli; see firmware/README.md.
//
// All protocol parsing and formatting lives in protocol.hpp, which is
// gate-tested on a workstation (firmware/tests). This file is only the glue:
// pins, motors, sensor, odometry, timing.

#include "protocol.hpp"

// ---- wiring ----------------------------------------------------------------

constexpr int PIN_LEFT_PWM = 5;
constexpr int PIN_LEFT_DIR = 4;
constexpr int PIN_RIGHT_PWM = 6;
constexpr int PIN_RIGHT_DIR = 7;
constexpr int PIN_ULTRASONIC_TRIG = 8;
constexpr int PIN_ULTRASONIC_ECHO = 9;

// ---- robot geometry (must match the simulated car) -------------------------

constexpr float WHEEL_BASE = 0.12f;      // metres between the wheels
constexpr float MAX_WHEEL_SPEED = 0.5f;  // m/s at full PWM
constexpr float ROBOT_RADIUS = 0.10f;    // metres, front edge offset

// ---- state -----------------------------------------------------------------

constexpr uint32_t STATE_INTERVAL_MS = 50;   // 20 Hz state reports
constexpr uint32_t COMMAND_TIMEOUT_MS = 1000;  // stop if the host goes quiet

okrobo::LineReader reader;
okrobo::BoardState state;
float commandedLeft = 0.0f;
float commandedRight = 0.0f;
uint32_t lastStateMs = 0;
uint32_t lastCommandMs = 0;
uint32_t lastOdometryMs = 0;

void applyMotors(float left, float right) {
  auto drive = [](int pwmPin, int dirPin, float speed) {
    const bool forward = speed >= 0.0f;
    float magnitude = forward ? speed : -speed;
    if (magnitude > MAX_WHEEL_SPEED) magnitude = MAX_WHEEL_SPEED;
    const int pwm = static_cast<int>((magnitude / MAX_WHEEL_SPEED) * 255.0f);
    digitalWrite(dirPin, forward ? HIGH : LOW);
    analogWrite(pwmPin, pwm);
  };
  drive(PIN_LEFT_PWM, PIN_LEFT_DIR, left);
  drive(PIN_RIGHT_PWM, PIN_RIGHT_DIR, right);
}

// Open-loop odometry from commanded speeds. Swap this for encoder counts when
// the robot has them; the protocol does not change.
void integrateOdometry(float dt) {
  const float v = (commandedLeft + commandedRight) * 0.5f;
  const float w = (commandedRight - commandedLeft) / WHEEL_BASE;
  if (w > -1e-6f && w < 1e-6f) {
    state.x += v * dt * cosf(state.theta);
    state.y += v * dt * sinf(state.theta);
  } else {
    const float r = v / w;
    const float theta2 = state.theta + w * dt;
    state.x += r * (sinf(theta2) - sinf(state.theta));
    state.y -= r * (cosf(theta2) - cosf(state.theta));
    state.theta = theta2;
    while (state.theta > 3.14159265f) state.theta -= 6.28318531f;
    while (state.theta <= -3.14159265f) state.theta += 6.28318531f;
  }
  ++state.tick;
}

// HC-SR04 style ultrasonic sensor, measured from the robot's front edge.
float readDistance() {
  digitalWrite(PIN_ULTRASONIC_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_ULTRASONIC_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_ULTRASONIC_TRIG, LOW);
  const unsigned long echoUs = pulseIn(PIN_ULTRASONIC_ECHO, HIGH, 30000UL);
  if (echoUs == 0) return 4.0f;  // nothing within range
  const float metres = (echoUs * 0.000343f) * 0.5f;
  const float fromEdge = metres - ROBOT_RADIUS;
  return fromEdge > 0.0f ? fromEdge : 0.0f;
}

void sendState() {
  char line[okrobo::kMaxLine];
  state.distance = readDistance();
  state.collided = state.distance <= 0.02f;
  okrobo::format_state(state, line, sizeof(line));
  Serial.println(line);
}

void handle(const okrobo::Command& command) {
  switch (command.type) {
    case okrobo::CommandType::Hello: {
      char line[okrobo::kMaxLine];
      okrobo::format_identity("okrobo-car", 1, line, sizeof(line));
      Serial.println(line);
      break;
    }
    case okrobo::CommandType::Drive:
      commandedLeft = command.left;
      commandedRight = command.right;
      applyMotors(commandedLeft, commandedRight);
      break;
    case okrobo::CommandType::Stop:
      commandedLeft = 0.0f;
      commandedRight = 0.0f;
      applyMotors(0.0f, 0.0f);
      break;
    case okrobo::CommandType::Reset:
      state = okrobo::BoardState();
      commandedLeft = 0.0f;
      commandedRight = 0.0f;
      applyMotors(0.0f, 0.0f);
      break;
    case okrobo::CommandType::Query:
      sendState();
      break;
    case okrobo::CommandType::Error:
      Serial.println("E bad-command");
      break;
    case okrobo::CommandType::None:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LEFT_PWM, OUTPUT);
  pinMode(PIN_LEFT_DIR, OUTPUT);
  pinMode(PIN_RIGHT_PWM, OUTPUT);
  pinMode(PIN_RIGHT_DIR, OUTPUT);
  pinMode(PIN_ULTRASONIC_TRIG, OUTPUT);
  pinMode(PIN_ULTRASONIC_ECHO, INPUT);
  applyMotors(0.0f, 0.0f);

  const uint32_t now = millis();
  lastStateMs = now;
  lastCommandMs = now;
  lastOdometryMs = now;
}

void loop() {
  while (Serial.available() > 0) {
    const char* line = reader.feed(static_cast<char>(Serial.read()));
    if (line) {
      lastCommandMs = millis();
      handle(okrobo::parse_command(line));
    }
  }

  const uint32_t now = millis();

  integrateOdometry((now - lastOdometryMs) * 0.001f);
  lastOdometryMs = now;

  // Safety: a silent host (unplugged cable, crashed studio) must not leave
  // the robot driving. Matches contracts/robot-serial/v0.
  if (now - lastCommandMs > COMMAND_TIMEOUT_MS &&
      (commandedLeft != 0.0f || commandedRight != 0.0f)) {
    commandedLeft = 0.0f;
    commandedRight = 0.0f;
    applyMotors(0.0f, 0.0f);
    Serial.println("E host-timeout");
  }

  if (now - lastStateMs >= STATE_INTERVAL_MS) {
    lastStateMs = now;
    sendState();
  }
}
