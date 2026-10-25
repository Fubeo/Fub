// La mini-barra: i gesti di formattazione accanto al puntatore, come la Mini
// Toolbar di Word.
//
// Ha due inneschi e una sola regola, l'impostazione `editor.minibar`: sopra il
// menu del tasto destro (lo slot `strip` di `ui/menu.ts`) e sul testo scelto
// (la bolla, `selection-bubble.ts`). Il contenuto è quello della superficie
// quando ne ha uno suo (`miniBar()`, un documento di Word, un foglio),
// altrimenti la barra di formattazione ristretta allo stile del blocco, al
// carattere e ai collegamenti: nessun comando nuovo, nessuna copia dei
// pulsanti.
//
// La shell scrive la scelta su `#app` (`data-minibar`), come fa con la barra
// spenta (`data-formatbar-off`): qui la si legge senza chiedere all'host.
import type { CommandSpec } from "../host/contract";
import type { SurfaceMiniBar } from "../editors/core/editor-menu";
import { closeContextMenu } from "../ui/menu";
import { createFormatBar, type FormatBarHost, type GroupId } from "./format-bar";

export type MiniBarMode = "auto" | "always" | "menu" | "off";

/// L'impostazione che la sceglie.
export const MINIBAR_SETTING = "editor.minibar";

/// I gruppi della mini-barra del menu: lo stile della riga, il carattere, i
/// collegamenti.
export const MINIBAR_GROUPS: readonly GroupId[] = ["block", "inline", "links"];

/// Un valore dell'impostazione, o `auto` per ciò che non si conosce.
export function miniBarModeOf(value: unknown): MiniBarMode {
  return value === "always" || value === "menu" || value === "off" ? value : "auto";
}

/// La scelta corrente, come la shell l'ha scritta su `#app`.
export function miniBarMode(): MiniBarMode {
  return miniBarModeOf(document.getElementById("app")?.dataset["minibar"]);
}

/// La bolla sul testo scelto: con `auto` soltanto a barra del foglio spenta.
export function bubbleWanted(mode: MiniBarMode, barOff: boolean): boolean {
  return mode === "always" || (mode === "auto" && barOff);
}

/// Monta la mini-barra del menu dentro `host`, e torna come smontarla. Un
/// gesto fatto dalla barra chiude il menu: il testo è già cambiato, le voci
/// parlerebbero dello stato di prima.
export function mountMiniBar(
  barHost: Omit<FormatBarHost, "only">,
  specs: readonly CommandSpec[],
  own: SurfaceMiniBar | null,
): ((host: HTMLElement) => () => void) | null {
  if (miniBarMode() === "off") return null;
  if (own) return (host) => own.mount(host);
  return (host) => {
    const bar = createFormatBar({
      ...barHost,
      focusPane: () => {
        barHost.focusPane();
        queueMicrotask(closeContextMenu);
      },
      only: MINIBAR_GROUPS,
    });
    bar.update(specs);
    host.append(bar.element);
    return () => {
      bar.destroy();
      bar.element.remove();
    };
  };
}
