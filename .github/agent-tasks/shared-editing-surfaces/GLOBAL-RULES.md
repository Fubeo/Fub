# Regole globali — SURF Fasi 0–3

Queste regole valgono per tutti i task, salvo una eccezione esplicita nel file del singolo SURF.

## Confini non negoziabili

- Nessuna modifica Rust nelle Fasi 0–3.
- Nessuna modifica IPC, ABI o WIT.
- Nessun nuovo contratto pubblico.
- Nessun nuovo tipo DOM, callback JavaScript o oggetto CodeMirror nel contratto host.
- Nessuna battuta, transazione CodeMirror o completamento locale deve generare una nuova chiamata IPC/WASM.
- Nessuna nuova dipendenza npm e nessuna modifica al lockfile, salvo autorizzazione esplicita fuori da questo piano.
- `createEditor` può restare un adapter temporaneo.
- `TextEngine` non deve conoscere Markdown, wikilink, tag, live preview o `SyntaxForm`.
- `MarkdownProfile` deve conservare integralmente il comportamento osservabile corrente.
- `PlainTextProfile` e `FormulaProfile` devono usare realmente lo stesso `TextEngine`, non una copia o un fake del core.
- Non anticipare `DocumentSession`, `DocumentSurfaceRegistry`, modalità generiche, `.fubsheet`, `GridEngine` o pubblicazione di protocollo.

## GLOBAL-FORBIDDEN

Salvo override esplicito del task:

```text
crates/**
**/*.wit
apps/client/src/host/**
apps/client/src/panels/document.ts
apps/client/src/state/layout.ts
apps/client/package.json
apps/client/package-lock.json
docs/decisions/**
apps/client/bench/baseline/**
.github/**
```

Se un task elenca esplicitamente un path appartenente a `GLOBAL-FORBIDDEN` nei propri `allowed_paths`, quell'eccezione vale soltanto per quel task e soltanto per quei path.

## Disciplina dei test

- Prima di estrarre un comportamento, deve esistere una caratterizzazione osservabile sufficiente.
- Non duplicare test già presenti.
- Non cancellare, indebolire, allargare arbitrariamente o riscrivere expected value esistenti per rendere verde un refactor.
- Un move meccanico deve mantenere gli stessi casi e le stesse aspettative.
- Un test nuovo deve fallire per la regressione che dichiara di presidiare, non soltanto aumentare il coverage nominale.
- Differenze visuali nelle Fasi 0–3 sono escalation, salvo task che dichiari esplicitamente un cambiamento visuale; nessuno dei SURF correnti lo fa.

## Ownership e concorrenza

- Un implementatore non può verificare il proprio task.
- Il verificatore non modifica il codice.
- Due implementatori non possono scrivere contemporaneamente sullo stesso hotspot.
- Un task PASS vale per lo SHA esatto verificato. `amend`, rebase o un commit successivo invalidano la verifica.
- Se una integrazione modifica il commit verificato, il risultato deve essere verificato di nuovo.

## Hotspot

- `H1`: `apps/client/src/editor/editor.ts` e `apps/client/src/editors/text/engine*`.
- `H2`: `apps/client/src/shell.e2e.test.ts`.
- `H3`: `apps/client/src/editor/editor-commands*` e successori Markdown/shared.
- `H4`: composizione `MarkdownProfile`.
- `H5`: `.github/workflows/ci.yml`, `CONTRIBUTING.md` e guard CI.

Un solo task implementatore alla volta può possedere ciascun hotspot.

## Escalation globale

L'implementatore deve fermarsi e restituire `ESCALATION` se:

- serve un forbidden path non esplicitamente consentito;
- emerge una decisione architetturale non coperta dal TODO/task;
- un test di caratterizzazione mostra che il comportamento corrente contraddice una invariante del piano;
- è necessario cambiare ABI/WIT/IPC o un tipo generato;
- è necessario spostare buffer, queue, revision, dirty, draft o conflitti fuori da `document.ts` prima della Fase 4;
- un secondo cliente richiede una modifica al core non prevista dal SURF assegnato;
- si propone una nuova dipendenza per evitare un'implementazione locale semplice;
- compare una differenza visuale non spiegabile come rumore del banco.

L'escalation non è un fallimento: è un risultato corretto quando il task ha raggiunto il proprio confine.