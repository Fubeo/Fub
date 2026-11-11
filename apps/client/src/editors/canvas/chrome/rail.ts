// La colonna degli strumenti della lavagna (T49): Selezione (col Lazo in
// tendina, T86), Mano, Penna, Evidenziatore, Gomma, Testo e Collega, sulla colonna del kit
// (`kit/tool-rail.ts`) come quella del disegno, con le tendine. Ogni
// strumento è un comando del catalogo (`canvas.tool.<id>`, `commands.ts`) col
// suo tasto; la colonna lo mostra e lo sceglie, la tela sa che cosa fa.
//
// La forma delle caselle è una regola pura, `canvasRailLayout`: dalla colonna
// scelta in `canvas.toolbar` (vuota, quella di serie) ai gruppi. Uno strumento
// tolto dalla colonna resta nei tasti e in Ctrl+/.
//
// Nello spazio Semplice (T65) la colonna è quella ridotta di
// `CANVAS_SIMPLE_TOOLS`, ogni strumento nella sua casella e senza tendine,
// con caselle da 44 px (`data-size="large"` del kit) e «Completo» in fondo.
// La colonna scelta in `canvas.toolbar` vale solo nello spazio Completo.
//
// In fondo alla colonna, in tutti e due gli spazi, l'interruttore «Il dito
// scrive» (T64): cambia `canvas.finger_writes`, che è di questo computer
// (`saveFingerWrites`). Acceso, un dito scrive con la penna scelta e due dita
// spostano; il suo suggerimento dice quando «Il dito sposta le schede» non vale
// più.
//
// In sola lettura gli strumenti che scrivono (penna, evidenziatore, gomma,
// testo, collega) si vedono spenti col perché nel nome e nel suggerimento;
// Selezione, Lazo e Mano restano: il lazo sceglie anche lì, non sposta.

import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import { textButton } from "../../../kit";
import { createToolRail, type RailGroup, type RailTool, type ToolRail } from "../../../kit/tool-rail";
import { t } from "../../../i18n/strings";
import { FINGER_WRITES_KEY } from "../../../rules/canvas-settings";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { notify } from "../../../ui/notify";
import { setTooltip } from "../../../ui/tooltip";
import { CANVAS_TOOL_IDS, CANVAS_TOOL_KEYS, displayCanvasKey, type CanvasToolId } from "./commands";
import { ensureCanvasIcons } from "./icons";
import { CANVAS_SIMPLE_TOOLS, type CanvasWorkspace } from "./workspace";

export type { CanvasToolId } from "./commands";

/// La colonna di serie, nel suo ordine: è anche l'elenco che il campo delle
/// Impostazioni (`toolbar-field.ts`) mostra.
export const CANVAS_RAIL_TOOLS: readonly CanvasToolId[] = CANVAS_TOOL_IDS;

/// Gli strumenti dell'inchiostro: col mouse scrivono con la penna di N4.
export const CANVAS_INK_TOOLS: ReadonlySet<CanvasToolId> = new Set<CanvasToolId>(["pen", "highlighter", "eraser"]);

/// Gli strumenti che cambiano la lavagna: in sola lettura sono spenti.
export const CANVAS_WRITING_TOOLS: ReadonlySet<CanvasToolId> = new Set<CanvasToolId>(["pen", "highlighter", "eraser", "text", "connect"]);

/// Le caselle, per gruppo: ogni casella elenca i suoi strumenti, il primo è
/// quello che mostra finché non se ne sceglie un altro (come il disegno: la
/// penna con l'evidenziatore in tendina).
type Layout = readonly (readonly (readonly CanvasToolId[])[])[];

const DEFAULT_LAYOUT: Layout = [
  [["select", "lasso"], ["hand"]],
  [["pen", "highlighter"], ["eraser"]],
  [["text"], ["connect"]],
];

/// La famiglia di uno strumento: scegliere, scrivere a mano, creare.
const FAMILY: Readonly<Record<CanvasToolId, number>> = {
  select: 0, lasso: 0, hand: 0, pen: 1, highlighter: 1, eraser: 1, text: 2, connect: 2,
};
const GROUP_IDS = ["pick", "ink", "make"] as const;

/// L'icona di ogni strumento: la colonna e il menu radiale (T63).
export const CANVAS_TOOL_ICONS: Readonly<Record<CanvasToolId, string>> = {
  select: "draw-select",
  lasso: "canvas-lasso",
  hand: "draw-hand",
  pen: "draw-pen",
  highlighter: "draw-highlighter",
  eraser: "draw-eraser",
  text: "canvas-text",
  connect: "canvas-connect",
};

export function isCanvasTool(name: string): name is CanvasToolId {
  return (CANVAS_TOOL_IDS as readonly string[]).includes(name);
}

