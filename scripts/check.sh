#!/usr/bin/env bash
# I controlli della CI, in locale. Stampa una riga per passo; il log intero di
# ogni passo va in target/check/<passo>.log.
#
#   scripts/check.sh                  completo: quello che la CI fa su Linux,
#                                     banchi esclusi. Lo usa l'orchestratore a
#                                     fine piano.
#   scripts/check.sh --rapido         solo ciò che il diff tocca: i crate cambiati
#                                     e quelli che li usano, il client se cambia,
#                                     i guard dei documenti se cambiano. Lo usano
#                                     i coder e l'orchestratore dopo ogni unione.
#
# Opzioni:
#   --base <rev>   il punto da cui contare il diff (predefinito: il merge-base
#                  con origin/main)
#   -p <crate>     limita i crate a questi (ripetibile); vale con --rapido
#   --client       controlla anche il frontend, anche se il diff non lo tocca
#   --banchi       aggiunge i banchi del frontend (lenti, Playwright)
#
# Esce con 0 solo se ogni passo eseguito è verde. Un passo saltato (uno
# strumento o un target che manca su questa macchina) è scritto come SALTA:
# non è una prova, e il resoconto deve dirlo.
#
# Ogni comando di `ci-required` in CONTRIBUTING.md compare anche qui:
# `.github/scripts/check-locale-loop.mjs` lo verifica.

cd "$(git rev-parse --show-toplevel)" || exit 2

MODE=completo
BASE=""
CRATES_ARG=""
WANT_CLIENT=0
WANT_BENCH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rapido) MODE=rapido ;;
    --base) BASE="$2"; shift ;;
    -p) CRATES_ARG="$CRATES_ARG $2"; shift ;;
    --client) WANT_CLIENT=1 ;;
    --banchi) WANT_BENCH=1 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opzione sconosciuta: $1 (vedi --help)" >&2; exit 2 ;;
  esac
  shift
done

LOG_DIR="target/check"
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log
START=$SECONDS
FAILED=""
SKIPPED=""
STEPS=0

# run <nome> <comando...>: esegue, scrive una riga e, se è rosso, i primi errori.
run() {
  name="$1"; shift
  log="$LOG_DIR/$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_').log"
  t0=$SECONDS
  STEPS=$((STEPS + 1))
  if "$@" >"$log" 2>&1; then
    printf 'OK     %-46s %4ss\n' "$name" $((SECONDS - t0))
  else
    printf 'ROSSO  %-46s %4ss  → %s\n' "$name" $((SECONDS - t0)) "$log"
    excerpt=$(grep -E '^(error|warning)(\[|:)|^ *FAIL |panicked at|^test .* FAILED|^failures:|^Error|✗|×' "$log" | head -n 12)
    [ -n "$excerpt" ] || excerpt=$(tail -n 12 "$log")
    printf '%s\n' "$excerpt" | sed 's/^/         /'
    FAILED="$FAILED|$name"
  fi
}

skip() {
  printf 'SALTA  %-46s %s\n' "$1" "$2"
  SKIPPED="$SKIPPED|$1"
}

have() { command -v "$1" >/dev/null 2>&1; }
has_target() { rustup target list --installed 2>/dev/null | grep -qx "$1"; }

