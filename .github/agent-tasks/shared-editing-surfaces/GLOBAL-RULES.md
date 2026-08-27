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

## Eccezione approvata — confine delle operazioni tipizzate

La spec [`SURF-023R`](tasks/SURF-023R.md) autorizza soltanto il confine
interno delle operazioni già presente fra `TextEngine`,
`createEditor()` e `apps/client/src/panels/document.ts`. I path autorizzati
sono quelli elencati nella spec; ogni altro path resta soggetto a
`GLOBAL-FORBIDDEN`.

- `TextEngine` emette `EditorChange`, che conserva `text`, `TextOperation` e
  `origin`; `createEditor` inoltra il valore tipizzato come adapter legacy.
- `document.ts`, quando il `Buffer` esiste, valida `TextOperation` contro il
  testo autorevole con `tryApplyOperation`, rifiuta un'operazione stantia o
  incoerente e riallinea la superficie sorgente, senza sovrascrivere un cambio
  più recente.
- Il coordinatore può fare fan-out di `{ text, operation }` soltanto alle
  altre superfici dello stesso documento. `TextEngine.syncDoc()` valida il
  valore ricevuto e usa `operationFromText()` soltanto come fallback locale.
- La history del testo appartiene a CodeMirror: `TextEngine` monta `history()`
  nel `historyCompartment` e il keymap effettivo include `historyKeymap`.
  `syncDoc()` usa insieme `Transaction.addToHistory.of(false)` e
  `Transaction.remote.of(true)`, così un cambio esterno viene mappato sui rami
  senza diventare un evento locale.
- `HistoryFootprints` conserva soltanto al massimo 512 intervalli o anchor,
  senza testo. Se l'overlap è ambiguo, la metadata è sconosciuta o il mapping
  fallisce, `TextEngine` rimuove e reinserisce la history in due transazioni
  pubbliche successive, ricostruisce il sync e scarta entrambi i rami prima
  dell'applicazione. Se il reset fallisce, il sync viene interrotto.

Questa è una forma interna alla shell TypeScript: non è un contratto IPC,
ABI, WIT o pubblico. `document.ts` conserva l'ownership di `Buffer`, revisione
o base, dirty, coda e coordinamento di salvataggio, bozza, conflitto,
rinomina, cancellazione e chiusura.

L'eccezione non autorizza un callback text-only, un bridge nascosto fra
motori, la ricostruzione arbitraria dell'operazione, meccanica generica di
editor o history nel pannello, né l'estrazione di `DocumentSession` o di
qualsiasi responsabilità del `Buffer`.

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