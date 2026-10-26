#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include "FastAccelStepper.h"

// VEXA-käyttöliittymän tiedostot (samassa kansiossa välilehtinä)
#include "index.h"
#include "styles.h"
#include "script.h"

// --- VERKKO ---
// WiFi-tunnukset ovat tiedostossa secrets.h (ei GitHubissa).
// Kopioi secrets.example.h -> secrets.h ja täytä omat tunnukset.
#include "secrets.h"
const char* ssid     = WIFI_SSID;
const char* password = WIFI_PASSWORD;
const char* HOSTNAME = "vexa";   // http://vexa.local ja ws://vexa.local:81

// --- PINNIT ---
#define M1_STEP 25
#define M1_DIR  26
#define M1_EN   27  // Base (VEXA: J1)

#define M2_STEP 32
#define M2_DIR  33
#define M2_EN   23  // Shoulder (VEXA: J2)

#define M3_STEP 19
#define M3_DIR  18
#define M3_EN   17  // Elbow (VEXA: J3)

// --- MEKANIIKKA ---
const int MOTOR_FULL_STEPS = 200;
const int MICROSTEP        = 32;   // TMC2209: MS1 HIGH + MS2 LOW = 1/32

// Tallennetut rajat: huippunopeus (askelta/s) ja kiihtyvyys (askelta/s^2) kaikille nivelille
const uint32_t MAX_SPEED_HZ = 7000;
const uint32_t ACCEL        = 2000;

struct Joint {
  const char* id;
  const char* name;
  uint8_t stepPin, dirPin, enPin;
  float ratio;
  bool dirHighCountsUp;      // vaihda false jos akseli pyörii väärään suuntaan
  FastAccelStepper* stepper;
  float stepsPerDeg;
};

#define NUM_JOINTS 3
Joint joints[NUM_JOINTS] = {
  { "J1", "Base",     M1_STEP, M1_DIR, M1_EN, 10.0f, true, NULL, 0 },
  { "J2", "Shoulder", M2_STEP, M2_DIR, M2_EN, 50.0f, true, NULL, 0 },
  { "J3", "Elbow",    M3_STEP, M3_DIR, M3_EN, 10.0f, true, NULL, 0 },
};

FastAccelStepperEngine engine = FastAccelStepperEngine();
WebServer server(80);
WebSocketsServer webSocket = WebSocketsServer(81);   // VEXA käyttää porttia 81

bool     lastMoving    = false;
uint32_t lastMoveCheck = 0;

// ---------------------------------------------------------------
// Apufunktiot
// ---------------------------------------------------------------
bool anyMoving() {
  for (int i = 0; i < NUM_JOINTS; i++) {
    if (joints[i].stepper && joints[i].stepper->isRunning()) return true;
  }
  return false;
}

float jointAngle(Joint &j) {
  if (!j.stepper) return 0.0f;
  return (float)j.stepper->getCurrentPosition() / j.stepsPerDeg;   // 0° = nollapositio
}

// Lähettää nivelten todelliset kulmat ja liikkeen tilan kaikille asiakkaille
// (VEXA näyttää nämä ja odottaa liikkeen päättymistä sekvenssiajossa)
void broadcastPos() {
  lastMoving = anyMoving();
  char buf[160];
  snprintf(buf, sizeof(buf),
           "{\"type\":\"pos\",\"J1\":%.2f,\"J2\":%.2f,\"J3\":%.2f,\"moving\":%s}",
           jointAngle(joints[0]), jointAngle(joints[1]), jointAngle(joints[2]),
           lastMoving ? "true" : "false");
  webSocket.broadcastTXT(buf);
}

void sendStatus(uint8_t num, const char* type) {
  char buf[200];
  snprintf(buf, sizeof(buf),
           "{\"type\":\"%s\",\"uptime_ms\":%lu,\"J1\":%.1f,\"J2\":%.1f,\"J3\":%.1f,\"moving\":%s}",
           type, (unsigned long)millis(),
           jointAngle(joints[0]), jointAngle(joints[1]), jointAngle(joints[2]),
           anyMoving() ? "true" : "false");
  webSocket.sendTXT(num, buf);
}

// angle = aste suhteessa nollapositioon (±180°)
void moveJoint(Joint &j, float angle) {
  if (!j.stepper) return;
  if (angle < -180.0f) angle = -180.0f;
  if (angle >  180.0f) angle =  180.0f;

  j.stepper->setSpeedInHz(MAX_SPEED_HZ);
  j.stepper->setAcceleration(ACCEL);
  j.stepper->moveTo((long)(angle * j.stepsPerDeg));
}

int jointIndex(const char* id) {
  for (int i = 0; i < NUM_JOINTS; i++) {
    if (strcmp(id, joints[i].id) == 0) return i;
  }
  return -1;
}

