#!/usr/bin/env bash
# Genera le sorgenti offline del Flatpak in packaging/flatpak/generated/:
#
#   cargo-sources.json  da Cargo.lock (ogni crate, con la sua impronta)
#   node-sources.json   da apps/client/package-lock.json (ogni pacchetto npm)
#
# Il builder di Flatpak non ha la rete: scarica prima queste sorgenti, e
# `cargo --offline` e `npm ci --offline` le trovano già lì. I due file non
# stanno nel repository: si rifanno a ogni build, così seguono sempre i lockfile.
#
# I generatori sono quelli di flatpak-builder-tools (MIT), al commit fissato
# qui sotto. Servono Python 3.10+ e i moduli aiohttp, tomlkit e PyYAML, con
# le versioni e le impronte di requisiti-generatori.txt:
#
#   python3 -m pip install --require-hashes -r packaging/flatpak/requisiti-generatori.txt
#
# Uso: packaging/flatpak/genera-sorgenti.sh
# Con FLATPAK_BUILDER_TOOLS=<cartella> usa una copia di flatpak-builder-tools
# già scaricata (allo stesso commit) invece di scaricarla.
set -euo pipefail

TOOLS_URL=https://github.com/flatpak/flatpak-builder-tools.git
TOOLS_COMMIT=9d86d336a39b9af38b86f114b6ce5820fe260f91

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
out="$here/generated"

if ! python3 -c 'import aiohttp, tomlkit, yaml' 2>/dev/null; then
  echo "mancano i moduli Python dei generatori:" >&2
  echo "  python3 -m pip install --require-hashes -r packaging/flatpak/requisiti-generatori.txt" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

tools=${FLATPAK_BUILDER_TOOLS:-}
if [ -z "$tools" ]; then
  tools="$work/flatpak-builder-tools"
  git init -q "$tools"
  git -C "$tools" fetch -q --depth 1 "$TOOLS_URL" "$TOOLS_COMMIT"
  git -C "$tools" checkout -q FETCH_HEAD
fi
actual=$(git -C "$tools" rev-parse HEAD)
if [ "$actual" != "$TOOLS_COMMIT" ]; then
  echo "flatpak-builder-tools è a $actual, non a $TOOLS_COMMIT" >&2
  exit 1
fi

mkdir -p "$out"

python3 "$tools/cargo/flatpak-cargo-generator.py" "$root/Cargo.lock" \
  -o "$out/cargo-sources.json"

# Il generatore di npm vuole un lockfile senza node_modules accanto: lo legge
# da una copia, così una build locale con node_modules non lo confonde.
mkdir -p "$work/npm"
cp "$root/apps/client/package.json" "$root/apps/client/package-lock.json" "$work/npm/"
PYTHONPATH="$tools/node" python3 -m flatpak_node_generator npm \
  "$work/npm/package-lock.json" -o "$out/node-sources.json"

echo "sorgenti offline in $out"
