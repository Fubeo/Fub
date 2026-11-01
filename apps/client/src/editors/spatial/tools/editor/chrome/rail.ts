// La colonna degli strumenti del disegno (B3): gli strumenti del registro,
// in gruppi e caselle come nei programmi di grafica, sulla colonna del kit
// (`kit/tool-rail.ts`). Una casella con più strumenti ha la tendina e mostra
// l'ultimo scelto; gli strumenti che il livello non offre non ci sono.
//
// La forma delle caselle è una regola pura, `railGroups`: dagli strumenti
// offerti ai gruppi, per profilo.

import { createToolRail, type RailGroup, type RailTool, type ToolRail } from "../../../../../kit/tool-rail";
import { t } from "../../../strings";
import { toolKeyText, type ToolId, type ToolProfile, type ToolSpec } from "../../registry";
import type { EditorContext } from "../context";

/// Le caselle, per gruppo: ogni casella elenca i suoi strumenti, il primo è
/// quello che mostra finché non se ne sceglie un altro.
type Layout = readonly (readonly (readonly ToolId[])[])[];

const VECTOR: Layout = [
  [["select"], ["hand", "zoom"]],
  [["pen", "highlighter"], ["eraser"]],
  [["rect", "ellipse", "line", "arrow"]],
];

const PDF: Layout = [
  [["select"], ["hand", "zoom"]],
  [["pen", "highlighter"], ["eraser"], ["note"]],
  [["rect", "ellipse", "line", "arrow"], ["cover"]],
];

const GROUP_IDS = ["pick", "ink", "shape", "more"] as const;

/// Le caselle della colonna per gli strumenti `offered` del profilo: quelli
/// non offerti escono, una casella vuota non c'è, uno strumento offerto che
/// la forma non nomina va in fondo al suo gruppo, da solo. Con `toolbar`, la
/// colonna scelta, e la Selezione in cima se non c'è: senza, non si sceglie
/// più niente.
export function railLayout(offered: readonly ToolSpec[], profile: ToolProfile, toolbar: readonly ToolId[] = []): ToolId[][][] {
  const chosen = [...new Set(toolbar)].filter((id) => offered.some((spec) => spec.id === id));
  if (chosen.length > 0) return chosenLayout(offered, chosen.includes("select") ? chosen : ["select", ...chosen]);
  const layout = profile === "pdf" ? PDF : VECTOR;
  const ids = new Set(offered.map((spec) => spec.id));
  const placed = new Set(layout.flat(2));
  const groups = layout.map((group) => group.map((slot) => slot.filter((id) => ids.has(id))).filter((slot) => slot.length > 0));
  const order: Record<string, number> = { pick: 0, ink: 1, shape: 2, text: 2 };
  for (const spec of offered) {
    if (placed.has(spec.id)) continue;
    groups[Math.min(order[spec.group] ?? 0, groups.length - 1)]!.push([spec.id]);
  }
  return groups;
}

/// La colonna scelta in «Personalizza la barra…»: gli strumenti `chosen`
/// nel loro ordine, ognuno nella sua casella, con un filo dove cambia la
/// famiglia (scegliere, scrivere a mano, forme e testo).
function chosenLayout(offered: readonly ToolSpec[], chosen: readonly ToolId[]): ToolId[][][] {
  const family = (id: ToolId): number => {
    const group = offered.find((spec) => spec.id === id)!.group;
    return group === "pick" ? 0 : group === "ink" ? 1 : 2;
  };
  const groups: ToolId[][][] = [];
  let last = -1;
  for (const id of chosen) {
    if (family(id) !== last || groups.length === 0) groups.push([]);
    last = family(id);
    groups[groups.length - 1]!.push([id]);
  }
  return groups;
}

/// I tasti di uno strumento come si leggono e come li vuole
/// `aria-keyshortcuts`: il suo, poi gli altri.
function keysOf(spec: ToolSpec): { keys: string; aria: string } {
  const all = [spec.shortcut, ...(spec.aliases ?? [])];
  return { keys: all.map(toolKeyText).join(", "), aria: all.map(toolKeyText).join(" ") };
}

export interface RailContext {
  /// La colonna degli strumenti.
  rail: ToolRail;
  /// La colonna con ciò che le sta sotto (le immagini del vault).
  railColumn: HTMLElement;
  /// Rifà le caselle se gli strumenti offerti sono cambiati, e mostra lo
  /// strumento scelto.
  syncRail: (editable: boolean) => void;
}

/// Monta la colonna: la sceglie `pickTool`, il nome e il tasto vengono dal
/// registro.
export function installRail(ctx: EditorContext): void {
  const { life, profile, relabels, toolLabel, toolHint } = ctx;
  let shown = "";

  const groups = (): RailGroup[] =>
    railLayout(ctx.tools, profile, ctx.column).map((slots, at) => ({
      id: GROUP_IDS[at] ?? `group-${at}`,
      slots: slots.map((tools) => ({
        id: tools[0]!,
        tools: tools.map((id): RailTool => {
          const spec = ctx.tools.find((each) => each.id === id)!;
          const { keys, aria } = keysOf(spec);
          return { id, label: t(toolLabel(id)), icon: ctx.toolIcon(id), keys, ariaKeys: aria, description: t(toolHint(id)) };
        }),
      })),
    }));
  const signature = (): string => `${ctx.column.join("+")}|${ctx.tools.map((spec) => `${spec.id}:${ctx.toolIcon(spec.id)}:${toolLabel(spec.id)}`).join(",")}`;

  const rail = createToolRail({
    label: t("draw.chrome.rail"),
    groups: groups(),
    active: ctx.tool,
    slotClass: "draw-tool",
    text: { more: (tool) => t("draw.chrome.rail.more", { tool }) },
    onSelect: (tool) => ctx.pickTool(tool as ToolId),
    lifetime: life,
  });
  shown = signature();
  ctx.rail = rail;
  const column = document.createElement("div");
  column.className = "draw-rail";
  column.append(rail.element);
  ctx.railColumn = column;

  const rebuild = (): void => {
    shown = signature();
    rail.setGroups(groups());
    rail.setActive(ctx.tool);
  };
  relabels.push(() => {
    rail.element.setAttribute("aria-label", t("draw.chrome.rail"));
    rebuild();
  });

  ctx.syncRail = (editable) => {
    if (signature() !== shown) rebuild();
    else rail.setActive(ctx.tool);
    rail.setDisabled(!editable);
  };
}
