# Piano d'azione — superfici di editing condivise

Questo documento prepara Fub a riusare gli stessi motori di interazione in
formati e funzionalità diverse. Il caso che lo rende necessario è concreto: un
futuro foglio di calcolo deve poter usare, dentro una cella e nella barra delle
formule, lo stesso editor di testo che Fub usa già per Markdown, senza copiare
CodeMirror, la gestione del cursore, l'undo, il tema, l'IME, la clipboard e il
lifecycle in ogni plugin.

Il piano non aggiunge oggi una firma al contratto e non apre ancora una nuova
versione WIT. Prima costruisce ed esercita la forma dentro la shell; soltanto
quando esistono almeno due clienti reali la parte stabile può salire in
[`fub-abi`](../../crates/fub-abi/) e nel
[WIT](../../crates/fub-abi/wit/fub/abi.wit).

Rimandi utili:

- [la shell e il frontend](01-la-shell-e-il-frontend.md);
- [il protocollo dichiarativo `UiNode`](02-il-protocollo-ui-node.md);
- [comandi, eventi e IPC](03-comandi-eventi-ipc.md);
- [l'editor e la tastiera](../roadmap/18-editor-e-tastiera.md);
- [le due pile di undo](../decisions/0045-l-undo-ha-due-pile.md);
- [i riquadri sono un fatto della shell](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md);
- [chi vede il modello parsato](../decisions/0018-chi-vede-il-modello-parsato.md);
- [il piano è della superficie](../decisions/0150-il-piano-e-della-superficie.md).

---

## 1. Risultato atteso

La forma finale è questa:

```text
Documento aperto
      │
      ▼
DocumentSession della shell
      │
      ▼
DocumentSurfaceRegistry
      │
      ├── TextEngine
      │     ├── MarkdownProfile
      │     ├── PlainTextProfile
      │     ├── FormulaProfile
      │     ├── CellTextProfile
      │     └── CodeProfile
      │
      ├── GridEngine
      │     ├── griglia virtualizzata
      │     ├── selezione di celle
      │     ├── formula bar ─────────► TextEngine + FormulaProfile
      │     └── editor della cella ──► TextEngine + CellTextProfile
      │
      ├── StructuredEngine
      │     └── futuro editor visuale DOCX/rich text
      │
      └── CanvasEngine
            └── diagrammi, mappe, whiteboard
```

La regola architetturale è:

> **La shell fornisce famiglie di superfici di editing. I plugin le scelgono,
> le configurano e le alimentano; non le reimplementano.**

Markdown, foglio di calcolo e DOCX non devono dipendere l'uno dall'altro. Tutti
possono dipendere da servizi della shell. Una correzione a input Unicode, IME,
clipboard, selezioni, lifecycle o tema deve essere fatta una volta sola e
raggiungere ogni cliente del servizio.

---

## 2. Stato da cui si parte

La base esiste già, ma oggi le responsabilità sono composte nello stesso punto.

[`frontend/src/editor/editor.ts`](../../frontend/src/editor/editor.ts) possiede
sia il motore generico sia il profilo Markdown. Sono già generiche:

- costruzione e distruzione di `EditorView`;
- sostituzione del documento senza trascinare la history della nota precedente;
- sincronizzazione minima fra due editor sullo stesso documento;
- esclusione delle modifiche remote dalla pila locale di undo;
- conversione fra code unit e byte UTF-8;
- selezioni multiple con primaria distinta;
- preservazione dei terminatori CRLF;
- focus e salto a un offset;
- cambio di luce senza ricostruzione;
- teardown di observer e listener posseduti da CodeMirror.

Sono invece specifici di Markdown:

- `markdown()` e `markdownLanguage`;
- live preview;
- wikilink e tag;
- `SyntaxForm`;
- completamenti del vault;
- parte dei comandi di editing;
- le modalità Sorgente, Live Preview e Lettura.

[`frontend/src/panels/document.ts`](../../frontend/src/panels/document.ts)
possiede già la decisione più importante: il buffer è **per documento**, mentre
l'editor è una superficie del riquadro. Due riquadri sulla stessa nota
condividono testo, revisione, debounce e stato dirty, ma non cursore, scroll e
pila locale di undo. Questa separazione va estratta e resa esplicita, non
sostituita.

[`frontend/src/state/layout.ts`](../../frontend/src/state/layout.ts) distingue
già le tab di documento dalle view dichiarate. Un foglio resta una tab di
documento: cambia la superficie montata, non l'identità della tab.

Il protocollo [`UiNode`](../../crates/fub-abi/src/ui.rs) possiede già input,
tabelle, form e `Custom { ns, payload, fallback }`. Il frontend ha già un
[registro di renderer custom](../../frontend/src/ui/custom.ts) con disposer.
Questa strada è utile per il primo banco della griglia, ma non deve diventare un
canale che trasferisce un intero workbook a ogni ridisegno.

Il [`FormatProvider`](../../crates/fub-abi/src/format.rs) trasforma una sorgente
nel [`DocumentModel`](../../crates/fub-abi/src/model.rs) comune. Non deve
assorbire l'editor: formato e superficie hanno una relazione molti-a-molti.

---

## 3. Distinzioni da non perdere

### 3.1 Motore e profilo

Un **motore** risolve problemi meccanici comuni. Un **profilo** aggiunge la
semantica di un dominio.

| Livello | Responsabilità |
| --- | --- |
| `TextEngine` | buffer CodeMirror, selezioni, undo, focus, lifecycle, tema, line ending, aggiornamenti programmatici |
| `MarkdownProfile` | parser Markdown, live preview, wikilink, tag, callout, completamenti e comandi Markdown |
| `FormulaProfile` | sintassi delle formule, riferimenti A1, funzioni e completamenti |
| `CellTextProfile` | editing breve o multilinea, commit/cancel, nessuna live preview |
| `PlainTextProfile` | testo senza semantica aggiuntiva |

Un profilo fidato può produrre estensioni CodeMirror. Un plugin WASM non può
mandare estensioni JavaScript, closure o oggetti DOM attraverso il confine.

### 3.2 Superficie e formato

Un formato può avere più superfici:

- Markdown: sorgente, live preview, lettura;
- DOCX: visuale, lettura, ispezione XML;
- foglio: griglia, lettura, ispezione formule.

Una superficie può servire più formati:

- il motore testuale serve Markdown, JSON, formule, codice e celle;
- la griglia può servire un formato Fub, CSV e in seguito XLSX;
- il motore strutturato può servire DOCX e altri documenti rich text.

Per questo la scelta della superficie non va incorporata come dettaglio
obbligatorio di `FormatProvider` prima di avere clienti reali.

### 3.3 Documento e superficie

Il documento ha una sola autorità. La superficie è una proiezione interattiva.

La sessione del documento possiede:

- contenuto o modello autorevole;
- revisione di base;
- stato dirty;
- coda di salvataggio;
- bozza;
- esito dell'ultima scrittura;
- conflitto;
- sottoscrittori;
- lifecycle legato alle tab aperte.

La superficie possiede:

- cursore o cella attiva;
- selezione;
- scroll;
- zoom locale;
- modalità attiva;
- history locale dell'editing in corso;
- stato visuale catturabile e ripristinabile.

### 3.4 Componente condiviso e plugin

Non tutto ciò che è riusabile deve essere un plugin installabile. CodeMirror è
un servizio della shell, non un plugin dal quale dipendono altri plugin.

Questo evita:

- dipendenze plugin→plugin;
- problemi di ordine di caricamento;
- copie diverse di `@codemirror/state`;
- incompatibilità di versione;
- una chiamata IPC o WASM per ogni battuta;
- accesso arbitrario alla webview principale;
- più implementazioni di IME, clipboard e accessibilità.

---

## 4. Invarianti

Il lavoro è corretto soltanto se restano vere tutte queste proprietà.

### 4.1 Documento

- [ ] Un documento aperto in due riquadri ha un solo buffer autorevole.
- [ ] Ogni superficie conserva cursore, scroll e undo propri.
- [ ] Il debounce del salvataggio è per documento, non per riquadro.
- [ ] Una modifica esterna non sovrascrive un buffer sporco.
- [ ] Le scritture restano guardate dalla revisione.
- [ ] Le bozze restano associate al documento.
- [ ] Rinomina e cancellazione migrano o chiudono la sessione una volta sola.
- [ ] Chiudere l'ultima tab esegue flush, eventuale bozza e teardown nell'ordine deciso.

### 4.2 Motore testuale

- [ ] Il core testuale non importa Markdown, wikilink, tag o `SyntaxForm`.
- [ ] Le selezioni continuano a uscire in byte UTF-8.
- [ ] I file CRLF non vengono normalizzati involontariamente.
- [ ] Caricare un altro documento elimina la history del precedente.
- [ ] Sincronizzare un altro riquadro non entra nella history locale.
- [ ] Il cambio di tema non ricostruisce il documento.
- [ ] `destroy()` rilascia l'istanza e tutto ciò che essa possiede.
- [ ] Nessun file fuori dal package del motore importa direttamente `@codemirror/*`.

### 4.3 Superfici

- [ ] Ogni superficie ha un id e una famiglia stabili.
- [ ] Ogni superficie dichiara le modalità che supporta.
- [ ] Mount, suspend, resume e destroy hanno una semantica esplicita.
- [ ] Una registrazione appartiene a un owner e sparisce con lui.
- [ ] Famiglia o profilo sconosciuti producono un fallback leggibile.
- [ ] Spegnere un bundle non lascia renderer, timer, observer o comandi vivi.
- [ ] Nessuna superficie manda IPC a ogni carattere digitato.

### 4.4 Contratto

- [ ] Il contratto pubblico non contiene tipi CodeMirror, DOM o callback JS.
- [ ] Tutto ciò che attraversa il confine è serializzabile e rappresentabile in WIT.
- [ ] Nativo e WASM ricevono la stessa semantica.
- [ ] Non nasce un IPC specifico per ogni famiglia di editor.
- [ ] Payload grandi vengono richiesti a finestre o per operazioni incrementali.
- [ ] Ogni capability pubblica ha versione, limiti e fallback.

---

## 5. Vocabolario proposto

### `DocumentSession`

Stato autorevole di un documento aperto e coordinamento di salvataggio,
conflitti, bozze e sottoscrittori.

### `EditorSurface`

Superficie interattiva montata in un riquadro: testo, griglia, documento
strutturato, canvas o viewer.

### `EditorEngine`

Implementazione tecnica di una famiglia: CodeMirror, griglia virtualizzata,
motore rich text o canvas.

### `EditorProfile`

Configurazione semantica di un engine: Markdown, formula, testo della cella,
JSON o codice.

### `DocumentSurfaceRegistry`

Registro della shell che risolve una richiesta in una factory, monta la
superficie e ne lega la vita a un owner.

### `SurfaceRequest`

Richiesta serializzabile di una famiglia e di un profilo noti, senza codice
frontend arbitrario.

```json
{
  "family": "fub.text@1",
  "profile": "markdown",
  "configuration": {
    "mode": "live_preview"
  }
}
```

---

## 6. API interne candidate

Queste firme sono una bozza TypeScript interna. Non vanno copiate nel WIT prima
di avere Markdown, un secondo profilo e la griglia in funzione.

```ts
export type SurfaceFamily =
  | "text"
  | "grid"
  | "structured"
  | "canvas"
  | "viewer";

export interface SurfaceViewState {
  version: number;
  value: unknown;
}

export interface EditorSurface {
  readonly family: SurfaceFamily;
  readonly surfaceId: string;

  focus(target?: unknown): void;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: Theme): void;

  captureViewState(): SurfaceViewState;
  restoreViewState(state: SurfaceViewState): void;

  suspend(): void;
  resume(): void;
  destroy(): void;
}
```

La superficie testuale aggiunge soltanto ciò che è proprio del testo:

```ts
export interface TextEditorSurface extends EditorSurface {
  readonly family: "text";

  replaceDocument(text: string): void;
  synchronizeDocument(text: string): void;
  currentText(): string;

  selections(): EditorSelections;
  revealByteOffset(offset: number): void;
  reconfigure(request: TextProfileRequest): void;
}

export interface TextProfileRequest {
  profile: string;
  configuration?: unknown;
}
```

Il registro possiede le factory e il loro owner:

```ts
export interface SurfaceMountContext {
  paneId: string;
  documentId: string;
  parent: HTMLElement;
  session: DocumentSession;
}

export interface SurfaceFactory {
  readonly family: string;
  mount(
    request: SurfaceRequest,
    context: SurfaceMountContext,
  ): EditorSurface;
}

export interface SurfaceRegistration {
  owner: string;
  family: string;
  factory: SurfaceFactory;
}

export interface DocumentSurfaceRegistry {
  register(registration: SurfaceRegistration): () => void;
  resolve(request: SurfaceRequest): SurfaceFactory | null;
  mount(
    request: SurfaceRequest,
    context: SurfaceMountContext,
  ): EditorSurface;
}
```

Ogni `register` restituisce l'unregister. Il bundle non deve conoscere la mappa
interna né svuotarla a mano.

---

## 7. Struttura dei file proposta

```text
frontend/src/editors/
├── core/
│   ├── surface.ts
│   ├── registry.ts
│   ├── selector.ts
│   ├── session.ts
│   ├── commands.ts
│   ├── modes.ts
│   └── view-state.ts
│
├── text/
│   ├── engine.ts
│   ├── surface.ts
│   ├── selection.ts
│   ├── line-endings.ts
│   ├── synchronization.ts
│   ├── theme.ts
│   ├── internal-types.ts
│   └── profiles/
│       ├── markdown/
│       │   ├── profile.ts
│       │   ├── commands.ts
│       │   ├── completions.ts
│       │   ├── live-preview.ts
│       │   └── syntax.ts
│       ├── plain-text.ts
│       ├── formula.ts
│       └── cell-text.ts
│
├── grid/
│   ├── engine.ts
│   ├── model.ts
│   ├── viewport.ts
│   ├── selection.ts
│   ├── clipboard.ts
│   ├── keyboard.ts
│   ├── cell-editor.ts
│   ├── formula-bar.ts
│   ├── commands.ts
│   ├── accessibility.ts
│   └── protocol.ts
│
├── structured/
│   └── README.md
│
└── bootstrap.ts
```

La struttura è una destinazione, non un vincolo sul primo commit. Durante la
migrazione [`frontend/src/editor/editor.ts`](../../frontend/src/editor/editor.ts)
può restare come adapter della vecchia API.

---

# PARTE I — separare ciò che esiste

## 8. Fase 0 — caratterizzare prima di spostare

### Obiettivo

Trasformare il comportamento attuale in un oracolo abbastanza forte da
permettere spostamenti meccanici senza affidarsi all'ispezione manuale.

### Lavoro

- [ ] Inventariare tutti gli import `@codemirror/*`.
- [ ] Classificare ogni parte dell'editor come generica o Markdown.
- [ ] Elencare le assunzioni Markdown presenti nel pannello documenti.
- [ ] Conservare baseline visuali nelle due luci.
- [ ] Aggiungere test per i casi oggi affidati ai commenti.

### Test di caratterizzazione

- [ ] `replaceDocument` elimina la history precedente.
- [ ] `synchronizeDocument` applica la modifica minima.
- [ ] La sincronizzazione non muove inutilmente il cursore.
- [ ] La sincronizzazione non entra nella history locale.
- [ ] Due riquadri condividono il testo.
- [ ] Due riquadri non condividono l'undo locale.
- [ ] Un autosave appartiene al documento.
- [ ] CRLF e file misti seguono la politica attuale.
- [ ] Selezioni multiple, primaria, accenti ed emoji attraversano UTF-8.
- [ ] Il cambio di tema non cambia testo o selezione.
- [ ] Live preview e `SyntaxForm` si riconfigurano senza ricostruzione.
- [ ] `destroy()` non lascia observer o listener vivi.

### Uscita

Nessuna differenza visiva e nessuna modifica a Rust, IPC o WIT.

---

## 9. Fase 1 — estrarre `TextEngine`

### Da estrarre

- costruzione di `EditorView`;
- listener di testo e selezione;
- gestione programmatica degli aggiornamenti;
- sostituzione e sincronizzazione del documento;
- line ending;
- conversioni UTF-8;
- focus e reveal;
- read-only;
- lifecycle;
- compartimento del tema;
- cattura dello stato visuale.

### Da lasciare fuori

- parser Markdown;
- live preview;
- wikilink e tag;
- completamenti del vault;
- `SyntaxForm`;
- comandi dipendenti dalla sintassi Markdown.

### Compatibilità

La vecchia factory deve diventare temporaneamente un adapter:

```ts
export function createEditor(
  parent: HTMLElement,
  options: EditorOptions,
): Editor {
  return legacyMarkdownAdapter(
    createTextSurface(parent, markdownProfile(options)),
  );
}
```

In questa fase [`panels/document.ts`](../../frontend/src/panels/document.ts) non
cambia ancora cliente.

### Uscita

- [ ] I test preesistenti restano verdi.
- [ ] `TextEngine` non importa niente di Markdown.
- [ ] La vecchia API continua a funzionare attraverso l'adapter.
- [ ] Tema e resa restano identici.
- [ ] Nessun nuovo canale IPC.

---

## 10. Fase 2 — rendere Markdown un profilo

### Lavoro

- [ ] Spostare language support nel profilo.
- [ ] Spostare live preview.
- [ ] Spostare wikilink e tag.
- [ ] Spostare completamenti e relative dipendenze.
- [ ] Spostare la riconfigurazione di `SyntaxForm`.
- [ ] Classificare uno per uno i comandi di `editor-commands.ts`.
- [ ] Tenere nel core soltanto i comandi che conservano significato in plain text, formula e cella.
- [ ] Sostituire `setLivePreview` e `setSyntaxForms` con la configurazione del profilo.

Un comando di lista, task, wikilink, heading o blockquote è Markdown. Un comando
come undo, selezione o duplicazione di una riga può essere generico soltanto se
il secondo profilo lo esercita con la stessa semantica.

### Uscita

- [ ] Nel motore non compare la parola `markdown`.
- [ ] Il corpus di live preview resta verde.
- [ ] Tutte le funzionalità dell'editor attuale passano dal profilo.
- [ ] Riconfigurare il profilo non perde la history.
- [ ] Il profilo può essere montato e distrutto più volte.

---

## 11. Fase 3 — secondo e terzo cliente

L'astrazione non è dimostrata finché esiste soltanto Markdown.

### `PlainTextProfile`

Deve offrire:

- lo stesso motore;
- nessun parser Markdown;
- nessuna live preview;
- nessun completamento del vault;
- nessun click semantico;
- stessi line ending, selezioni, tema e lifecycle.

### `FormulaProfile`

Prima versione:

- single line configurabile;
- operatori, numeri, stringhe e riferimenti A1;
- completamento di funzioni;
- completamento dei nomi di foglio;
- commit e cancel espliciti;
- nessuna chiamata al provider per carattere.

### Banco

Creare una fixture che monti insieme:

```text
[MarkdownProfile]
[PlainTextProfile]
[FormulaProfile]
```

Una correzione nel core deve raggiungere tutti e tre senza modificare i profili.
Solo allora si può procedere alla generalizzazione della shell.

---

# PARTE II — separare documento e superficie

## 12. Fase 4 — estrarre `DocumentSession`

### Obiettivo

Togliere da `panels/document.ts` la gestione dettagliata del buffer senza
cambiare le decisioni già prese.

```text
DocumentSessionStore
    └── Documento A
        ├── testo/modello
        ├── revisione
        ├── dirty
        ├── bozza
        ├── save queue
        ├── conflitto
        └── sottoscrittori
              ├── pane 1 / superficie A
              └── pane 2 / superficie B
```

### Migrazione

- [ ] Estrarre la mappa dei buffer.
- [ ] Estrarre queue, timer, revisione, dirty, echoes ed esito.
- [ ] Centralizzare modifiche esterne, rename, delete e close.
- [ ] Fare notificare la sessione dalle superfici con un metodo tipizzato.
- [ ] Fare sincronizzare le altre superfici dalla sessione.
- [ ] Lasciare nel pannello soltanto layout, tab, DOM del riquadro, focus e mount.

La sessione non deve contenere cursore, scroll, cella attiva o history locale.

### Uscita

- [ ] Il pannello non implementa più il protocollo di salvataggio.
- [ ] Due superfici dello stesso documento si sincronizzano attraverso la sessione.
- [ ] Conflitti, bozze, rename e cancellazione conservano il comportamento attuale.
- [ ] La sessione muore dopo l'ultima tab, nell'ordine corretto.

---

## 13. Fase 5 — introdurre `DocumentSurfaceRegistry`

### Risoluzione iniziale

1. override esplicito dell'utente;
2. binding esatto per `format_id`;
3. binding per specie della sorgente;
4. fallback testuale se la sorgente è testo;
5. viewer read-only se la sorgente è a byte;
6. superficie di errore esplicita se niente è disponibile.

Il primo mapping può vivere soltanto nella shell:

```ts
registerDocumentSurfaceBinding({
  owner: "core.shell",
  format: "markdown",
  request: {
    family: "fub.text@1",
    profile: "markdown",
  },
});
```

Non è ancora una promessa pubblica. Serve a esercitare selezione, collisione,
fallback e unload.

### Collisioni

Due owner che rivendicano lo stesso binding non devono produrre silenziosamente
“l'ultimo vince”. La collisione deve:

- nominare entrambi gli owner;
- essere deterministica;
- essere testabile;
- consentire in seguito una scelta esplicita dell'utente.

### Uscita

- [ ] Il riquadro non chiama direttamente `createEditor()`.
- [ ] Markdown viene scelto dal registro.
- [ ] Plain text viene montato senza un ramo nel pannello.
- [ ] Una famiglia assente mostra il fallback.
- [ ] Unregister rimuove binding e istanze possedute.

---

## 14. Fase 6 — modalità e tastiera appartengono alla superficie

Le modalità attuali sono nate per Markdown. Una griglia non deve fingere di
avere “live preview”.

```ts
export interface SurfaceMode {
  id: string;
  label: string;
  command?: string;
}

export interface SurfaceModeController {
  modes(): readonly SurfaceMode[];
  currentMode(): string;
  setMode(mode: string): void;
}
```

Esempi:

| Superficie | Modalità |
| --- | --- |
| Markdown | `reading`, `live_preview`, `source` |
| Plain text | `editing`, `reading` |
| Grid | `editing`, `reading`, `formula_inspection` |
| Structured | `editing`, `reading`, `source_inspection` |

Il commutatore della shell deve leggere la superficie attiva. La migrazione del
vecchio `PaneMode` avviene soltanto quando text e grid sono entrambi reali.

### Arbitrato tastiera

Ordine raccomandato:

1. popup o modalità transitoria attiva;
2. editor locale in modifica;
3. superficie attiva;
4. profilo attivo;
5. comandi del documento;
6. comandi del riquadro;
7. comandi globali della shell.

Non vanno aggiunti listener isolati dentro ogni renderer.

---

# PARTE III — il foglio come prova verticale

## 15. Perché il foglio è il cliente giusto

Il foglio costringe l'architettura a dimostrare insieme:

- modello non lineare;
- selezione propria;
- tastiera propria;
- undo a due livelli;
- virtualizzazione;
- editor testuale incorporato;
- formula bar;
- clipboard tabellare;
- grandi quantità di dati;
- superficie posseduta dalla shell e alimentata da un provider.

Non si deve iniziare da XLSX: OOXML, ZIP, stili, relazioni, immagini e formule
Excel nasconderebbero la domanda architetturale sotto un lavoro di compatibilità.

---

## 16. Fase 7 — formato pilota `.fubsheet`

Creare in seguito un provider separato:

```text
crates/fub-format-sheet/
```

Prima versione testuale e versionata:

```json
{
  "schema": 1,
  "workbook": {
    "id": "workbook-1",
    "sheets": [
      {
        "id": "sheet-1",
        "name": "Foglio 1",
        "rows": ["row-1", "row-2"],
        "columns": ["col-1", "col-2"],
        "cells": {
          "row-1:col-1": { "input": "10" },
          "row-1:col-2": { "input": "=A1*2" }
        }
      }
    ]
  }
}
```

### Identità

L'indirizzo A1 non è un'identità persistente. La cella è la coppia
`RowId + ColumnId`; A1 è una proiezione dell'ordine corrente. Inserire una riga
non deve cambiare l'identità di tutte le celle sottostanti.

### Persistito

- input della cella;
- ordine di righe e colonne;
- dimensioni esplicite;
- stile semantico;
- metadati del foglio;
- versione dello schema.

### Derivato

- AST della formula;
- valore calcolato;
- grafo delle dipendenze;
- indirizzo A1;
- cache visuale;
- errori di valutazione;
- viewport e selezione.

### Proiezione comune

Il workbook autorevole non va schiacciato dentro `DocumentModel`. Il provider
produce una proiezione per il resto di Fub:

- fogli nell'outline;
- nomi, input e valori testuali nella ricerca;
- eventuali riferimenti fra documenti come link;
- metadati come proprietà.

---

## 17. Fase 8 — `GridEngine`

### Primo vertical slice

- [ ] una sheet visibile;
- [ ] righe e colonne;
- [ ] intestazioni;
- [ ] viewport virtualizzata;
- [ ] cella attiva;
- [ ] selezione rettangolare;
- [ ] navigazione da tastiera;
- [ ] editor in-cell;
- [ ] formula bar;
- [ ] commit/cancel;
- [ ] copia/incolla TSV;
- [ ] undo del workbook;
- [ ] lettura e scrittura `.fubsheet`.

### Non ancora

- XLSX;
- grafici;
- pivot;
- macro;
- immagini;
- collaborazione;
- formule complete di Excel;
- WebView di plugin.

### Composizione

```text
GridCell in modifica
    └── TextEngine + CellTextProfile

FormulaBar
    └── TextEngine + FormulaProfile
```

Deve esistere una sola istanza di editor in-cell, spostata sulla cella attiva.
Non va creato un CodeMirror per cella.

### Editing locale

```text
cella selezionata
      │
      ├── F2 / doppio click / digitazione
      ▼
bozza locale della cella
      │
      ├── battute: solo TextEngine
      ├── Escape: annulla
      ├── Enter/Tab: conferma
      └── blur: politica esplicita
      ▼
GridOperation::SetCell
      ▼
DocumentSession
      ▼
scrittura guardata
```

Nessun carattere digitato deve attraversare IPC o WASM.

---

## 18. Undo del foglio

Prima del commit, `Ctrl-Z` appartiene al `TextEngine` e modifica la bozza della
cella. Dopo il commit, appartiene al workbook e annulla un'operazione:

```text
SetCell
PasteRange
InsertRow
DeleteRow
ResizeColumn
RenameSheet
```

Le due pile non si fondono. Chiudere l'editor in-cell elimina la pila locale;
la sessione del workbook conserva le operazioni finché il documento è aperto.

---

## 19. Formula engine

Prima versione dichiarata:

- numeri e stringhe;
- operatori aritmetici e confronti;
- parentesi;
- riferimenti e intervalli;
- `SUM`, `AVERAGE`, `MIN`, `MAX`, `IF`;
- errori tipizzati;
- rilevamento dei cicli.

L'input è autorevole e persistito. AST, dipendenze, valore ed errore sono
derivati. L'evaluatore autorevole deve stare nel provider Rust o in un modulo
Rust condiviso dal bundle ufficiale. Il frontend può evidenziare e completare,
ma non deve diventare una seconda implementazione autorevole delle formule.

Un commit aggiorna la cella modificata e le dipendenti, non l'intero workbook.

---

## 20. Virtualizzazione, clipboard e accessibilità

### Virtualizzazione

- [ ] Il numero di celle DOM dipende dalla viewport.
- [ ] L'overscan è limitato.
- [ ] Le celle invisibili non possiedono DOM.
- [ ] L'editor in-cell è un overlay riusabile.
- [ ] Scroll e selezione restano stabili dopo gli aggiornamenti.
- [ ] I test contano operazioni e nodi, non millisecondi fragili.

### Clipboard

- [ ] Copia di una cella e di un intervallo.
- [ ] TSV come formato minimo interoperabile.
- [ ] Incolla come una sola operazione di undo.
- [ ] Limite esplicito alle dimensioni.
- [ ] Nessun HTML arbitrario interpretato.
- [ ] Errore visibile, non console silenziosa.

### Accessibilità

- [ ] `role="grid"` e celle semanticamente riconoscibili.
- [ ] Cella attiva e selezione annunciate.
- [ ] Intestazioni di riga e colonna.
- [ ] Navigazione completa da tastiera.
- [ ] Modalità editing distinta dalla navigazione.
- [ ] Focus ripristinato dopo commit/cancel.
- [ ] Errori di formula associati alla cella.
- [ ] Scene visuali nelle due luci e audit axe.

---

# PARTE IV — pubblicare soltanto ciò che ha retto

## 21. Fase 9 — misurare il protocollo

Prima di cambiare `fub-abi`, il vertical slice deve rispondere a queste domande:

1. Qual è il dato minimo per scegliere una superficie?
2. Chi possiede il binding formato→superficie?
3. La scelta è statica, per vault o per documento?
4. Come si negozia la versione?
5. Come si esprime il fallback?
6. Come chiede una griglia una finestra di celle?
7. Come invia un'operazione senza trasferire il workbook intero?
8. Come torna l'insieme delle celle dipendenti?
9. Come si conserva lo stato visuale?
10. Cosa accade durante l'unload del bundle?
11. Quali operazioni richiedono capacità di scrittura?
12. Come si localizzano errori e stati mancanti?
13. Cosa fa una shell che non conosce `fub.grid@2`?
14. Quale parte deve attraversare davvero il confine WASM?

Un tipo entra nel contratto soltanto se:

- [ ] ha almeno due clienti;
- [ ] non contiene dettagli del framework frontend;
- [ ] ha fallback e politica di versione;
- [ ] ha errori tipizzati e limiti dimensionali;
- [ ] attraversa WIT;
- [ ] è provato nativamente e via WASM;
- [ ] non richiede chiamate per battuta;
- [ ] sopravvive allo spegnimento del plugin;
- [ ] non duplica query, comandi, view o scritture esistenti.

---

## 22. Forma pubblica candidata

Non è una firma approvata. È il minimo candidato da confrontare col vertical
slice.

```rust
pub struct DocumentSurfaceSpec {
    pub id: String,
    pub format: String,
    pub family: String,
    pub profile: Option<String>,
    pub protocol: u32,
    pub config: serde_json::Value,
    pub fallback: SurfaceFallback,
}

pub enum SurfaceFallback {
    SourceText,
    RenderedPreview,
    DeclarativeView(ViewId),
    Unsupported(Text),
}

pub trait SurfaceProvider: Send + Sync {
    fn document_surfaces(&self) -> Vec<DocumentSurfaceSpec>;
}
```

Un provider separato è preferibile a un nuovo metodo obbligatorio di
`FormatProvider`: un formato può avere più superfici e un bundle può fornire
una superficie per il formato di un altro bundle.

La shell deve dichiarare le capability che conosce:

```json
{
  "surfaces": [
    {
      "family": "fub.text",
      "versions": [1],
      "profiles": ["markdown", "plain-text", "formula", "cell-text"]
    },
    {
      "family": "fub.grid",
      "versions": [1]
    }
  ]
}
```

Una capability assente non è un errore di sicurezza: è una funzionalità non
disponibile che deve degradare nel fallback dichiarato.

---

## 23. Fiducia e sandbox

### Shell fidata

Può registrare:

- factory di superfici;
- profili CodeMirror;
- renderer custom;
- motori grid, rich text e canvas;
- integrazioni DOM;
- comandi locali.

### Plugin nativo

Può fornire provider e servizi backend. Non riceve automaticamente accesso al
DOM della webview.

### Plugin WASM non fidato

Può:

- dichiarare una superficie conosciuta;
- fornire dati e ricevere azioni;
- interrogare il vault attraverso `HostApi`;
- applicare operazioni con le capacità concesse;
- eseguire job;
- restituire fallback dichiarativi.

Non può:

- importare CodeMirror nella shell;
- mandare closure JavaScript;
- accedere direttamente al DOM;
- iniettare markup attivo;
- bypassare il `Guard`;
- inventare un canale verso il provider.

La `WebView` resta un escape hatch futuro, subordinato ad asset story, CSP,
origine isolata, permessi, messaggistica e lifecycle. Non è la strada del foglio
ufficiale.

---

## 24. Fase 10 — ABI, WIT e WASM

Quando la forma interna è stata misurata:

- [ ] aggiungere i tipi in `fub-abi`;
- [ ] re-esportarli dalla radice;
- [ ] aggiungere il trait minimo;
- [ ] aggiornare il WIT vivo;
- [ ] verificare l'additività rispetto alle copie congelate;
- [ ] aggiornare mirror TypeScript e fake host;
- [ ] aggiornare `MemoryHost` e `fub-testkit`;
- [ ] implementare il proxy in `fub-wasm-host`;
- [ ] aggiornare inventario e lifecycle dei bundle;
- [ ] creare un esempio WASM;
- [ ] provare parità nativo↔WASM;
- [ ] documentare limiti, fallback e negoziazione;
- [ ] eseguire l'intero ciclo di [`CONTRIBUTING.md`](../CONTRIBUTING.md).

L'esempio WASM deve dichiarare una piccola griglia, modificare una cella,
funzionare con `fub.grid@1`, degradare su una shell senza griglia e smontarsi
senza lasciare registrazioni.

---

# PARTE V — motore strutturato e DOCX

## 25. DOCX non è CodeMirror con più decorazioni

DOCX contiene paragrafi, run, stili, sezioni, tabelle, immagini, note,
intestazioni, piè di pagina, campi e relazioni OOXML. CodeMirror può servire per
ispezione XML, formule, codice e fallback sorgente; non deve essere forzato a
fare l'editor visuale principale.

Il lavoro su sessioni, registry, lifecycle, comandi, modalità e salvataggio deve
preparare una seconda famiglia:

```ts
export interface StructuredEditorSurface extends EditorSurface {
  applyDocumentModel(model: StructuredDocument): void;
  selection(): StructuredSelection;
  applyOperation(operation: StructuredOperation): void;
}
```

Un vero provider DOCX richiederà inoltre una scrittura a byte con la stessa
disciplina di revisione e conflitto della scrittura testuale. Non va iniziato
prima che la famiglia `structured` e quella porta esistano.

---

# PARTE VI — test, CI e migrazione

## 26. Matrice minima dei test

### Text engine

- line ending;
- sincronizzazione minima;
- offset UTF-8;
- multi-selection;
- undo;
- read-only;
- focus;
- tema;
- teardown;
- riconfigurazione.

### Profili

Per ogni profilo: mount, configurazione, comandi, completamenti, teardown e
assenza di dipendenze vietate.

### Sessioni

Buffer condiviso, subscriber multipli, debounce unico, conflitto, bozza,
rename, delete, close, modifica esterna, echo, fault injection e gare
deterministiche.

### Registry

Registrazione, collisione, owner, unregister, fallback, versione sconosciuta,
profilo sconosciuto e unload.

### Grid

Coordinate, identità di righe e colonne, selezione, tastiera, viewport,
overscan, overlay, formula bar, commit/cancel, paste, undo, resize, formule,
cicli, serializzazione e migrazione dello schema.

### Contratto

Round-trip JSON, Rust↔WIT, additività, mirror TypeScript, host nativo, host WASM,
fallback, negoziazione ed errori.

### End-to-end

Aprire Markdown, plain text e foglio; split dello stesso documento; cambio tab;
cambio superficie; unload; riavvio; recupero bozza; conflitto esterno; tema;
lingua; sola tastiera.

---

## 27. Presidi CI da aggiungere

Pochi e legati a regressioni silenziose reali.

### Import CodeMirror

```text
nessun import @codemirror/* fuori da frontend/src/editors/text/
```

Durante la migrazione l'adapter storico può essere un'eccezione nominata e con
una condizione di rimozione.

### Binding validi

Ogni binding formato→superficie deve riferirsi a famiglia, profilo e fallback
registrati.

### Dopo la pubblicazione dell'ABI

Ogni famiglia pubblica deve avere implementazione shell, fallback, mirror,
conformità nativa e conformità WASM.

Non servono guard per ordine estetico dei file, numero di profili o struttura
esatta delle cartelle.

---

## 28. Sequenza dei commit

Niente big bang. Ogni commit appartiene a una sola specie:

1. test di caratterizzazione;
2. spostamento meccanico;
3. astrazione con adapter;
4. migrazione di un cliente;
5. rimozione dell'adapter;
6. nuova funzionalità.

Ordine raccomandato:

1. test e baseline;
2. estrazione del core testuale;
3. adapter della vecchia API;
4. profilo Markdown;
5. plain text;
6. formula;
7. presidio sugli import;
8. `DocumentSession`;
9. registry;
10. modalità per superficie;
11. formato `.fubsheet`;
12. grid verticale;
13. cell editor e formula bar condivisi;
14. undo, clipboard, formule e accessibilità;
15. misura del protocollo;
16. proposta ABI;
17. WIT, mirror, SDK e proxy WASM;
18. esempio di terzi e fallback;
19. rimozione degli ultimi adapter.

Rinomine, spostamenti, cambiamenti di comportamento e aggiornamenti visuali non
vanno mescolati nello stesso commit.

---

## 29. Rischi e segnali precoci

| Rischio | Segnale | Risposta |
| --- | --- | --- |
| Astrazione soltanto nominale | il core riceve ancora `SyntaxForm` o callback wikilink | secondo profilo obbligatorio prima del registry |
| ABI prematura | ogni modifica alla griglia richiede cambiare il WIT | protocollo interno fino al vertical slice |
| Dipendenza plugin→plugin | il foglio importa il plugin Markdown | entrambi consumano servizi della shell |
| CodeMirror fuoriesce | nuovi import in feature e renderer | presidio sugli import |
| Chiamata per battuta | lag e code IPC | bozza locale e commit esplicito |
| Due verità | frontend e Rust calcolano formule diverse | evaluatore autorevole unico |
| Undo ambiguo | `Ctrl-Z` modifica il workbook mentre si scrive | priorità contestuale e pile separate |
| Modalità universali finte | la griglia acquisisce “live preview” | modalità dichiarate dalla superficie |
| Grid non accessibile | funziona soltanto con mouse | ARIA e tastiera dal primo vertical slice |
| Renderer orfano | timer dopo la chiusura | disposer e test di unload |
| Payload enorme | workbook intero a ogni refresh | finestre e operazioni incrementali |
| XLSX blocca il progetto | il lavoro si concentra su OOXML | `.fubsheet` prima di XLSX |
| `DocumentModel` si gonfia | celle e stili entrano nel contratto comune | proiezione, non autorità |
| DOCX forzato nel testo | fedeltà insufficiente e complessità crescente | famiglia `structured` distinta |
| Registro opaco | due owner rivendicano lo stesso formato | collisione tipizzata e scelta deterministica |
| Stato perso al cambio | testo, cursore o selezione spariscono | sessione separata e view state catturabile |

---

## 30. Definition of Done

La predisposizione è completa quando:

- [ ] Markdown usa `TextEngine` attraverso `MarkdownProfile`.
- [ ] Il core testuale non conosce Markdown.
- [ ] Plain text usa lo stesso motore.
- [ ] Formula bar e cell editor usano lo stesso motore.
- [ ] Una correzione al core raggiunge tutti i profili.
- [ ] Il pannello documenti monta superfici attraverso il registro.
- [ ] Il buffer appartiene alla sessione del documento.
- [ ] Cursore, scroll e undo appartengono alla superficie.
- [ ] La griglia non crea un CodeMirror per cella.
- [ ] Nessuna battuta genera IPC.
- [ ] Il foglio ha un undo operativo separato dall'undo testuale.
- [ ] Famiglia e profilo sconosciuti hanno un fallback.
- [ ] Un owner disabilitato rimuove registrazioni e istanze.
- [ ] Un plugin WASM può richiedere una superficie conosciuta.
- [ ] Un plugin WASM non può iniettare JavaScript nella shell.
- [ ] Rust, WIT, TypeScript, SDK, host nativo e WASM sono conformi.
- [ ] `DocumentModel` resta agnostico rispetto a celle e DOCX.
- [ ] Banchi visuali e di accessibilità coprono testo e griglia.
- [ ] Tutta la CI è verde.

---

## 31. Primo blocco eseguibile

Il primo blocco non costruisce il foglio. Rende vero il riuso e deve poter
atterrare senza modifiche al backend:

1. aggiungere i test di caratterizzazione mancanti;
2. creare `frontend/src/editors/text/`;
3. estrarre line ending, selezioni e sincronizzazione;
4. costruire `TextEngine` mantenendo `createEditor` come adapter;
5. estrarre `MarkdownProfile`;
6. aggiungere `PlainTextProfile`;
7. aggiungere una piccola fixture con Markdown e plain text affiancati;
8. introdurre il presidio sugli import CodeMirror;
9. eseguire typecheck, test, build e banco visuale;
10. soltanto dopo aprire il lavoro su `DocumentSession` e registry.

Questo blocco produce già un risultato verificabile: due profili diversi usano
lo stesso motore, mentre l'app Markdown continua a comportarsi esattamente come
prima.

---

## 32. Cose da non fare

- Non rendere il plugin Markdown una dipendenza degli altri plugin.
- Non permettere a ogni plugin di portarsi una copia di CodeMirror.
- Non aggiungere un ramo per formato in dieci pannelli.
- Non trasformare `DocumentModel` nel modello completo di ogni formato.
- Non passare il modello parsato salvato alla live preview di un buffer sporco.
- Non far salvare direttamente le superfici.
- Non fare IPC per ogni battuta.
- Non pubblicare subito un'API WIT grande.
- Non usare una WebView per il foglio ufficiale.
- Non iniziare da XLSX.
- Non usare CodeMirror come editor visuale DOCX.
- Non imporre lo stesso enum di modalità a ogni superficie.
- Non lasciare registrazioni senza owner e teardown.
- Non mantenere due implementazioni autorevoli delle formule.
- Non fare una migrazione big bang.

---

## 33. Integrazione futura con `todo.md`

Questo documento è il piano operativo completo. Non modifica oggi il conteggio
delle voci aperte di [`todo.md`](../todo.md), perché prima vanno separate le
**decisioni ancora aperte** dal lavoro già determinato.

Quando si avvia il primo blocco, una seduta dedicata può estrarre soltanto le
domande che richiedono una scelta, per esempio:

- chi possiede il binding formato→superficie;
- quale stato resta nella sessione e quale nella superficie;
- come si risolvono le collisioni;
- quando una famiglia diventa capability pubblica;
- quale protocollo incrementale usa la griglia;
- quale porta di scrittura serve ai documenti binari.

Le estrazioni meccaniche, i test e il vertical slice già descritti qui sono
caselle di lavoro, non nuove voci da decidere. In questo modo il registro resta
onesto: `todo.md` conta decisioni aperte, questo file conserva l'intero percorso
necessario per realizzarle.