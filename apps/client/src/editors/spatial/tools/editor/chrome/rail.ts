// La colonna degli strumenti del disegno (B3): gli strumenti del registro,
// in gruppi e caselle come nei programmi di grafica, sulla colonna del kit
// (`kit/tool-rail.ts`). Una casella con più strumenti ha la tendina e mostra
// l'ultimo scelto; gli strumenti che il livello non offre non ci sono.
//
// La forma delle caselle è una regola pura, `railGroups`: dagli strumenti
// offerti ai gruppi, per profilo.

import { createToolRail, type RailGroup, type RailTool, type ToolRail } from "../../../../../kit/tool-rail";
import { t, type DrawKey } from "../../../strings";
import { toolKeyText, type ToolId, type ToolProfile, type ToolSpec } from "../../registry";
import type { EditorContext } from "../context";
import type { StrumentoCassetto } from "./drawer";

/// La casella «Tutti gli strumenti» della colonna del Completo: non è uno
/// strumento, apre il cassetto.
export const TUTTI_GLI_STRUMENTI = "fub:tutti";

/// La colonna del Disegno completo, come la porta `completo/` quando è aperto
/// e acceso (K6 T8). Le sue caselle sono strumenti per id, nel loro gruppo; il
/// cassetto riceve gli strumenti da mostrare e chi li sceglie.
export interface CompletoColonna {
  colonna(offerti: readonly ToolSpec[]): readonly { readonly id: string; readonly caselle: readonly (readonly string[])[] }[];
  cassetto(
    anchor: HTMLElement,
    opzioni: { readonly strumenti: readonly StrumentoCassetto[]; readonly corrente: string | null; readonly scegli: (id: string) => void; readonly modifica: () => void },
  ): void;
}

/// Le caselle, per gruppo: ogni casella elenca i suoi strumenti, il primo è
/// quello che mostra finché non se ne sceglie un altro.
type Layout = readonly (readonly (readonly ToolId[])[])[];

const VECTOR: Layout = [
  [["select"], ["hand", "zoom"]],
  [["pen", "highlighter"], ["eraser"]],
  [["rect", "ellipse", "line", "arrow"], ["text"]],
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
  /// La colonna del Completo, se è aperto e acceso e la colonna è quella di
  /// serie (K6 T8); `null` o assente altrimenti.
  completo?: () => CompletoColonna | null;
}

/// Monta la colonna: la sceglie `pickTool`, il nome e il tasto vengono dal
/// registro.
export function installRail(ctx: EditorContext): void {
  const { life, profile, relabels, toolLabel, toolHint } = ctx;
  let shown = "";

  const railTool = (id: string): RailTool => {
    const spec = ctx.tools.find((each) => each.id === id)!;
    const { keys, aria } = keysOf(spec);
    return { id, label: t(toolLabel(id as ToolId)), icon: ctx.toolIcon(id as ToolId), keys, ariaKeys: aria, description: t(toolHint(id as ToolId)) };
  };
  /// Il cassetto di «Tutti gli strumenti»: ogni strumento col suo gruppo e il
  /// suo tasto, e la modifica della colonna di chi lo apre.
  const openDrawer = (completo: CompletoColonna): void => {
    const anchor = rail.element.querySelector<HTMLElement>(`[data-slot="${TUTTI_GLI_STRUMENTI}"]`) ?? rail.element;
    completo.cassetto(anchor, {
      strumenti: ctx.tools.map((spec) => ({ id: spec.id, label: toolLabel(spec.id) as DrawKey, icon: spec.icon, keys: keysOf(spec).keys, famiglia: spec.group })),
      corrente: ctx.tool,
      scegli: (id) => ctx.pickTool(id as ToolId),
      modifica: () => ctx.customizeToolbar(),
    });
  };
  const groups = (): RailGroup[] => {
    const completo = ctx.completo?.() ?? null;
    // La colonna del Completo, se la colonna è quella di serie; con una
    // colonna scelta da chi usa, quella vince.
    if (completo !== null && ctx.column.length === 0) {
      const gruppi: RailGroup[] = completo.colonna(ctx.tools).map((gruppo) => ({
        id: gruppo.id,
        slots: gruppo.caselle.map((tools) => ({ id: tools[0]!, tools: tools.map(railTool) })),
      }));
      const tutti: RailTool = { id: TUTTI_GLI_STRUMENTI, label: t("draw.chrome.column.all"), icon: "draw-all-tools", description: t("draw.chrome.column.all") };
      gruppi.push({ id: "all", slots: [{ id: TUTTI_GLI_STRUMENTI, tools: [tutti] }] });
      return gruppi;
    }
    return railLayout(ctx.tools, profile, ctx.column).map((slots, at) => ({
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
  };
  const signature = (): string => `${ctx.column.join("+")}|${ctx.completo?.() ? "completo" : "base"}|${ctx.tools.map((spec) => `${spec.id}:${ctx.toolIcon(spec.id)}:${toolLabel(spec.id)}`).join(",")}`;

  const rail = createToolRail({
    label: t("draw.chrome.rail"),
    groups: groups(),
    active: ctx.tool,
    slotClass: "draw-tool",
    text: { more: (tool) => t("draw.chrome.rail.more", { tool }) },
    onSelect: (tool) => {
      if (tool === TUTTI_GLI_STRUMENTI) {
        const completo = ctx.completo?.() ?? null;
        if (completo !== null) openDrawer(completo);
        return;
      }
      ctx.pickTool(tool as ToolId);
    },
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
