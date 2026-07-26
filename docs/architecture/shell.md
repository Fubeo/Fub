# La forma della shell

Torna a [PIANO.md](../PIANO.md) · [ui-protocol.md](ui-protocol.md) · [i verbali](../decisions/README.md)

Questo documento dice **dove sta cosa** nel frontend, e quali sono le due o tre
regole che tengono in piedi quella divisione. È il verbale operativo della
[decisione 0015](../decisions/0015-la-forma-della-shell.md): lì c'è il perché,
qui c'è la mappa da consultare quando si scrive un file nuovo.

## Perché un albero dichiarato

Il frontend è nato piatto: quattordici file in `frontend/src/`, con `main.ts` a
1622 righe, 81 funzioni di primo livello e 18 variabili globali mutabili. Non è
successo per disattenzione — è successo perché **non c'era un posto dove
mettere le cose**, e in mancanza di un posto ogni aggiunta finisce nel file più
grande. Il costo non si paga scrivendo la voce che lo provoca: lo paga quella
dopo.

E quelle dopo sono già scritte nella roadmap. Il [§2.1](../roadmap/02-cosa-e-una-view.md)
riversa una ventina di nodi nuovi sul renderer `UiNode`; il [§2.8](../roadmap/02-cosa-e-una-view.md)
gli mette accanto un riconciliatore con le chiavi; il [§2.2](../roadmap/02-cosa-e-una-view.md)
aggiunge cinque superfici; il [§18.2](../roadmap/18-editor-e-tastiera.md) un
registro di scorciatoie; il [§10.3](../roadmap/10-gli-eventi.md) un centro
notifiche. Senza un albero, la divisione la decide chi tocca il file per ultimo.

## L'albero

```
frontend/src/
  main.ts        il punto di montaggio: compone e nient'altro
  style.css      le regole dei componenti

  host/          la cucitura con l'esterno, e nient'altro
    contract.ts    i tipi rispecchiati dal Rust (nessun @tauri-apps)
    ipc.ts         `api` + il canale eventi: i comandi del backend
    dialog.ts      le superfici di SISTEMA: conferme, selettore di cartella

  state/         lo stato condiviso e ciò che lo cambia
    store.ts       i campi condivisi + il bus dei segnali + lo stato di vista
    kernel.ts      il router degli eventi del kernel
    vault.ts       le operazioni sul vault (tutte dal registro comandi)
    organization.ts  il sidecar .fubmd/workspace.json

  ui/            le primitive di interfaccia, senza dominio
    node.ts        il renderer di `UiNode`
    views.ts       il view host: monta ciò che il backend dichiara
    intents.ts     gli intenti che la shell sa eseguire
    palette.ts     la palette dei comandi
    menu.ts        menu contestuale e selettore di icona
    notify.ts      i messaggi che non chiedono risposta
    dom.ts         `$`

  panels/        un modulo per dominio
    document.ts    l'editor, il buffer, la modalità, il contesto di sessione
    preview.ts     il documento reso (modalità Lettura) e gli embed
    explorer.ts    l'albero, gli spazi, le appuntate, il drag & drop
    search.ts      la barra e i risultati
    trash.ts       il cestino, e la conferma prima di cestinare
    history.ts     la cronologia delle versioni
    sidebar.ts     quale pannello della sidebar occupa lo spazio
    graph.ts       il grafo su canvas (superficie privilegiata, fuori da UiNode)

  editor/        i moduli CodeMirror, autonomi e iniettati
    editor.ts, editor-commands.ts, completions.ts, livepreview.ts

  rules/         le regole condivise col Rust
    organizer.ts   alberatura, folder note, nome pagina
    offsets.ts     il ponte byte UTF-8 ↔ code unit UTF-16

  theme/         i token
    tokens.css

  __fixtures__/  le fixture generate da serde (il mirror TS↔Rust)
```

Due cartelle dell'albero **non esistono ancora come codice**, e non è una
dimenticanza:

- `i18n/` — dipende dal [§12.1](../roadmap/12-stringhe-errori-locale.md), che è
  una decisione non ancora presa: dove vive il catalogo, chi localizza gli
  errori del confine, e in che forma. Fare la cartella prima della decisione
  significa deciderla per inerzia.
- `theme/` esiste ma con **solo i token di oggi**. Il sistema vero — scala
  semantica, chiaro/scuro/sistema, snippet CSS dell'utente, alto contrasto e
  reduced motion — è 6.2 e 25.1 di FEATURES; qui c'è il contenitore in cui
  atterrerà, che è ciò che mancava.

