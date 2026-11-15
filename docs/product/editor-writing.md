# Scrittura

> **Per chi:** chi scrive nelle note Markdown e chi aggiunge qualcosa al foglio
> dell'editor.
> **Risultato:** sapere quali modalità ha una nota, che cosa fa Scrittura, quando
> compare ciò che sta sul foglio, da dove si raggiunge una funzione e che cosa
> succede quando si incolla un indirizzo.

## Le modalità di una nota

Una nota Markdown ha tre modalità:

- **Scrittura**, dove si scrive sulla pagina resa: i segni Markdown si
  attenuano o spariscono, e ogni blocco ha la sua maniglia;
- **Sorgente**, con la sintassi esplicita;
- **Lettura**, la resa senza cursore di testo (**Ctrl+E** ci va e torna alla
  modalità di prima).

Il commutatore in fondo alla banda di stato le elenca così: Scrittura,
Sorgente e, dopo un separatore, Lettura. Accanto a Scrittura e Sorgente, in
grigio, una frase dice che cosa sono («Il testo formattato e i blocchi», «Il
Markdown com'è sul disco»): la dichiara la modalità (`description` di
`SurfaceMode`). Le altre superfici tengono le loro modalità
([Editor e anteprima](editor-and-preview.md#modalità)).

Scrittura usa l'id di modalità `live_preview` e il ruolo `PaneMode::LivePreview`
di sempre: per il riquadro, il layout salvato e i comandi è la stessa voce che
prima si chiamava Live. La vecchia modalità **Blocchi** non è più una voce: i
[blocchi](editor-blocks.md) stanno dentro Scrittura. Un riquadro salvato in
`blocks` da un Fub di prima si apre in Scrittura, e il layout non si riscrive;
anche il comando `shell.mode.blocks` (Mod+Shift+B) porta a Scrittura, e c'è
soltanto sulle note.

Quanto si vede dei segni lo dice `editor.live-reveal` (`mai` di serie), anche
coi blocchi: col cursore dentro un `**grassetto**` i segni compaiono solo se
la preferenza lo chiede. In sola lettura maniglie, testata e strumenti della
pagina sono spenti, e Lettura resta possibile. Una nota aperta in due riquadri
può stare in Scrittura in uno e in Sorgente nell'altro: il testo è uno, ogni
riquadro ha la sua modalità.

## Tre livelli di presenza

Ogni elemento del foglio ha un livello, e il livello decide quando si vede:

- **a riposo**, sempre: il testo, la testata con copertina, icona e titolo, la
  riga dei dati, le proprietà;
- **al passaggio** del puntatore o del fuoco: il «+» e la maniglia del blocco,
  gli strumenti della testata;
- **a richiesta**, dopo un gesto (un clic, un tasto, un carattere): la linea
  dove cade un blocco trascinato, la maniglia di un'immagine scelta, i menu.

Un elemento che compare al passaggio non sposta mai il testo: sta nel margine
o in uno spazio che c'era già. Due elementi non si contendono lo stesso posto:
coi blocchi la pastiglia del livello di un titolo («H1» nel margine) non c'è,
perché quel margine è di «+» e maniglia; il livello si cambia da «Trasforma
in» del menu del blocco o dalla barra di formato. Nel DOM l'elemento dichiara il suo livello con
`data-presence="hover"` o `data-presence="request"` (`markPresence` in
`editors/core/presence.ts`); quello a riposo non porta niente. La scena
`scrittura-a-riposo` del banco passa il puntatore su un blocco e sulla testata,
controlla che il testo non si muova, poi lo allontana e toglie il fuoco: sul
foglio non deve restare visibile nessun elemento con `data-presence` e nessun
pulsante, salvo quelli che sono contenuto (l'icona della pagina, la riga dei
dati, la testata di un blocco di codice).

## Tre porte per ogni funzione

Chi scrive non deve ricordarsi dove sta una funzione: ognuna si raggiunge dal
«/» nel testo, dalla palette dei comandi e dal tasto destro o da un menu,
con la scorciatoia scritta accanto quando c'è. Le funzioni dei blocchi hanno
anche «+ Inserisci» nella barra di formato. Una funzione nuova del foglio entra
da tutte e tre le porte; i menu sono descritti in
[Tasto destro, mini-barra e «/»](editor-menus.md).

## Incollare un indirizzo

Un indirizzo `http`, `https` o `mailto:` incollato da solo, senza spazi e su
una riga sola, si scrive come link Markdown: il testo del link tra quadre, e
l'indirizzo tra tonde. Che cosa succede dipende da dove cade.

- **Su un testo selezionato** il testo selezionato diventa il testo del link,
  come in Obsidian. Il testo resta quello che era.
- **Su una riga vuota** l'indirizzo si scrive come link, con l'indirizzo come
  testo, e sotto compare una scelta piccola:
  - **Link**, la scelta di partenza: il link resta com'è.
  - **Scheda**: scrive l'indirizzo da solo sulla riga. Diventa il segnalibro web
    della pagina, con titolo, descrizione e sito; l'anteprima si chiede a parte,
    come nella [pagina dei blocchi](editor-blocks.md#i-segnalibri-web).
- **Dentro un testo** l'indirizzo entra com'è, come testo semplice.

La scelta compare solo per un incolla, mai per un indirizzo scritto lettera per
lettera. Invio o un'altra battuta tengono Link e chiudono la scelta; il cursore
che esce dalla riga la chiude senza cambiare nulla.

Con la tastiera:

- Tab, dall'editor, porta il fuoco sulla scelta, sul Link. La scelta è una barra
  con un solo punto di tabulazione: ← e → passano da Link a Scheda.
- Invio o Spazio applicano la voce col fuoco, come un clic: Link chiude la
  scelta, Scheda scrive l'indirizzo da solo. Il fuoco torna nell'editor.
- Esc, Tab o Maiusc+Tab riportano il fuoco nell'editor tenendo Link.
- Qualunque altro tasto tiene Link, chiude la scelta e va all'editor, dove fa
  il suo lavoro.
- Senza scelta visibile, Tab è quello di sempre.

Non tutto diventa un link:

- un `mailto:` su una riga vuota è un link senza scelta, perché la scheda è
  per le pagine web;
- un indirizzo con spazi, o più righe di indirizzi, entra come testo;
- dentro un blocco di codice o un codice in linea l'indirizzo resta testo;
- in una cella di tabella il link non chiude la colonna: il `|` dell'indirizzo
  si scrive `%7C` e quello del testo selezionato `\|`;
- dagli appunti con HTML, come un link copiato da una pagina, vale la
  conversione di sempre, che porta il titolo del link, e nessuna scelta;
- «Incolla senza formattazione» (Ctrl Maiusc V) incolla il testo così com'è,
  senza link e senza scelta;
- durante una composizione (IME) l'incolla entra come testo.

## La sbirciata

Alt col clic su un wikilink o su un link Markdown a una nota (`[testo](Carte/B.md)`),
o `Alt+Invio` col cursore sul link, o «Sbircia» dal menu del link, apre la nota
in un pannello sopra la destra del foglio, sotto le linguette: la
**sbirciata**. Il nome si risolve dalla nota che contiene il link, anche
quando il link sta dentro un'altra sbirciata. Al telefono prende tutto il foglio. La nota è aperta per
scrivere in Scrittura, con lo stesso buffer di un riquadro che la mostra già:
cursore, scorrimento e annulla sono della sbirciata.

- In testata la cartella della nota e tre pulsanti: **Apri qui** porta la nota
  nel riquadro, **A lato** in un riquadro accanto, alla stessa selezione, **×**
  chiude. All'apertura il fuoco va nel testo della nota (su **Crea la nota**,
  se la nota non c'è).
- Finché il fuoco è nella sbirciata, i comandi dell'editor, la barra, la
  ricerca nella nota e il contesto parlano della nota sbirciata.
- **Esc** salva e chiude, e il fuoco torna dov'era. Un Esc che l'editor usa
  già (il menu «/», un completamento, il modo normale di vim) resta suo:
  allora serve un secondo Esc, subito dopo, per chiudere.
- Dal lanciatore, `Alt+Invio` o l'azione **Sbircia** aprono una nota nella
  sbirciata; un file che non è una nota si apre a lato.
- Promuovere o chiudere non perde testo: prima l'editor consegna quello che
  tiene alla sessione, poi il riquadro prende la nota, poi la sbirciata si
  chiude.
- Un link che non porta a niente apre la sbirciata col nome e **Crea la nota**;
  la nota nata si apre lì. Un link a un PDF o a un foglio si apre a lato: la
  sbirciata è per le note. Una nota tolta da fuori mentre la si guarda lo dice
  al posto dell'editor.
- Ce n'è una per finestra: aprirne un'altra salva e chiude quella di prima.
  Cambiare vault o chiudere il riquadro la chiudono.

### Il clic su un link

Un solo criterio per wikilink e link Markdown a una nota, nel testo, nelle
celle delle tabelle e sulle schede (`link-gesture.ts`):

- il clic che segue un link lo decide `editor.link-click` in Impostazioni ›
  Editor: `apri`, di serie, porta la nota nel riquadro; `sbircia` la apre nella
  sbirciata;
- sul testo che si scrive il clic semplice resta del cursore e segue il link
  Ctrl/Cmd col clic (Cmd su Mac); in Lettura e su una scheda della nota segue
  il clic semplice;
- in un blocco reso della Scrittura (una tabella, un embed) il clic semplice
  entra nel blocco e Ctrl/Cmd col clic segue il link, come sul testo;
- Alt col clic sbircia sempre; «Apri» del menu del link apre sempre.

## La scheda della nota

Un paragrafo fatto soltanto di un wikilink (`[[Biblioteca civica]]`, anche con
sezione o alias) si vede, fuori dal cursore, come la scheda della nota a cui
porta: icona, titolo, descrizione, data, quante note la collegano e copertina,
prese dall'indice e dalle proprietà
della nota (`icon:`, `description:`, la prima fra `date:`, `updated:`,
`modified:` e `created:`, `cover:`). Il titolo è l'alias, se c'è, altrimenti il
nome della nota. La copertina mostra il colore scritto in `cover:` (`#cfe7d6`,
`rgb(…)`, `oklch(…)`), e per ogni altro valore la striscia del tema.

- Il file resta il wikilink; col cursore dentro il paragrafo torna il link.
- Il clic segue `editor.link-click`, Alt col clic sbircia; Ctrl/Cmd col clic
  vale come il clic. Il clic non porta il cursore dentro: ci si entra con le
  frecce.
- Finché l'indice non ha risposto, e per un link che non porta a una nota (una
  nota che non c'è, un PDF), il paragrafo resta link. Un embed (`![[…]]`), un
  link a un punto della nota stessa (`[[#Sezione]]`) o un link con altro testo
  accanto non sono una scheda.
- Le proprietà arrivano dall'indice (`query_index`) con una sola domanda per
  tutte le schede nuove, non per battuta: l'editor tiene i nomi dei paragrafi
  che possono diventare schede e li ricontrolla poco dopo che cambiano. Quando
  l'indice cambia si richiedono solo le schede tenute, e la Scrittura ridisegna
  soltanto quelle davvero cambiate.

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/surface.ts`: le tre modalità
  (`MARKDOWN_MODES`), `markdownModeOf`, il montaggio dei blocchi in Scrittura;
- `apps/client/src/editors/core/surface-modes.ts`: `modeById`, che riconosce
  anche gli id di prima (`formerIds` di `SurfaceMode`);
- `apps/client/src/state/document-controller.ts` e `state/mode-menu.ts`: la
  modalità del riquadro e il commutatore della banda;
- `apps/client/src/editors/core/presence.ts`: i livelli di presenza;
- `apps/client/src/state/note-peek.ts`: la sbirciata (`createNotePeek`), con
  l'editor montato dalla porta delle schede (`state/card-editors.ts`);
  `state/document-controller.ts` la cabla al riquadro col fuoco e legge
  `editor.link-click`;
- `apps/client/src/editors/text/profiles/markdown/link-gesture.ts`: il
  criterio del clic su un link (`textLinkGesture`, `renderedLinkGesture`,
  `followWikilink`, `followPath`);
- `apps/client/src/editors/text/profiles/markdown/open-link.ts`: Alt-Invio e
  il link sotto il cursore;
- `apps/client/src/editors/text/profiles/markdown/link-card.ts`
  (`NoteCardWidget`) e `apps/client/src/state/note-cards.ts`: la scheda della
  nota e le sue proprietà;
- `apps/client/bench/scene.mjs`: la scena `scrittura-a-riposo`.
