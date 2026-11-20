#!/bin/sh
# Turns a Raspberry Pi (Raspberry Pi OS Bookworm or newer, NetworkManager) into the restaurant Wi-Fi:
# an access point at 192.168.50.1 with DHCP and a "captive portal" DNS that sends every name to the hub.
#   sudo sh deploy/setup-ap.sh "Tablebell" "a-long-wifi-password"
set -eu
SSID="${1:?usage: setup-ap.sh SSID PASSWORD}"
PASS="${2:?usage: setup-ap.sh SSID PASSWORD}"
IFACE="${IFACE:-wlan0}"
nmcli con delete tablebell-ap >/dev/null 2>&1 || true
nmcli con add type wifi ifname "$IFACE" con-name tablebell-ap autoconnect yes ssid "$SSID" \
  802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel 6 \
  ipv4.method shared ipv4.addresses 192.168.50.1/24 \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS"
# Wildcard DNS: any hostname a phone looks up (connectivity checks included) resolves to the hub,
# which makes phones pop up the portal page automatically.
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo "address=/#/192.168.50.1" > /etc/NetworkManager/dnsmasq-shared.d/tablebell-captive.conf
nmcli con up tablebell-ap
echo "Access point '$SSID' is up on 192.168.50.1. Now start the hub (see README)."
