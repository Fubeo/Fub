// Il menu delle modalità di un riquadro: lo stesso per il bottone della
// testata, per la banda e per la testata del telefono. Ordine, icone e
// scorciatoie si decidono qui, una volta sola.
//
// L'ordine segue il ruolo e non la dichiarazione della superficie: prima le
// modalità in cui si scrive sulla resa (`live_preview`, nell'ordine in cui la
// superficie le dichiara), poi il sorgente, poi, dopo una riga, la lettura.
// Le scorciatoie sono quelle dei comandi che portano alla stessa modalità,
// lette da `allCommands()`: se la persona ne ha cambiata una, il menu dice la
// sua.

import type { PaneMode } from "../host/contract";
import type { SurfaceMode } from "../editors/core/registry";
import { allCommands, displayBinding } from "../ui/commands";
import { icon } from "../ui/icons";
import { showContextMenu, type MenuItem } from "../ui/menu";
import { paneOf, selectedMode, setMode } from "./document-controller";
import { focusPane, pane as paneState } from "./layout";

/// La figura di una modalità che non ne dichiara una sua, o ne dichiara una
/// che `ui/icons.ts` non sa disegnare: quella del suo ruolo.
const ROLE_ICONS: Readonly<Record<PaneMode, string>> = {
  live_preview: "pen",
  source: "code",
  reading: "eye",
};

const ROLE_ORDER: Readonly<Record<PaneMode, number>> = {
  live_preview: 0,
  source: 1,
  reading: 2,
};

/// L'icona con cui si disegna `mode`: la sua, se il set la conosce, sennò
/// quella del ruolo.
export function modeIcon(mode: SurfaceMode): string {
  return mode.icon && icon(mode.icon) !== "" ? mode.icon : ROLE_ICONS[mode.contextMode];
}

/// Le modalità di `modes` nell'ordine del menu. Il `sort` è stabile: dentro
/// un ruolo resta l'ordine dichiarato.
export function orderedModes(modes: readonly SurfaceMode[]): SurfaceMode[] {
  return [...modes].sort((left, right) => ROLE_ORDER[left.contextMode] - ROLE_ORDER[right.contextMode]);
}

/// Il comando che porta a `mode`, come lo cercano i comandi della shell: i
/// Blocchi per id, gli altri per ruolo, e del ruolo la prima modalità (la
/// Live è la prima che non è Blocchi). Le altre di uno stesso ruolo non ne
/// hanno uno.
function commandOf(mode: SurfaceMode, modes: readonly SurfaceMode[]): string | null {
  if (mode.id === "blocks") return "shell.mode.blocks";
  const first = modes.find((candidate) => candidate.contextMode === mode.contextMode && candidate.id !== "blocks");
  if (first !== mode) return null;
  switch (mode.contextMode) {
    case "live_preview":
      return "shell.mode.live";
    case "source":
      return "shell.mode.source";
    case "reading":
      return "shell.mode.reading";
  }
}

/// Le voci del menu delle modalità del riquadro `paneId`: vuoto se il
/// riquadro non c'è o la sua superficie ha una modalità sola. Le scorciatoie
/// sono quelle dei comandi disponibili adesso, che seguono il riquadro a
/// fuoco: `openModeMenu` gli dà il fuoco prima di chiederle.
export function modeMenuItems(paneId: string): MenuItem[] {
  const r = paneOf(paneId);
  const modes = r?.surface?.modes ?? [];
  if (modes.length <= 1) return [];
  const active = selectedMode(r);
  const bindings = new Map(allCommands().map((entry) => [entry.id, entry.binding]));
  return orderedModes(modes).map((mode, index, ordered) => {
    const command = commandOf(mode, modes);
    const hint = command ? displayBinding(bindings.get(command)) : "";
    const current = active?.id === mode.id;
    return {
      label: mode.label(),
      icon: modeIcon(mode),
      choice: "radio",
      checked: current,
      selected: current,
      ...(hint ? { hint } : {}),
      ...(mode.contextMode === "reading" && index > 0 && ordered[index - 1]!.contextMode !== "reading" ? { separator: true } : {}),
      run: () => {
        // Il riquadro può essersi chiuso col menu aperto. E il menu, chiudendosi,
        // rende il fuoco a chi l'aveva prima, magari l'editor di un altro
        // riquadro: `setMode` cambia quello a fuoco, quindi il fuoco torna qui.
        if (!paneOf(paneId) || !paneState(paneId)) return;
        focusPane(paneId);
        void setMode(mode.id);
      },
    };
  });
}

/// Apre il menu delle modalità del riquadro `paneId` sotto `anchor`, che dice
/// con `aria-expanded` se è aperto. Il riquadro prende il fuoco prima, perché
/// le scorciatoie e la scelta siano le sue.
export function openModeMenu(anchor: HTMLElement, paneId: string, options: { onClose?: () => void } = {}): void {
  focusPane(paneId);
  const items = modeMenuItems(paneId);
  if (items.length === 0) return;
  anchor.setAttribute("aria-expanded", "true");
  showContextMenu(anchor, items, {
    onClose: () => {
      anchor.setAttribute("aria-expanded", "false");
      options.onClose?.();
    },
  });
}
