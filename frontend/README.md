# frontend/

La webview dell'app: Vite + TypeScript + CodeMirror 6.

**La documentazione di questa cartella sta in `docs/`**, e non qui: la mappa dei
moduli — `host/`, `state/`, `ui/`, `panels/`, `editor/` — con le regole che la
tengono in piedi è in [docs/07-ui/01-la-shell-e-il-frontend.md](../docs/07-ui/01-la-shell-e-il-frontend.md).
Il protocollo con cui il backend descrive un'interfaccia e questa cartella la
disegna è in [docs/07-ui/02-il-protocollo-ui-node.md](../docs/07-ui/02-il-protocollo-ui-node.md).

Questo file è un cartello, non un documento — e la ragione è che un secondo
posto in cui si racconta com'è fatto il frontend è un secondo posto che
invecchia. Era già successo: fino alla riorganizzazione della documentazione
queste righe promettevano `src/editor.ts`, `src/ui.ts` e `src/api.ts`, spariti
con la [decisione 0015](../docs/decisions/0015-la-forma-della-shell.md) e mai
scollegati di qui.

Comandi: `npm install`, poi `npm run dev` (porta 1420) oppure `npm run build`
(→ `dist/`, che il binario Tauri consuma in release). L'avvio completo dell'app
è nel [README della radice](../README.md).
