# Hardware test checklist

Run this once per restaurant installation, and again after changing Wi-Fi settings or firmware.
Tick every box. If one fails, the troubleshooting list at the bottom covers the common causes.

## 1. Hub

- [ ] `node hub/server.js` starts and prints no `WARNING` lines (default `nodeKey` / empty `staffPin` are reported).
- [ ] The phone joins the guest Wi-Fi and the portal page opens by itself (iOS/Android pop-up). If not, `http://192.168.50.1/` opens in the browser.
- [ ] `http://192.168.50.1/waiter` asks for the PIN; a wrong PIN is refused, five wrong PINs lock the login for a minute.
- [ ] Reboot the Raspberry Pi/laptop: the hub, the Wi-Fi and the dashboard come back without touching anything (systemd unit enabled).
- [ ] Press the Pi's power off/on during an open call: after restart the call is still on the dashboard (`hub/data/state.json`).

## 2. Each table node (repeat per table)

- [ ] LED shows two short blinks every 2 s right after power-up (no hub yet), then a brief tick every 5 s once the hub is reached.
- [ ] Dashboard shows the table's card without a "button offline" badge within ~10 s.
- [ ] **Short press** (< 1.5 s): LED lights solid for a moment, the table card turns red "CALL" with a running timer, the buzzer (if fitted) chirps, the dashboard beeps (sound enabled).
- [ ] Waiter taps "I'm coming": within ~4 s the LED turns solid and the card turns purple.
- [ ] "Done" clears the card and the LED goes back to the idle tick.
- [ ] **Hold 1.5 s**: card turns orange "BILL"; LED shows the double pulse. A call that was pending is upgraded, its timer is not reset.
- [ ] **Hold 5 s** while a request is open (answered or not): the request disappears and the LED goes idle.
- [ ] Press the button 10 times quickly: only one entry appears, nothing crashes.
- [ ] Table number on the card equals the number printed on the node. (Wrong `TABLE_ID` flashed is the most common mistake.)

## 3. Robustness (no lost calls)

- [ ] Unplug the hub's Wi-Fi (or stop the hub), press the button: LED keeps two-blink "no hub" pattern. Restore the hub: the call appears on the dashboard within ~15 s without pressing again.
- [ ] Press twice while the hub is down: only one card appears afterwards (the hub de-duplicates).
- [ ] Power-cycle the node while a call is pending: after reboot the LED shows the pending state again (the hub tells it).
- [ ] Move a node to the farthest table: RSSI in the table detail sheet is better than -80 dBm. If worse, add a second AP/repeater or move the hub.
- [ ] 20 nodes powered on at the same moment (after a power cut): all reappear online within a minute.

## 4. Guests

- [ ] Scan the table QR: the page shows the right table number in the header.
- [ ] "Call waiter" turns the card red on the dashboard; "Cancel call" removes it, also after a waiter answered.
- [ ] Order two items: kitchen view shows a ticket, the bar view only shows the drinks.
- [ ] Mark an item "cooking" then "ready" in the kitchen: the guest page shows the statuses, the waiter dashboard shows "Ready to serve".
- [ ] Mark an item "sold out" in the dashboard menu tab: guests can no longer add it (within ~20 s) and the hub refuses a stale cart with HTTP 409.
- [ ] A QR with a wrong or missing `k=` key is refused ("scan the QR code on your table"). A guest cannot order for another table by editing `t=`.
- [ ] Guest taps "Card" or "Cash": the dashboard card shows the payment method; "Paid" closes the table and it turns grey "free".

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| LED two-blink forever | wrong Wi-Fi password/SSID in `config.local.h`; hub IP differs from `HUB_HOST`; `nodeKey` mismatch (HTTP 401, check Serial at 115200) |
| ESP-01 does not boot | GPIO0 held low (button pressed at power-up) or the 3V3 rail sags: ESP-01 needs a real 3.3 V supply with 300+ mA |
| Card flickers online/offline | weak signal, see RSSI; or noisy USB supply |
| Phones show "no internet" and do not open the portal | `dnsmasq-shared.d` wildcard missing (re-run `deploy/setup-ap.sh`); the page still opens manually at `http://192.168.50.1/` |
| Dashboard timers off by a few seconds | phone clocks differ; timers use the hub's clock offset, reload the page |
