# Esporta in PDF

Lo spazio «Esporta in PDF» mostra le pagine vere di una nota Markdown prima
di esportarle: come vanno a capo, dove cade ogni interruzione, che cosa sta
nella testata e nel piè di pagina. Vive in
[`apps/client/src/export/`](../../apps/client/src/export/); le pagine le
taglia l'impaginatore della stampa (`PrintPaginator` in
[`paginate/slices.ts`](../../apps/client/src/export/paginate/slices.ts)),
le regole del profilo sono quelle del core (`fub-markdown`, il `Profilo` di
stampa).

## Come si apre e come si chiude

- Dal menu «…» del riquadro di una nota, «Esporta in PDF…». Su una nota
  Markdown la voce prende il posto di «Stampa», che sta nella barra dello
  spazio; la lavagna tiene «Stampa».
- Dallo spazio comandi (Ctrl O), «Esporta in PDF…»
  (`shell.doc.export_pdf`), sulla nota del riquadro attivo.
- All'apertura la nota si salva; lo spazio copre il riquadro e la banda di
  stato, che restano inerti sotto.
- «Torna alla nota» o Esc chiude lo spazio e rimette il fuoco dove stava
  prima, se c'è ancora. Chiudere il riquadro chiude anche lo spazio.

## Più note in un PDF

- Dal tasto destro su una cartella dell'albero, «Esporta in PDF…»: le note
  Markdown della cartella e delle sue sottocartelle, nell'ordine
  dell'albero (la pagina della cartella per prima, poi le sottocartelle,
  poi le note), anche quelle delle cartelle chiuse.
- Dal tasto destro su più note scelte insieme, «Esporta in PDF…»: le note
  nell'ordine in cui si sono scelte.
- Lo spazio è lo stesso: la barra dice il nome della cartella (o «Note
  scelte») e quante note sono, e «Torna alle note» lo chiude. Ogni nota è un
  capitolo: comincia su una pagina sua, col suo nome in testa. L'indice è
  uno solo, per tutto il PDF.
- I collegamenti fra le note esportate portano dentro il PDF, alla nota o
  alla sezione che nominano; quelli verso note rimaste fuori restano verso
  fuori. Due note con lo stesso nome si distinguono nei segnalibri col loro
  percorso.
- Una nota che non si legge resta fuori, e un avviso la nomina; i file che
  non sono note Markdown (disegni, fogli) restano fuori, e un avviso lo
  dice. Oltre 500 note lo spazio non si apre e chiede di esportarne meno.
- Le note si salvano all'apertura e si seguono come una nota sola: una
  nota che cambia in un riquadro rifà le pagine.