/// Le caselle della colonna per la colonna scelta `toolbar`. Vuota (o senza
/// nessuno strumento che la lavagna conosce), quella di serie. Altrimenti gli
/// strumenti scelti nel loro ordine, ognuno nella sua casella, un filo dove
/// cambia la famiglia; un nome che non c'è si salta, un doppio conta una volta,
/// e la Selezione sta in cima se manca: senza, non si sceglierebbe più niente.
export function canvasRailLayout(toolbar: readonly string[] = [], workspace: CanvasWorkspace = "full"): CanvasToolId[][][] {
  if (workspace === "simple") return groupedByFamily(CANVAS_SIMPLE_TOOLS);
  const chosen = [...new Set(toolbar)].filter(isCanvasTool);
  if (chosen.length === 0) return DEFAULT_LAYOUT.map((group) => group.map((slot) => [...slot]));
  return groupedByFamily(chosen.includes("select") ? chosen : ["select" as const, ...chosen]);
}

/// Gli strumenti `tools` nel loro ordine, ognuno nella sua casella, un gruppo
/// per ogni tratto della stessa famiglia.
function groupedByFamily(tools: readonly CanvasToolId[]): CanvasToolId[][][] {
  const groups: CanvasToolId[][][] = [];
  let last = -1;
  for (const tool of tools) {
    if (FAMILY[tool] !== last || groups.length === 0) groups.push([]);
    last = FAMILY[tool];
    groups[groups.length - 1]!.push([tool]);
  }
  return groups;
}

export interface CanvasRailOptions {
  /// Lo strumento scelto adesso.
  readonly tool: () => CanvasToolId;
  /// Sceglie lo strumento (il comando `canvas.tool.<id>`).
  readonly pick: (tool: CanvasToolId) => void;
  /// La lavagna si può cambiare: senza, gli strumenti che scrivono sono spenti.
  readonly editable: () => boolean;
  /// La colonna scelta (`canvas.toolbar`); vuota, quella di serie.
  readonly toolbar: readonly string[];
  /// Lo spazio di lavoro all'apertura (T65); di serie Completo.
  readonly workspace?: CanvasWorkspace;
  /// «Completo» in fondo alla colonna, nello spazio Semplice.
  readonly onFull?: () => void;
  /// «Il dito scrive» adesso (T64); assente, spento.
  readonly fingerWrites?: () => boolean;
  /// «Il dito sposta le schede» adesso: con «Il dito scrive» il suggerimento
  /// dice che non vale.
  readonly fingerMovesCard?: () => boolean;
  /// L'interruttore «Il dito scrive» premuto: il valore nuovo.
  readonly onFingerWrites?: (on: boolean) => void;
  readonly lifetime: Lifetime;
}

/// Scrive `on` in `canvas.finger_writes`: lo leggono le altre lavagne e le
/// altre finestre. Una scrittura che non riesce lo dice e chiama `failed`, che
/// rimette il valore di prima.
export function saveFingerWrites(on: boolean, failed: () => void): void {
  void Promise.resolve()
    .then(() => api.setSetting(FINGER_WRITES_KEY, on))
    .catch((error: unknown) => {
      failed();
      notify(t("canvas.finger.save_failed", { reason: errorText(error) }), "guasto");
    });
}

export interface CanvasRail {
  /// La colonna intera, `.canvas-rail`, con la colonna del kit dentro.
  readonly element: HTMLElement;
  readonly rail: ToolRail;
  /// Mostra lo strumento scelto, la sola lettura e «Il dito scrive» di adesso.
  sync(): void;
  /// Un'altra colonna scelta, dal vivo.
  setToolbar(toolbar: readonly string[]): void;
  /// Un altro spazio di lavoro (T65): la colonna ridotta e grande, o quella intera.
  setWorkspace(workspace: CanvasWorkspace): void;
  /// Stretta: la colonna va sotto la lavagna, in riga.
  setNarrow(narrow: boolean): void;
  /// Rifà nomi e suggerimenti nella lingua di adesso.
  relabel(): void;
}

/// Il tasto di uno strumento come si legge e come lo vuole `aria-keyshortcuts`.
function keysOf(tool: CanvasToolId): { keys: string; aria: string } {
  const binding = CANVAS_TOOL_KEYS[tool];
  // `aria-keyshortcuts` vuole i nomi della specifica (`Shift+P`), non quelli
  // del Mac: il tasto si scrive come su un computer qualunque.
  return { keys: displayCanvasKey(binding), aria: displayCanvasKey(binding, "other") };
}

