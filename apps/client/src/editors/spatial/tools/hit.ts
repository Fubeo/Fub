// Gli oggetti che gli strumenti toccano: l'indice con cui la selezione
// sceglie, la gomma cancella e lo spostamento sposta.
//
// Un **oggetto** è ciò che al livello Essenziale si sceglie intero: un figlio
// di un livello, o un figlio della radice fuori da ogni livello, che non sia
// la carta, il titolo o la descrizione. Un oggetto fatto a un livello più
// ricco resta intatto anche qui, dove al massimo si sposta o si elimina
// intero. Un gruppo o un collegamento si sceglie con tutto ciò che contiene.
// Gli oggetti di un livello bloccato o nascosto non si toccano, e nemmeno
// quelli bloccati con `fub:locked="true"` o nascosti con `display="none"`.
// Un blocco estraneo non è un oggetto: si vede come immagine e resta com'è.
// Dentro un oggetto, però, conta nella sua geometria con una stima: le forme
// che SVG conosce, con le trasformazioni e gli attributi di presentazione,
// anche quelli del loro `style`, `display` e `visibility` compresi, e i
// riquadri di immagini, testi, documenti annidati e `use`. Ciò che un foglio di stile cambia non si legge. Così un
// gruppo che contiene disegni di un altro programma si tocca, si sceglie e
// si sposta dove lo si vede.
//
// Dentro un gruppo o un collegamento si sceglie anche un oggetto solo: con
// Ctrl o ⌘ col clic, o isolando il gruppo, che diventa l'unico posto dove si
// sceglie. L'indice dà gli oggetti in cima, quelli del gruppo isolato se ce
// n'è uno, e trova quelli più dentro quando servono, con le stesse regole:
// niente dentro un gruppo bloccato o nascosto.
//
// La geometria è quella che il painter disegna: gli attributi dipinti della
// stessa `PaintScene` (`PaintBuilder.shape` e `headInfo`), con le
// trasformazioni di livelli e gruppi composte. I tracciati si appiattiscono
// solo per gli oggetti vicini al puntatore, con un errore di 0,05 unità
// della scena, e un tratto a penna si tocca dentro il suo contorno pieno
// come lo riempie il browser, con la regola non zero. Un testo si tocca nel
// riquadro stimato delle sue righe: la misura vera dipende dai caratteri.
// I marcatori di un tracciato, come le punte delle linee, si disegnano sopra
// la forma che li usa: si toccano come il suo contorno e stanno nei riquadri
// col contorno, ma non nella geometria che la griglia aggancia.
//
// Un'istanza di un simbolo si tocca dove si vede il contenuto del simbolo,
// portato dalla sua trasformazione, anche attraverso le istanze che il
// contenuto ha a sua volta. Le forme del contenuto non si modificano da lì:
// per gli strumenti che cambiano una forma l'istanza è una forma sola, che
// non ha nodi. Un oggetto tocca al più [`MAX_INSTANCE_PARTS`] forme
// attraverso le istanze: oltre, un'istanza si tocca nel riquadro del suo
// simbolo, così un file con simboli annidati non costa all'indice più del
// disegno che mostra.
//
// Una copia in una ripetizione si tocca dove si vede l'originale, portato
// dalla sua trasformazione, e come un'istanza è una forma sola che non ha
// nodi. Non è un oggetto: nella ripetizione isolata non si sceglie, e un
// clic dove si vede dà il suo originale. Oltre [`MAX_INSTANCE_PARTS`] forme
// nell'oggetto, una copia si tocca nel riquadro dell'originale.
//
// Di un oggetto ritagliato o mascherato conta ciò che si vede: le forme
// disegnate, tagliate dai ritagli e dalle maschere che le riguardano, cioè
// quelli dell'oggetto e di ciò che contiene, quelli del gruppo in cui lo si
// sceglie e quelli del suo livello. Riquadri, cornice, geometria, contatto,
// gomma e lazo li usano tutti così: un'immagine ritagliata si sceglie, si
// aggancia e si inquadra dove si vede, e le parti nascoste non prendono i
// clic. Il contenuto di un ritaglio conta dove riempie, quello di una
// maschera dove dipinge, qualunque colore abbia: la luminanza non si legge
// (`clips.ts`). Un oggetto che non si vede più non ha riquadro, ma si trova
// ancora dall'albero.
//
// Il codice sta nei moduli di `hit/`; qui restano i nomi che gli altri usano.

export { FLATNESS, MAX_INSTANCE_PARTS } from "./hit/base";
export type { Holder, LayerInfo, Sampled, TextLook } from "./hit/base";
export { ForeignBlock, Unit } from "./hit/unit";
export { elemBounds, geometryBox, shapeSegments } from "./hit/shapes";
export { SceneIndex } from "./hit/scene-index";
export { SceneIndexer } from "./hit/indexer";
