// Le figure della barra del documento, col tratto delle icone della shell:
// griglia di 24, soltanto tracciati.
//
// Si registrano in `ui/icons.ts` perché la barra del kit e le voci dei menu le
// disegnino per nome. Due documenti aperti montano due barre: la prima che si
// monta registra, l'ultima che si smonta toglie.
import { registerIcon } from "../../ui/icons";
import type { Teardown } from "../../ui/lifetime";

const BOX = "M4 5h16v14H4z";
const LINES = ["M11 6h9", "M11 10h9", "M11 14h9", "M11 18h9"];

export const RICH_ICONS: Readonly<Record<string, readonly string[]>> = {
  "rc-chevron-down": ["M7 10l5 5 5-5"],
  "rc-chevron-up": ["M7 14l5-5 5 5"],
  "rc-undo": ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  "rc-redo": ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  "rc-painter": ["M5 3h12v6H5z", "M17 6h2v5h-8v3", "M10 14h2v7h-2z"],
  "rc-clear": ["M4 7V5h12v2", "M10 5 8 19", "M14 14l6 6", "M20 14l-6 6"],
  "rc-bullets": ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  "rc-numbers": ["M10 6h10", "M10 12h10", "M10 18h10", "M4 5l1.5-1v5", "M3.5 13.5a1.5 1.5 0 0 1 3 .5L4 17h3"],
  "rc-align-left": ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"],
  "rc-align-center": ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"],
  "rc-align-right": ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"],
  "rc-align-justify": ["M4 6h16", "M4 10h16", "M4 14h16", "M4 18h16"],
  "rc-indent-less": [...LINES, "M7 9l-3 3 3 3"],
  "rc-indent-more": [...LINES, "M4 9l3 3-3 3"],
  "rc-spacing": ["M11 6h9", "M11 12h9", "M11 18h9", "M5 4v16", "M3 6l2-2 2 2", "M3 18l2 2 2-2"],
  "rc-quote": ["M6 9h4v4H7l-1 3", "M14 9h4v4h-3l-1 3"],
  "rc-styles": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  "rc-find": ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20"],
  "rc-replace": ["M4 7h11", "M12 4l3 3-3 3", "M20 17H9", "M12 14l-3 3 3 3"],
  "rc-link": ["M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1", "M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"],
  "rc-break-page": ["M5 3v5h14V3", "M5 21v-5h14v5", "M4 12h2", "M9 12h2", "M13 12h2", "M18 12h2"],
  "rc-break-column": ["M4 5h6", "M4 9h6", "M4 13h6", "M14 11h6", "M14 15h6", "M14 19h6", "M12 3v18"],
  "rc-table": [BOX, "M4 10h16", "M4 15h16", "M10 5v14"],
  "rc-merge": [BOX, "M7 12h4", "M9 10l2 2-2 2", "M17 12h-4", "M15 10l-2 2 2 2"],
  "rc-split": [BOX, "M12 5v14", "M9 12H6", "M7.5 10.5 6 12l1.5 1.5", "M15 12h3", "M16.5 10.5 18 12l-1.5 1.5"],
  "rc-row-before": ["M4 12h16v8H4z", "M12 3v6", "M9 6h6"],
  "rc-row-after": ["M4 4h16v8H4z", "M12 15v6", "M9 18h6"],
  "rc-row-delete": [BOX, "M4 12h16", "M15 14l4 4", "M19 14l-4 4"],
  "rc-row-up": ["M4 12h16v8H4z", "M12 9V3", "M9 6l3-3 3 3"],
  "rc-row-down": ["M4 4h16v8H4z", "M12 15v6", "M9 18l3 3 3-3"],
  "rc-column-before": ["M12 4h8v16h-8z", "M3 12h6", "M6 9v6"],
  "rc-column-after": ["M4 4h8v16H4z", "M15 12h6", "M18 9v6"],
  "rc-column-delete": [BOX, "M12 5v14", "M14 15l4 4", "M18 15l-4 4"],
  "rc-column-left": ["M12 4h8v16h-8z", "M9 12H3", "M6 9l-3 3 3 3"],
  "rc-column-right": ["M4 4h8v16H4z", "M15 12h6", "M18 9l3 3-3 3"],
  "rc-image": [BOX, "M4 16l5-5 4 4 2-2 5 5", "M15.5 9.5h.01"],
  "rc-note": ["M5 4h14v10l-5 6H5z", "M14 20v-6h5", "M8 8h8", "M8 11h5"],
  "rc-page": ["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 12h7", "M9 15h7", "M9 18h4"],
  "rc-hf": ["M6 3h12v18H6z", "M9 6h6", "M9 18h6", "M6 9h12", "M6 15h12"],
  "rc-toc": ["M4 6h2", "M9 6h11", "M6 11h2", "M11 11h9", "M6 16h2", "M11 16h9"],
  "rc-count": ["M4 6h10", "M4 10h16", "M4 14h12", "M4 18h7", "M17 16v4", "M15 18h4"],
  "rc-comments": ["M4 5h16v11H9l-5 4z", "M8 9h8", "M8 12h5"],
  "rc-comment-new": ["M4 5h16v11H9l-5 4z", "M12 8v5", "M9.5 10.5h5"],
  "rc-track": ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4", "M14 20h6"],
  "rc-rev-previous": ["M15 6l-6 6 6 6"],
  "rc-rev-next": ["M9 6l6 6-6 6"],
  "rc-rev-accept": ["M5 12l5 5 9-10"],
  "rc-rev-reject": ["M6 6l12 12", "M18 6 6 18"],
  "rc-rev-accept-all": ["M2 12l5 5 9-10", "M12 16l1 1 9-10"],
  "rc-rev-reject-all": ["M4 4h16v16H4z", "M8 8l8 8", "M16 8l-8 8"],
  "rc-zoom-in": ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20", "M10.5 8v5", "M8 10.5h5"],
  "rc-zoom-out": ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20", "M8 10.5h5"],
  "rc-zoom-reset": ["M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z", "M15.5 15.5 20 20", "M9 9l1.5-1v5"],
};

let mounted = 0;
let teardowns: Teardown[] = [];

/// Registra le figure per una barra che si monta; la teardown la smonta.
export function useRichIcons(): Teardown {
  if (mounted === 0) teardowns = Object.entries(RICH_ICONS).map(([name, paths]) => registerIcon(name, paths));
  mounted += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted -= 1;
    if (mounted > 0) return;
    for (const teardown of teardowns) teardown();
    teardowns = [];
  };
}
