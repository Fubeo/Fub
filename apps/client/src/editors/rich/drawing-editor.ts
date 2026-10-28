// L'editor dei disegni dentro un documento: il pezzo che `drawing.ts` carica
// soltanto quando si apre un disegno, perché il documento non porti con sé
// tutto FubDraw.
//
// Le cromature sono quelle in linea (`inlineChrome`): colonna, barra e
// pannelli stanno nel riquadro sopra l'oggetto, non nell'ispettore dello
// Scrittoio, che resta del documento.

import { SceneEngine } from "../spatial/scene/engine";
import { createDrawEditor } from "../spatial/tools/editor";
import type { Lifetime } from "../../ui/lifetime";
import type { RichDrawingEditor } from "./drawing";

/// Monta l'editor su `svg` dentro `host`, finché vive `life`. Lancia se `svg`
/// non si legge come scena.
export function openDrawingEditor(host: HTMLElement, svg: string, life: Lifetime): RichDrawingEditor {
  const editor = createDrawEditor(host, SceneEngine.open(svg), life, { workspace: "full" });
  return {
    text: () => editor.engine.text,
    focus: () => editor.focus(),
    fit: () => editor.fit(),
  };
}
