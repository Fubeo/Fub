// Le pagine di un PDF incorporato, disegnate per «tutte le pagine in coda»
// (E28, T74). Il PDF si trova come lo trova la nota (il riferimento dal suo
// nome), se ne leggono i byte, pdf.js ne disegna le pagine una alla volta su
// tele larghe il doppio della colonna (la carta si stampa più fitta dello
// schermo). Le porte le dà chi compone l'app (`document-controller.ts`): qui
// niente IPC.

import type { PdfEngine } from "../../editors/media/pdf-view";
import { APPENDIX_PAGE_LIMIT, type CardPages } from "./cards";

export interface PdfPagesPorts {
  /// L'identità del file `target`, letto dalla nota `from`; `null` se non c'è.
  resolve(target: string, from: string): Promise<string | null>;
  read(id: string): Promise<Uint8Array>;
  load(bytes: Uint8Array): Promise<PdfEngine>;
}

/// Quanto più fitta della colonna si disegna una pagina.
const DENSITY = 2;

export async function renderPdfPages(ports: PdfPagesPorts, target: string, from: string, width: number, limit = APPENDIX_PAGE_LIMIT): Promise<CardPages | null> {
  const id = await ports.resolve(target, from);
  if (!id) return null;
  const engine = await ports.load(await ports.read(id));
  try {
    const total = engine.pageCount;
    const canvases: HTMLCanvasElement[] = [];
    for (let index = 0; index < Math.min(total, limit); index++) {
      const [points] = await engine.pageSize(index);
      const canvas = document.createElement("canvas");
      canvas.className = "export-appendix-canvas";
      await engine.renderPage(index, canvas, points > 0 ? (width * DENSITY) / points : DENSITY);
      canvases.push(canvas);
    }
    return { canvases, total };
  } finally {
    engine.destroy();
  }
}
