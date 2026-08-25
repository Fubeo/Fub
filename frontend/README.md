# Frontend di Fub

Questa cartella contiene la shell TypeScript eseguita nella webview Tauri.

## Responsabilità

Il frontend gestisce layout, pannelli, editor, anteprima, tema, accessibilità e stato locale delle viste. Le regole del vault, le mutazioni e l'indicizzazione appartengono al backend.

Gli import diretti da `@tauri-apps/*` devono restare negli adattatori sotto `src/host/`. Il resto della shell usa il confine interno del progetto e può essere eseguito nei test con un host finto.

## Installazione

Dalla radice:

```bash
npm --prefix frontend ci
```

Oppure, dentro questa cartella:

```bash
npm ci
```

## Comandi

```bash
npm run dev          # server Vite
npm run typecheck    # TypeScript senza emissione
npm test             # unit test
npm run build        # bundle della shell
npm run bench:a11y   # accessibilità resa
npm run bench:verify # confronto visuale con le baseline
```

Tauri avvia automaticamente `npm run dev` quando si usa:

```bash
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

## Struttura essenziale

- `src/host/`: adattatori IPC e dialoghi Tauri;
- `src/editor/`: motore e integrazione dell'editor;
- `src/panels/`: pannelli della shell;
- `src/ui/`: primitive, lifecycle e composizione dell'interfaccia;
- `src/theme/`: ricetta, fogli generati e skin;
- `bench/`: scene, baseline e verifiche visuali.

I file generati non si modificano a mano: si cambia la sorgente che li produce e si esegue il relativo comando di generazione.

## Documentazione

- [`docs/frontend/`](../docs/frontend/README.md): protocollo, IPC, temi e piano delle superfici condivise;
- [`docs/architecture/shell.md`](../docs/architecture/shell.md): confine architetturale;
- [`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md): ciclo completo verificato dalla CI.