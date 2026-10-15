// Le preferenze dello Scrittoio: ciò che la shell aggiunge alla vista.
//
// La vista (`panels/settings.ts`) disegna schede, sezioni e righe, e possiede
// ciò che si scrive e i suoi esiti. Qui sta ciò che è di questa cornice — il
// velo, i controlli dedicati di due righe, l'anteprima, le voci del tema — e si
// appoggia al DOM che la vista scrive, senza possederlo: a ogni riscrittura del
// corpo ogni pezzo rimette il suo nodo e scrive soltanto ciò che è cambiato.
import "./preferences.css";
import { onLanguage } from "../../../i18n/strings";
import type { Lifetime } from "../../../ui/lifetime";
import { byId, follow } from "../frame/dom";
import { accentControl } from "./accent-control";
import { appearancePreview } from "./preview";
import { dressRow, type Piece } from "./rows";
import { mountScrim } from "./scrim";
import { spaceControl } from "./space-control";
import { themeSettings } from "./theme-settings";

/// L'esito di una scrittura rifiutata va sotto il controllo che l'ha chiesta:
/// la vista lo mette in coda al testo della riga, a sinistra, lontano dal gesto.
function outcomesUnderControls(body: HTMLElement): boolean {
  for (const outcome of body.querySelectorAll<HTMLElement>(".setting-row > .setting-text > .setting-error")) {
    outcome.closest(".setting-row")?.querySelector(":scope > .setting-control")?.append(outcome);
  }
  return false;
}

export function mountPreferences(lifetime: Lifetime): void {
  const panel = byId("settings-panel");
  const body = byId("settings-body");
  if (!panel || !body) return;

  mountScrim(lifetime, panel);
  const pieces: Piece[] = [
    dressRow(lifetime, body, spaceControl(lifetime)),
    dressRow(lifetime, body, accentControl(lifetime, panel)),
    appearancePreview(lifetime, body),
    themeSettings(lifetime, panel, body),
    () => outcomesUnderControls(body),
  ];

  // La vista, riscrivendo, rimette lo scroll dov'era — ma lo fa sul suo
  // disegno, che non ha ancora i nodi di questa shell ed è più corto: in fondo
  // alla pagina il numero viene tagliato, e ciò che si guardava scivola via.
  // Rimessi i nodi il disegno ha di nuovo l'altezza di prima, e lo scroll si
  // riporta al punto che la persona aveva lasciato. Cambiata la scheda, vale
  // quello che ha deciso la vista.
  const scroller = byId("settings-scroll");
  let left = 0;
  let tabSeen: string | null = null;
  if (scroller) {
    lifetime.listen(scroller, "scroll", () => {
      left = scroller.scrollTop;
    }, { passive: true });
  }

  const sync = (): void => {
    let placed = false;
    for (const piece of pieces) placed = piece() || placed;
    if (!scroller || !placed) return;
    const tab = byId("settings-tabs")?.querySelector('[aria-selected="true"]')?.id ?? "";
    if (tab === tabSeen && scroller.scrollTop !== left) scroller.scrollTop = left;
    else left = scroller.scrollTop;
    tabSeen = tab;
  };
  follow(lifetime, body, sync);
  // La luce e il contrasto cambiano i colori dei campioni; la lingua, i nomi.
  follow(lifetime, document.documentElement, sync, { attributes: ["data-theme", "data-contrast"] });
  lifetime.add(onLanguage(sync));
  // Il filtro della vista nasconde e mostra senza riscrivere: chi dipende da
  // lui lo risente da qui, dopo che la vista ha fatto il suo.
  for (const id of ["settings-search", "settings-modified"]) {
    const control = byId(id);
    if (control) lifetime.listen(control, id === "settings-search" ? "input" : "click", sync);
  }
  sync();
}
