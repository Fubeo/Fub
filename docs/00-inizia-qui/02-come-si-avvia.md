# Come si avvia Fub

Per chi è: studenti e sviluppatori che vogliono compilare, eseguire e testare Fub sul proprio computer.

---

## Prerequisiti

Per compilare Fub servono:
1. **Rust** versione ≥ 1.89 (`rustup default 1.89` o superiore).
2. **Node.js** versione ≥ 20 con npm.
3. **Librerie di sistema (su Linux)**: pacchetti di sviluppo per WebKit2GTK e GTK 3:
   ```bash
   sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev
   ```

---

## 1. Installare le dipendenze del frontend

Prima di tutto, installa i moduli npm per l'interfaccia grafica:

```bash
cd frontend && npm install && cd ..
```

---

## 2. Avviare Fub in modalità sviluppo

Questo comando avvia il server locale di Vite per il frontend e apre la finestra Tauri con ricaricamento a caldo (*hot-reload*):

```bash
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Se vuoi aprire direttamente una cartella di note specifica all'avvio:

```bash
FUB_VAULT="/percorso/della/tua/cartella" cargo tauri dev --config crates/fub-app/tauri.conf.json
```

---

## 3. Compilare la versione finale (Release)

Per generare l'eseguibile unico autonomo (con il frontend già incorporato):

```bash
cargo build --release -p fub-app
```
L'eseguibile pronto all'uso si troverà in `target/release/fub`.

---

## 4. Eseguire i test e i controlli di qualità

```bash
# Esegue tutti i test del workspace Rust
cargo test --workspace

# Controlla i tipi TypeScript del frontend
npm --prefix frontend run typecheck

# Esegue i test del frontend
npm --prefix frontend test

# Controlla i link interni e i formati della documentazione
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```

---

## Se vuoi il dettaglio

- Guarda [`docs/00-inizia-qui/03-struttura-del-repo.md`](./03-struttura-del-repo.md) per conoscere l'albero delle cartelle.
