# Disegni, tipografia

> **Per chi:** chi scrive in un disegno titoli, didascalie ed etichette, e
> vuole una parola in grassetto, un'altra in corsivo o di un altro colore, un
> testo che va a capo in un riquadro o uno che segue una curva.
> **Risultato:** sapere come si scrive e si formatta un testo sul posto, che
> cosa cambiano la barra e il pannello, come un testo va a capo in un
> riquadro o scorre lungo un tracciato, e che cosa entra nel file.

Dal [livello Standard](drawing.md#il-livello-standard) un testo si scrive sul
posto con lo strumento **Testo**, come descrive [Disegni](drawing.md#testo).
Questa pagina dice il resto: le righe e i **pezzi** di una riga, cioè le
parole con un aspetto loro, i tasti che li fanno, la barra e il pannello
delle proprietà mentre si scrive e dopo. Dal [livello
Esperto](drawing.md#il-livello-esperto) un testo va anche a capo da sé in un
riquadro, [in area](#il-testo-in-area), o scorre lungo una linea, [su
tracciato](#il-testo-su-tracciato). Come il file li scrive è in [formato della
scena, testo](../reference/scene-format-text.md).

## Il campo

Il campo sta sopra il testo, che si nasconde, e lo mostra come si vedrà:
ogni riga dove il file la mette, ogni pezzo col suo carattere, il suo corpo,
il suo peso, il suo colore e le sue linee. Una riga con un pezzo più grande
si fa più alta e tiene la sua linea di base.

- **Scrivere continua il pezzo** dov'è il cursore: una lettera dopo una
  parola blu è blu.
- **`Invio` spezza la riga**, che scende dell'interlinea; `Backspace`
  all'inizio di una riga la riunisce alla precedente, e così `Canc` alla
  fine.
- **Incollare incolla il testo**, anche su più righe, con lo stile di dove
  arriva; la formattazione che arriva da un altro programma non entra.
- **Un metodo d'immissione**, come un accento composto o il giapponese,
  scrive come sempre: il campo rilegge la riga quando la composizione
  finisce.
- **Annulla e ripeti** (`Ctrl+Z`, `Ctrl+Maiusc+Z` o `Ctrl+Y`, e `⌘`) sono
  del campo mentre si scrive: una parola scritta di seguito è un passo.
  Chiuso il campo, tutto ciò che si è fatto nel testo è un passo solo del
  disegno.

Il campo è una casella di testo di più righe, col controllo ortografico del
browser. `Esc`, `Tab` e `Ctrl+Invio` o `⌘Invio` concludono, come un tocco
fuori dal campo.

## Formattare mentre si scrive

| Tasto | Che cosa fa |
|---|---|
| `Ctrl+B` o `⌘B` | Grassetto |
| `Ctrl+I` o `⌘I` | Corsivo |
| `Ctrl+U` o `⌘U` | Sottolineato |
| `Ctrl+Maiusc+X` o `⌘⇧X` | Barrato; fuori dal campo, all'Esperto, porta agli attributi |

Un tasto vale per ciò che è scelto nel campo: lo accende se una parte della
scelta non l'ha, e lo spegne se l'ha tutta. Senza scelta vale per ciò che si
scriverà lì: dentro una parola in grassetto, `Ctrl+B` fa uscire in tondo ciò
che si scrive dopo.
Il campo dice com'è adesso: «Grassetto attivato.», «Corsivo disattivato.». I
comandi di formato che il browser manda al campo fanno lo stesso.

Il colore e la dimensione della barra, mentre si scrive, valgono per ciò che
è scelto nel campo. Senza scelta valgono per tutto un testo nuovo, che è
della barra, e per ciò che si scriverà in un testo che c'era. Un corpo nuovo
per tutto il testo porta con sé l'interlinea e la spaziatura.

## Il pannello

Il pannello delle proprietà ([Disegni, proprietà](drawing-properties.md))
legge un testo intero, righe e pezzi: un valore che i pezzi hanno diverso è
**misto**: un campo lo dice, e un interruttore misto si vede a metà. Ciò
che vi si scrive vale per tutto il testo, e toglie lo stesso attributo alle
righe e ai pezzi; ogni cambio è un passo di annulla col suo nome. Mentre si
scrive, toccare il pannello conclude prima il campo.

- **Stile**: un corpo e un peso insieme, sulle misure della barra. Un testo
  che non è di nessuno stile è «Su misura».

  | Stile | Corpo | Peso |
  |---|---|---|
  | Titolo | 64 | Grassetto |
  | Sottotitolo | 48 | Semigrassetto |
  | Titoletto | 40 | Semigrassetto |
  | Testo | 32 | Normale |
  | Didascalia | 24 | Normale |

- **Carattere**: Inter, Literata o JetBrains Mono, ciascuno col suo corsivo.
- **Dimensione**, in punti, o in pixel in un documento in pixel.
- **Peso**: Leggero, Normale, Medio, Semigrassetto, Grassetto, Extragrassetto
  e Nero, da 300 a 900. Un peso che non è del menu c'è, col suo numero.
- **Enfasi**: grassetto, corsivo, sottolineato e barrato, una fila di
  interruttori. Uno misto si accende; il grassetto è acceso da Semigrassetto
  in su, e spento torna Normale.
- **Interlinea**, per un testo di più righe: quanto scende una riga, in
  percentuale del corpo più grande fra lei e quella prima. Di partenza è il
  125%.
- **Spaziatura** delle lettere, in percentuale del corpo che ogni pezzo ha:
  un pezzo più grande ha lo spazio più largo.
- **Allineamento**: a sinistra, al centro o a destra del punto d'ancoraggio.
- **Larghezza del riquadro**, per un testo in area, e il passaggio fra testo
  da punto e testo in area: in [Il testo in area](#il-testo-in-area).

Sottolineato e barrato scritti su tutto il testo hanno il colore del testo,
anche sotto un pezzo di un altro colore: SVG dipinge la linea col
riempimento di chi la scrive. Scritti su un pezzo hanno il colore del pezzo.

## Il testo in area

Un tocco con lo strumento Testo scrive un testo **da punto**, che va a capo
soltanto dove si preme `Invio`. Un testo **in area** va a capo da sé, nella
larghezza di un riquadro, come una colonna di giornale.

- **Trascinare lo strumento Testo** disegna il riquadro: dal livello
  Esperto, o nel Personalizzato con la parte «Testo in area e su tracciato».
  È largo quanto il trascinamento, e almeno quanto il corpo; l'altezza non
  si disegna, perché segue le righe. La prima riga sta in cima, e
  l'aggancio vale per tutti e due gli angoli.
- **Sotto l'Esperto**, o senza quella parte, trascinare lo strumento Testo
  scrive un testo da punto dove il trascinamento comincia, come un tocco.
- **Il campo** di un testo in area è largo quanto il riquadro e va a capo
  mentre si scrive, a ogni livello: anche dove il riquadro non si disegna,
  un testo in area che c'è si scrive così. Gli a capo del campo sono quelli
  che il file scrive e che l'esportazione mostra, misurati coi caratteri del
  foglio.
- **Una riga prende le parole che ci stanno.** Va a capo dopo uno spazio,
  che in fondo alla riga non conta, o dopo un trattino attaccato a una
  parola; una parola più larga del riquadro si spezza fra due lettere.
- **`Invio` comincia un paragrafo**, che va a capo per conto suo.
  `Backspace` all'inizio di una riga che continua una parola spezzata
  cancella la lettera prima, in fondo alla riga sopra.
- **Un carattere più largo del riquadro** sta da solo sulla sua riga, che
  supera il riquadro. Chiuso il campo, l'annuncio lo dice dopo «Testo
  aggiunto.» o «Testo modificato.»: «Un carattere è più largo del riquadro,
  e la sua riga lo supera.»
- **L'allineamento** del testo vale anche per il riquadro: a sinistra il
  riquadro comincia dal punto d'ancoraggio, al centro ci sta a metà, a
  destra ci finisce, e le righe vi stanno allineate allo stesso modo.
  Cambiarlo nel pannello tiene il riquadro dov'è: si spostano le righe.

Gli a capo cambiano quando cambiano il testo, il riquadro o il carattere:
famiglia, corpo, peso, corsivo e spaziatura. Il colore, il sottolineato, il
barrato e l'interlinea non li toccano. Quando un carattere resta più largo
del riquadro, dopo un cambio del pannello o «Incolla lo stile», l'annuncio
lo dice.

Il pannello delle proprietà, con la parte «Testo in area e su tracciato»,
ha per un testo scelto che non segue un tracciato il **Tipo di testo**: «Da
punto» o «In area». Il passaggio non sposta niente di ciò che si vede.

- **Da punto a in area**, il riquadro è largo quanto la riga più larga, e
  ogni riga che c'era diventa un paragrafo suo.
- **Da in area a punto**, ogni riga, come si vede, diventa una riga sua, che
  non continua più quella prima, e il riquadro se ne va.
- **«Larghezza del riquadro»**, per un testo in area, è un numero
  nell'unità del documento, come le altre lunghezze del pannello. Scriverlo
  cambia la larghezza tenendo fermo il bordo sinistro, e il testo va di
  nuovo a capo.

Le maniglie della cornice ([Disegni, trasformare](drawing-transform.md)) di
un testo in area scelto da solo, con la stessa parte, cambiano la larghezza
del suo riquadro, non il corpo:

- quelle in alto e in basso non ci sono, e le altre tirano soltanto di lato;
- il bordo opposto resta dov'è, l'aggancio porta il bordo che si trascina,
  e il riquadro non diventa più stretto del corpo;
- mentre si trascina il testo va già a capo come andrà;
- lasciata la maniglia, il cambio è un passo di annulla, «Larghezza del
  riquadro», e l'annuncio dice la larghezza nuova, «Riquadro largo …»,
  nell'unità del documento.

Senza quella parte la cornice scala un testo in area come ogni oggetto, e
un testo in area che c'è va a capo da sé a ogni livello, quando si scrive.

## Il testo su tracciato

Un testo su tracciato scorre lungo una linea, una curva o il bordo di una
forma, su una riga sola, e non va a capo. Il tracciato non si vede: dice
soltanto dove passa il testo, che sta dalla parte sinistra del suo verso,
sopra una linea tracciata da sinistra a destra.

Il menu «Testo su tracciato», nella barra della selezione, c'è dal livello
Esperto, o nel Personalizzato con la parte «Testo in area e su tracciato»,
quando fra gli oggetti scelti c'è un testo. Ha tre comandi, un passo di
annulla ciascuno col suo nome; una voce che adesso non serve è spenta e dice
perché.

- **«Metti sul tracciato»**, con un testo e una forma scelti, e nient'altro.
  Si seguono un tracciato, un rettangolo, un'ellisse, un cerchio, una linea,
  una spezzata, un poligono, una freccia, un poligono regolare e una stella;
  non un tratto a penna, una linea a spessore variabile, un gruppo o
  un'immagine. La forma lascia il disegno e diventa il tracciato del testo,
  scritto nelle sue coordinate. Il testo diventa una riga sola: le righe si
  uniscono con uno spazio, una parola spezzata in un testo in area torna
  intera, una riga vuota non conta, e il riquadro se ne va. Dopo è scelto il
  testo, e l'annuncio dice «Il testo segue il tracciato.».
- **«Togli dal tracciato»:** ogni testo su tracciato scelto torna una riga
  dritta, col punto d'ancoraggio dove l'aveva sul tracciato. Il tracciato se
  ne va con l'ultimo testo che lo segue, se l'ha scritto FubDraw; quello di
  un altro programma resta nel file. La forma di prima non torna, e la
  selezione resta quella.
- **«Rovescia sul tracciato»:** il tracciato si percorre al contrario, e il
  testo passa dall'altra parte, restando dov'era lungo il tracciato. Un
  tracciato che anche un altro testo segue, o che non è di FubDraw, resta
  com'è: il testo ne prende uno suo, rovesciato.

**Dove comincia il testo.** Una forma si segue come la disegna SVG: un
tracciato, una linea o una spezzata dal primo punto, un rettangolo
dall'angolo in alto a sinistra e un'ellisse o un cerchio dal punto più a
destra, tutti e due in senso orario, così il testo sta fuori. Il testo
comincia nel punto del tracciato più vicino a dove cominciava, o tanto prima
o dopo quanto serve perché ci stia tutto. Uno più lungo del tracciato ne prende
l'inizio, il centro o la fine, secondo il suo allineamento, e le lettere che
escono dal tracciato non si vedono.

- **Scrivere:** un testo su tracciato si apre nel campo dritto, su una riga
  sola, dove comincia, girato come il tracciato in quel punto; chiuso il
  campo, torna a seguirlo. `Invio` non va a capo, e ciò che si incolla su
  più righe sta sulla riga, con gli a capo diventati spazi. I pezzi, i tasti
  di formato, la barra e il pannello valgono come in ogni testo.
- **Toccare:** il testo si prende lungo il tracciato, lettera per lettera;
  una lettera che esce dal tracciato non si vede e non si tocca.
- **Lo strumento Nodi** ([Disegni, livello
  Esperto](drawing-expert.md#nodi)), su un testo su tracciato, mostra i nodi
  del tracciato che il testo segue. Spostare i nodi e le maniglie, e i
  comandi dei nodi, cambiano quel tracciato, in un passo di annulla, e il
  testo lo segue già mentre si trascina; un altro testo che segue lo stesso
  tracciato lo segue anche lui. Il tracciato resta lungo più di zero, e non
  si unisce a un'altra forma: per lasciarlo c'è «Togli dal tracciato».
- **Le copie:** duplicare un testo su tracciato copia anche il suo
  tracciato, quando è suo soltanto, e la copia segue il proprio; un
  tracciato condiviso, o scritto da un altro programma, resta lo stesso per
  tutti e due. Gli appunti portano il tracciato col testo: incollato nello
  stesso disegno ne ha una copia sua, in un altro disegno ci arriva insieme.

## Lo stile copiato

«Copia lo stile» ([Disegni, appunti](drawing-clipboard.md#lo-stile)) prende
da un testo il carattere del suo primo carattere che si vede: famiglia,
corpo, peso, corsivo, spaziatura, sottolineato e barrato, e l'interlinea se
il testo ha più righe. «Incolla lo stile» li dà a tutto il testo, come il
pannello.

## Ciò che si vede è ciò che esce

Gli a capo di un testo in area sono gli stessi nel campo, sul foglio, in
Lettura, in una nota e nel PNG: li scrive il file, e nessuno li ricalcola.
Il corsivo è quello vero di ciascun carattere, non il tondo inclinato. In
Lettura, in una nota e nel PNG copiato il disegno porta dentro i caratteri
che i suoi testi nominano, e il corsivo soltanto se un testo lo chiede: tutti
e sei i file insieme stanno sotto i 384 KB. Il banco di fedeltà
(`apps/client/bench/fidelity.mjs`) confronta pixel per pixel il foglio, la
Lettura e il PNG anche su righe con pezzi, corsivi, spaziatura e
decorazioni, su testi in area e su tracciato, e prova di vedere un corsivo
che manca. Prova anche gli a capo, in italiano e in inglese, in ogni
carattere dell'app, con pezzi e spaziatura: ogni riga che FubDraw scrive sta
nel riquadro come la disegna il browser, ed è la più lunga che ci sta. Con la
spaziatura il browser non fa le legature, e la misura nemmeno: il banco
prova anche la strada di dove il canvas non sa mettere la spaziatura, come
in WebKit, in cui la misura separa le lettere con uno ZWNJ.

## Il file

```xml
<text id="o9i0j1k2l" x="720" y="460" fill="#000000" font-family="Inter, sans-serif" font-size="32">
  <tspan x="720" dy="0">Evaporazione</tspan>
  <tspan x="720" dy="40" font-style="italic">in <tspan fill="#0072b2" font-weight="bold">pioggia</tspan></tspan>
</text>
```

Un pezzo è un `tspan` dentro una riga, con gli attributi di presentazione
che la riga non ha: colore, carattere, corpo, peso, corsivo, spaziatura e
decorazioni. Un testo scritto da un altro programma con i pezzi si apre coi
suoi pezzi; uno che il formato non sa riscrivere intero si apre con le sue
righe.

```xml
<text id="o1a2b3c4d" fub:wrap="240" x="40" y="60" font-size="20">
  <tspan x="40" dy="0">Il testo in area va a</tspan>
  <tspan fub:join="space" x="40" dy="25">capo da sé.</tspan>
</text>
<text id="o5e6f7g8h" font-size="24" text-anchor="middle">
  <textPath startOffset="50%" href="#r9i0j1k2l">Sopra <tspan font-weight="bold">la</tspan> collina</textPath>
</text>
```

Un testo in area scrive la larghezza del riquadro, `fub:wrap`, e su ogni
riga che continua un paragrafo come continua, `fub:join`: le righe sono già
spezzate, e un programma che non conosce FubDraw le disegna uguali, senza
il riquadro. Un testo su tracciato ha un `textPath` che rimanda al suo
tracciato, fra le [risorse](drawing-resources.md) del disegno, e da dove
comincia, qui a metà; un browser lo disegna come il foglio.

## Chi monta l'editor

Il campo sta in `apps/client/src/editors/spatial/tools/text-field.ts`, il
modello delle righe e dei pezzi in `rich.ts`, la lettura e la scrittura del
pannello in `look.ts` e `fields.ts`, i caratteri in `text.ts` e
`picture.ts`, gli a capo del testo in area in `wrap.ts`, con le misure dei
caratteri in `measure.ts`, e i comandi del testo su tracciato in
`text-path.ts`.
