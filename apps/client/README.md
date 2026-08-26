# apps/client/

Il client unificato di Fub: una sola applicazione, una sola logica e più shell
di presentazione.

- `src/main.ts` seleziona l'entrypoint corrente;
- `src/entrypoints/desktop.ts` avvia la shell desktop;
- `src/desktop-shell.ts` compone l'interfaccia desktop esistente;
- `src/shells/desktop/` possiede il bootstrap e le capacità desktop;
- `src/shells/mobile/` definisce il confine della futura shell mobile;
- `src/platform/` descrive capacità concrete, senza condizioni globali
  `isMobile`.

Editor, stato, contratto host, temi e funzionalità restano condivisi. Desktop e
mobile possono avere layout e interazioni profondamente diversi senza diventare
due prodotti distinti.

La documentazione canonica è in
[`docs/architecture/frontend-and-ipc.md`](../../docs/architecture/frontend-and-ipc.md).
L'avvio completo è nel [README della radice](../../README.md).

Comandi locali: `npm ci`, `npm run dev`, `npm run typecheck`, `npm test` e
`npm run build`.
