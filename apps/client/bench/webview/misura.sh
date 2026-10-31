#!/usr/bin/env bash
# N0, R1, T1 e I1 su una macchina Linux vera, con un comando solo:
#
#   apps/client/bench/webview/misura.sh [--only=S1,S2,...] [--budgets=ci|targets]
#
# Costruisce il client e l'app di release, installa `tauri-driver` dentro
# `target/` (non nel sistema), poi lancia `run.mjs` su tutti gli scenari.
# Senza un display (né X11 né Wayland) usa `xvfb-run`. Le fixture nascono in
# una cartella temporanea: il vault di chi misura non si tocca. Il referto va
# in `apps/client/bench/.output/webview/referto.json`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
client="$root/apps/client"
driver_root="$root/target/tauri-driver"

native_driver="$(command -v WebKitWebDriver || true)"
if [[ -z "$native_driver" && -x /usr/bin/WebKitWebDriver ]]; then
  native_driver=/usr/bin/WebKitWebDriver
fi
if [[ -z "$native_driver" ]]; then
  echo "Manca WebKitWebDriver. Su Debian e Ubuntu:" >&2
  echo "  sudo apt-get install webkit2gtk-driver" >&2
  exit 2
fi

wrap=()
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  if ! command -v xvfb-run >/dev/null; then
    echo "Nessun display e niente xvfb-run. Su Debian e Ubuntu:" >&2
    echo "  sudo apt-get install xvfb" >&2
    exit 2
  fi
  wrap=(xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048")
fi

echo "== il client"
(cd "$client" && npm ci && npm run build)

echo "== l'app di release"
(cd "$root" && cargo build --release --locked -p fub-app --features tauri/custom-protocol)

if [[ ! -x "$driver_root/bin/tauri-driver" ]]; then
  echo "== tauri-driver 2.1.0, in target/tauri-driver"
  cargo install tauri-driver --version "=2.1.0" --locked --root "$driver_root"
fi

echo "== le misure"
cd "$client"
status=0
"${wrap[@]}" node bench/webview/run.mjs \
  --only=S1,S2,S3,S4,S5,S6,S7,R1,T1,I1 --budgets=targets \
  --driver="$driver_root/bin/tauri-driver" --native-driver="$native_driver" \
  "$@" || status=$?

echo
echo "Referto: $client/bench/.output/webview/referto.json"
echo "Commit: $(git -C "$root" rev-parse --short HEAD)"
echo "Sessione: ${XDG_SESSION_TYPE:-sconosciuta}${wrap:+ (Xvfb)}"
exit "$status"
