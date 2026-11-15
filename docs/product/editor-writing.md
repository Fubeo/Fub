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

## La testata

In cima alla nota, in Scrittura e in Lettura, sta la stessa testata, in
quest'ordine: la copertina, l'icona, il titolo (il nome del file), le
proprietà in evidenza, «Altre N proprietà», «Aggiungi una proprietà» e la
[riga dei dati](editor-note-facts.md). Un filo la stacca dal testo. Che cosa
sono icona, copertina, titolo e menu «⋯» lo dice la
[pagina dei blocchi](editor-blocks.md#la-testata-della-pagina).

- **Le proprietà.** Senza un tipo, sono in evidenza le prime quattro voci del
  frontmatter, nell'ordine del file; le altre stanno dietro «Altre N
  proprietà», che si apre e si richiude e resta com'era finché l'editor è
  aperto. Le voci che la testata mostra a modo suo (`icon`, `cover`,
  `cover-y`, `cssclasses`) e le etichette (`tags`, che stanno nella riga dei
  dati) non sono righe. Il nome lungo si taglia e si legge intero al
  passaggio; il valore va a capo. Un valore vuoto si legge «Vuoto».
- **`editor.properties`** decide quanto se ne vede: `visible` le mostra come
  sopra, `hidden` le mette tutte dietro «Altre N», `source` lascia lo YAML
  sotto il titolo, senza righe. In Lettura vale lo stesso, all'apertura.
- **Scrivere.** In Scrittura il clic su un valore apre lo YAML sulla sua riga,
  col cursore in fondo: la testata cede il posto alle righe del frontmatter
  finché il cursore ci sta. «Aggiungi una proprietà» apre una riga vuota prima
  della chiusura (o crea il frontmatter); «Aggiungi una descrizione», fra gli
  strumenti al passaggio, scrive `description: ` e ci porta il cursore. Gli
  editor dei valori per tipo arriveranno; in Lettura le righe si leggono e
  basta, «Altre N» compreso, senza strumenti né «Aggiungi».
- **La copertina** è alta 112 px (88 sul foglio stretto) ed esce dalla colonna
  fino ai bordi della pagina. Al passaggio offre «Cambia copertina» e
  «Riposiziona»: l'immagine si trascina in su e in giù, o si sposta con ↑ ↓
  (Shift per un passo fine, Home e Fine ai bordi); Invio o «Salva la
  posizione» scrivono `cover-y:` (da 0 a 100, 50 il centro), Esc o «Annulla»
  tornano dov'era. Un'immagine che non si trova lascia il segnaposto col suo
  path.
- **La tastiera.** ↓ dal titolo passa per i valori, «Altre N» e «Aggiungi una
  proprietà», e dall'ultimo arriva alla prima riga del testo; ↑ sulla prima
  riga del testo torna all'ultima voce della testata, e da lì su fino al
  titolo.
- **Un frontmatter che non si legge** (una riga di primo livello che non è una
  chiave) non diventa righe a metà: la testata lo dice, e lo YAML resta sotto
  il titolo com'è scritto, in Scrittura e in Lettura.

La testata non scrive niente da sé: il file cambia solo per un gesto, con un
passo d'annullamento suo, e le righe `---` del frontmatter restano protette
dalle battute. In sola lettura si guarda soltanto. La densità «Compatta» la
stringe con il resto del foglio. Le scene `testata-*` e `mobile-testata` del
banco la fotografano con `?properties=visible`.

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

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/surface.ts`: le tre modalità
  (`MARKDOWN_MODES`), `markdownModeOf`, il montaggio dei blocchi in Scrittura;
- `apps/client/src/editors/core/surface-modes.ts`: `modeById`, che riconosce
  anche gli id di prima (`formerIds` di `SurfaceMode`);
- `apps/client/src/state/document-controller.ts` e `state/mode-menu.ts`: la
  modalità del riquadro e il commutatore della banda;
- `apps/client/src/editors/core/presence.ts`: i livelli di presenza;
- `apps/client/bench/scene.mjs`: la scena `scrittura-a-riposo`.
