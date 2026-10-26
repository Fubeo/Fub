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

L'override dell'utente è della scheda: `Tab.override` in
`apps/client/src/state/layout.ts`, che il pannello passa al registro quando
monta la superficie della scheda attiva. È opt-in della superficie: una
registrazione dichiara in `sourceViews`, per profilo, la vista sorgente del
documento, cioè famiglia e profilo che mostrano lo stesso documento come testo.
La dichiarano i profili `vector` e `pdf` della tela, i disegni dell' [ADR
0203](../decisions/0203-superfici-spaziali.md) e le annotazioni dei PDF, verso
`{ family: "text", profile: "svg" }`; le altre famiglie della shell non ne
dichiarano. Il registro rifiuta una vista di un profilo non registrato, senza
famiglia o uguale al profilo stesso; `sourceView(request)` la risolve dalla
superficie naturale del documento, con il profilo esplicito, e restituisce
`null` finché la famiglia indicata non è registrata o non ha quel profilo.

Il montaggio resta sincrono anche quando il codice della superficie arriva dopo.
Il disegno, e così le annotazioni, monta subito un involucro con i modi e il
contratto della superficie vera (`apps/client/src/editors/spatial/lazy.ts`):
finché `import()` non risolve tiene testo, modalità, sola lettura, fuoco e un
rimando, e li consegna nell'ordine in cui la shell li avrebbe dati. Un `reveal`
in attesa risponde di sì; se poi la scena non ci arriva, l'avviso è quello della
shell. Un caricamento fallito lascia il testo alla sessione.

I comandi `shell.doc.source.open` («Apri come sorgente») e
`shell.doc.source.close` («Chiudi la vista sorgente») impostano e tolgono la
scelta sulla scheda attiva; `shell.doc.source.side` («Apri come sorgente
accanto») la imposta nel riquadro nuovo di una divisione verso destra, o va al
riquadro che la mostra già. Aprire e chiudere non sono mai disponibili
insieme; stanno nella palette e nel menu del riquadro, senza accordo. Il
cambio passa dalla via del cambio di scheda: il riquadro stacca e distrugge la
superficie e ne monta un'altra sulla stessa `DocumentSession`, che restituisce
testo e descrittore senza leggere il disco. Testo sporco, coda di salvataggio
e bozza restano; la cronologia locale della superficie smontata si perde come
a ogni cambio di scheda, quella degli altri riquadri no. Il fuoco va sulla
superficie nuova. Se il riquadro ricorda una lettura per la famiglia della
vista, l'apertura passa alla scrittura che sceglierebbe `Mod-E`, perché chi
chiede il sorgente vuole il testo; accanto passa alla modalità di ruolo
`source`, se c'è, perché la resa è già nel riquadro di partenza.

Una scelta vale finché la superficie naturale dichiara quella vista e il
registro risolve la scelta proprio a lei. Altrimenti (il profilo non la offre
più, una rinomina ha cambiato specie al documento, il file di stato è scritto a
mano, il documento si mostra dai byte) il riquadro la toglie dalla scheda e
monta la superficie naturale, mai quella d'errore. La scelta non fa parte
dell'identità della scheda (`sameTab`): segue pin, pila, rinomina, spostamento
fra riquadri, cronologia, riapertura delle schede chiuse e workspace salvati.
Non passa alla scheda nata da una divisione né ai riquadri collegati, dove
disegno e sorgente affiancati sono il caso d'uso, e nemmeno ai segnalibri, che
ricordano identità. Il parser del layout scarta una scelta malformata e tiene
la scheda, come fa con le modalità per famiglia. La finestra documento a parte
monta il profilo naturale e ignora la scelta.

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
- `printable` dichiara una resa di stampa del provider (`IndexQuery::RenderPrint`);
- `anchorHere` dà titolo o blocco sotto il cursore a `shell.doc.copy_anchor_link`;
- `contextMenu(at)` dice, come dati (`editors/core/editor-menu.ts`), cosa la
  superficie offre al tasto destro nel punto `at`, o sotto il cursore quando
  `at` è `null` (il tasto Menu): il bersaglio, le voci per ciò che sta lì, gli
  appunti eseguiti sui suoi dati e gli id delle azioni di formato, trasformazione
  e inserimento. Passano soltanto id, testi, booleani e funzioni senza
  argomenti; `null` lascia il menu del sistema. Lo dichiarano il Markdown
  (scrittura e Lettura), i documenti di Word, i fogli, la tela, le basi e il
  visualizzatore dei media;
