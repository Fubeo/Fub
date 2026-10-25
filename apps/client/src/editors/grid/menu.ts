// Il menu del tasto destro di una cartella di Excel, per il menu dell'editor:
// il motore dice su cosa si è premuto e sceglie la cella, la barra
// multifunzione dà le voci (`ribbon/context.ts`) e la mini-barra, qui si
// aggiungono gli appunti e il riferimento della selezione.
import type { SurfaceMenu, SurfaceMenuItem, SurfaceMiniBar } from "../core/editor-menu";
import type { GridRibbon } from "./ribbon/ribbon";
import type { GridEngine } from "./engine";
import { readClipboard, writeClipboardText } from "../../platform/clipboard";
import { t } from "../../i18n/strings";

export interface GridMenuHost {
  readonly engine: GridEngine;
  /// La barra, quando è arrivata: prima, il menu ha soltanto gli appunti.
  ribbon(): GridRibbon | null;
  /// Un avviso breve per un appunto che non si scrive o non si legge.
  notify?(message: string): void;
}

/// Il menu sul punto `at` della finestra, o sulla cella attiva quando arriva
/// dalla tastiera; `null` fuori dalla griglia.
export function gridContextMenu(host: GridMenuHost, at: { x: number; y: number } | null): SurfaceMenu | null {
  const { engine } = host;
  const kind = at ? engine.pointAt(at.x, at.y) : engine.selectedObject() ? "object" : "cell";
  if (!kind) return null;
  const writable = engine.writable();
  const cells = kind !== "sheet" && kind !== "object";
  const fail = (key: "editor_menu.copy_failed" | "editor_menu.paste_failed") => host.notify?.(t(key));
  const refs = engine.selectionRefs();
  const tail: SurfaceMenuItem[] = cells
    ? [{
        id: "grid.copy_reference",
        label: t("grid.menu.copy_reference"),
        description: refs.range,
        run: () => void writeClipboardText(refs.range).catch(() => fail("editor_menu.copy_failed")),
      }]
    : [];
  const box = engine.activeCellBox();
  return {
    target: { kind, ref: cells ? `${refs.sheet}!${refs.range}` : undefined },
    at: box && !at ? { x: Math.round(box.left), y: Math.round(box.bottom) + 4 } : undefined,
    context: host.ribbon()?.contextMenu(kind) ?? [],
    clipboard: cells
      ? {
          offers: { cut: writable, copy: true, paste: writable, "select-all": true },
          run(op) {
            if (op === "select-all") engine.selectAll();
            else if (op === "paste" || op === "paste-plain") {
              void readClipboard().then(async (entries) => {
                const entry = entries.find((one) => one.types.includes("text/plain"));
                if (entry) engine.pasteText(await (await entry.getType("text/plain")).text());
              }).catch(() => fail("editor_menu.paste_failed"));
            } else {
              void writeClipboardText(engine.selectionTsv()).then(
                () => {
                  if (op === "cut") engine.clearCells();
                },
                () => fail("editor_menu.copy_failed"),
              );
            }
          },
        }
      : undefined,
    tail,
    miniBar: cells && engine.commandable(),
  };
}

/// La mini-barra della cartella: i controlli della scheda Home, dalla barra.
export function gridMiniBar(host: GridMenuHost): SurfaceMiniBar | null {
  const ribbon = host.ribbon();
  if (!ribbon || !host.engine.commandable()) return null;
  return { mount: (element) => ribbon.mountMini(element) };
}
