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
`blocks` da un Fub di prima si apre in Scrittura, e il layout non si riscrive.

Chi aveva scelto Live o Blocchi non deve accorgersi di niente:

- **La modalità iniziale** (`editor.default-mode`, nelle Impostazioni, gruppo
  Editor) offre Scrittura, Sorgente e Lettura. Il valore `blocks`, scritto da
  un Fub di prima, resta valido: il file delle impostazioni non si riscrive, la
  riga resta «cambiata da te», le note si aprono in Scrittura e il controllo
  accende Scrittura. Nello schema `blocks` è l'ultima scelta, con l'etichetta di
  Scrittura, e il pannello mostra una sola scelta per etichetta
  (`visibleChoices` in `panels/settings-model.ts`). Un valore sconosciuto vale
  il predefinito, Scrittura, come per ogni scelta.
- **I comandi** tengono i loro id. `shell.mode.live` si chiama «Passa a
  Scrittura»; `shell.mode.blocks` si chiama «Passa a Scrittura (era Blocchi)»,
  porta anche lui a Scrittura e c'è soltanto sulle note. Le scorciatoie
  restano dove sono: Mod+Shift+B di fabbrica, o quella che la persona aveva dato
  ai Blocchi (`keys.shell.mode.blocks`).
- I comandi delle modalità sono della finestra: un agente via MCP non li vede
  in `fub_commands`, e `fub_invoke` li rifiuta allo stesso modo con l'id vecchio
  e con quello nuovo.

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

## La riga dei suggerimenti

Al centro della banda in basso, in grigio, ci sono i tasti utili per ciò che si
sta facendo. Niente finestre che coprono il lavoro: la riga suggerisce e basta.

| Dove sta il cursore | Che cosa dice la riga |
| --- | --- |
| in una riga qualunque | «/ inserisce un blocco · @ persone e date · Ctrl+O cerca o esegue · Esc seleziona il blocco» |
| su un testo scelto | «Ctrl+B grassetto · Ctrl+I corsivo · Ctrl+K collega» |
| in un compito | «Ctrl+Enter spunta · @ una data diventa la scadenza · Tab rientra» |
| su un link | «Ctrl sopra il link: l'anteprima · Alt+Enter lo apre» |
| su blocchi scelti | «↑ ↓ scegli · Shift+↑ Shift+↓ allarga · Ctrl+Shift+↑ Ctrl+Shift+↓ sposta · Ctrl+D duplica · Del elimina · Enter scrivi» |
| nel titolo della pagina | «Enter rinomina il file e scende nel testo · ↓ scende nel testo · Esc lascia il nome» |
| col «/» aperto | «↑ ↓ scegli · Enter metti · Tab gruppo dopo · Esc lascia il testo · Ctrl+/ tutti i comandi» |

Le regole:

- i comandi si scrivono coi tasti della persona: la scorciatoia cambiata nelle
  Preferenze si vede alla prima pausa, quella tolta toglie la voce. Un comando
  senza scorciatoia propria mostra quella con cui l'editor lo esegue da sé
  (Ctrl+B per il grassetto). Se due comandi hanno lo stesso tasto, la voce resta
  a quello che il tasto esegue davvero, e un tasto si dice una volta sola;
- la riga cambia dopo una pausa breve (almeno 300 ms senza battute), non a
  ogni battuta né a ogni freccia, e non chiede niente al backend;
- quando lo spazio non basta (una finestra stretta, la somma delle celle scelte
  che entra nella banda) la riga toglie le voci dalla fine, sempre intere; senza
  niente da dire resta vuota al suo posto, e la banda non si sposta;
- è `aria-hidden`: i gesti si annunciano da sé, la riga no;
- non c'è al telefono né in una finestra più stretta di 620 px, e si spegne
  nelle Preferenze con «Riga dei suggerimenti» (`editor.hints`, accesa di
  serie).

La pubblica la nota in Scrittura, attraverso la porta della riga
(`openHintSource`); un altro editor che vuole i suoi suggerimenti apre la sua
fonte coi suoi tasti. Anche il segnaposto della riga vuota dice i due tasti del testo:
«Scrivi, oppure / per i blocchi e @ per persone e date». Il vault della demo ha
«Il giro dell'editor», una nota con dieci cose da provare, ciascuna un compito
da spuntare.

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
  modalità del riquadro, i comandi `shell.mode.*` e il commutatore della banda;
- `crates/fub-host/src/settings.rs`: `editor.default-mode` e le sue scelte;
  `apps/client/src/panels/settings-model.ts`: le scelte che il pannello mostra;
- `apps/client/src/editors/core/presence.ts`: i livelli di presenza;
- `apps/client/src/shells/scrittoio/frame/hints-row.ts`: la riga dei
  suggerimenti, la porta (`openHintSource`) e i tasti della persona
  (`resolveHints`); `editors/text/profiles/markdown/hints.ts`: i contesti della
  nota (`markdownHints`); `crates/fub-host/src/settings.rs`: `editor.hints`;
  `crates/fub-host/src/support.rs`: «Il giro dell'editor» nella demo;
- `apps/client/bench/scene.mjs`: le scene `scrittura-a-riposo` e
  `riga-dei-suggerimenti`.
