# Superfici dell'editor

> **Domanda:** come si dividono il lavoro sessione documento, superfici, motori
> e profili, e dove passa il confine di CodeMirror?
> **Fonti autorevoli:** `apps/client/src/editors/`,
> `apps/client/src/state/document-session.ts`,
> `apps/client/src/panels/document.ts`.

## Superfici di editing

La sessione documento e la superficie non sono la stessa cosa. Il percorso
corrente crea una sola `DocumentSession` per documento tramite
`DocumentSessionCollection`, l'unico owner e percorso di costruzione in
`apps/client/src/state/document-session.ts`.

La sessione possiede il buffer autorevole in memoria: testo, revisione di base,
stato dirty, coda e debounce di salvataggio e bozza, esiti, riconciliazione degli
eventi esterni, conflitti, rinomina, cancellazione e chiusura. Il buffer è lo
stato condiviso del documento, non una copia per riquadro.

La collection mantiene la sessione finché il documento è trattenuto da almeno
un riquadro o da un'apertura in corso. Il rilascio dell'ultima tab esegue il
flush della scrittura e, se il testo resta sporco, della bozza, prima di
chiudere l'owner. Una rinomina mantiene lo stesso owner e il suo buffer; una
cancellazione riuscita o una rimozione esterna lo chiudono. La riapertura crea o
riusa l'owner a partire dalla sorgente.

Durante una cancellazione in attesa di conferma la sessione sospende i timer e
segnala lo stato di cancellazione pendente; il pannello congela con
`setReadOnly` gli editor di ogni riquadro che mostra il documento finché la
conferma non risolve. Il fan-out continua a raggiungere le superfici congelate:
una modifica accettata da un altro riquadro resta visibile ma non modificabile.

Ogni `Pane` possiede invece una `EditorSurface`.
`DocumentSurfaceRegistry` risolve la factory da metadati `format_id` e
`source_kind`, applicando override, formato, specie, fallback testuale, viewer
per byte ed errore. Il registro possiede le istanze e le distrugge quando il
riquadro o l'owner vengono smontati. Ogni famiglia dichiara anche l'insieme dei
profili che sa montare: `formats`, `sources` e override possono selezionare
soltanto profili registrati. Un profilo di override sconosciuto non crea una
superficie implicita: la risoluzione continua lungo formato, specie e fallback.
Il test del registro rende questa regola un gate, insieme a collisioni,
unregister e teardown delle istanze.

La famiglia è un nome aperto, posseduto da un owner alla volta. Il proprietario
della specie `bytes` decide con `selectSourceProfile` quali file senza formato
sa mostrare, e `null` vuol dire «non questo»: la tabella dei media della shell
vive soltanto lì. `showsBytes(id)` è la domanda che pannello ed esploratore
pongono invece di ripetere la classificazione. Un file la cui estensione è
gestita da un formato del vault passa dal descrittore anche quando è un media.
Tutte le famiglie registrate sono della shell: una superficie di terzi
richiederebbe un contratto dichiarativo di superficie che non esiste.

`EditorSurface` ha pochi membri obbligatori — famiglia, profilo, id, modi,
`setMode` e `destroy` — e per il resto è fatto di capacità:

- `buffer` per chi modifica il testo della sessione; una superficie di byte o
  d'errore non ne finge uno;
- `reveal(location)` porta a schermo uno span del modello: il testo vi sposta
  il cursore, la lettura scorre il DOM reso, la tela seleziona e inquadra la
  carta che lo contiene; `false` quando la superficie non ci arriva;
- `insertReferences` scrive rimandi a note e allegati nella sintassi del
  formato, al punto del rilascio o al cursore, come una battuta dell'utente;
- `mountPresentation` monta la resa da presentare come slide;
- `printable` dichiara una resa di stampa del provider del formato
  (`IndexQuery::RenderPrint`);
- `selections()` dà le selezioni del testo in offset byte UTF-8 del buffer;
  `selectedText()` è di chi sceglie elementi che non sono intervalli del
  sorgente, come le carte della tela o l'intervallo del foglio, e ne dà soltanto
  il testo. `selectionSetOf` in `editors/core/registry.ts` decide una volta per
  riquadro: span ancorati a buffer pulito, testo flottante altrimenti. Una
  feature che scrive nel sorgente chiede `source::PROSE` prima delle coordinate
  e rifiuta per il formato, non per il buffer;
