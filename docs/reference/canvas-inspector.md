# L'ispettore della lavagna

> **Ambito:** le linguette che la lavagna porta nell'ispettore dello
> Scrittoio: «Schede» in ordine di lettura, «Scheda» e «Fili» che cambiano la
> selezione, «Fonti» coi file sulla lavagna e le loro barre.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/chrome/inspector.ts`,
> `reading-order.ts`, `sources.ts` e le loro prove; le porte di «Fonti» in
> `surface.ts`.

Questa pagina viene da [I tasti e i gesti della lavagna](canvas-input.md).
Le parti di un estratto (`fub:parts`) stanno in
[Gli estratti della lavagna](canvas-parts.md).

## Le linguette

La lavagna porta nell'ispettore dello Scrittoio le sue linguette
(`EditorSurface.panels`, `chrome/inspector.ts`), come il disegno: «Schede»
sempre, «Scheda» con una scheda scelta, «Fili» con un filo scelto, e in
fondo «Fonti», sempre. Si offrono solo con la tela in vista: nel Sorgente,
o senza nucleo, l'ispettore non ha linguette della lavagna. Titoli, note a
piè di pagina e proprietà, che di una lavagna non dicono niente, restano
fuori (`covers`).

## «Schede»

«Schede» elenca tutte le schede in **ordine di lettura** (`readingOrder` in
`reading-order.ts`, una regola pura):

- una scheda sta in un gruppo se il suo rettangolo è tutto dentro quello del
  gruppo, come quando la tela sposta un gruppo; conta il gruppo più piccolo che
  la contiene. Due gruppi identici non si contengono a vicenda: quello sotto
  (prima nell'array) contiene l'altro;
- a ogni livello vengono prima i gruppi, poi le altre schede; dopo un gruppo
  il suo contenuto, rientrato, con le stesse regole;
- le schede vanno in righe, dall'alto in basso, e ogni riga da sinistra a
  destra. Due schede stanno sulla stessa riga se si sovrappongono in altezza
  per più di metà della più bassa; la riga la apre la scheda più in alto. A
  parità di tutto viene prima quella sotto.

Ogni riga ha la figura, il nome (l'etichetta del gruppo, la prima riga del
testo, il file senza cartelle, l'host della pagina web) e la specie. Il filtro
tiene le schede col nome che contiene ciò che si scrive (senza badare a
maiuscole e accenti) e della specie scelta (note, testi, gruppi, PDF), coi
gruppi che le contengono. Un clic, Invio o Spazio porta la vista sulla scheda
e la sceglie (`revealSource` della tela, al byte dove comincia l'oggetto della
scheda); la vista ci va come ogni salto (`#jumpCamera`): vola, e Indietro
torna da dove si era ([canvas-view.md](canvas-view.md)). La riga resta
segnata finché la scelta della lavagna non cambia per un'altra strada. Le frecce, Inizio, Fine e PagSu/PagGiù muovono il fuoco fra
le righe, con una sola fermata del Tab.

L'elenco si rilegge a fine gesto (ogni commit) e quando arriva un testo nuovo.
Oltre 500 righe disegna solo quelle che si vedono, più la fermata del Tab.

## «Scheda» e «Fili»

