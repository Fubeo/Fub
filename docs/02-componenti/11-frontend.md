# `frontend` — la shell dell'applicazione

La cartella [`frontend/`](../../frontend) contiene l'interfaccia eseguita nella
webview di Tauri. Mostra lo stato ricevuto dall'host, raccoglie le azioni
dell'utente e usa il confine tipizzato in `src/host/` per comunicare con Rust.

La logica riutilizzabile del prodotto non deve nascere qui. Se un comportamento
può vivere nel contratto, nel kernel o nell'host, la shell lo consuma invece di
replicarlo in TypeScript.

## Responsabilità

- avviare e comporre la finestra principale;
- mostrare explorer, editor, anteprima, ricerca, grafo e altri pannelli;
- mantenere lo stato reattivo della sessione e delle superfici aperte;
- interpretare viste e azioni dichiarative fornite dai provider;
- tradurre input, scorciatoie e dialoghi in chiamate tipizzate all'host;
- applicare temi, localizzazione e regole di accessibilità.

## Struttura corrente

| Percorso | Responsabilità |
|---|---|
| [`src/main.ts`](../../frontend/src/main.ts) | Bootstrap della shell e composizione dei componenti principali. |
| [`src/host/`](../../frontend/src/host) | Contratto TypeScript, IPC Tauri, query generiche e host finto per i test. |
| [`src/state/`](../../frontend/src/state) | Stato condiviso, sessione, salvataggio ed eventi ricevuti dall'host. |
| [`src/panels/`](../../frontend/src/panels) | Pannelli della shell e adattatori delle diverse superfici. |
| [`src/ui/`](../../frontend/src/ui) | Componenti comuni e interprete del protocollo dichiarativo `UiNode`. |
| [`src/editor/`](../../frontend/src/editor) | CodeMirror 6, estensioni di editing e integrazione con il salvataggio. |
| [`src/graph/`](../../frontend/src/graph) | Simulazione, rendering e interazione della graph view. |
| [`src/theme/`](../../frontend/src/theme) | Contratto visivo, ricette e file di tema generati. |
| [`src/i18n/`](../../frontend/src/i18n) | Cataloghi e risoluzione dei testi localizzati. |
| [`src/rules/`](../../frontend/src/rules) | Regole sintattiche, offset e mirror TypeScript dei tipi condivisi. |
| [`bench/`](../../frontend/bench) | Scene Playwright, confronto visuale e audit del contrasto. |

Solo i moduli di confine dedicati possono importare le API Tauri. Le altre parti
della shell dipendono dal contratto TypeScript e possono essere provate con
l'host finto.

## Comandi di sviluppo

```bash
cd frontend
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

`npm ci` usa il lockfile committato. `npm run dev` avvia soltanto Vite; per
avviare l'app desktop completa usare dalla radice:

```bash
cargo tauri dev
```

## Controlli visuali e temi

```bash
cd frontend
npm run theme:verify
npm run bench:verify
npm run bench:a11y
```

I file di tema generati non si modificano a mano: si cambia la sorgente prevista
e si usa lo script proprietario.

## Approfondimenti

- [`../07-ui/01-la-shell-e-il-frontend.md`](../07-ui/01-la-shell-e-il-frontend.md): flusso completo della shell.
- [`../07-ui/02-il-protocollo-ui-node.md`](../07-ui/02-il-protocollo-ui-node.md): protocollo dichiarativo delle viste.
- [`../07-ui/03-comandi-eventi-ipc.md`](../07-ui/03-comandi-eventi-ipc.md): comandi, eventi e confine IPC.
- [`../07-ui/04-temi-e-accessibilita.md`](../07-ui/04-temi-e-accessibilita.md): temi e controlli di accessibilità.
- [`../07-ui/05-superfici-di-editing-condivise.md`](../07-ui/05-superfici-di-editing-condivise.md): piano delle superfici di editing riutilizzabili.