# Le librerie di sistema di Tauri mancano su molte macchine (e nelle sessioni
# cloud): lì i crate che dipendono da Tauri si saltano, e il resoconto lo dice.
EXCLUDE=""
TAURI_CRATES=""
SCOPE=$(git diff --name-only HEAD 2>/dev/null | node scripts/check-scope.mjs) || { echo "check-scope.mjs non è riuscito a leggere il workspace" >&2; exit 2; }
TAURI_CRATES=$(printf '%s\n' "$SCOPE" | sed -n 's/^tauri=//p')
if [ "$(uname -s)" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  for c in $TAURI_CRATES; do EXCLUDE="$EXCLUDE --exclude $c"; done
fi
skip_tauri() { # skip_tauri <crate...>: dice quali crate con Tauri restano fuori
  [ -n "$EXCLUDE" ] && [ -n "$*" ] && skip "crate con Tauri: $*" "mancano le librerie di sistema di Tauri (webkit2gtk-4.1)"
}

if have cargo-nextest; then
  NEXTEST=1
else
  NEXTEST=0
  echo "nota   cargo-nextest manca: i test girano con cargo test (stesse prove, più lente)"
fi

tests() { # tests <argomenti di selezione dei crate...>
  if [ "$NEXTEST" = 1 ]; then
    cargo nextest run "$@" --no-fail-fast --profile ci
  else
    cargo test "$@" --no-fail-fast
  fi
}

wasm_prep() {
  if has_target wasm32-wasip2; then
    run "componente d'esempio (wasm32-wasip2)" cargo build --manifest-path esempi/ping-wasm/Cargo.toml --target wasm32-wasip2
  else
    skip "componente d'esempio (wasm32-wasip2)" "target mancante: rustup target add wasm32-wasip2 (i test di fub-wasm-host che lo usano falliranno)"
  fi
}

client_ready() {
  if [ ! -d apps/client/node_modules ]; then
    run "npm ci" bash -c 'cd apps/client && npm ci'
  fi
}

client_checks() { # client_checks completo|rapido
  client_ready
  run "tema rigenerato byte per byte" bash -c 'cd apps/client && npm run theme:generate && git diff --exit-code -- src/theme/scrittoio theme/author && npm run theme:verify'
  run "npm run typecheck" bash -c 'cd apps/client && npm run typecheck'
  if [ "$1" = completo ]; then
    run "npm test" bash -c 'cd apps/client && npm test'
    run "npm run build" bash -c 'cd apps/client && npm run build'
  else
    run "vitest dei file cambiati" bash -c "cd apps/client && npx vitest run --changed $BASE"
  fi
  run "confine CodeMirror" node .github/scripts/check-codemirror-boundary.mjs
  run "confine ProseMirror" bash -c 'node .github/scripts/check-prosemirror-boundary.mjs --self-test && node .github/scripts/check-prosemirror-boundary.mjs'
  run "confine della Tabella" bash -c 'node .github/scripts/check-tabella-boundary.mjs --self-test && node .github/scripts/check-tabella-boundary.mjs'
  run "tema non scritto inline" bash -c 'node .github/scripts/check-inline-theme.mjs --self-test && node .github/scripts/check-inline-theme.mjs'
  run "ascoltatori con una Vita" node .github/scripts/check-listeners.mjs
  run "nessuna attesa nascosta" node .github/scripts/check-races.mjs
  run "pacchetti npm in copia unica" node .github/scripts/check-npm-copies.mjs
}

rust_guards() {
  run "confine host/workspace" node .github/scripts/check-host-workspace-boundary.mjs
  run "confine dei motori" node .github/scripts/check-engine-boundary.mjs
  run "interfaccia e doppioni di fub-app" bash -c 'node .github/scripts/check-motori.mjs --self-test && node .github/scripts/check-motori.mjs'
  run "errori letterali" node .github/scripts/check-error-literals.mjs
  run "commenti di Rust" bash -c 'node .github/scripts/check-rust-comments.mjs --self-test && node .github/scripts/check-rust-comments.mjs'
  run "versioni in un posto solo" node .github/scripts/check-cargo-versions.mjs
  run "versione del prodotto" node .github/scripts/check-release-version.mjs
  run "cargo feature compilate" node .github/scripts/check-cargo-feature-default.mjs
  run "forme di libreria consumate" node .github/scripts/check-crate-type.mjs
  run "profilo dev deciso" node .github/scripts/check-dev-profile.mjs
}

doc_guards() {
  run "link dei documenti" node .github/scripts/check-doc-links.mjs
  run "pagine raggiungibili" node .github/scripts/check-doc-orphans.mjs
  run "soglie delle pagine" node .github/scripts/check-doc-size.mjs
  run "stile del Markdown" node .github/scripts/check-markdown-style.mjs
  run "diagrammi Mermaid" node .github/scripts/check-mermaid.mjs --render
  run "numeri della prosa" bash -c 'node .github/scripts/check-prose.mjs --self-test && node .github/scripts/check-prose.mjs'
  run "tabelle intere" bash -c 'node .github/scripts/check-tables.mjs --autoprova && node .github/scripts/check-tables.mjs'
  run "ciclo locale = CI" bash -c 'node .github/scripts/check-locale-loop.mjs --self-test && node .github/scripts/check-locale-loop.mjs'
}

vendor_guards() {
  run "WordCraft = upstream + patch" node tools/vendor-craft/vendor.mjs wordcraft check
  run "GridCraft = upstream + patch" node tools/vendor-craft/vendor.mjs gridcraft check
  run "patch dei motori a tre vie" node tools/vendor-craft/vendor.mjs self-test
}

benches() {
  client_ready
  for b in "bench:verify" "bench:a11y -- --light=dark" "bench:a11y -- --light=light" "bench:motion" "bench:fidelity" \
           "bench:grid" "bench:large" \
           "bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3" \
           "bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8" \
           "bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 16"; do
    run "npm run $b" bash -c "cd apps/client && npm run $b"
  done
}

# ------------------------------------------------------------------ rapido
if [ "$MODE" = rapido ]; then
  if [ -z "$BASE" ]; then
    BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null)
  fi
  [ -n "$BASE" ] || { echo "non trovo la base del diff: passa --base <rev>" >&2; exit 2; }
  CHANGED=$( { git diff --name-only "$BASE"...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
  SCOPE=$(printf '%s\n' "$CHANGED" | node scripts/check-scope.mjs) || exit 2
  val() { printf '%s\n' "$SCOPE" | sed -n "s/^$1=//p"; }
  CRATES=$(val crates)
  [ -n "$CRATES_ARG" ] && CRATES="$CRATES_ARG"
  echo "base   $(git rev-parse --short "$BASE") · $(printf '%s\n' "$CHANGED" | grep -c .) file cambiati"

  run "cargo fmt --all --check" cargo fmt --all --check

  if [ "$(val all)" = 1 ] && [ -z "$CRATES_ARG" ]; then
    echo "nota   cambia la radice del workspace (Cargo.toml, Cargo.lock…): si controlla tutto"
    skip_tauri $TAURI_CRATES
    run "cargo clippy --workspace" cargo clippy --workspace $EXCLUDE --all-targets -- -D warnings
    wasm_prep
    run "test del workspace" tests --workspace $EXCLUDE
    rust_guards
  elif [ -n "$CRATES" ]; then
    SEL=""
    LEFT_OUT=""
    for c in $CRATES; do
      case " $TAURI_CRATES " in *" $c "*) [ -n "$EXCLUDE" ] && { LEFT_OUT="$LEFT_OUT $c"; continue; } ;; esac
      SEL="$SEL -p $c"
    done
    skip_tauri $LEFT_OUT
    if [ -n "$SEL" ]; then
      echo "crate  $(echo $SEL | sed 's/-p //g')"
      run "cargo clippy (crate toccati)" cargo clippy $SEL --all-targets -- -D warnings
      case " $CRATES " in *" fub-wasm-host "*) wasm_prep ;; esac
      run "test (crate toccati e chi li usa)" tests $SEL
      case " $CRATES " in *" fub-features "*)
        run "fub-features senza feature" cargo check -p fub-features --no-default-features --all-targets ;;
      esac
    fi
    rust_guards
  fi

  if [ "$(val client)" = 1 ] || [ "$WANT_CLIENT" = 1 ]; then client_checks rapido; fi
  if [ "$(val docs)" = 1 ]; then doc_guards; fi
  if [ "$(val github)" = 1 ]; then
    run "action pin a commit" node .github/scripts/check-actions-pinned.mjs
    [ "$(val docs)" = 1 ] || run "ciclo locale = CI" bash -c 'node .github/scripts/check-locale-loop.mjs --self-test && node .github/scripts/check-locale-loop.mjs'
  fi
  if [ "$(val vendor)" = 1 ]; then vendor_guards; fi
  [ "$WANT_BENCH" = 1 ] && benches

