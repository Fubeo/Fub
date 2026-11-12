// Le figure della barra del PDF, col tratto delle icone della shell: griglia
// di 24, soltanto tracciati.
//
// Si registrano in `ui/icons.ts` perché la barra le disegni per nome e un tema
// le possa ridisegnare. Due PDF aperti montano due barre: la prima che si
// monta registra, l'ultima che si smonta toglie. La lente della ricerca e «…»
// sono della serie (`search`, `more`).
import { registerIcon } from "../../ui/icons";
import type { Teardown } from "../../ui/lifetime";

export const MEDIA_ICONS: Readonly<Record<string, readonly string[]>> = {
  "media-page-previous": ["M15 6l-6 6 6 6"],
  "media-page-next": ["M9 6l6 6-6 6"],
  "media-thumbnails": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  "media-fit-width": ["M3 12h18", "M7 8l-4 4 4 4", "M17 8l4 4-4 4"],
  "media-two-pages": ["M3 5h8v14H3z", "M13 5h8v14h-8z"],
  "media-dark-pages": ["M12 3a9 9 0 1 0 0 18z", "M12 3a9 9 0 0 1 0 18"],
  "media-show-annotations": ["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 16c1.5-2.5 2.5 1 4-1.5s2.5 0 3 0"],
};

let mounted = 0;
let teardowns: Teardown[] = [];

/// Registra le figure per una barra che si monta; la teardown la smonta.
export function useMediaIcons(): Teardown {
  if (mounted === 0) teardowns = Object.entries(MEDIA_ICONS).map(([name, paths]) => registerIcon(name, paths));
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
