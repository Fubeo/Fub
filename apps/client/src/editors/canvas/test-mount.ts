// L'aiuto che monta la tela nei test di parità. È una copia di `mounted` in
// `engine.test.ts` (righe 62–99): quel file non si tocca, e chi cambia il
// montaggio lì lo cambia anche qui.
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "./engine";

/** Una tela montata in `document.body`, con le chiamate che fa verso fuori. */
export function mountCanvas(source: string, overrides: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const opened: Array<{ page?: string; path?: string; url?: string; note?: string }> = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "test",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "board.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onOpenWikilink: (page) => {
      opened.push({ page });
    },
    onOpenPath: (path) => {
      opened.push({ path });
    },
    onCreateNote: (initialText) => {
      opened.push({ note: initialText });
    },
    media: {
      openExternal: (url) => {
        opened.push({ url });
      },
    },
    renderMarkdownForCard: (_nodeId, text, host) =>
      mountMarkdown(host, renderMarkdown(text).html, {
        documentId: "board.canvas",
        openWikilink: (page) => {
          opened.push({ page });
        },
      }),
    ...overrides,
  });
  engine.setDoc(source);
  return { engine, host, changes, opened };
}
