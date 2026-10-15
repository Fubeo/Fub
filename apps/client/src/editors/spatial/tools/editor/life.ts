// L'editor del disegno: la vita dell'editor. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { onLanguage } from "../../../../i18n/strings";
import type { EditorContext } from "./context";

/// Ciò che la vita dell'editor dà agli altri pezzi dell'editor.
export interface LifeContext {
  dispose: () => void;
}

/// Monta la vita dell'editor.
export function installLife(ctx: EditorContext): void {
  const {
    life, relabels, root, setCamera, showPanelByDefault, refresh, owner
  } = ctx;
  // --- Vita ------------------------------------------------------------------

  const relabel = (): void => {
    for (const run of relabels) run();
  };
  relabel();
  life.add(onLanguage(relabel));
  setCamera(ctx.camera);
  refresh();
  showPanelByDefault();

  const dispose = (): void => {
    if (ctx.disposed) return;
    ctx.disposed = true;
    life.close();
    root.remove();
  };
  ctx.dispose = dispose;
  owner.add(dispose);
}