«Scheda» mostra la selezione (T59): X, Y, larghezza e altezza coi campi
numerici del kit, che accettano anche `120+15` o `*2`; con più schede scelte
i numeri valgono per tutte e un valore diverso fra loro si legge «—». Poi il
colore (i colori di T47, «Colori diversi» se non è uno solo) e il file, in
sola lettura. Sotto il file di una scheda sola c'è «Sostituisci il file…»,
la stessa azione del menu della scheda (`canvas.replace_file`,
[convertire](canvas-convert.md)): c'è solo se la superficie ha il selettore
dei file, e non in sola lettura. «Avanzate», chiusa di serie, mostra il nodo grezzo come tabella
chiave-valore: ogni valore si scrive come JSON e si controlla prima del
commit (un JSON non valido, un numero non finito, una misura sotto
`DROP_MIN_SIZE` restano com'erano e la riga dice perché). L'id e il tipo non
si cambiano; i campi `fub:` con una forma loro (l'inchiostro, gli estratti)
si vedono ma si cambiano dal loro editor; un campo sconosciuto di un altro
programma si vede, si conserva e si cambia come testo.

«Fili» mostra il filo scelto: l'etichetta, le punte, i lati di partenza e di
arrivo (Automatico, Sopra, Destra, Sotto, Sinistra) e «Inverti la
direzione»; con più fili scelti chiede di sceglierne uno. Ogni modifica, da
«Scheda», «Avanzate» o «Fili», è un commit della lavagna con il suo annulla
(`commitPatches` del motore); un annulla rende il file uguale, byte per byte.
In sola lettura tutto si legge e niente si cambia.

## «Fonti»

«Fonti» (T77) dice quali file stanno sulla lavagna e che cosa se ne vede:
una riga per file, in ordine di nome (i numeri come numeri, poi il percorso
per due file con lo stesso nome), col nome, il numero delle schede e una
barra. La regola è pura, in `sources.ts`: dalle schede lette (`boardCards`)
`boardSources` dà, per ogni file mostrato da almeno una scheda, le pagine,
le sezioni o il file intero, e `sourceBar` ne fa i pezzi.

- **Le pagine** di un PDF vengono dal `subpath` (`#page=3`, anche le schede
  di «Spargi le pagine») e da `fub:parts` `pages` e `region`. La barra ha un
  pezzo per pagina; quante sono lo dice il PDF (`pdfPages.count`, la porta
  di «Spargi le pagine»). Finché non si sa, o se il PDF non si apre, la
  barra non c'è e la riga dice le pagine a parole («pp. 3, 7»). Oltre 200
  pagine un pezzo ne tiene più d'una.
- **Le sezioni** di una nota vengono dal `subpath` (`#Varianza`,
  `#Capitolo#Varianza`) e da `fub:parts` `sections`; i pezzi sono i titoli
  del sommario (la domanda `outline` dell'indice, come il selettore delle
  sezioni), e una chiave trova il suo titolo per chiave intera o per il
  titolo più interno, se nella nota è uno solo. Una sezione usata che il
  sommario non ha più resta in fondo. Una nota senza titoli è un pezzo
  solo, «tutta». Un `#^blocco` conta la scheda ma non un pezzo.
- **Il file intero**: un file che le schede mostrano solo intero (una nota
  senza `subpath`, un PDF senza pagina, un'immagine anche ritagliata, un
  foglio) è un pezzo solo, che riempie la barra.

Un `fub:parts` che si conserva senza mostrarlo vale come il `subpath`, come
per la scheda. Ciò che si sa di un file si chiede una volta, quando la riga
si disegna, e di nuovo quando il file cambia (`watch` delle schede); le
risposte di molti file insieme fanno un solo ridisegno.

I pezzi sulla lavagna sono in colore d'accento. Un clic su uno di loro porta
la vista sulla scheda che lo mostra e la sceglie, come «Schede»
(`revealSource`, un salto che Indietro ricorda). Un clic su un pezzo grigio porta la vista su una scheda di
quel file (un estratto, se c'è) e le chiede «Parti…» (`canvas.parts`): per
una nota si apre il selettore delle sezioni, con le sezioni di quella
scheda già spuntate; per un PDF, finché non c'è il selettore delle pagine,
la scheda resta solo scelta. In sola lettura il selettore non si apre.

Un file mancante (una sua scheda ha `data-card-missing`, il segnaposto di
[Il file che manca](canvas-cards.md#il-file-che-manca)) ha la riga grigia
col nome barrato e «File mancante»; i suoi pezzi si leggono ma non si
prendono. Una lavagna senza file dice «Su questa lavagna non ci sono
file.». Una sola fermata del Tab: le frecce su e giù cambiano file, a
destra e a sinistra cambiano pezzo, Inizio e Fine vanno al primo e
all'ultimo; una riga senza barra prende il fuoco lei, e Invio porta alla
prima scheda del file. Oltre 40 file si disegnano solo le righe che si
vedono, più la fermata del Tab.
