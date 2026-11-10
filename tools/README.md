# `tools/` — strumenti fuori dal workspace

Una riga per strumento. Non sono crate del workspace (target o script
specifici); i comandi si lanciano dalla radice del repo.

- `motori-prova/` — le misure di K0 dei motori Craft collegati a Fub da soli
  (peso, RAM, tempi, librerie doppie); comando principale:
  `node tools/motori-prova/misura.mjs --out DIR`. I numeri vanno in
  `docs/misure/2026-*-motori-*.md`.
- `librerie-runtime/` — la prova del livello 3 di K0: componenti Rust in
  dylib caricati a runtime con `libloading`; comando:
  `node tools/librerie-runtime/prova.mjs --out DIR`.
- `varco-wasm/` — «il varco»: compila il mondo `plugin-world` di
  `crates/fub-abi/wit/fub/abi.wit` per `wasm32-unknown-unknown`; se compila, il
  contratto attraversa il confine. Eseguibile solo dalla CI.
- `ink-wasm-banco/` — `fub-ink` dietro interfaccia C per misurare le
  prestazioni in WASM; lo carica `apps/client/src/ink/wasm.bench.ts`, non la
  shell.
- `vendor-craft/` — gestione delle copie dei motori Craft in `vendor/`
  (derivate da upstream a SHA + patch, con `upstream.lock`); comandi:
  `node tools/vendor-craft/vendor.mjs check` (tutti i motori), poi `update` /
  `verify-upstream` / `gate` per singolo motore.
- `fubdraw-inventory.mjs` — inventario della chiusura di FubDraw (ADR 0231):
  segue gli import dai tre ingressi Vite e lista i moduli raggiunti;
  `node tools/fubdraw-inventory.mjs` (con `--orfani` elenca i moduli morti di
  `editors/spatial`).
