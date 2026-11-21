#!/usr/bin/env bash
# Build table node firmware and collect the .bin files in dist/.
#   tools/build.sh [-e ENV|all] [-t TABLE]
#     -e  esp01_1m (default) | nodemcuv2 | esp32dev | esp32c3 | all
#     -t  table number baked into the firmware (overrides TABLE_ID in config.local.h)
# Wi-Fi, hub address and node key come from firmware/table_node/config.local.h.
set -euo pipefail
cd "$(dirname "$0")/.."
ENVS=(esp01_1m); TABLE=""
while getopts "e:t:h" o; do
  case $o in
    e) if [ "$OPTARG" = all ]; then ENVS=(esp01_1m nodemcuv2 esp32dev esp32c3); else ENVS=("$OPTARG"); fi ;;
    t) TABLE="$OPTARG" ;;
    *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
done
command -v pio >/dev/null || { echo "PlatformIO ('pio') not found: https://platformio.org/install/cli" >&2; exit 1; }
CFG=firmware/table_node/config.local.h
if [ ! -f "$CFG" ]; then
  cp firmware/table_node/config.local.h.example "$CFG"
  echo "Created $CFG from the example. Edit WIFI_SSID, WIFI_PASS, HUB_HOST and NODE_KEY, then run again." >&2
  exit 1
fi
if [ -n "$TABLE" ]; then
  case $TABLE in ''|*[!0-9]*) echo "table must be a number" >&2; exit 1 ;; esac
  export PLATFORMIO_BUILD_FLAGS="-DTABLE_ID_OVERRIDE=$TABLE"
  SUFFIX="-table$TABLE"
else SUFFIX=""; fi
mkdir -p dist
for e in "${ENVS[@]}"; do
  echo "==> building $e${TABLE:+ for table $TABLE}"
  pio run -s -e "$e"
  cp ".pio/build/$e/firmware.bin" "dist/tablebell-$e$SUFFIX.bin"
  echo "    dist/tablebell-$e$SUFFIX.bin ($(wc -c < "dist/tablebell-$e$SUFFIX.bin" | tr -d ' ') bytes)"
done
