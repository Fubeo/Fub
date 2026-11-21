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

/// Il bersaglio di una casella della colonna, in px: il lato di 44 px del kit
/// (`kit-rail[data-size="large"]`). È la misura di serie; quella vera si legge
/// dal DOM quando la colonna è in pagina.
export const PASSO_CASELLA = 44;

/// Quante caselle la colonna salvata può mostrare: il resto va nel cassetto.
export const CASELLE_SALVATE_MAX = 15;

/// Le misure che servono a contare le caselle che stanno, in px: il lato di
/// una casella, il filo fra due caselle di un gruppo, quello fra due gruppi, il
/// respiro di un gruppo (la metà del suo padding, sopra e sotto) e ciò che la
/// colonna occupa attorno alle sue caselle (i suoi margini e il suo padding).
export interface MisureColonna {
  readonly lato: number;
  readonly filoCasella: number;
  readonly filoGruppo: number;
  readonly respiroGruppo: number;
  readonly cornice: number;
}

/// Le misure di serie: il bersaglio del kit e nessun filo né respiro, per
/// quando la colonna non è ancora in pagina (lì la lunghezza è 0 e non conta).
export const MISURE_DI_SERIE: MisureColonna = { lato: PASSO_CASELLA, filoCasella: 0, filoGruppo: 0, respiroGruppo: 0, cornice: 0 };

/// Lo spazio che occupano le caselle dei gruppi `gruppi` (quante caselle ha
/// ogni gruppo, in ordine), in px: ogni casella il suo lato, ogni gruppo il suo
/// respiro e i suoi fili, e un filo fra un gruppo e l'altro.
export function spazioCaselle(gruppi: readonly number[], misure: MisureColonna): number {
  const pieni = gruppi.filter((n) => n > 0);
  if (pieni.length === 0) return misure.cornice;
  const dentro = pieni.reduce((somma, n) => somma + n * misure.lato + (n - 1) * misure.filoCasella + 2 * misure.respiroGruppo, 0);
  return misure.cornice + dentro + (pieni.length - 1) * misure.filoGruppo;
}

/// Le prime `k` caselle di `gruppi`, ancora divise per gruppo.
function primeCaselle(gruppi: readonly number[], k: number): number[] {
  const out: number[] = [];
  let resto = k;
  for (const n of gruppi) {
    if (resto <= 0) break;
    const preso = Math.min(n, resto);
    out.push(preso);
    resto -= preso;
  }
  return out;
}

/// Quante delle caselle `gruppi` (quante ne ha ogni gruppo, in ordine) stanno
/// in `lunghezza` px. «Tutti gli strumenti» è in fondo, in un suo gruppo da una
/// casella, e ne occupa sempre una: non si toglie. Quelle che non stanno
/// passano nel cassetto. Una lunghezza che non c'è (0: la colonna non è ancora
/// in pagina) non toglie niente.
export function caselleCheStanno(lunghezza: number, gruppi: readonly number[], misure: MisureColonna = MISURE_DI_SERIE): number {
  const quante = gruppi.reduce((somma, n) => somma + n, 0);
  if (lunghezza <= 0) return quante;
  let stanno = 0;
  for (let k = 1; k <= quante; k++) {
    if (spazioCaselle([...primeCaselle(gruppi, k), 1], misure) > lunghezza) break;
    stanno = k;
  }
  return stanno;
}

/// Le caselle del Completo con i soli strumenti che il disegno offre: uno
/// strumento del motore (`motore:…`) o sconosciuto non ha un `ToolSpec` e si
/// salta, e una casella senza strumenti non c'è. Così la colonna non cerca mai
/// uno strumento che non esiste.
export function casellePresenti(caselle: readonly (readonly string[])[], offerti: readonly ToolSpec[]): string[][] {
  const ids = new Set(offerti.map((spec) => spec.id as string));
  return caselle.map((casella) => casella.filter((id) => ids.has(id))).filter((casella) => casella.length > 0);
}

/// La casella «Tutti gli strumenti» della colonna del Completo: non è uno
/// strumento, apre il cassetto.
export const TUTTI_GLI_STRUMENTI = "all";

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
  // Uno strumento che la colonna salvata non conosce si salta; quelle oltre
  // `CASELLE_SALVATE_MAX` stanno nel cassetto, con tutti gli altri.
  const chosen = [...new Set(toolbar)].filter((id) => offered.some((spec) => spec.id === id));
  if (chosen.length > 0) {
    const scelti: ToolId[] = chosen.includes("select") ? chosen : ["select", ...chosen];
    return chosenLayout(offered, scelti.slice(0, CASELLE_SALVATE_MAX));
  }
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

/// Un valore in px dello stile calcolato (0 se non è un numero).
function px(stile: CSSStyleDeclaration, proprieta: readonly string[]): number {
  return proprieta.reduce((somma, nome) => somma + (Number.parseFloat((stile as unknown as Record<string, string>)[nome] ?? "") || 0), 0);
}

