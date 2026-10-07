# Disegni, tipografia

> **Per chi:** chi scrive in un disegno titoli, didascalie ed etichette, e
> vuole una parola in grassetto, un'altra in corsivo o di un altro colore.
> **Risultato:** sapere come si scrive e si formatta un testo sul posto, che
> cosa cambiano la barra e il pannello, e che cosa entra nel file.

Dal [livello Standard](drawing.md#il-livello-standard) un testo si scrive sul
posto con lo strumento **Testo**, come descrive [Disegni](drawing.md#testo).
Questa pagina dice il resto: le righe e i **pezzi** di una riga, cioè le
parole con un aspetto loro, i tasti che li fanno, la barra e il pannello
delle proprietà mentre si scrive e dopo. Come il file li scrive è in
[formato della scena, testo](../reference/scene-format-text.md).

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

Sottolineato e barrato scritti su tutto il testo hanno il colore del testo,
anche sotto un pezzo di un altro colore: SVG dipinge la linea col
riempimento di chi la scrive. Scritti su un pezzo hanno il colore del pezzo.

## Lo stile copiato

«Copia lo stile» ([Disegni, appunti](drawing-clipboard.md#lo-stile)) prende
da un testo il carattere del suo primo carattere che si vede: famiglia,
corpo, peso, corsivo, spaziatura, sottolineato e barrato, e l'interlinea se
il testo ha più righe. «Incolla lo stile» li dà a tutto il testo, come il
pannello.

## Ciò che si vede è ciò che esce

Il corsivo è quello vero di ciascun carattere, non il tondo inclinato. In
Lettura, in una nota e nel PNG copiato il disegno porta dentro i caratteri
che i suoi testi nominano, e il corsivo soltanto se un testo lo chiede: tutti
e sei i file insieme stanno sotto i 384 KB. Il banco di fedeltà
(`apps/client/bench/fidelity.mjs`) confronta pixel per pixel il foglio, la
Lettura e il PNG anche su righe con pezzi, corsivi, spaziatura e
decorazioni, e prova di vedere un corsivo che manca.

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

## Chi monta l'editor

Il campo sta in `apps/client/src/editors/spatial/tools/text-field.ts`, il
modello delle righe e dei pezzi in `rich.ts`, la lettura e la scrittura del
pannello in `look.ts` e `fields.ts`, i caratteri in `text.ts` e
`picture.ts`.