void stopAll() {
  for (int i = 0; i < NUM_JOINTS; i++) {
    if (joints[i].stepper) joints[i].stepper->stopMove();
  }
}

void initJoint(Joint &j) {
  j.stepsPerDeg = MOTOR_FULL_STEPS * MICROSTEP * j.ratio / 360.0f;

  pinMode(j.enPin, OUTPUT);
  digitalWrite(j.enPin, LOW);   // TMC2209 päälle (aktiivinen LOW)

  j.stepper = engine.stepperConnectToPin(j.stepPin);
  if (!j.stepper) {
    Serial.printf("VIRHE: %s (STEP %d) ei alustunut!\n", j.id, j.stepPin);
    return;
  }
  j.stepper->setDirectionPin(j.dirPin, j.dirHighCountsUp);
  j.stepper->setSpeedInHz(MAX_SPEED_HZ);
  j.stepper->setAcceleration(ACCEL);
  // Alkuasento = nollapositio (0°). Aseta käsivarsi nolla-asentoon ennen virran kytkemistä.
  j.stepper->setCurrentPosition(0);
  Serial.printf("OK: %s %s (%.1f askelta/aste)\n", j.id, j.name, j.stepsPerDeg);
}

// ---------------------------------------------------------------
// WebSocket-viestit VEXA:lta
// ---------------------------------------------------------------
void handleCommand(uint8_t num, String cmd) {
  cmd.trim();
  cmd.toLowerCase();

  if (cmd == "stop") {
    stopAll();
    webSocket.sendTXT(num, "{\"status\":\"stopped\"}");
  }
  else if (cmd == "status" || cmd == "ping") {
    sendStatus(num, "heartbeat");
  }
  else if (cmd == "home") {                       // kaikki nollaan
    for (int i = 0; i < NUM_JOINTS; i++) moveJoint(joints[i], 0.0f);
    broadcastPos();
  }
  else if (cmd == "zero") {                       // nykyinen asento = 0°
    for (int i = 0; i < NUM_JOINTS; i++) {
      if (joints[i].stepper) joints[i].stepper->forceStopAndNewPosition(0);
    }
    webSocket.sendTXT(num, "{\"status\":\"zeroed\"}");
    broadcastPos();
  }
  else if (cmd == "reboot") {
    webSocket.sendTXT(num, "{\"status\":\"rebooting\"}");
    delay(200);
    ESP.restart();
  }
  else {
    webSocket.sendTXT(num, "{\"status\":\"unknown command\"}");
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    sendStatus(num, "hello");
    return;
  }
  if (type != WStype_TEXT) return;

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, (const char*)payload, length);
  if (error) {
    Serial.printf("JSON-virhe: %s\n", error.c_str());
    return;
  }

  String msgType = doc["type"] | "";

  if (msgType == "joint_update") {
    int i = jointIndex(doc["joint"] | "");
    if (i >= 0) moveJoint(joints[i], doc["angle"] | 0.0f);
    broadcastPos();
  }
  else if (msgType == "preset_load" || msgType == "quick_set" ||
           msgType == "randomize"   || msgType == "reset") {
    if (doc.containsKey("allAngles")) {
      JsonObject angles = doc["allAngles"];
      for (int i = 0; i < NUM_JOINTS; i++) {
        if (angles.containsKey(joints[i].id))
          moveJoint(joints[i], angles[joints[i].id].as<float>());
      }
    }
    broadcastPos();
  }
  else if (msgType == "custom_cmd") {
    handleCommand(num, String((const char*)(doc["cmd"] | "")));
  }
}

// ---------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  engine.init();
  for (int i = 0; i < NUM_JOINTS; i++) initJoint(joints[i]);

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  Serial.print("Yhdistetaan WiFi: ");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nWiFi OK!");
  Serial.println(WiFi.localIP());

  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 81);
    Serial.println("mDNS: http://vexa.local");
  } else {
    Serial.println("mDNS ei kaynnistynyt, kayta IP-osoitetta");
  }

  // VEXA-käyttöliittymä
  server.on("/", []() { server.send(200, "text/html", PAGE_HTML); });
  server.on("/styles.css", []() { server.send(200, "text/css", PAGE_CSS); });
  server.on("/script.js", []() { server.send(200, "application/javascript", PAGE_JS); });
  server.begin();

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
}

void loop() {
  server.handleClient();
  webSocket.loop();

  // Lähetä kulmat 10 Hz kun liikutaan (sekä viimeinen kerta pysähdyttäessä)
  if (millis() - lastMoveCheck > 100) {
    lastMoveCheck = millis();
    bool moving = anyMoving();
    if ((moving || lastMoving) && webSocket.connectedClients() > 0) broadcastPos();
    else lastMoving = moving;
  }
}