- `miniBar()` monta la mini-barra di chi ha controlli suoi (i documenti di
  Word, i fogli) sopra il menu; il Markdown usa i gruppi della barra di
  formattazione;
- `standing`: fin dove si scrive, perché, i posti («Vai» se hanno `run`,
  dietro `placesAsk`) e le azioni, per il chip di `panels/standing.ts` (rich);
- `ownBar` dice che la superficie disegna la sua barra dei comandi (i
  documenti di Word, con la barra multifunzione del kit): la barra di
  formattazione della shell allora non si mostra, mentre la bolla della
  selezione e `fub.editor.action` restano;
- `panels` porta le schede del documento nell'ispettore, dopo le view
  dichiarate: ognuna ha un id, un titolo, un'icona e `mount(host)`, che
  restituisce il suo disposer. Le segue `shells/scrittoio/frame/document-panels.ts`
  sul riquadro a fuoco: cambiano con lui, se ne vanno col documento e si
  rifanno soltanto quando cambia quali sono. La scheda scelta si ricorda anche
  mentre manca. Con `onShow` la superficie chiede di mostrarne una (la barra
  del documento apre Commenti): la shell apre l'ispettore e la sceglie;
- `exports` dichiara gli export registrati che valgono per il documento: il
  disegno offre PNG e PDF, il profilo `pdf` il PDF annotato e quello redatto.
  Il core ne fa `shell.doc.export` e una voce del menu del riquadro ciascuno,
  salva ciò che è in attesa, chiede `export.run` e apre il centro attività.
  `exportWindow`, finché è disponibile, prende il posto della scelta del
  formato in «Esporta…»: il disegno vi sceglie anche JPEG, SVG, selezione e tavole;
- `selections()` dà le selezioni del testo in offset byte UTF-8 del buffer; il
  disegno dà gli intervalli degli elementi degli oggetti scelti;
  `selectedText()` è di chi sceglie elementi che non sono intervalli del
  sorgente, come le carte della tela o l'intervallo del foglio, e ne dà soltanto
  il testo. `selectionSetOf` in `editors/core/registry.ts` decide una volta per
  riquadro: span ancorati a buffer pulito, testo flottante altrimenti. Una
  feature che scrive nel sorgente chiede `source::PROSE` prima delle coordinate
  e rifiuta per il formato, non per il buffer;
- `editorActions` esegue le **azioni dell'editor** per id (`markdown.bold`,
  `markdown.heading.2`, `markdown.table.row.after`, `text.undo`) e ne dice lo
  stato dove sta il cursore principale: `enabled`, e `active` per chi commuta
  (`null` per chi inserisce). Attraverso la capacità passano soltanto id e
  booleani; `subscribe` avvisa a ogni cambio di selezione, testo, modalità o
  sola lettura. La superficie Markdown le trae dal catalogo del profilo
  (`profiles/markdown/actions.ts`), che la sua keymap condivide; esegue come
  una battuta, con `TextEngine.runCommand`, quindi nella cronologia locale e
  nella sessione. In Lettura o in sola lettura ogni azione è spenta. Ne sono
  clienti la barra di formattazione (`panels/format-bar.ts`) e `fub.editor.action`;
- `setSyntaxForms(forms)` riceve le sintassi effettive del documento, cioè
  quelle del provider più gli innesti delle `SyntaxRule` del vault. La tela le
  usa per le card di testo: il canvas dichiara con `fub:embedded-grammar`
  che le card sono Markdown, e il kernel gli dà le forme effettive del
  Markdown. Una sintassi spenta per le note, come i diagrammi, lo è anche nelle card.

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
le estensioni senza rifare vista, documento, selezione, tema o history nativa.

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
del profilo regolano l'input locale e non possono riscrivere il testo autorevole
della sessione. Prima del dispatch il motore verifica testo e annotazioni. Il
cambio esterno aggiorna i due rami senza aggiungere un evento locale.

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

