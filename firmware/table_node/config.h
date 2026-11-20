// Table button node settings. Do not put secrets here: copy config.local.h.example to
// config.local.h (git-ignored) and override what you need there.
#pragma once

#if __has_include("config.local.h")
#include "config.local.h"
#endif

#ifndef TABLE_ID
#define TABLE_ID 1                 // the table number this button belongs to (1..N)
#endif
#ifndef WIFI_SSID
#define WIFI_SSID "Tablebell"      // the restaurant Wi-Fi served by the hub (Raspberry Pi / laptop)
#endif
#ifndef WIFI_PASS
#define WIFI_PASS "changeme123"
#endif
#ifndef HUB_HOST
#define HUB_HOST "192.168.50.1"    // hub IP address (a fixed IP avoids relying on DNS/mDNS)
#endif
#ifndef HUB_PORT
#define HUB_PORT 80
#endif
#ifndef NODE_KEY
#define NODE_KEY "change-me-node-key"   // must equal nodeKey in hub/config.json
#endif

// Pins are set per board in platformio.ini (-DBUTTON_PIN=...). BUZZER_PIN -1 = no buzzer.
#ifndef BUTTON_PIN
#define BUTTON_PIN 0
#endif
#ifndef LED_PIN
#define LED_PIN 2
#endif
#ifndef LED_ACTIVE_LOW
#define LED_ACTIVE_LOW 1
#endif
#ifndef BUZZER_PIN
#define BUZZER_PIN -1
#endif

#define FW_VERSION "1.0"
#define HEARTBEAT_MS 4000UL        // also how fast the LED follows the waiter's "I'm coming"
#define HTTP_TIMEOUT_MS 2500
#define REBOOT_AFTER_MS (10UL * 60UL * 1000UL)   // restart if the hub was unreachable this long