## Le regole

### 1. Una cucitura sola verso l'host, e un test che la presidia

Nessun modulo importa `@tauri-apps` fuori da `host/ipc.ts` e `host/dialog.ts`.
Vale **anche per i tipi**: `import type` conta come un import, o la regola si
aggira con una parola.

Il presidio è `host/no-tauri-outside-host.test.ts`, che legge i sorgenti con
`import.meta.glob` e fallisce nominando il file colpevole. Non è una regola di
stile: è il prerequisito del PWA (26.3), del mobile (26.2) e degli e2e della
shell ([§17.2](../roadmap/17-presidi-che-restano.md)), che girano contro un host
finto — e prima bastava **una riga** in `main.ts` per perderlo.

Per la stessa ragione `host/ipc.ts` dichiara il ritorno del canale eventi come
`() => void` invece che `UnlistenFn`: nominare il tipo di Tauri obbligherebbe
chi lo riceve a importarlo.

E per la stessa ragione `tsconfig.json` non ha i tipi di Node: la shell gira in
una webview, e non avere `process`/`fs` a tiro è ciò che impedisce di scrivere
codice che nell'app impacchettata non esiste.

### 2. Chi cambia qualcosa lo dice; chi ha interesse si iscrive

Due bus, con due nature diverse:

- **`state/kernel.ts`** — gli eventi del *backend*. Un modulo dichiara quale
  evento gli interessa (`onEvent("document_renamed", …)`) e riceve l'evento già
  ristretto alla sua variante, con l'origine. C'è un solo ascoltatore "di
  tutto" legittimo (`onAnyEvent`), ed è il view host, che decide per **dato**
  (`ViewSpec.refresh`) e non per conoscenza privata di chi c'è.
- **`state/store.ts`** — i segnali della *shell*: `vault`, `documents`,
  `active-doc`, `organization`, `stale-views`.

Prima c'era una funzione sola, `handleKernelEvent`, che conosceva privatamente
ogni pannello. Il guadagno non è l'eleganza: è che `explorer` e `document`
possono entrambi dipendere dallo store senza dipendere l'uno dall'altro. Un
ciclo di import fra due moduli di dominio, in un bundle ESM, è un `undefined`
all'avvio che non dice da dove viene.

In entrambi i bus **un ascoltatore che lancia non ferma gli altri**: il difetto
si manifesterebbe come "metà finestra ferma", cioè nel modo più difficile da
ricondurre alla causa.

### 3. Le operazioni sul vault non disegnano e non aprono

`state/vault.ts` fa l'operazione e **restituisce** ciò che serve; chi ha
chiamato decide cosa farne. È la regola che tiene i moduli aciclici: se
`createNote` aprisse da sé la nota creata dovrebbe importare `panels/document`,
che a sua volta la chiama per creare la nota di un wikilink non risolto.

Le uniche due eccezioni sono iniettate esplicitamente in `main.ts`, con la
ragione scritta accanto: il pannello del documento riceve `searchTag`, e
l'anteprima riceve `openPage`.

### 4. Lo store è piccolo per costruzione

Nello store sta ciò che serve a **più di un modulo**. I risultati di ricerca, le
voci del cestino, l'anteprima di una versione restano nel loro pannello. Uno
store che raccoglie tutto torna a essere l'oggetto-dio, con un file diverso.

## Cosa resta aperto, e perché

Sono le due metà del [§1.2](../roadmap/01-forma-della-shell.md) che questo giro
**non** ha chiuso:

- **Il modello di layout** — tab, split, pane, workspace salvabili. Non è un
  refactor: è la feature 3.3, e va decisa insieme a `PaneId` e alle sessioni
  multiple ([§9.6](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)). Ciò che
  è già pronto è che il contesto pubblicato porta l'identità del pannello
  (`MAIN_PANE`), quindi il giorno che i pannelli saranno due nessuno dovrà
  inventarsi da dove viene la risposta.
- **Un solo modo di montare un pannello** — cestino, cronologia, ricerca e grafo
  non passano dal view host. Il grafo per decisione di M2 (è una superficie
  privilegiata fuori da `UiNode`); gli altri perché il protocollo dichiarativo
  non ha ancora i nodi di input del [§2.1](../roadmap/02-cosa-e-una-view.md) né
  un modo di dire "sto caricando" ([§2.5](../roadmap/02-cosa-e-una-view.md)). La
  cronologia è il caso di collaudo giusto — view con stato per-documento, input
  e azioni che scrivono — e si migra **dopo** quella seduta, non prima.
