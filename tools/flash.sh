#!/usr/bin/env bash
# Build and flash a table node over USB, optionally open the serial monitor.
#   tools/flash.sh -t TABLE [-e ENV] [-p PORT] [-m]
#     -t  table number for this node (required)
#     -e  esp01_1m (default) | nodemcuv2 | esp32dev | esp32c3
#     -p  serial port, e.g. /dev/cu.usbserial-110 or COM3 (default: auto-detect)
#     -m  open the serial monitor afterwards (Ctrl+C to leave)
# ESP-01 only: hold GPIO0 to GND while plugging in the USB-serial adapter (flash mode).
# Already have a dist/*.bin? Flash it with BugZapper instead: https://github.com/gumslone/bugzapper
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=esp01_1m; TABLE=""; PORT=""; MON=0
while getopts "e:t:p:mh" o; do
  case $o in
    e) ENV="$OPTARG" ;; t) TABLE="$OPTARG" ;; p) PORT="$OPTARG" ;; m) MON=1 ;;
    *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
done
[ -n "$TABLE" ] || { echo "Missing -t TABLE (table number for this node)" >&2; exit 1; }
command -v pio >/dev/null || { echo "PlatformIO ('pio') not found: https://platformio.org/install/cli" >&2; exit 1; }
tools/build.sh -e "$ENV" -t "$TABLE"
UP=()
if [ -n "$PORT" ]; then UP=(--upload-port "$PORT"); else
  echo "No -p given: PlatformIO will pick the port. Ports seen:"; pio device list | grep -E '^(/dev|COM)' || echo "  (none found, is the board plugged in?)"
fi
echo "==> flashing $ENV as table $TABLE"
PLATFORMIO_BUILD_FLAGS="-DTABLE_ID_OVERRIDE=$TABLE" pio run -e "$ENV" -t upload ${UP[@]+"${UP[@]}"}
echo "Done. Put a label 'Table $TABLE' on this node."
if [ "$MON" = 1 ]; then pio device monitor -b 115200 ${PORT:+-p "$PORT"}; fi