I profili condividono il motore e aggiungono soltanto semantica di dominio:

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

Le tabelle GFM di primo livello fanno eccezione in Live: restano un widget
anche col cursore dentro, la griglia di `profiles/markdown/table-widget.ts`.
Il modello puro (`table-model.ts`) legge la tabella dalla sorgente e calcola
le modifiche: una cella cambia soltanto il proprio intervallo, un cambio di
forma riscrive la tabella. Il controller (`table-grid.ts`) possiede DOM,
selezione e tastiera senza importare CodeMirror; il widget applica le
modifiche con `dispatch` e `userEvent: "input"`, quindi nella cronologia
nativa della superficie, e usa annulla e ripeti nativi. CodeMirror ignora
gli eventi dentro la griglia (`ignoreEvent`), e dopo una modifica il widget
aggiorna il DOM sul posto (`updateDOM`), così fuoco e selezione restano. La
resa in riga delle celle viene dal renderer condiviso (`MarkdownBlock.cells`,
per offset relativo alla tabella), perché la resa HTML della tabella salta le
celle vuote. La griglia a fuoco riceve le azioni dell'editor della superficie
(`editorActions`) finché il fuoco non torna al testo.

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
conoscere, cioè il documento com'è salvato (`source`), una resa in cui si scrive
(`live_preview`) o una resa da leggere senza cursore (`reading`). La tela e il
foglio proiettano la loro vista principale su `live_preview`, il sorgente JSON
della tela su `source`, visori e superficie d'errore su `reading`. Il disegno
proietta Disegno (`draw`) su `live_preview` e Lettura (`read`) su `reading`; le
annotazioni di un PDF fanno lo stesso con Annota, che ha l'id `draw`, e Lettura.

Gli id valgono dentro la famiglia della superficie: il layout ricorda una
modalità per famiglia in ogni riquadro (`PaneState.modes`), e il `source` del
testo non decide come si apre una tela. Una famiglia senza voce si apre nella
`defaultMode` della superficie, o nella prima dichiarata; un id che la
superficie non supporta ripiega allo stesso modo, senza sovrascrivere la voce
persistita. `editor.default-mode` e la vecchia `mode` di un riquadro nominano
modalità del testo.

I comandi `shell.mode.reading` (`Mod-E`), `shell.mode.live` e
`shell.mode.source` cercano la modalità per `contextMode`, non per id
(`apps/client/src/editors/core/surface-modes.ts`): Live sulla tela porta alla
modalità `canvas`, e `Mod-E` trova la lettura di un profilo che la chiama
`read`. Fra più modalità con lo stesso ruolo resta quella corrente, altrimenti
vale la prima dichiarata. Un comando è disponibile soltanto dove cambierebbe
qualcosa: una superficie con una sola modalità non ne espone nessuno, e il
toggle chiede una lettura e almeno una scrittura. La disponibilità dipende
dalla superficie e non dalla modalità corrente, così un accordo assegnato
dall'utente non ricade sull'editor a seconda della modalità. Dalla lettura il
toggle torna all'ultima scrittura del riquadro per quella famiglia, se la
superficie la dichiara; altrimenti alla `defaultMode` se è di scrittura, poi
alla prima scrittura dichiarata. La command palette usa la stessa proiezione e
non conosce nomi di profilo.

### L'aspetto del contenuto

