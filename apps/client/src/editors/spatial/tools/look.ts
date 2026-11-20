// L'aspetto degli oggetti scelti, per il pannello delle proprietà (livello
// Standard): il riempimento, il contorno, lo spessore, l'opacità e il testo
// che hanno in comune, o che sono misti; e le operazioni che danno un valore
// a tutti, in un `batch` solo, come i comandi di «Disponi». Il tratteggio,
// gli estremi e gli angoli sono di `outline.ts`.
//
// - **Chi ha che cosa.** Un riempimento l'hanno rettangoli, ellissi,
//   cerchi, poligoni, spezzate, tracciati e testi, dove è il colore delle
//   lettere. Un contorno l'hanno le forme di `outline.ts`, anche quelle che
//   oggi non lo mostrano; e un tratto a penna e una linea a spessore
//   variabile, che sono tutti riempimento ma si vedono come una linea: il
//   loro colore si legge e si scrive come contorno. Lo spessore è dei
//   contorni che si vedono, tranne quello di un tratto a penna, che viene
//   dall'inchiostro; di una linea a spessore variabile è il suo punto più
//   largo, e cambiarlo allarga o stringe tutto il profilo. Un gruppo o un
//   collegamento passano tutto alle parti; un'immagine ha soltanto
//   l'opacità. Una parte bloccata dentro un gruppo scelto resta com'è.
// - **L'opacità è dell'oggetto scelto**, gruppo compreso: non si eredita, si
//   moltiplica, e scritta sulle parti si vedrebbe diversa dove si
//   sovrappongono.
// - **La fusione è dell'oggetto scelto**, come l'opacità (livello Esperto):
//   sta nello `style` del formato, `mix-blend-mode: multiply`, e di un gruppo
//   o di un collegamento anche `isolation: isolate`, scritti sempre allo
//   stesso modo. «Normale» e l'isolamento spento tolgono la dichiarazione, e
//   senza dichiarazioni lo `style` se ne va. Un elemento con altro nello
//   `style` è estraneo, e non si tocca.
// - **Il file resta corto**, come in `outline.ts`: un valore uguale a quello
//   che la parte prenderebbe comunque, dal gruppo che la contiene o da SVG,
//   si toglie invece di scriversi.
// - **Il tratteggio si misura in spessori** (`outline.ts`): con lo spessore
//   cambia anche lui, e una freccia ridisegna la punta.
// - **Il testo si legge intero**, righe e pezzi compresi (`rich.ts`): un
//   testo con una parola blu ha il colore misto, e uno con una riga in
//   corsivo il corsivo misto. Un valore dato dal pannello va al testo
//   intero, e le righe e i pezzi che ne scrivevano un altro lo lasciano.
// - **Il corpo porta l'interlinea con sé.** Ogni riga di un testo scende di
//   un'interlinea scritta nel suo `tspan`: cambiando il corpo cambia nella
//   stessa proporzione, così le righe non si accavallano; e così la
//   spaziatura delle lettere. Interlinea e spaziatura si leggono e si
//   scrivono in volte il corpo, come le misurano i programmi di
//   impaginazione.
// - **L'allineamento resta sul punto d'ancoraggio**, come il testo a punto
//   dei programmi di disegno: le righe si allineano attorno al punto dove il
//   testo è nato, ed è esatto, senza stimare la larghezza delle lettere.
// - **Un testo in area tiene il suo riquadro** (livello Esperto): con
//   l'allineamento o la larghezza il bordo sinistro resta dov'era, e le
//   righe si allineano dentro. Un attributo del carattere che cambia, o la
//   larghezza, rifanno gli a capo, misurati come li misura l'export; un
//   colore o una linea no. Un testo da punto diventa in area con un
//   riquadro largo quanto la riga più larga, ogni riga un paragrafo, e un
//   testo in area torna da punto con le righe che mostrava: nessuno dei due
//   si muove.
// - **Lo stile si copia e si incolla** (livello Standard): il riempimento,
//   il contorno col suo spessore, tratteggio, estremi e angoli, l'opacità, la
//   fusione, gli effetti e il carattere di un oggetto vanno sugli oggetti
//   scelti in un passo, a ciascuna parte ciò che ha. Si copia ciò che si
//   vede, anche se viene dal gruppo che lo contiene. Il contagocce prende lo
//   stesso, dalla forma sotto il puntatore o dall'oggetto di una riga
//   dell'albero, anche bloccato o nascosto: leggerlo non lo cambia.
// - **Gli effetti vanno con lo stile** come l'opacità: chi riceve ha gli
//   stessi, col suo filtro e la sua regione, e una copia senza effetti toglie
//   i suoi. Chi non può averli (un ritaglio, una maschera, una misura che non
//   si sa) tiene i suoi, e il resto dello stile si applica. Il filtro di un
//   altro programma si sostituisce con un effetto nuovo, ma una copia senza
//   effetti non lo toglie; un oggetto copiato con un filtro d'un altro
//   programma non dà effetti. L'isolamento è della struttura, non dello
//   stile, e non si copia.
// - **Le punte vanno con lo stile.** Di una linea, una spezzata o un
//   tracciato aperto si copia la punta di ogni capo, forma e misura, o
//   l'assenza; si dà a ogni parte che può averne, dentro i gruppi, e `none`
//   le toglie. Un capo con un marcatore che non è della raccolta non si
//   copia, e chi riceve lo stile tiene il suo; una forma che non può averne
//   punte, come un rettangolo, non le dice, e le punte di chi riceve restano.
//   La punta si ricrea per nome nel disegno che la riceve, anche se è un
//   altro, e il suo colore lo porta [`followTips`] nello stesso passo.
// - **Lo stile vale anche in un altro disegno**: un campione che lì non c'è
//   lascia il posto a quello con lo stesso nome e lo stesso colore, o al
//   suo colore; un'altra risorsa che manca, al colore di ripiego. Un
//   campione che c'è porta come ripiego il suo colore di adesso.
// - **Una risorsa privata resta di un oggetto solo** (formato della scena,
//   risorse): un colore che ne usa una, preso da un altro oggetto, ne porta
//   una copia, com'era quando lo stile si è copiato; e una sfumatura nelle
//   coordinate di chi la usa si adatta al riquadro di chi la riceve, come
//   stava in quello dell'altro.
// - **Mille oggetti scelti** si leggono entro un fotogramma: gli attributi di
//   un nodo e ciò che un contenitore passa ai figli si leggono una volta
//   sola, finché un'operazione non li cambia.
//
// Il codice sta in `look/`: leggere l'aspetto della selezione (`read.ts`),
// scriverlo (`write.ts`), copiare e incollare lo stile e gli stili del
// disegno (`style.ts`). Questo file ne ri-esporta i nomi pubblici.

export { ANCHORS, FILLED, OUTLINED, INKED, initialText, paintText, textNodesOf, opacityOf, lookOf, type Anchor, type Shared, type Look } from "./look/read";
export { weightText, boxFit, lookOps, paintParts, paintEachOps, textRich, type LookChange, type Restyled, type PaintPart } from "./look/write";
export {
  styleOf,
  styleOps,
  STYLE_FIELDS,
  STYLE_BOX,
  protoOf,
  styleSource,
  followOps,
  styleDifferences,
  styleChanges,
  type StyleOutline,
  type StyleFont,
  type Style,
  type StyleField,
  type StyleKind,
  type StyleLook,
  type StyleSource,
  type Follow,
} from "./look/style";
