// Incollare in un disegno ciò che Excalidraw o draw.io mettono negli appunti,
// o un loro file lasciato sul foglio. Passa dallo stesso lettore
// dell'importazione: il diagramma diventa un disegno di FubDraw, che l'editor
// incolla come un SVG suo, e il rapporto dice che cosa non entra o entra
// cambiato. La parte arriva con un `import()` al primo incolla che serve.

import { MEDIA_MAX_INLINE_BYTES } from "../../media/media-types";
import { utf8Length } from "../scene/text";
import { loadFonts } from "../tools/measure";
import { ensureTextFont } from "../tools/text";
import { browserPictures } from "./images";
import { fontsOf, ImportError, readDiagram, writeImported } from "./index";
import { noteText, reportOrder } from "./report";
import { setupFor } from "./setup";

/// Un disegno di un altro programma pronto da incollare.
export interface Pasted {
  /// Il testo di un disegno di FubDraw con gli oggetti incollati.
  readonly svg: string;
  /// Le frasi del rapporto, nell'ordine del rapporto.
  readonly notes: readonly string[];
}

/// Il disegno che `text`, di Excalidraw o di draw.io, diventa. Lancia
/// [`ImportError`] se non si legge o non sta in un disegno.
export async function pastedDrawing(text: string): Promise<Pasted> {
  if (utf8Length(text) > MEDIA_MAX_INLINE_BYTES) throw new ImportError("large", "gli appunti sono troppo grandi per un disegno");
  const diagram = await readDiagram("", new TextEncoder().encode(text));
  ensureTextFont();
  await loadFonts(fontsOf(diagram));
  const done = await writeImported(diagram, setupFor(""), browserPictures());
  return { svg: done.text, notes: reportOrder(done.notes).map(noteText) };
}
