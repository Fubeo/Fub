// Le view dichiarate sulla superficie `context_menu`: voci in coda al menu
// contestuale di una nota, di una cartella o di un file.
//
// # Dove viaggia il bersaglio
//
// Il contesto di sessione non ha un bersaglio del clic e non lo avrà
// (`ViewSurface::ContextMenu` in `fub-abi`): un bersaglio è vero per un istante.
// Qui viaggia con l'**invocazione**, nei `params` che `render_view` e
// `view_action` già portano per ogni istanza (§2.3). Quei `params` il kernel li
// convalida contro i `ParamSpec` che la view dichiara, e una chiave non
// dichiarata è un rifiuto: perciò la shell manda **solo** ciò che la view ha
// chiesto, per nome.
//
// - `target`: l'id di ciò su cui si è cliccato (il percorso di una nota, di una
//   cartella, di un file);
// - `target_kind`: `note`, `folder` o `file`.
//
// Una view che non dichiara né l'uno né l'altro riceve `{}` e disegna le stesse
// voci per ogni clic. Nessun campo nuovo nel contratto.
//
// # Che cosa se ne fa
//
// Il menu non è un pannello: dall'albero restituito la shell prende solo ciò
// che si può **scegliere** — `button` e `list_item` con un'azione — e ne fa
// voci, nell'ordine in cui compaiono. Il resto (testo, tabelle, campi) non ha
// posto in un menu e si ignora. I limiti sono questi, e non dipendono dalla view:
// al più `MAX_VIEWS` view, `MAX_ITEMS` voci per view, `RENDER_TIMEOUT_MS` per
// farsi disegnare. Una view che non risponde, o che sbaglia, non c'è: il menu
// compare con le voci della shell e non sa che c'era una view che mancava.
import { api } from "../host/ipc";
import type { ActionRef, UiNode, ViewSpec } from "../host/contract";
import { applyIntent } from "./intents";
import type { MenuItem } from "./menu";

export type ContextTarget = { kind: "note" | "folder" | "file"; id: string };

export const MAX_VIEWS = 4;
export const MAX_ITEMS = 8;
export const RENDER_TIMEOUT_MS = 300;

let specs: readonly ViewSpec[] = [];

/// Le view `context_menu` di questo giro: le riscrive `mountDeclaredViews`, a
/// ogni vault aperto, e le svuota lo smontaggio della finestra.
export function setContextMenuViews(next: readonly ViewSpec[]): void {
  specs = next.slice(0, MAX_VIEWS);
}

/// C'è almeno una view da interrogare? Chi apre un menu lo chiede prima, per
/// non rinviare di un istante un menu che non ha niente da aspettare.
export function hasContextMenuViews(): boolean {
  return specs.length > 0;
}

interface Choice {
  label: string;
  danger: boolean;
  action: ActionRef;
}

/// Ciò che di un albero si può scegliere, in ordine di lettura.
export function choicesOf(root: UiNode): Choice[] {
  const found: Choice[] = [];
  const walk = (node: UiNode): void => {
    if (found.length >= MAX_ITEMS) return;
    switch (node.node) {
      case "button":
        found.push({ label: node.label, danger: node.intent === "danger", action: node.action });
        return;
      case "list_item":
        if (node.action) found.push({ label: node.title, danger: false, action: node.action });
        return;
      case "stack":
      case "section":
        node.children.forEach(walk);
        return;
      case "list":
        node.items.forEach(walk);
        return;
    }
  };
  walk(root);
  return found;
}

/// I `params` di una view per questo clic: solo le chiavi che dichiara.
export function paramsFor(spec: ViewSpec, target: ContextTarget): Record<string, string> {
  const offered: Record<string, string> = { target: target.id, target_kind: target.kind };
  const params: Record<string, string> = {};
  for (const declared of spec.params) {
    const value = offered[declared.name];
    if (value !== undefined) params[declared.name] = value;
  }
  return params;
}

/// Ciò che la view disegna, o `null` se sbaglia o tarda oltre il limite. Il
/// timer si ferma appena la risposta arriva: non resta niente di pendente.
async function renderWithin(spec: ViewSpec, params: Record<string, string>): Promise<UiNode | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RENDER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([api.renderView(spec.id, undefined, params).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/// Le voci che le view contribuiscono al menu di `target`. Mai rifiuta: un
/// guasto o una risposta tardiva valgono «nessuna voce».
export async function contextMenuItems(target: ContextTarget): Promise<MenuItem[]> {
  if (specs.length === 0) return [];
  const perView = await Promise.all(
    specs.map(async (spec): Promise<MenuItem[]> => {
      const params = paramsFor(spec, target);
      const root = await renderWithin(spec, params);
      if (!root) return [];
      return choicesOf(root).map((choice, index) => ({
        label: choice.label,
        danger: choice.danger,
        separator: index === 0,
        run: () => void invoke(spec, params, choice.action),
      }));
    }),
  );
  return perView.flat();
}

async function invoke(spec: ViewSpec, params: unknown, action: ActionRef): Promise<void> {
  const update = await api.viewAction(spec.id, null, params, action.action, action.payload, []);
  // Il menu si è chiuso: un ridisegno non ha dove andare. Restano gli intenti.
  if (update.kind === "replace" || update.kind === "patch" || update.kind === "none") return;
  await applyIntent(update);
}