/// Lo spazio che la colonna ha per le sue caselle, e le misure vere delle
/// caselle e dei fili, lette dal DOM (K6 T8). Lo spazio è il contenitore della
/// colonna, meno il padding suo, meno ciò che gli sta accanto (il «Completo» in
/// fondo nello spazio Semplice), meno i fili fra i figli, meno la cornice della
/// colonna. Non si misura la colonna stessa: lei è alta quanto le sue caselle.
/// Un contenitore senza misura (0) dà uno spazio nullo, e nessuna casella si toglie.
export function misureColonna(colonna: HTMLElement): { lunghezza: number; misure: MisureColonna } {
  const contenitore = colonna.parentElement;
  if (contenitore === null) return { lunghezza: 0, misure: MISURE_DI_SERIE };
  const orizzontale = colonna.dataset.orientation === "horizontal";
  const lungo = (el: HTMLElement): number => (orizzontale ? el.offsetWidth : el.offsetHeight);
  const stile = getComputedStyle(colonna);
  const stileContenitore = getComputedStyle(contenitore);
  const interno = (orizzontale ? contenitore.clientWidth : contenitore.clientHeight) - px(stileContenitore, orizzontale ? ["paddingLeft", "paddingRight"] : ["paddingTop", "paddingBottom"]);
  const cornice = px(stile, orizzontale ? ["marginLeft", "marginRight", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] : ["marginTop", "marginBottom", "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]);
  const figli = [...contenitore.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.hidden && getComputedStyle(el).display !== "none");
  const altri = figli.filter((el) => el !== colonna);
  const ingombri = altri.reduce((somma, el) => {
    const s = getComputedStyle(el);
    return somma + lungo(el) + px(s, orizzontale ? ["marginLeft", "marginRight"] : ["marginTop", "marginBottom"]);
  }, 0);
  const fili = Math.max(0, figli.length - 1) * px(stileContenitore, orizzontale ? ["columnGap"] : ["rowGap"]);
  const lunghezza = interno - ingombri - fili - cornice;
  // Le misure delle caselle e dei gruppi, dal DOM quando ce ne sono; di serie
  // prima del primo disegno.
  const casella = colonna.querySelector<HTMLElement>(".kit-rail-slot");
  const gruppo = colonna.querySelector<HTMLElement>(".kit-rail-group");
  const misure: MisureColonna = {
    lato: casella !== null && lungo(casella) > 0 ? lungo(casella) : PASSO_CASELLA,
    filoCasella: gruppo !== null ? px(getComputedStyle(gruppo), orizzontale ? ["columnGap"] : ["rowGap"]) : 0,
    filoGruppo: px(stile, orizzontale ? ["columnGap"] : ["rowGap"]),
    respiroGruppo: gruppo !== null ? px(getComputedStyle(gruppo), orizzontale ? ["paddingLeft", "paddingRight"] : ["paddingTop", "paddingBottom"]) / 2 : 0,
    cornice,
  };
  return { lunghezza: Math.max(0, lunghezza), misure };
}

/// Monta la colonna: la sceglie `pickTool`, il nome e il tasto vengono dal
/// registro.
export function installRail(ctx: EditorContext): void {
  const { life, profile, relabels, toolLabel, toolHint } = ctx;
  let shown = "";

  // La colonna in pagina: lo spazio che ha dicono quante caselle stanno. Prima
  // che `createToolRail` la restituisca, non c'è (0).
  let railEl: HTMLElement | null = null;
  const misura = (): { lunghezza: number; misure: MisureColonna } => (railEl === null ? { lunghezza: 0, misure: MISURE_DI_SERIE } : misureColonna(railEl));
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
      const tutte: RailGroup[] = completo.colonna(ctx.tools).map((gruppo) => ({
        id: gruppo.id,
        slots: casellePresenti(gruppo.caselle, ctx.tools)
          .filter((tools) => tools.length > 0)
          .map((tools) => ({ id: tools[0]!, tools: tools.map(railTool) })),
      })).filter((gruppo) => gruppo.slots.length > 0);
      // Le caselle che non stanno nello spazio passano nel cassetto: lo
      // mostra il cassetto, che elenca tutti gli strumenti.
      const { lunghezza, misure } = misura();
      let posti = caselleCheStanno(lunghezza, tutte.map((gruppo) => gruppo.slots.length), misure);
      const gruppi: RailGroup[] = tutte
        .map((gruppo) => ({ ...gruppo, slots: gruppo.slots.filter(() => posti-- > 0) }))
        .filter((gruppo) => gruppo.slots.length > 0);
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
  railEl = rail.element;
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
  // Quando lo spazio della colonna cambia, si ricontano le caselle che stanno.
  // Si osserva il contenitore, non la colonna: la colonna è alta quanto le sue
  // caselle, e osservarla farebbe ricontare sé stessa.
  if (typeof ResizeObserver !== "undefined") {
    let stanno = -1;
    const osservatore = new ResizeObserver(() => {
      const quante = groups().reduce((n, gruppo) => n + gruppo.slots.length, 0);
      if (quante === stanno) return;
      stanno = quante;
      rebuild();
    });
    osservatore.observe(column);
    life.add(() => osservatore.disconnect());
  }

  ctx.syncRail = (editable) => {
    if (signature() !== shown) rebuild();
    else rail.setActive(ctx.tool);
    rail.setDisabled(!editable);
  };
}