- `setSyntaxForms(forms)` riceve le sintassi effettive del documento, cioè
  quelle del provider più gli innesti delle `SyntaxRule` del vault. La tela le
  usa per le card di testo: il canvas dichiara con `fub:embedded-grammar`
  che le card sono Markdown, e il kernel gli dà le forme effettive del
  Markdown. Una sintassi spenta per le note, per esempio i diagrammi, resta
  spenta anche nelle card.

Il pannello offre un gesto soltanto se la superficie montata lo dichiara e non
chiede mai famiglia o profilo. `reveal(doc, location)` in `panels/document.ts`
porta il punto nel riquadro che mostra quel documento — prima quello col fuoco,
poi un altro, che prende il fuoco — oppure apre il documento nel riquadro col
fuoco. Il punto non arriva mai a un riquadro che mostra un altro testo; una
superficie che non lo raggiunge produce un avviso invece di un gesto muto.

`TextEngine` in `apps/client/src/editors/text/engine.ts` è il motore testuale
corrente. Possiede la `EditorView` e la meccanica condivisa: aggiornamenti e
sincronizzazione del documento, selezioni e offset byte UTF-8, terminatori di
riga, focus, reveal, tema, sola lettura, undo/redo e `destroy()`. Il seam
`extensions` monta la configurazione di un profilo; `reconfigure()` sostituisce
le estensioni senza ricostruire vista, documento, selezione, tema o history
nativa.

Ogni `TextEngine` monta `history({ minDepth: 100, newGroupDelay: 500 })` nel
proprio `historyCompartment`. CodeMirror possiede quindi i due rami per
superficie, l'inversione, il raggruppamento, la composizione, la history delle
selezioni e il mapping attraverso cambi esterni. `historyKeymap` è montata nel
keymap effettivo insieme ai comandi dell'editor: include undo/redo del contenuto
e `undoSelection`/`redoSelection`; l'estensione `history()` registra anche gli
eventi DOM `beforeinput` `historyUndo` e `historyRedo`. `TextEngine.undo()` e
`redo()` sono adapter dei comandi nativi e non leggono campi o strutture private
di CodeMirror.

Una modifica locale diventa un evento della history nativa della superficie.
`TextEngine.syncDoc()` costruisce la transazione dal risultato effettivo di
`EditorState.update()`, con `filter: false`,
`Transaction.addToHistory.of(false)` e `Transaction.remote.of(true)`. I filtri
del profilo regolano l'input locale e non possono riscrivere il testo
autorevole della sessione. Prima del dispatch il motore verifica testo e
annotazioni. Il cambio esterno aggiorna i due rami senza aggiungere un evento
locale.

Prima di inviare un cambio esterno, `HistoryFootprints` conserva al massimo 512
intervalli non vuoti e anchor di cancellazione, soltanto come coordinate UTF-16:
non conserva testo, inversi o frame. `footprintsOverlap()` valuta il
`ChangeDesc` reale. Quando il controllo segnala un overlap o una metadata
sconosciuta, anche per un errore di mapping, fa eseguire a
`resetNativeHistory()` due transazioni pubbliche
successive: prima `historyCompartment.reconfigure([])`, poi il reinserimento
della history nativa. La transazione di sync viene ricostruita dopo il reset e
soltanto allora inviata. Il reset scarta entrambi i rami nativi (anche la
history di selezione) prima di mostrare il cambio esterno; se il reset fallisce,
il sync viene interrotto.

### Confine delle operazioni tra superfici

Il flusso delle modifiche è esplicito e resta interno alla shell:
`TextEngine.handleUpdate()` crea un `EditorChange` con `text`, `operation`
(`TextOperation`) e `origin`; il pannello inoltra questi dati alla sessione,
senza ridurre l'operazione al solo testo.

`TextOperation` vive in `apps/client/src/editors/core/text-operation.ts` e non conosce
CodeMirror, DOM o history. La `DocumentSession` valida l'operazione tipizzata
contro il testo autorevole, usando la stessa normalizzazione dei terminatori per
preimmagine e testo obiettivo. Un'operazione stantia, malformata o incoerente
lascia invariato il buffer e riallinea la superficie sorgente col testo
autorevole.

