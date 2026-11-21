// Tablebell table node: one button per table. Short press = call waiter, hold 1.5 s = bill please,
// hold 5 s = cancel. Talks to the hub over the restaurant Wi-Fi with plain HTTP POSTs.
// Events are queued and retried, so a call survives Wi-Fi or hub outages; the hub de-duplicates by id.
#include <Arduino.h>
#ifdef ESP8266
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#else
#include <WiFi.h>
#include <HTTPClient.h>
#endif
#include "config.h"
#include "button_logic.h"

using namespace tc;

static uint32_t chipId() {
#ifdef ESP8266
  return ESP.getChipId();
#else
  return (uint32_t)ESP.getEfuseMac();
#endif
}

enum HubState : uint8_t { HS_UNKNOWN, HS_IDLE, HS_CALL, HS_BILL, HS_ACK };

static Button button;
static Queue<8> queue;
static HubState hubState = HS_UNKNOWN;     // what the hub last told us for this table
static bool hubReachable = false;
static uint32_t lastHubOk = 0, nextTry = 0, nextBeat = 0, nextWifi = 0;
static uint8_t failures = 0;
static uint32_t bootId = 0;
static uint16_t counter = 0;
static uint32_t lastEventAt = 0;
static uint32_t feedbackUntil = 0;         // confirm blink after a press
static const char* const URL_EVENT = "/api/node/event";
static const char* const URL_BEAT = "/api/node/hb";

// ---------- output: LED + optional buzzer ----------
static void led(bool on) {
  digitalWrite(LED_PIN, (on != (LED_ACTIVE_LOW != 0)) ? HIGH : LOW);
}
static void beepMs(uint16_t ms) {
#if BUZZER_PIN >= 0
  digitalWrite(BUZZER_PIN, HIGH); delay(ms); digitalWrite(BUZZER_PIN, LOW);
#else
  (void)ms;
#endif
}

// LED patterns by situation, evaluated every loop pass from millis().
static void updateLed(uint32_t now) {
  bool on = false;
  uint32_t ph = now % 2000;
  if (feedbackUntil && (int32_t)(feedbackUntil - now) > 0) on = true;                    // pressed: solid
  else if (WiFi.status() != WL_CONNECTED || !hubReachable) on = ph < 100 || (ph > 300 && ph < 400);  // two blinks: no hub
  else if (hubState == HS_ACK) on = true;                                                // solid: waiter is coming
  else if (hubState == HS_CALL) on = (now % 500) < 250;                                  // fast blink: call pending
  else if (hubState == HS_BILL) on = (now % 1000) < 120 || ((now % 1000) > 240 && (now % 1000) < 360);  // double pulse
  else on = (now % 5000) < 40;                                                           // idle: brief tick
  led(on);
}

// ---------- hub communication ----------
static int post(const char* path, uint32_t id, const char* ev, HubState* stOut) {
  WiFiClient client;
  HTTPClient http;
  char url[96], body[160];
  snprintf(url, sizeof url, "http://%s:%d%s", HUB_HOST, HUB_PORT, path);
  if (ev) snprintf(body, sizeof body, "{\"t\":%d,\"ev\":\"%s\",\"id\":%lu,\"rssi\":%d,\"vcc\":0,\"fw\":\"%s\"}", TABLE_ID, ev, (unsigned long)id, WiFi.RSSI(), FW_VERSION);
  else snprintf(body, sizeof body, "{\"t\":%d,\"rssi\":%d,\"vcc\":0,\"fw\":\"%s\"}", TABLE_ID, WiFi.RSSI(), FW_VERSION);
  if (!http.begin(client, url)) return -1;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Key", NODE_KEY);
  int code = http.POST((uint8_t*)body, strlen(body));
  if (code == 200 && stOut) {
    String r = http.getString();
    if (r.indexOf("\"st\":\"ack\"") >= 0) *stOut = HS_ACK;
    else if (r.indexOf("\"st\":\"call\"") >= 0) *stOut = HS_CALL;
    else if (r.indexOf("\"st\":\"bill\"") >= 0) *stOut = HS_BILL;
    else *stOut = HS_IDLE;
  }
  http.end();
  return code;
}

static void hubOk(uint32_t now) { hubReachable = true; lastHubOk = now; failures = 0; }
static void hubFail() { hubReachable = false; if (failures < 250) failures++; }

static void enqueue(uint8_t type, uint32_t now) {
  // Rate limit: ignore a second event within 800 ms (a bouncy or nervous finger).
  if (lastEventAt && now - lastEventAt < 800) return;
  lastEventAt = now;
  uint32_t id = (bootId << 16) | counter++;
  queue.push({id, type});
  nextTry = now;  // try immediately
  feedbackUntil = now + 400;
  beepMs(type == 2 ? 120 : 60);
  // Optimistic local state so the LED reacts at once, before the hub answers.
  if (type == 1 && hubState != HS_BILL) hubState = HS_CALL;
  if (type == 2) hubState = HS_BILL;
  if (type == 3) hubState = HS_IDLE;
}

static void pump(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!queue.empty() && (int32_t)(now - nextTry) >= 0) {
    const Event& e = queue.front();
    const char* ev = e.type == 1 ? "call" : e.type == 2 ? "bill" : "cancel";
    HubState st = HS_UNKNOWN;
    int code = post(URL_EVENT, e.id, ev, &st);
    if (code == 200) { queue.pop(); hubOk(now); if (st != HS_UNKNOWN) hubState = st; nextBeat = now + HEARTBEAT_MS; nextTry = now; }
    else { hubFail(); nextTry = now + backoffMs(failures); }
    return;
  }
  if (queue.empty() && (int32_t)(now - nextBeat) >= 0) {
    HubState st = HS_UNKNOWN;
    int code = post(URL_BEAT, 0, nullptr, &st);
    if (code == 200) { hubOk(now); if (st != HS_UNKNOWN) hubState = st; nextBeat = now + HEARTBEAT_MS; }
    else { hubFail(); nextBeat = now + backoffMs(failures); }
  }
}

static void keepWifi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED || (int32_t)(now - nextWifi) < 0) return;
  nextWifi = now + 8000;           // re-issue begin() every 8 s while disconnected
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT); led(false);
#if BUZZER_PIN >= 0
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW);
#endif
  pinMode(BUTTON_PIN, INPUT_PULLUP);   // button between pin and GND
  randomSeed(micros() ^ chipId());
  bootId = (random(0x10000) ^ (uint32_t)(chipId() & 0xFFFF)) & 0xFFFF;
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastHubOk = millis();
  Serial.printf("\nTablebell node, table %d, fw %s\n", TABLE_ID, FW_VERSION);
}

void loop() {
  uint32_t now = millis();
  Gesture g = button.update(digitalRead(BUTTON_PIN) == LOW, now);
  if (g == Gesture::Call) enqueue(1, now);
  else if (g == Gesture::Bill) enqueue(2, now);
  else if (g == Gesture::Cancel) { enqueue(3, now); beepMs(250); }
  // One short chirp the moment the hold counts as "bill" (release now = bill, keep holding = cancel).
  static bool wasLong = false;
  if (button.longReached() && !wasLong) { beepMs(40); feedbackUntil = now + 300; }
  wasLong = button.longReached();
  keepWifi(now);
  pump(now);
  updateLed(now);
  // Last resort: if the hub has been unreachable for a long time, a restart often fixes a wedged Wi-Fi stack.
  if (now - lastHubOk > REBOOT_AFTER_MS) ESP.restart();
  delay(1);
}
