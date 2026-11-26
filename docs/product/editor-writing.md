# Scrittura

> **Per chi:** chi scrive nelle note Markdown e chi aggiunge qualcosa al foglio
> dell'editor.
> **Risultato:** sapere quali modalità ha una nota, che cosa fa Scrittura, quando
> compare ciò che sta sul foglio, da dove si raggiunge una funzione, che cosa
> dice la riga dei suggerimenti, come si scrive in tipografia italiana e come
> si scrive concentrati. I link, la sbirciata e le pagine incorporate sono in
> [Link, sbirciata e pagine incorporate](editor-links.md).

## Le modalità di una nota

Una nota Markdown ha tre modalità:

- **Scrittura**, dove si scrive sulla pagina resa: i segni Markdown si
  attenuano o spariscono, e coi blocchi accesi ogni blocco ha la sua maniglia;
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

## Blocchi accesi o spenti

Come si comporta Scrittura lo dice la preferenza della macchina
`editor.blocks` («Blocchi: maniglie e selezione», gruppo Editor delle
Impostazioni; accesa di fabbrica). Accesa, Scrittura è un editor a
[blocchi](editor-blocks.md), alla Notion: maniglie e «+», Esc che seleziona il
blocco, Mod+A che prende il blocco e poi tutti i blocchi. Spenta, è un editor
di testo: niente maniglie, Esc non seleziona blocchi, Mod+A prende il corpo
della nota, Mod+D sceglie la prossima occorrenza e Mod+Shift+↑/↓ sposta le
righe; la testata della pagina, la resa dei segni e il «/» restano. La tabella
completa sta in [I blocchi spenti](editor-blocks.md#i-blocchi-spenti).

La preferenza si cambia anche dal menu «…» del riquadro di una nota, gruppo
Scrittura: la voce ha la spunta, dice che cosa fa Mod+A in quello stato, e un
avviso conferma il cambio. Ogni nota aperta in Scrittura cambia subito, senza
riaprirsi: testo, selezione, scorrimento e cronologia restano.

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

### Al tocco

Senza puntatore (`(any-hover: hover)` falso) «+» e maniglia stanno sul blocco
del cursore finché la nota ha il fuoco, con 40 px di margine sul foglio
stretto; il gruppo del blocco sta nella [barra sopra la tastiera](editor-toolbar.md).
Regola: `touchMode` in `editors/text/profiles/markdown/blocks/handles.ts`; scene `mobile-tocco-*`.

## La testata

In cima alla nota, in Scrittura e in Lettura, sta la testata: copertina, icona,
titolo, proprietà e [riga dei dati](editor-note-facts.md). Che cosa fa ogni
parte, come si scrivono le proprietà e come il titolo segue il primo H1 lo dice
la [pagina della testata](editor-header.md); che cosa cambia in una nota con un
tipo (Libro, Progetto) e che cosa chiede «Nuova nota» lo dicono i
[tipi di nota](editor-note-types.md).

## Tre porte per ogni funzione

Chi scrive non deve ricordarsi dove sta una funzione: ognuna si raggiunge dal
«/» nel testo, dalla palette dei comandi e dal tasto destro o da un menu,
con la scorciatoia scritta accanto quando c'è. Le funzioni dei blocchi hanno
anche «+ Inserisci» nella [barra di formato](editor-toolbar.md). Sul testo
scelto la mini-barra raccoglie ciò che si fa a una selezione: Trasforma, i
formati in riga, Collega, Colore e «Commenta»; ogni pulsante è la sua
scorciatoia, con lo stesso annullamento. Una funzione nuova del foglio entra
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

La pubblica la nota in Scrittura, attraverso la porta degli editor
(`openHintSource` in `editors/core/hints.ts`); un altro editor che vuole i suoi
suggerimenti apre la sua fonte coi suoi tasti. Anche il segnaposto della riga
vuota dice i due tasti del testo: «Scrivi, oppure / per i blocchi e @ per
persone e date». Il vault della demo ha «Il giro dell'editor», una nota con
dieci cose da provare, ciascuna un compito da spuntare.

## La tipografia italiana

Con «Tipografia italiana» accesa nelle Preferenze (`editor.typography`,
spenta di serie, di questa macchina) la nota si scrive coi segni della
tipografia italiana mentre si batte:

- `"` diventa « dopo uno spazio, una parentesi o a inizio riga, » dopo una
  parola; dentro una citazione già aperta diventa “ e ”;
- `--` diventa —; un terzo `-` subito dopo rimette `---`;
- `...` diventa …; l'apostrofo `'` diventa ’, anche a inizio parola (’90).

Scatta sul tasto che chiude la forma. Un annulla o un Backspace subito dopo
rimettono ciò che si era scritto. Non cambia mai:

- il codice (in linea e a blocchi), le formule (`$…$`, `$$…$$`), i link e i
  wikilink, l'HTML, i commenti e il frontmatter, anche mentre li si sta
  ancora scrivendo;
- una riga di soli trattini, barre e due punti: il separatore `---`, la
  sottolineatura di un titolo, la riga di una tabella;
- ciò che si incolla o si trascina, un testo che arriva in un colpo e la
  composizione (IME); con Vim, i tasti del modo normale.

Vale nelle note in italiano: la lingua dichiarata dalla nota (`lang: it`),
altrimenti quella dell'app.

## La concentrazione

La concentrazione (`shell.focus.toggle`, «Modalità concentrazione» nel menu
Vista e in Ctrl O, «Concentrazione» nel menu «…» del riquadro di una nota)
lascia il foglio e poco altro:

- cassetti, linguette e barra di formato si ritirano; la barra del titolo si
  attenua nei colori, leggibile, e torna piena al passaggio o col fuoco;
- nel foglio che ha il fuoco resta acceso il blocco del cursore (le righe fino
  alla riga vuota prima e dopo, o tutte quelle che una scelta attraversa) e gli
  altri si attenuano; la riga sotto il puntatore si riaccende. Vale in ogni
  modalità e in ogni linguaggio, e segna soltanto le righe montate;
- la banda resta, con «Esci dalla concentrazione»; la riga dei suggerimenti
  dice che Esc esce;
- Esc esce quando nessuno lo prende prima: un menu, un dialogo o la sbirciata
  aperti si chiudono e basta; una selezione di blocchi si lascia, e il blocco
  non si seleziona. Con Vim acceso Esc resta di Vim anche in modo normale, e si
  esce con «Esci» o col comando.

## La macchina da scrivere

La preferenza della macchina `editor.typewriter` («Macchina da scrivere»,
gruppo Editor delle Impostazioni; spenta di fabbrica) tiene la riga del cursore a metà altezza del
foglio, in ogni editor di testo che non sia un campo:

- scrivendo, con le frecce, con annulla e rifai la riga torna a metà; il clic,
  il trascinamento e i cambi arrivati da un altro riquadro non fanno scorrere;
- in cima a una nota corta il testo non scende oltre l'inizio; sotto l'ultima
  riga c'è mezzo foglio vuoto, perché anche l'ultima possa stare a metà;
- non costa niente per battuta: dove CodeMirror porterebbe già il cursore in
  vista lo porta a metà, nello stesso passo di misura, e soltanto se il testo è
  cambiato o il cursore si è mosso. Scrivere dentro una riga che sta già a metà
  non fa scorrere.

## Dove sta nel codice

- `apps/client/src/editors/text/profiles/markdown/surface.ts`: le tre modalità
  (`MARKDOWN_MODES`), `markdownModeOf`, il montaggio dei blocchi in Scrittura
  e il cambio di `editor.blocks` sulla vista aperta; `blocks/keys.ts`: i tasti
  coi blocchi accesi (`blockKeysExtension`) e spenti (`plainKeysExtension`);
- `apps/client/src/state/editor-blocks.ts`: la preferenza `editor.blocks`;
  `apps/client/src/panels/document.ts`: la voce del menu «…»;
- `apps/client/src/editors/core/surface-modes.ts`: `modeById`, anche con gli id di prima (`formerIds`);
- `apps/client/src/state/document-controller.ts` e `state/mode-menu.ts`: la
  modalità del riquadro, i comandi `shell.mode.*` e il commutatore della banda;
- `crates/fub-host/src/settings/editor_specs.rs`: `editor.default-mode` e le sue scelte;
  `apps/client/src/panels/settings-model.ts`: le scelte che il pannello mostra;
- `apps/client/src/editors/core/presence.ts`: i livelli di presenza;
- `apps/client/src/editors/core/hints.ts`: la porta dei suggerimenti
  (`openHintSource`, `currentHints`, `onHintsChanged`);
  `shells/scrittoio/frame/hints-row.ts`: la riga che la ascolta e i tasti della
  persona (`resolveHints`); `editors/text/profiles/markdown/hints.ts`: i
  contesti della nota (`markdownHints`); `crates/fub-host/src/settings/editor_specs.rs`: `editor.hints`;
  `crates/fub-host/src/support.rs`: «Il giro dell'editor» nella demo;
- `apps/client/src/editors/text/profiles/markdown/typography.ts`: la
  tipografia italiana (`italianTypography`, montata da `profile.ts`);
  `crates/fub-host/src/settings/editor_specs.rs`: `editor.typography`;
- `apps/client/src/desktop-shell.ts`: la concentrazione (`toggleFocusMode`,
  «Esci» nella banda, Esc); `apps/client/src/state/concentration.ts`: lo stato
  per chi sta sotto la shell e la regola di Esc;
  `apps/client/src/editors/text/cursor-block.ts`: il blocco del cursore;
  `apps/client/src/theme/scrittoio/structure.css`: che cosa si ritira e che
  cosa si attenua;
- `apps/client/src/editors/text/typewriter.ts`: la macchina da scrivere (la
  faccetta `typewriter`); `apps/client/src/editors/text/engine.ts` la legge
  da `editor.typewriter` (`crates/fub-host/src/settings/editor_specs.rs`);
- `apps/client/bench/scene.mjs`: le scene `scrittura-a-riposo`,
  `riga-dei-suggerimenti`, `concentration`, `concentration-writing`,
  `typewriter`.