Quando la validazione riesce, la sessione aggiorna una volta testo e dirty,
pianifica salvataggio e bozza e diffonde l'operazione alle superfici sottoscritte
tranne la sorgente. Una sostituzione autorevole — ricarica pulita, conflitto
scartato o bozza recuperata — diffonde invece il testo intero a tutte le
superfici. Il pannello possiede il collegamento delle superfici e applica questi
dati all'editor; non possiede la validazione, il buffer o il fan-out delle
modifiche.

La superficie destinataria esegue una seconda guardia:
`TextEngine.syncDoc()` valida l'operazione ricevuta contro il proprio testo
corrente e contro il testo obiettivo normalizzato. Se l'operazione è stantia o
non produce l'obiettivo, usa `operationFromText(current, normalizedText)` come
fallback locale e limitato. Il cambio passa quindi dalla history nativa con
origine `sync`, senza diventare una battuta locale; l'eventuale overlap viene
gestito dalla guardia `HistoryFootprints` descritta sopra.

`EditorChange`, `DocumentUpdate` e `TextOperation` sono tipi interni della
shell TypeScript: non attraversano `host/contract.ts`, IPC, WIT o ABI.
`DocumentSessionCollection` costruisce e conserva gli owner; ogni
`DocumentSession` coordina testo, revisione di base, dirty, coda, salvataggio,
bozza, conflitto, rinomina, cancellazione e chiusura. Le superfici sottoscritte
ricevono soltanto dati e ciascun `TextEngine` conserva i propri rami nativi e la
metadata di sicurezza. `operationFromText()` è soltanto il fallback del
ricevente, non la sostituzione dell'operazione tipizzata emessa dalla sorgente.

La distinzione è motivata da [0190](../decisions/0190-sessioni-documento-e-undo.md)
e il confine di sicurezza della history nativa è precisato in
[0199](../decisions/0199-history-nativa-e-gate-di-overlap.md); 0199 completa
0190 senza sostituirla.

I profili condividono lo stesso motore e aggiungono soltanto semantica di
dominio:

| Profilo | Responsabilità corrente |
|---|---|
| `MarkdownProfile` | `createMarkdownProfile()` monta linguaggio Markdown, comandi, live preview locale, completamenti e callback per wikilink e tag. |
| `PlainTextProfile` | `createPlainTextProfile()` monta estensioni vuote, senza sintassi o comandi di dominio. |
| `FormulaProfile` | `createFormulaProfile()` monta lessico, completamenti per funzioni/fogli/nomi e commit/cancel espliciti; `singleLine` è configurabile. |

Markdown e plain text sono superfici utente distinte montate dal registro sullo
stesso `TextEngine`; `FormulaProfile` è incorporato dalla formula bar e
dall'editor in-cell di `GridEngine`. I moduli dei profili vivono rispettivamente
in `apps/client/src/editors/text/profiles/markdown/profile.ts`,
`apps/client/src/editors/text/profiles/plain-text.ts` e
`apps/client/src/editors/text/profiles/formula.ts`. Le callback
`FormulaProfileCallbacks.commit` e `.cancel` sono punti di integrazione
TypeScript interni e iniettati dal chiamante; non attraversano IPC, WIT o ABI.

### Markdown: Source, Live e Reading

Source, Live e Reading sono tre viste sullo stesso `TextEngine` e sullo stesso
buffer della `DocumentSession`: il cambio modo riusa la vista di scrittura e
Reading ridisegna dal buffer corrente, senza salvataggio imposto.

I blocchi Live inattivi e Reading condividono lo stesso renderer locale in
`apps/client/src/editors/text/profiles/markdown/render*.ts` e lo stesso
montaggio in `apps/client/src/editors/text/profiles/markdown/mount.ts`; i blocchi selezionati mostrano
la sorgente. Il task passa da normale modifica undoabile della sessione e
`readOnly` disabilita l'input.

Risorse native ed embed in `apps/client/src/ui/markdown-resources.ts` sono
condivisi per `DocumentSession`, con conteggio dei riferimenti, controllo delle
esecuzioni superate e invalidazione. I renderer nativi arricchiscono soltanto
gli span salvati rimasti invariati; gli embed partono dai riferimenti presenti
nel buffer corrente. Il rendering locale non richiede IPC per battuta.
Finché una risorsa è viva, il modulo è iscritto alle cache dei documenti
(`apps/client/src/state/document-caches.ts`). Il pannello annuncia lì i
documenti cambiati da fuori, tolti o rinominati, senza sapere quale profilo
tenga quale cache. L'anteprima al passaggio legge il bersaglio dal contratto
`data-wikilink-*`, che la Live posa come la Lettura.

