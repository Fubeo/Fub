// Le figure della barra della Base, col tratto delle icone della shell:
// griglia di 24, soltanto tracciati.
//
// Si registrano in `ui/icons.ts` perché la barra le disegni per nome e un tema
// le possa ridisegnare. Due Basi aperte (un riquadro e una incorporata)
// montano due barre: la prima che si monta registra, l'ultima che si smonta
// toglie. La lente, «…», la croce e il calendario sono della serie (`search`,
// `more`, `close`, `calendar`).
import { registerIcon } from "../../ui/icons";
import type { Teardown } from "../../ui/lifetime";

export const BASE_ICONS: Readonly<Record<string, readonly string[]>> = {
  "base-filter": ["M3.75 5.25h16.5l-6.45 7.5v6.3l-3.6 1.95v-8.25z"],
  "base-sort": ["M7.5 4.5v15", "M3.75 15.75 7.5 19.5l3.75-3.75", "M16.5 19.5v-15", "M12.75 8.25 16.5 4.5l3.75 3.75"],
  "base-sliders": ["M3 6.75h10.5M18 6.75h3", "M3 12h3M10.5 12h10.5", "M3 17.25h9M16.5 17.25h4.5", "M13.5 6.75a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0", "M6 12a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0", "M12 17.25a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0"],
  "base-table": ["M6 3.75h12a3 3 0 0 1 3 3v10.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6.75a3 3 0 0 1 3-3z", "M3 9.75h18M3 15h18M9.75 9.75v10.5"],
  "base-board": ["M3 3.75h5.1v16.5H3z", "M9.45 3.75h5.1v10.5h-5.1z", "M15.9 3.75H21v13.5h-5.1z"],
  "base-cards": ["M3.75 3.75h7v7h-7z", "M13.25 3.75h7v7h-7z", "M3.75 13.25h7v7h-7z", "M13.25 13.25h7v7h-7z"],
  "base-list": ["M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5", "M4 6h.01M4 12h.01M4 18h.01"],
  "base-map": ["M3 6l6-2.25 6 2.25 6-2.25v14.25l-6 2.25-6-2.25-6 2.25z", "M9 3.75V18M15 6v14.25"],
  "base-timeline": ["M3 6h9M7.5 12h10.5M5 18h8", "M3 3v18"],
  "base-plus": ["M12 4.8v14.4M4.8 12h14.4"],
  "base-chevron-down": ["M6.75 9.3 12 14.7l5.25-5.4"],
  "base-grip": ["M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01"],
};

/// La figura della linguetta di una vista, per tipo. Un tipo che la Base non
/// conosce ha la tabella, come chi apre il file senza sapere cosa sia.
export function viewIcon(type: string | null): string {
  switch (type) {
    case "kanban": return "base-board";
    case "cards": return "base-cards";
    case "list": return "base-list";
    case "map": return "base-map";
    case "calendar": return "calendar";
    case "timeline": return "base-timeline";
    default: return "base-table";
  }
}

let mounted = 0;
let teardowns: Teardown[] = [];

/// Registra le figure per una barra che si monta; la teardown la smonta.
export function useBaseIcons(): Teardown {
  if (mounted === 0) teardowns = Object.entries(BASE_ICONS).map(([name, paths]) => registerIcon(name, paths));
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
