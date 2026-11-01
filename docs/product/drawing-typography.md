# Disegni, tipografia

> **Per chi:** chi apre un disegno con titoli, didascalie ed etichette, con
> parole in grassetto, in corsivo o di un altro colore, testi che vanno a
> capo in un riquadro o che seguono una curva.
> **Risultato:** sapere che cosa cambia il pannello di un testo, come un
> testo va a capo in un riquadro o scorre lungo un tracciato, e che cosa
> entra nel file.

Un testo di un [disegno](drawing.md) ha righe e **pezzi** di una riga, cioè
parole con un aspetto loro. L'editor non scrive più testi e non li cambia
sul posto: lo strumento Testo, il campo, il gruppo «Carattere» della barra e
il correttore se ne sono andati col livello Standard (decisione 0231). I
testi che un file ha già restano, si vedono, si spostano, si salvano
uguali, e il pannello delle proprietà ne cambia ancora l'aspetto. Un disegno
può portare anche testi che vanno a capo da sé in un riquadro, [in
area](#il-testo-in-area), o che scorrono lungo una linea, [su
tracciato](#il-testo-su-tracciato). Come il file li scrive è in [formato
della scena, testo](../reference/scene-format-text.md).

## Il pannello

Il pannello delle proprietà ([Disegni, proprietà](drawing-properties.md))
legge un testo intero, righe e pezzi: un valore che i pezzi hanno diverso è
**misto**: un campo lo dice, e un interruttore misto si vede a metà. Ciò
che vi si scrive vale per tutto il testo, e toglie lo stesso attributo alle
righe e ai pezzi; ogni cambio è un passo di annulla col suo nome.

- **Stile**: un corpo e un peso insieme. Un testo che non è di nessuno
  stile è «Su misura».

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

Sottolineato e barrato scritti su tutto il testo hanno il colore del testo,
anche sotto un pezzo di un altro colore: SVG dipinge la linea col
riempimento di chi la scrive. Scritti su un pezzo hanno il colore del pezzo.

## Il testo in area

Un testo **da punto** va a capo soltanto dove lo dicono le sue righe. Un
testo **in area**, scritto da una versione precedente o da un altro
programma, va a capo da sé, nella larghezza di un riquadro, come una colonna
di giornale.

- **Una riga prende le parole che ci stanno.** Va a capo dopo uno spazio,
  che in fondo alla riga non conta, o dopo un trattino attaccato a una
  parola; una parola più larga del riquadro si spezza fra due lettere.
- **Un carattere più largo del riquadro** sta da solo sulla sua riga, che
  supera il riquadro.
- **L'allineamento** del testo vale anche per il riquadro: a sinistra il
  riquadro comincia dal punto d'ancoraggio, al centro ci sta a metà, a
  destra ci finisce, e le righe vi stanno allineate allo stesso modo.
  Cambiarlo nel pannello tiene il riquadro dov'è: si spostano le righe.

Gli a capo cambiano quando cambia il carattere: famiglia, corpo, peso,
corsivo e spaziatura. Il colore, il sottolineato, il barrato e
l'interlinea non li toccano. Quando un carattere resta più largo del
riquadro, dopo un cambio del pannello o «Incolla lo stile», l'annuncio lo
dice. La cornice scala un testo in area come ogni oggetto.

## Il testo su tracciato

Un testo su tracciato scorre lungo una linea, una curva o il bordo di una
forma, su una riga sola, e non va a capo. Il tracciato non si vede: dice
soltanto dove passa il testo, che sta dalla parte sinistra del suo verso,
sopra una linea tracciata da sinistra a destra. Fub lo disegna e lo
riscrive quando un disegno lo porta; non mette più un testo su un
tracciato, e non lo toglie.

**Dove comincia il testo.** Una forma si segue come la disegna SVG: un
tracciato, una linea o una spezzata dal primo punto, un rettangolo
dall'angolo in alto a sinistra e un'ellisse o un cerchio dal punto più a
destra, tutti e due in senso orario, così il testo sta fuori. Il testo
comincia nel punto del tracciato più vicino a dove cominciava, o tanto prima
o dopo quanto serve perché ci stia tutto. Uno più lungo del tracciato ne prende
l'inizio, il centro o la fine, secondo il suo allineamento, e le lettere che
escono dal tracciato non si vedono.

- **Toccare:** il testo si prende lungo il tracciato, lettera per lettera;
  una lettera che esce dal tracciato non si vede e non si tocca.
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

Gli a capo di un testo in area sono gli stessi sul foglio, in Lettura, in una nota e nel PNG: li scrive il file, e nessuno li ricalcola.
Il corsivo è quello vero di ciascun carattere, non il tondo inclinato. In
Lettura, in una nota e nel PNG copiato il disegno porta dentro i caratteri
che i suoi testi nominano, e il corsivo soltanto se un testo lo chiede: tutti
e sei i file di Fub insieme stanno sotto i 384 KB, e quelli del
[vault](drawing-fonts.md) entro i 64 MiB di un disegno. Il banco di fedeltà
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

Il modello delle righe e dei pezzi sta in
`apps/client/src/editors/spatial/tools/rich.ts`, la lettura e la scrittura
del pannello in `look.ts` e `fields.ts`, i caratteri in `text.ts` e
`picture.ts`, gli a capo del testo in area in `wrap.ts`, con le misure dei
caratteri in `measure.ts`.
