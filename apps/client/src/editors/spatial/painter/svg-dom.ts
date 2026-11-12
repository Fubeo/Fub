// Il painter SVG DOM: disegna una `PaintScene` dentro un elemento della
// shell, uno strato sopra l'altro nell'ordine del documento.
//
// - **Strati vivi:** un elemento `svg` grande quanto la vista, con un `g`
//   che porta la camera. Le forme si creano con `createElementNS` e i soli
//   attributi dipinti: nessun testo della sorgente diventa DOM, nessun `id`
//   del disegno entra nel documento della shell (resta in `data-scene-id`),
//   un collegamento è un `g`. Fra un aggiornamento e l'altro si
//   riconciliano per identità: una forma che la scena ripete è lo stesso
//   nodo DOM.
// - **Risorse vive:** le sfumature, i motivi, i marcatori, i ritagli, le
//   maschere e i filtri modificabili stanno in una `defs` dentro un `svg`
//   senza misura, prima degli strati, finché la scena ne ha. Si creano come
//   le forme, elemento per elemento, coi soli elementi e attributi del
//   formato. Il loro id è quello del disegno dopo il prefisso del painter
//   ([`liveId`]), e così ogni `url(#…)` degli oggetti vivi e del contenuto
//   delle risorse: due superfici nella stessa pagina non si rubano le
//   risorse, e un riferimento non trova mai un elemento della shell. Una
//   risorsa che la scena ripete è lo stesso nodo; una che cambia si rifà, e
//   il browser ridisegna chi la usa.
// - **Simboli vivi:** stanno in una seconda `defs` dello stesso `svg`, come
//   `symbol` con l'id vivo e `overflow="visible"`, e il loro contenuto si
//   crea e si riconcilia come quello di uno strato vivo. Un'istanza è un
//   `use` vivo verso l'id vivo del suo simbolo: il browser la disegna col
//   contenuto, e un'anteprima sul contenuto si vede in ogni istanza.
// - **Copie vive:** una copia in una ripetizione è un `use` vivo verso
//   l'originale, che solo per questo ha l'id vivo. Le copie seguono
//   l'originale anche nell'anteprima: si sposta, e loro con lui.
// - **Scene grandi:** da [`LARGE_SCENE_SHAPES`] forme vive, mentre la camera
//   si muove gli strati la seguono tutti insieme con una trasformazione CSS
//   della radice, che il browser compone senza ridisporre né ridipingere
//   niente: uno zoom ingrandisce per un momento i pixel di prima. La radice
//   dipinge la vista e un margine attorno, e taglia il resto; un passo che
//   scoprirebbe ciò che sta oltre il margine, o che salta lontano, ridisegna
//   subito. Quando la camera si ferma, gli strati prendono la vista nuova e
//   la radice torna ferma. Sotto quella soglia ogni passo della camera
//   ridisegna subito.
// - **Strati immagine:** un `<img>` da blob, disegnato per il rettangolo della
//   vista più un margine. Mentre la camera si muove l'immagine segue con una
//   trasformazione CSS; quando si ferma si ridisegna alla nuova scala e al
//   nuovo angolo, e la nuova immagine prende il posto della vecchia solo dopo
//   la decodifica, senza lampi. Ogni URL di blob si revoca quando l'immagine
//   lascia il DOM. Con la vista girata l'immagine resta allineata ai pixel
//   dello schermo, e il disegno vi entra già girato.
// - **Immagini del vault:** un'`image` viva con un percorso del vault chiede
//   l'URL a chi monta il painter, con una vita sua che si chiude quando
//   l'elemento esce dalla scena. Un'immagine che non si risolve, e ogni URL
//   remoto, mostrano il segnaposto.
// - **Anteprima degli strumenti:** mentre si trascina una selezione o si
//   passa la gomma, `setDraft` cambia il `transform` dei nodi vivi o li
//   sbiadisce, e cambia il `d` di un tracciato i cui nodi si spostano, senza
//   ricrearli e senza toccare la scena; l'operazione scritta
//   alla fine porta la scena nuova. Un testo che si scrive sul posto si
//   nasconde allo stesso modo. Una sfumatura che si cambia si mostra da una
//   `defs` dell'anteprima, a cui l'oggetto punta nello stile in linea. Uno
//   strato immagine che sta tutto dentro un gruppo che si sposta segue il
//   gruppo con una trasformazione CSS, e dopo l'operazione resta dove l'ha
//   portato finché la sua immagine nuova non è pronta.
// - **Isolamento:** con un gruppo isolato, `setFocus` attenua tutto ciò che
//   gli sta fuori, carta esclusa, con l'opacità degli elementi; il disegno
//   non cambia. Con un simbolo isolato resta com'è l'istanza da cui lo si
//   modifica, e le altre si attenuano.
//
// - **Miniature:** `paintMiniature` disegna alcuni nodi della scena in un
//   `svg` a sé, con gli stessi elementi e gli stessi attributi, dentro gli
//   stili di chi li contiene, e con le risorse e i simboli che usano, sotto
//   un prefisso suo: l'albero degli oggetti le mostra accanto ai nomi.
//
// Tutto ciò che il painter apre (timer, osservatori, lease) appartiene alla
// sua vita, e la vita di chi lo monta la chiude.

//
// Il codice sta in `svg-dom/`: le forme, le costanti e gli id vivi
// (`base.ts`), il painter con la sua vita (`painter.ts`), gli elementi che
// crea e riconcilia (`elements.ts`) e le miniature (`miniature.ts`). Questo
// file ne ri-esporta i nomi pubblici.

export {
  liveId,
  FADED_OPACITY,
  CROPPED_OPACITY,
  DIMMED_OPACITY,
  LARGE_SCENE_SHAPES,
  outlineSheet,
  type PainterView,
  type PainterOptions,
  type LiveFamilies,
  type PainterDraft,
  type CropCover,
  type ScenePainter,
} from "./svg-dom/base";
export { createSvgPainter } from "./svg-dom/painter";
export { paintMiniature, miniaturePicture, type MiniatureBox } from "./svg-dom/miniature";
export { shapeCount } from "./svg-dom/elements";