- «Esporta» passa per ora dalla stampa del sistema, come per una nota sola.
  Il comando che scrive il PDF di più note (`pdf.write_book`) ne fa un
  lavoro solo, che si annulla dal centro attività (vedi
  [il formato](../reference/pdf-export-format.md#più-note-in-un-pdf)).

## Che cosa c'è

- **La barra in alto**: «Torna alla nota», il nome della nota, lo zoom
  (−, percentuale, +), le tre viste (Una, Due, Tutte), il profilo, «Stampa…»
  ed «Esporta». Nella vista Tutte un clic su una pagina la apre in Una.
- **Le pagine** su un fondo neutro, nei colori del tema di stampa. Si
  riempiono solo le pagine vicine a quelle visibili: una nota lunga non
  costruisce tutte le copie insieme.
- **Le dieci sezioni** a destra: Tema, Colori, Caratteri, Pagina, Testata e
  piè di pagina, Frontespizio e indice, Contenuto, Diagrammi, Interruzioni di
  pagina, Uscita. La testa chiusa dice ciò che vale ora («A4 verticale»,
  «Titolo, Pagina»). Le regolazioni di ogni sezione arrivano coi
  loro lavori; finché manca, la sezione aperta lo dice.
- **La banda** in basso: le pagine, il formato, i margini, i segnalibri e il
  tempo dell'impaginazione. Il numero di pagine si annuncia a voce solo
  quando cambia.

## Tema e Colori

I temi di stampa e i loro colori vivono in
[`export/themes.ts`](../../apps/client/src/export/themes.ts); le due
sezioni in [`export/sections/theme.ts`](../../apps/client/src/export/sections/theme.ts)
e [`export/sections/colors.ts`](../../apps/client/src/export/sections/colors.ts).

- **Otto temi**: Fub, Classico, Relazione, Rivista, Accademico, Quaderno,
  Essenziale, Notte. Ognuno porta gli undici colori, i caratteri dei titoli
  e del testo, il corpo, l'interlinea, la scala dei titoli e l'impostazione
  (colonne, giustificato, rientro o spazio fra i paragrafi, titoli centrati
  o numerati). Un tema che questa versione non conosce si legge come Fub.
- Passare su un tema lo mostra sulle pagine senza sceglierlo; uscendo
  tornano le pagine di prima. Un clic lo sceglie.
- **Undici colori**: carta, testo, titoli, accento, link, testo secondario,
  linee, evidenziato, riquadri, codice, intestazioni di tabella. Una riga
  aperta offre i tondi pronti, un selettore libero e il codice a mano
  (`#rgb` o `#rrggbb`, come il core). Un codice scritto male non entra: la
  riga lo dice e resta il colore di prima; Esc nel campo rimette il colore
  com'era. Passare su un colore contorna sulle pagine i punti che lo usano.
- **Il contrasto** del testo sulla carta si ricalcola a ogni colore e avvisa
  sotto 4,5 a 1; l'accento avvisa a parte sotto 3 a 1.
- Ciò che cambi tu resta cambiando tema: la riga dice «tuo» e torna al
  colore del tema da sola; «Togli le regolazioni tue» le toglie tutte.
- **Bianco e nero** fa grigio ogni colore e, con un filtro sulla pagina,
  anche ciò che i colori non raggiungono (un diagramma colorato,
  un'immagine). **Risparmia inchiostro** dà carta bianca e niente fondi
  pieni: un fondo uguale alla carta prende il filo delle linee.
- Un colore cambia solo variabili dell'aspetto e non rifà l'impaginazione;
  il tema la rifà solo se cambia le misure (caratteri, colonne). Le pagine
  si stampano coi colori del tema anche quando l'app è scura: il tema
  dell'app cambia solo la cornice dello spazio. Notte stampa davvero su
  carta scura, col codice e il testo colorato schiariti.

## Caratteri e Pagina

Le due sezioni vivono in
[`export/sections/fonts.ts`](../../apps/client/src/export/sections/fonts.ts)
e [`export/sections/page.ts`](../../apps/client/src/export/sections/page.ts);
le guide dei margini in [`export/guides.ts`](../../apps/client/src/export/guides.ts).

- **Il testo e i titoli** si scelgono fra i caratteri che Fub porta con sé
  (Newsreader, Literata, Hanken Grotesk, Inter; IBM Plex Mono solo per i
  titoli), ognuno scritto nel suo carattere, e fra quelli del vault: ogni
  file `.ttf`, `.otf`, `.woff` o `.woff2` del vault, raccolti in famiglie
  (il comando `pdf.vault_fonts`, vedi il
  [formato](../reference/pdf-export-format.md#i-caratteri)). Il PDF li
  incorpora tutti, e le pagine li mostrano come usciranno.
- Un carattere del vault che la licenza **non lascia incorporare** si vede
  barrato e non si sceglie: l'avviso dice perché, e il testo resta nel
  carattere del tema. Un profilo che lo nominava, o che nomina un carattere
  sparito dal vault, si legge nel carattere del tema e la sezione lo dice.
  Un carattere **senza corsivo** lo dice: il corsivo esce diritto, sulle
  pagine e nel PDF, mai un obliquo inventato.
- **Corpo** (da 8 a 14 pt), **interlinea**, **scala dei titoli**: cursori che
  rifanno le pagine mentre si trascinano. Poi i paragrafi staccati o col
  rientro, i titoli a sinistra o al centro, il testo giustificato, la
  **sillabazione** (nel testo, non nel codice né nelle tabelle) e i titoli
  numerati. Ogni scelta resta cambiando tema.
- **La pagina**: A4, A5, A3, Lettera o una misura propria (ogni lato da 50 a
  1189 mm: un numero fuori resta scritto in rosso, la frase lo dice e la
  pagina non cambia), verticale o orizzontale, una o due colonne.
- **I margini**: i tre pronti (Stretti, Normali, Larghi), i quattro numeri in
  millimetri, o le **guide** sul bordo del testo, che si vedono con la
  sezione Pagina aperta e si trascinano: la misura appare accanto al
  puntatore, le pagine seguono dal vivo, Esc rimette i margini di prima. Un
  margine va da 5 a 70 mm e lascia al testo almeno 30 mm: uno più largo
  diventa il più largo possibile e la frase lo dice.
- **Margini a specchio** per il fronte e retro: sulle pagine pari interno ed
  esterno si scambiano (e la guida di sinistra cambia il margine destro).
  **La filigrana**, al più 18 caratteri, attraversa ogni pagina in diagonale,
  appena accennata.
## Testata e piè, frontespizio e indice

- **Sei posti**: a sinistra, al centro e a destra, sopra e sotto la pagina.
  Un clic su un posto apre il menu: niente, il titolo della nota, la sezione
  in corso, la data, la pagina, «pagina di pagine», l'autore (la proprietà
  `autore` o `author`), il percorso nel vault o un testo tuo, che si scrive
  nel campo sotto i posti. Testata e piè stanno nei margini e usano i
  caratteri dei titoli e il testo secondario del tema di stampa.
- La **sezione** è il Titolo 1 o 2 in corso in cima alla pagina, o quello
  con cui la pagina comincia; prima del primo titolo il posto resta vuoto.
- **Filo sotto la testata** (acceso di serie), **prima pagina senza
  testata**, **numeri romani** per frontespizio e indice: con i romani la
  nota riparte da 1, senza il frontespizio e l'indice si contano solo nel
  totale delle pagine. A specchio, nelle pagine pari sinistra e destra si
  scambiano.
- **Il frontespizio** ha l'icona della nota, il titolo, fino a quattro
  proprietà, l'autore e la data, con il filo d'accento sul bordo; non ha
  testata né piè e non si numera. Con il frontespizio il titolo in cima
  alla nota esce dalle pagine.
- **L'indice** arriva fino ai Titoli 2 o anche ai 3 e porta i numeri che le
  pagine stampano davvero: si impagina in due passi (prima con il numero più
  largo, poi con quelli veri, finché le sue pagine non cambiano più). Un
  indice lungo va su più pagine; una nota senza titoli non ha indice.
  Finché l'impaginazione non è finita i numeri che mancano sono «…».
- **I segnalibri** del PDF seguono i titoli; la banda dice quanti sono.
- Cambiare testata, frontespizio o indice ridisegna i fogli senza rifare
  l'impaginazione della nota; il testo tuo segue mentre si scrive.

## Contenuto e Interruzioni

Le due sezioni vivono in
[`export/sections/content.ts`](../../apps/client/src/export/sections/content.ts);
ciò che ogni scelta fa sulle pagine in
[`export/content/`](../../apps/client/src/export/content/), un modulo per
specie di blocco. La resa per la stampa si monta una volta: prima di ogni
misura il contenuto la cambia secondo il profilo, dopo la rimette com'era.
Un blocco aggiunto (le proprietà, una riga di provenienza) non sposta le
identità degli altri.

- **Proprietà** sotto il titolo: nessuna, in evidenza (le prime quattro,
  senza icona, copertina ed etichette) o tutte. Arrivano dall'indice dopo la
  resa; senza l'indice la pagina esce senza.
- **Commenti**: no, nel margine o in fondo. Ogni passo commentato prende un
  numero; i commenti di seguito sono una discussione sola. Nel margine la
  nota dice il primo nome, il testo e quante risposte, accanto al suo
  paragrafo; con due colonne o un margine sotto i 22 mm va in fondo. In
  fondo, sotto il titolo «Commenti», ogni messaggio col nome e la data. Un
  commento in una cella di tabella ha il numero nella cella. La resa per la
  stampa del core porta i commenti in `<template class="comment-note">`, che
  il sanificatore toglierebbe: prima di montarla lo spazio ne fa segnaposti
  vuoti col solo testo in `data-text` (`inertComments`).
- **Link** colorati, sottolineati o come il testo; **tabelle** a linee, a
  righe alterne o a griglia. Cambiano solo l'aspetto, non l'impaginazione.
- **Compiti fatti**: si mostrano o si tolgono, coi passi che tengono dentro.
- **Ripiegabili**: tutti aperti, o chiusi col solo titolo.
- **Note riportate**: svolte, con sotto la riga «da Cartella / Nota ›
  Sezione». Una nota che riporta sé stessa (o troppo in profondità) non si
  svolge e la riga dice perché.
- **Schede vive**: l'anteprima col nome, solo il nome, o per un PDF tutte le
  sue pagine in fondo (al più 200; la riga al posto della scheda dice dove
  sono, e quante restano nel file). Un PDF che non si legge esce con
  l'anteprima.
- **Basi**: si distendono senza la barra e la ricerca, con sotto «Base ·
  vista · n righe»; si misurano come una tabella, così una Base di mille
  righe continua pagina dopo pagina.
- **Codice numerato**: un numero per riga del sorgente, fuori dal testo.
- **Interruzioni**: una pagina nuova a ogni Titolo 2 o a ogni separatore, e
  l'intestazione delle tabelle lunghe ripetuta in cima a ogni pagina (di
  serie). Spenta, l'intestazione resta solo all'inizio.

## Diagrammi

La sezione Diagrammi decide come escono i diagrammi Mermaid della nota.
`%% stile:` nella nota non cambia: tutto sta nel profilo (`diagrammi`, i
colori `diagramma-*`).

- **Lo stile**, sei pulsanti con la miniatura nei colori che disegnano
  davvero: «Come nella nota» (lo stile di ogni diagramma, in luce chiara),
  «Segue il tema» (Armonia coi colori della carta di stampa) o uno dei
  quattro stili con il fondo (Acquerello, Aurora, Blueprint, Inchiostro).
  Passando su uno stile le pagine lo mostrano; uscendo tornano a quello
  scelto. La testa chiusa dice il nome dello stile.
- **Uno stile per un solo diagramma**: lo dà il clic sul diagramma nella
  pagina; vale per la posizione del diagramma fra quelli della nota (non
  per quelli di una nota trasclusa, che prendono lo stile di tutti). Quando
  ce ne sono, la sezione offre «Togli lo stile dato a N».
- **Quattro colori dati a mano**: nodi, decisioni, inizio e fine, linee.
  Ognuno ha una tavolozza di dodici inchiostri, un colore qualsiasi e il
  codice; un colore dato vince sullo stile, e la scritta sopra sceglie da
  sola fra chiaro e scuro. «tuo» segna i colori dati, il pulsante accanto
  torna a quello dello stile.
- **Fondo del diagramma**: spento, i quattro stili con il fondo perdono la
  carta colorata e stanno sulla carta della pagina.

Un cambio di stile, colori o fondo ridisegna i diagrammi della resa che c'è,
senza chiederla di nuovo al core; anche un tema in anteprima, per i
diagrammi che seguono il tema. Il bianco e nero vale anche per i colori
dati ai diagrammi. In un PDF di più note vale per ogni capitolo lo stile di
tutti: lo stile di un diagramma solo conta le posizioni dentro una nota.

### Sulla carta

- I diagrammi e le formule vanno nel PDF come vettori (`svg2pdf`, nello
  scrittore del core): la misura delle pagine (`export/probe.ts`, con
  `vectorOf` di `export/vectors.ts`) passa il disegno di un diagramma con i
  suoi colori scritti sugli elementi e le scritte come testo, che nel PDF
  si seleziona. Le radici e le frecce delle formule sono già SVG nella
  resa. Finché «Esporta» passa dalla stampa del sistema, la stampa riceve
  gli stessi disegni.
- Un diagramma con un errore esce con l'ultimo disegno buono visto nello
  spazio; se non ce n'è uno, al suo posto c'è il riquadro «non disegnato»
  con il problema.
- Una formula o un diagramma più larghi della colonna si rimpiccioliscono
  per starci (non sotto il 30%) e una riga piccola sotto lo dice («formula
  al 64% per stare nella pagina»).

## Comportamenti

- Mentre si trascina un controllo il profilo cambia «dal vivo»: le pagine si
  rifanno, il pannello no, così il controllo non perde il fuoco.
- Se la nota cambia in un altro riquadro, lo spazio la risalva e rifà le
  pagine dopo una pausa breve (400 ms).
- «Stampa…» (o Ctrl P nello spazio) aspetta l'impaginazione finale e manda
  al sistema le stesse pagine che si vedono, con il formato della carta.
- «Esporta» scrive il PDF quando c'è lo scrittore del PDF; finché manca
  passa dalla stampa del sistema, e un avviso lo dice.
- Il menu del profilo offre per ora soltanto «Di serie» (A4, margini
  25/22/25/22 mm, titolo in alto a destra, «pagina n di m» in basso al
  centro).
- Sotto i 1040 px spariscono il nome della nota e il suggerimento della
  banda, e il pannello si stringe; sotto i 760 px (e sul telefono) il
  pannello va sotto le pagine, la barra tiene solo indietro, profilo,
  stampa ed esporta, la banda solo pagine e formato. Con il moto ridotto lo
  spazio entra senza animazione.