La risoluzione dei link resta del kernel tramite `resolvedReference`; per i
percorsi il frontend invia `LinkTarget::Path`.

Ogni superficie dichiara almeno una `SurfaceMode`: id estensibile, etichetta,
presentazione editabile o resa e proiezione sul `PaneMode` ABI. `PaneMode` non
nomina le modalità di un formato: è la classe di vista che un provider può
conoscere, cioè il documento com'è salvato (`source`), una resa in cui si
scrive (`live_preview`) o una resa da leggere senza cursore (`reading`). La tela
e il foglio proiettano la loro vista principale su `live_preview`, il sorgente
JSON della tela su `source`, visori e superficie d'errore su `reading`.

Gli id valgono dentro la famiglia della superficie: il layout ricorda una
modalità per famiglia in ogni riquadro (`PaneState.modes`), e il `source` del
testo non decide come si apre una tela. Una famiglia senza voce si apre nella
`defaultMode` della superficie, o nella prima dichiarata; un id che la
superficie non supporta ripiega allo stesso modo, senza sovrascrivere la voce
persistita. `editor.default-mode` e la vecchia `mode` di un riquadro nominano
modalità del testo. Il toggle `Mod-E` sceglie soltanto fra le modalità che la
superficie dichiara; quando manca una coppia edit/render non mostra un controllo
falso. La command palette usa la stessa proiezione e non conosce nomi di profilo.

La finestra documento a parte (`apps/client/src/shells/document/`) non ha IPC:
riceve dalla finestra principale il profilo di testo che il registro ha risolto
per il documento (`DocumentWindowRequest.profile`) e lo monta su un
`TextEngine` nudo, senza completamenti dal vault né slash palette. Un documento
la cui superficie non è di testo — tela, foglio, base, media — non vi si apre,
e la shell lo dice. Dal bridge del documento arrivano anche il tema, come
strati montati (`theme/loader.ts`), e tornano indietro i link e i tag cliccati
nella finestra, che la finestra principale apre.

La tastiera è ordinata per contesto: il popup di completamento e le keymap
CodeMirror precedono il layer della superficie; poi vengono profilo, documento,
riquadro e globale. La shell monta un solo listener globale e lo rimuove al
rimontaggio. Le callback di superficie diventano comandi nella stessa pipeline,
non un secondo sistema di tasti.

### Workbook e vertical slice della griglia

`crates/fub-format-sheet` possiede il formato testuale `.fubsheet` v1 e il
valutatore autorevole. `Workbook` conserva soltanto dati persistenti: versione,
proprietà, ordine, dimensioni, input e stile. `SheetId + RowId + ColumnId`
identifica una cella; A1, AST, valori, dipendenze, cache, errori, outline,
ricerca e proprietà comuni sono proiezioni calcolate.

Il formato è registrato nel kernel come sorgente conosciuta senza adattarlo a
`DocumentModel`: discovery, sincronizzazione e indicizzazione conservano
l'entry, mentre nessun parser di blocchi viene inventato. `GridEngine` analizza
lo stesso JSON strict nel client, virtualizza righe e colonne e produce
`GridOperation` con coordinate stabili, preimmagini e patch inverse.
`DocumentSession` valida e diffonde l'operazione tipizzata prima della scrittura
guardata; i reload full-text restano il fallback autorevole.

Editor in-cell e formula bar usano due istanze di `TextEngine` con
`FormulaProfile`, ma nessuna battuta attraversa IPC. Il pilot read-only
`fub.sheet` passa dalla route `query_index` in
`crates/fub-format-sheet/src/index.rs`; il mirror TypeScript di
`SheetEvaluation` è in `apps/client/src/host/contract.ts`. Il provider nativo
usa `Workbook::parse()` e `Workbook::evaluate()`. La richiesta privata ha
specie `evaluate`, versione intera e campi chiusi; il risultato conserva valori
ed errori formula tipizzati. La sorgente è limitata a 16 MiB e la risposta JSON,
envelope compreso, a 8 MiB.