function railTool(tool: CanvasToolId): RailTool {
  const { keys, aria } = keysOf(tool);
  return {
    id: tool,
    label: t(`canvas.tool.${tool}`),
    icon: CANVAS_TOOL_ICONS[tool],
    keys,
    ariaKeys: aria,
    description: t(`canvas.tool.${tool}.hint`),
  };
}

/// Monta la colonna della lavagna.
export function createCanvasRail(options: CanvasRailOptions): CanvasRail {
  ensureCanvasIcons();
  const { lifetime } = options;
  let toolbar = options.toolbar;
  let workspace: CanvasWorkspace = options.workspace ?? "full";
  const groups = (): RailGroup[] =>
    canvasRailLayout(toolbar, workspace).map((slots, at) => ({
      id: GROUP_IDS[FAMILY[slots[0]![0]!]] ?? `group-${at}`,
      slots: slots.map((tools) => ({ id: tools[0]!, tools: tools.map(railTool) })),
    }));

  const rail = createToolRail({
    label: t("menu.tools"),
    groups: groups(),
    active: options.tool(),
    slotClass: "canvas-tool",
    text: { more: (name) => t("canvas.tool.more", { name }) },
    onSelect: (tool) => {
      if (!isCanvasTool(tool)) return;
      // Spento in sola lettura: si vede, non si sceglie.
      if (CANVAS_WRITING_TOOLS.has(tool) && !options.editable()) return;
      options.pick(tool);
    },
    lifetime,
  });
  const element = document.createElement("div");
  element.className = "canvas-rail";
  element.append(rail.element);
  // «Il dito scrive» in fondo alla colonna, prima di «Completo» (T64).
  const finger = document.createElement("button");
  finger.type = "button";
  finger.className = "canvas-button canvas-rail-finger";
  const fingerIcon = iconEl("canvas-finger");
  if (fingerIcon) {
    fingerIcon.setAttribute("aria-hidden", "true");
    finger.append(fingerIcon);
  }
  lifetime.listen(finger, "click", () => options.onFingerWrites?.(!(options.fingerWrites?.() ?? false)));
  element.append(finger);
  const paintFinger = (): void => {
    const on = options.fingerWrites?.() ?? false;
    finger.setAttribute("aria-pressed", String(on));
    finger.setAttribute("aria-label", t("canvas.finger"));
    const cards = on && (options.fingerMovesCard?.() ?? false);
    setTooltip(finger, t(cards ? "canvas.finger.hint_cards" : "canvas.finger.hint"));
  };
  // «Completo» in fondo alla colonna: si vede solo nello spazio Semplice.
  const full = textButton({ label: t("canvas.workspace.full"), onPress: () => options.onFull?.(), lifetime });
  full.classList.add("canvas-rail-full");
  setTooltip(full, t("canvas.workspace.full_hint"));
  element.append(full);
  const paintWorkspace = (): void => {
    // Nel Semplice le caselle sono bersagli da 44 px, anche col mouse.
    rail.element.dataset.size = workspace === "simple" ? "large" : "normal";
    full.hidden = workspace !== "simple";
  };
  paintWorkspace();

  // Il kit ridipinge nome e suggerimento a ogni `setActive`: la sola lettura
  // si rimette sopra, sulla casella dello strumento che mostra.
  const paintReadOnly = (): void => {
    const editable = options.editable();
    for (const button of rail.element.querySelectorAll<HTMLButtonElement>(".kit-rail-slot")) {
      const tool = button.dataset.tool ?? "";
      const off = !editable && isCanvasTool(tool) && CANVAS_WRITING_TOOLS.has(tool);
      if (!off) {
        button.removeAttribute("aria-disabled");
        continue;
      }
      const why = t("canvas.tool.readonly", { name: t(`canvas.tool.${tool as CanvasToolId}`) });
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-label", why);
      setTooltip(button, why);
    }
  };

  const sync = (): void => {
    rail.setActive(options.tool());
    paintReadOnly();
    paintFinger();
  };
  const rebuild = (): void => {
    rail.setGroups(groups());
    sync();
  };
  sync();

  return {
    element,
    rail,
    sync,
    setToolbar(next) {
      if (next.length === toolbar.length && next.every((tool, at) => tool === toolbar[at])) return;
      toolbar = next;
      // Nel Semplice la colonna non cambia: la scelta vale al ritorno.
      if (workspace === "full") rebuild();
    },
    setWorkspace(next) {
      if (next === workspace) return;
      workspace = next;
      paintWorkspace();
      rebuild();
    },
    setNarrow(narrow) {
      rail.setOrientation(narrow ? "horizontal" : "vertical");
    },
    relabel() {
      rail.element.setAttribute("aria-label", t("menu.tools"));
      full.textContent = t("canvas.workspace.full");
      setTooltip(full, t("canvas.workspace.full_hint"));
      rebuild();
    },
  };
}
