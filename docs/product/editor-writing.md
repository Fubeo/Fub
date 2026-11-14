# Scrittura

> **Per chi:** chi scrive nelle note Markdown e chi aggiunge qualcosa al foglio
> dell'editor.
> **Risultato:** sapere quali modalità ha una nota, che cosa fa Scrittura, quando
> compare ciò che sta sul foglio e da dove si raggiunge una funzione.

## Le modalità di una nota

Una nota Markdown ha tre modalità:

- **Scrittura**, dove si scrive sulla pagina resa: i segni Markdown si
  attenuano o spariscono, e ogni blocco ha la sua maniglia;
- **Sorgente**, con la sintassi esplicita;
- **Lettura**, la resa senza cursore di testo (**Ctrl+E** ci va e torna alla
  modalità di prima).

Il commutatore in fondo alla banda di stato le elenca così: Scrittura,
Sorgente e, dopo un separatore, Lettura. Le altre superfici tengono le loro
modalità ([Editor e anteprima](editor-and-preview.md#modalità)).

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
  gli strumenti della testata, la pastiglia del livello di un titolo;
- **a richiesta**, dopo un gesto (un clic, un tasto, un carattere): la linea
  dove cade un blocco trascinato, la maniglia di un'immagine scelta, i menu.

Un elemento che compare al passaggio non sposta mai il testo: sta nel margine
o in uno spazio che c'era già. Nel DOM l'elemento dichiara il suo livello con
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

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/surface.ts`: le tre modalità
  (`MARKDOWN_MODES`), `markdownModeOf`, il montaggio dei blocchi in Scrittura;
- `apps/client/src/editors/core/surface-modes.ts`: `modeById`, che riconosce
  anche gli id di prima (`formerIds` di `SurfaceMode`);
- `apps/client/src/state/document-controller.ts` e `state/mode-menu.ts`: la
  modalità del riquadro e il commutatore della banda;
- `apps/client/src/editors/core/presence.ts`: i livelli di presenza;
- `apps/client/bench/scene.mjs`: la scena `scrittura-a-riposo`.