Ogni superficie ha tre strati: la cornice, i segni di Fub sul contenuto e il
contenuto ([ADR 0222](../decisions/0222-tre-strati-e-l-aspetto-del-contenuto.md)).
Cornice e segni sono sempre del tema. Del contenuto decide la modalità: una
`SurfaceMode` dichiara in `looks` gli aspetti che offre, il predefinito per
primo, fra `tema`, `file` e `adattato` (`apps/client/src/theme/content-look.ts`).
Markdown, testo, sorgenti, Lavagna e Base dichiarano `tema`; disegno,
annotazioni, immagini e media `file`; l'SVG `tema` nel sorgente e `file`
nell'anteprima. Il documento offre `file` e `adattato` in Pagina e in
Lettura, `tema` in Scrittura; il foglio di calcolo `file` e `adattato`. Il
campo è obbligatorio, e `apps/client/src/editors/core/surface-looks.test.ts`
controlla che ogni modalità registrata lo dichiari.

L'aspetto che si vede lo risolve il controller del documento: vale la scelta
del riquadro per quella famiglia (`PaneState.looks`), se la modalità la offre;
altrimenti l'impostazione `appearance.content-look`, dove `auto` è il
predefinito della modalità oppure `adattato` con il contrasto alto; altrimenti
il predefinito. La scelta non si cancella quando una modalità non la offre. La
regione del contenuto (`.pane-editor`) riceve la classe `look-tema`,
`look-file` o `look-adattato`, e la meccanica sta in
`apps/client/src/theme/scrittoio/structure.css`: in `look-file` i segni di Fub
prendono i colori della carta chiara (`--paper-*`). L'adattamento di un colore
del file a un'altra carta è una funzione sola, `apps/client/src/theme/adapt.ts`.

Dove un componente offre `file` o `adattato` il suo contenuto lo disegna
quella meccanica, e una pelle, un tema o un frammento lo vestono soltanto
sotto `.look-tema`. Il sanitizer lo fa rispettare con il gate del contenuto
(`CONTENT_GATE` in `apps/client/src/theme/scrittoio/anatomia.ts`, violazione
`content-look`): le classi di contenuto dei componenti con `gate`, e ogni
selettore di tipo dentro le loro cornici. Hanno `gate` il documento e il
foglio di calcolo.

Un editor non scrive un ruolo del tema sull'elemento: sull'elemento vanno i
valori del file. `.github/scripts/check-inline-theme.mjs` lo controlla in
`apps/client/src/editors/`, con l'elenco delle righe che lo fanno ancora.

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
non un secondo sistema di tasti. Il foglio del disegno tiene per sé i tasti
di un gesto, cioè frecce, `Spazio`, `Invio`, `?` e `Tab` con una selezione, e
li consuma; gli accordi che non usa, come `Mod-E`, arrivano alla shell
(`apps/client/src/editors/spatial/tools/editor/keys.ts`).

### La griglia

La famiglia `grid` apre le cartelle di Excel sulla versione 2 del protocollo:
la sorgente a byte resta nell'host, e il testo della `DocumentSession` è il
giornale della cartella. Griglia, barra multifunzione, finestre e oggetti
dei fogli sono descritti nella [superficie dei fogli](grid-surface.md).

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
- `apps/client/src/editors/text/profiles/markdown/actions.ts`
- `apps/client/src/editors/text/profiles/markdown/table-model.ts`
- `apps/client/src/editors/text/profiles/markdown/table-grid.ts`
- `apps/client/src/editors/text/profiles/markdown/table-widget.ts`
- `apps/client/src/editors/core/editor-actions.ts`
- `apps/client/src/panels/format-bar.ts`
- `apps/client/src/editors/text/profiles/markdown/completions.ts`
- `apps/client/src/editors/text/profiles/markdown/livepreview.ts`
- `apps/client/src/editors/text/profiles/plain-text.ts`
- `apps/client/src/editors/text/profiles/formula.ts`
- `apps/client/src/editors/text/profiles/markdown/surface.ts`
- `apps/client/src/editors/core/registry.ts`
- `apps/client/src/editors/core/surface-modes.ts`
- `apps/client/src/editors/core/bootstrap.ts`
- `apps/client/src/editors/spatial/lazy.ts`
- `apps/client/src/state/layout.ts`
- `apps/client/src/editors/grid/`
- `apps/client/src/editors/core/text-operation.ts`
- `apps/client/src/state/document-session.ts`