Il bundle `fub.sheet` possiede la route nel registro. Disabilitarlo ritira il
pilot e rende la query `Unserved`; questo percorso resta distinto dalla famiglia
Grid. `GridEngine` usa infatti il `GridHost` tipizzato per negoziare il
protocollo a finestre. Se il provider Grid non è disponibile o una finestra
fallisce, la superficie dichiara `data-grid-protocol="fallback"` e mostra gli
input grezzi senza duplicare il linguaggio formule in TypeScript.

`crates/fub-format-sheet/src/session.rs` possiede il motore derivato. Apertura e
reload costruiscono una sola valutazione e gli indici delle coordinate; le
letture successive restituiscono soltanto la finestra richiesta. Il commit
interno riceve fino a 16.384 patch e 4 MiB complessivi di preimmagini e nuovi
input. Valida revisione, coordinate, duplicati e tutte le preimmagini prima di
mutare; un errore lascia sorgente, revisione, valori e indici precedenti.

Un commit riuscito serializza il workbook autorevole una volta, rivalida la
sessione e restituisce un diff testuale con offset in byte UTF-8 e preimmagine.
Il diff non spezza caratteri multibyte né la coppia `\r\n`. La risposta viene
misurata, escaping JSON compreso, entro 8 MiB usando fette prese in prestito:
`deleted` e `inserted` vengono allocati soltanto dopo il controllo. La prima
canonicalizzazione di una sorgente non canonica può quindi fallire in modo
esplicito senza sostituire la sessione.

L'invalidazione include le coordinate modificate e le dipendenti transitive del
nuovo workbook, comprese formule che puntavano a celle prima assenti. Fino a
32.768 coordinate restituisce l'elenco ordinato; oltre la soglia restituisce
`all`. L'adapter `fub-host::sheet` conserva la derivazione comune
`Revision::of` ed espone la stessa semantica nativa. Il crate formato non
dipende dall'host ed è compilabile per WASM.

Questi tipi attraversano ora il contratto Rust↔WIT↔TypeScript e le porte IPC
tipizzate della famiglia Grid. La shell non riceve DOM, callback JavaScript o
oggetti CodeMirror: possiede rendering, input, clipboard, selezione e stato
visuale, mentre il provider possiede parsing, formule e dipendenze.
`query_index` resta read-only e ospita il pilot `fub.sheet`; non è il percorso
delle finestre, patch, invalidazioni o lifecycle Grid, che passano da `GridHost`.
Limiti, coordinate, fallback, diff UTF-8 e parità nativo/WASM sono normati in
[ABI e WIT](../reference/abi-and-wit.md) e nel [contratto
IPC](../reference/ipc-contract.md). Nessuna battuta genera IPC o WASM.

## Confine CodeMirror

Gli import `@codemirror/*` della shell sono confinati a
`apps/client/src/editors/text/`. `TextEngine`, i tre profili, le loro
estensioni, la superficie Markdown e i test del seam vivono sotto questo
percorso; `panels/document.ts` usa il contratto `EditorSurface` e i tipi senza
importare CodeMirror.

`node .github/scripts/check-codemirror-boundary.mjs` percorre
`apps/client/src` e segnala ogni import CodeMirror fuori da
`apps/client/src/editors/text/`. Il confine impedisce copie incompatibili e
mantiene CodeMirror un servizio della shell testuale.

## Dove si trova

- `apps/client/src/editors/text/engine.ts`
- `apps/client/src/editors/text/history-footprints.ts`
- `apps/client/src/editors/text/profiles/markdown/profile.ts`
- `apps/client/src/editors/text/profiles/markdown/commands.ts`
- `apps/client/src/editors/text/profiles/markdown/completions.ts`
- `apps/client/src/editors/text/profiles/markdown/livepreview.ts`
- `apps/client/src/editors/text/profiles/plain-text.ts`
- `apps/client/src/editors/text/profiles/formula.ts`
- `apps/client/src/editors/text/profiles/markdown/surface.ts`
- `apps/client/src/editors/core/registry.ts`
- `apps/client/src/editors/core/bootstrap.ts`
- `apps/client/src/editors/grid/engine.ts`
- `apps/client/src/editors/core/text-operation.ts`
- `apps/client/src/state/document-session.ts`