# ------------------------------------------------------------------ completo
else
  # invarianti e fmt + clippy, come i job omonimi
  skip_tauri $TAURI_CRATES
  run "action pin a commit" node .github/scripts/check-actions-pinned.mjs
  run "cargo fmt --all --check" cargo fmt --all --check
  run "cargo clippy --workspace --all-targets -- -D warnings" cargo clippy --workspace $EXCLUDE --all-targets -- -D warnings
  run "clippy dell'host senza draw" cargo clippy -p fub-host --no-default-features --features notify-watcher,http-client,official-features,rich --all-targets -- -D warnings
  run "clippy di fub-features con draw" cargo clippy -p fub-features --features draw --all-targets -- -D warnings
  if has_target x86_64-pc-windows-msvc; then
    run "kernel per Windows" cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc
  else
    skip "kernel per Windows" "target mancante: rustup target add x86_64-pc-windows-msvc"
  fi
  rust_guards
  vendor_guards
  run "cancello del rilascio (autoprova)" node .github/scripts/check-release-gate.mjs --self-test
  if has_target wasm32-unknown-unknown; then
    run "il contratto attraversa il confine wasm" cargo build --manifest-path tools/varco-wasm/Cargo.toml --target wasm32-unknown-unknown
  else
    skip "il contratto attraversa il confine wasm" "target mancante: rustup target add wasm32-unknown-unknown"
  fi
  run "le feature ufficiali si spengono" bash -c '
    cargo build -p fub-features --no-default-features &&
    cargo check -p fub-features --no-default-features --all-targets &&
    cargo build -p fub-features --no-default-features --features outline &&
    cargo build -p fub-host --no-default-features --features outline,notify-watcher'
  run "ogni feature ufficiale compila da sola" bash -c '
    set -e
    for f in $(cargo metadata --no-deps --format-version 1 | node -e "
      const m = JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"));
      const p = m.packages.find((x) => x.name === \"fub-features\");
      console.log(Object.keys(p.features).filter((k) => k !== \"default\").join(\" \"));"); do
      cargo check -p fub-features --no-default-features --features "$f"
    done'

  # test, come il job di Linux
  wasm_prep
  if has_target wasm32-wasip2; then
    run "fub-scene e fub-ink per wasm32-wasip2" bash -c '
      cargo check -p fub-scene --target wasm32-wasip2 --all-targets --locked &&
      cargo check -p fub-ink --target wasm32-wasip2 --all-targets --locked'
  fi
  if [ "$NEXTEST" = 1 ]; then
    run "cargo nextest run --workspace --no-fail-fast" cargo nextest run --workspace $EXCLUDE --no-fail-fast --profile ci
  else
    run "cargo test --workspace --no-fail-fast" cargo test --workspace $EXCLUDE --no-fail-fast
  fi
  run "cargo test --workspace --doc --no-fail-fast" cargo test --workspace $EXCLUDE --doc --no-fail-fast
  rm -f target/tmp/*.wasm

  # varianti
  run "host senza draw (test)" tests -p fub-host --no-default-features --features notify-watcher,http-client,official-features,rich
  run "fub-features con draw (test)" tests -p fub-features --features draw
  run "motori di WordCraft (workspace loro)" env CARGO_TARGET_DIR=target/wordcraft cargo test --manifest-path vendor/wordcraft/Cargo.toml --workspace --locked --no-fail-fast
  run "motori di GridCraft (workspace loro)" env CARGO_TARGET_DIR=target/gridcraft cargo test --manifest-path vendor/gridcraft/Cargo.toml --workspace --locked --no-fail-fast

  # supply chain
  if have cargo-deny; then
    run "cargo deny check" cargo deny check
  else
    skip "cargo deny check" "cargo-deny mancante: cargo install --locked cargo-deny"
  fi

  doc_guards
  client_checks completo
  [ "$WANT_BENCH" = 1 ] && benches
fi

# ------------------------------------------------------------------ esito
echo "------"
ELAPSED=$((SECONDS - START))
NFAIL=$(printf '%s' "$FAILED" | tr -cd '|' | wc -c | tr -d ' ')
NSKIP=$(printf '%s' "$SKIPPED" | tr -cd '|' | wc -c | tr -d ' ')
if [ "$NFAIL" = 0 ]; then
  printf 'VERDE  %s passi in %dm%02ds' "$STEPS" $((ELAPSED / 60)) $((ELAPSED % 60))
  [ "$NSKIP" != 0 ] && printf ' · %s saltati: non provati qui' "$NSKIP"
  printf '\n'
  exit 0
else
  printf 'ROSSO  %s passi su %s · log in %s\n' "$NFAIL" "$STEPS" "$LOG_DIR/"
  exit 1
fi
