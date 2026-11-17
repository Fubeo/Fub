// Il lettore dei file di draw.io (diagrams.net): `.drawio`, `.dio`, l'XML di
// un modello, e i file che lo portano dentro un'immagine (`.drawio.svg`,
// `.drawio.png`). Dalle celle al diagramma da importare (`diagram.ts`), con
// le note di ciò che non entra.
//
// - **Le pagine** diventano tavole, l'una accanto all'altra nell'ordine del
//   file; una pagina sola non ne ha bisogno. Una pagina compressa si apre
//   qui (`inflate.ts`). I livelli di draw.io restano livelli.
// - **Le forme** comuni restano forme: il rettangolo col suo angolo,
//   l'ellisse, il rombo e le forme dei diagrammi di flusso, che FubDraw ha
//   nella raccolta; il triangolo, l'esagono, il parallelogramma e le altre
//   forme fatte di lati diventano un contorno uguale. Una forma che FubDraw
//   non ha, come le icone dei servizi cloud, diventa un rettangolo dei suoi
//   colori, e la nota ne dice il nome.
// - **Il testo** di una cella, scritto in HTML o no, è l'etichetta della
//   forma quando sta in mezzo; in alto, in basso o fuori dalla forma è un
//   testo a sé dove lo mette draw.io, in un gruppo con la forma.
// - **I contenitori**, le corsie (`swimlane`) e le tabelle, sono gruppi con
//   dentro i loro oggetti.
// - **Gli archi** agganciati sono connettori, dritti, a gomito o curvi, coi
//   capi sugli stessi oggetti e il percorso del file quando ne ha uno; uno
//   libero con più punti resta una linea con le punte. Le etichette restano
//   sulla linea.
//
// Le coordinate di una cella sono relative a quelle del genitore, e quelle
// di un arco al genitore dell'arco: qui diventano tutte della tela.
//
// Qui restano le pagine messe in fila; la lettura del file, lo stile, le
// forme, i percorsi e chi legge una pagina stanno nei moduli di `drawio/`.

import { hexColor, Notes, type Board, type Diagram, type Node } from "./diagram";
import { attr, num, pagesOf } from "./drawio/file";
import { extentOf, shifted } from "./drawio/nodes";
import { PageReader } from "./drawio/page-reader";

export { drawioInPng, NotDrawio } from "./drawio/file";

/// Lo spazio fra due pagine messe l'una accanto all'altra, e il margine di
/// una tavola attorno al suo contenuto quando la pagina non ha un formato.
const PAGE_GAP = 80;
const PAGE_MARGIN = 40;

/// Legge `text`, un file di draw.io. Lancia [`NotDrawio`] se non lo è.
export function readDrawio(text: string): Diagram {
  const pages = pagesOf(text);
  const notes = new Notes();
  const layers: { name: string; hidden: boolean; locked: boolean; nodes: Node[] }[] = [];
  const boards: Board[] = [];
  let background: string | null = null;
  let right: number | null = null;
  let top: number | null = null;
  pages.forEach((page, i) => {
    const prefix = pages.length > 1 ? `${i}:` : "";
    const read = new PageReader(page, prefix, notes).read();
    const extent = extentOf(read.layers.flatMap((layer) => layer.nodes));
    if (extent === null) return;
    if (i === 0 || background === null) {
      const paper = attr(page.model, "background");
      if (paper !== undefined && paper !== "none") background = hexColor(paper);
    }
    let frame = extent;
    if (pages.length > 1) {
      // La tavola è il foglio di draw.io, o i fogli che il disegno occupa;
      // senza fogli, il disegno con un margine.
      const [pw, ph] = [num(attr(page.model, "pageWidth"), 0) * num(attr(page.model, "pageScale"), 1), num(attr(page.model, "pageHeight"), 0) * num(attr(page.model, "pageScale"), 1)];
      frame =
        attr(page.model, "page") !== "0" && pw > 0 && ph > 0
          ? { min: [Math.floor(extent.min[0] / pw) * pw, Math.floor(extent.min[1] / ph) * ph], max: [Math.ceil(extent.max[0] / pw) * pw, Math.ceil(extent.max[1] / ph) * ph] }
          : { min: [extent.min[0] - PAGE_MARGIN, extent.min[1] - PAGE_MARGIN], max: [extent.max[0] + PAGE_MARGIN, extent.max[1] + PAGE_MARGIN] };
    }
    const [dx, dy] = right === null || top === null ? [0, 0] : [right + PAGE_GAP - frame.min[0], top - frame.min[1]];
    if (right === null || top === null) top = frame.min[1];
    right = frame.max[0] + dx;
    if (pages.length > 1) boards.push({ name: page.name, box: { min: [frame.min[0] + dx, frame.min[1] + dy], max: [frame.max[0] + dx, frame.max[1] + dy] } });
    read.layers.forEach((layer, j) => {
      const nodes = layer.nodes.map((node) => shifted(node, dx, dy));
      const into = layers[j];
      if (into === undefined) layers.push({ ...layer, nodes });
      else into.nodes.push(...nodes);
    });
  });
  return { source: "drawio", background: background === "#ffffff" ? null : background, layers, boards, notes: notes.list() };
}
