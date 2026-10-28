// Lo spazio di lavoro (G2) e la colonna personalizzata (G3). «Completo» ha
// tutto; «Semplice» offre le parti per disegnare a mano o col dito, con
// pulsanti grandi, e «Completo» resta a un clic, nel menu ≡ e in fondo alla
// colonna. «Personalizza la barra…» sceglie quali strumenti stanno nella
// colonna e in che ordine: quelli tolti restano nei tasti e nella ricerca
// dei comandi. Chi monta l'editor ricorda le scelte (`onWorkspace`,
// `onToolbar`); l'editor le applica subito.

import { textButton } from "../../../../../kit";
import type { MenuItem } from "../../../../../ui/menu";
import { t } from "../../../strings";
import { workspaceLevel, type ToolId, type Workspace } from "../../registry";
import { openToolbarDialog } from "../../toolbar-dialog";
import type { EditorContext } from "../context";
import { railLayout } from "./rail";

/// Fino a questa larghezza della finestra, in px, la colonna sta sotto il
/// foglio; e così in un riquadro largo fino a `NARROW_PANE`, anche in una
/// finestra larga. Un riquadro di 670 px fra le note e l'ispettore di una
/// finestra di 1280 tiene la colonna a sinistra.
const NARROW_WIDTH = 700;
const NARROW_PANE = 480;

export interface WorkspaceContext {
  workspace: Workspace;
  /// Vero se lo spazio, e non un livello, sceglie che cosa si offre.
  byWorkspace: boolean;
  /// Gli strumenti della colonna, in ordine; vuoto, quelli di serie.
  column: readonly ToolId[];
  /// Un altro spazio, dal vivo; con `toolbar`, anche la colonna.
  setWorkspace: (next: Workspace, toolbar?: readonly ToolId[]) => void;
  /// Le voci «Spazio di lavoro» e «Personalizza la barra…» del menu ≡.
  workspaceItems: () => MenuItem[];
  /// Apre «Personalizza la barra…».
  customizeToolbar: () => void;
}

/// L'ordine di serie della colonna con gli strumenti `offered`.
export function defaultColumn(ctx: EditorContext): ToolId[] {
  return railLayout(ctx.tools, ctx.profile).flat(2);
}

/// La colonna di `toolbar` fra gli strumenti offerti: quelli che non ci sono
/// più non contano, e senza nessuno resta quella di serie; la Selezione c'è
/// sempre, come nella colonna.
export function columnOf(ctx: EditorContext, toolbar: readonly ToolId[]): ToolId[] {
  return railLayout(ctx.tools, ctx.profile, toolbar).flat(2);
}

export function installWorkspace(ctx: EditorContext): void {
  const { options } = ctx;
  ctx.root.dataset.workspace = ctx.workspace;
  // Nel Semplice le caselle sono bersagli da 44 px, anche col mouse.
  ctx.rail.element.dataset.size = ctx.workspace === "simple" ? "large" : "normal";

  // Su uno schermo stretto, o in un riquadro molto stretto, la colonna va
  // sotto il foglio e scorre di lato.
  if (typeof ResizeObserver !== "undefined") {
    const narrowObserver = new ResizeObserver(() => {
      const width = ctx.root.clientWidth;
      if (width === 0) return;
      const narrow = width <= NARROW_PANE || window.innerWidth <= NARROW_WIDTH;
      if (narrow === (ctx.root.dataset.narrow !== undefined)) return;
      ctx.root.toggleAttribute("data-narrow", narrow);
      ctx.rail.setOrientation(narrow ? "horizontal" : "vertical");
    });
    narrowObserver.observe(ctx.root);
    ctx.life.add(() => narrowObserver.disconnect());
  }

  // «Completo» in fondo alla colonna, nello spazio Semplice.
  const full = textButton({ label: t("draw.workspace.full"), onPress: () => choose("full"), lifetime: ctx.life });
  full.classList.add("draw-rail-full");
  full.hidden = ctx.workspace !== "simple";
  ctx.railColumn.append(full);
  ctx.relabels.push(() => {
    full.textContent = t("draw.workspace.full");
    full.title = t("draw.workspace.full.hint");
  });

  ctx.setWorkspace = (next, toolbar) => {
    if (ctx.disposed) return;
    const changed = next !== ctx.workspace || !ctx.byWorkspace;
    ctx.workspace = next;
    ctx.byWorkspace = true;
    if (toolbar !== undefined) ctx.column = toolbar;
    ctx.root.dataset.workspace = next;
    ctx.rail.element.dataset.size = next === "simple" ? "large" : "normal";
    full.hidden = next !== "simple";
    // Il livello con cui l'editor offre lo spazio: se è lo stesso, la colonna
    // si rifà per la sua firma.
    const { level, custom } = workspaceLevel(next, ctx.profile);
    if (changed || level !== ctx.level) ctx.setLevel(level, custom);
    ctx.syncRail(ctx.editable());
    ctx.syncPenOptions();
  };

  /// Lo spazio scelto da chi disegna: si applica, si dice e si ricorda.
  const choose = (next: Workspace): void => {
    if (next === ctx.workspace) return;
    ctx.setWorkspace(next);
    ctx.announce(t("draw.workspace.on", { name: t(next === "full" ? "draw.workspace.full" : "draw.workspace.simple") }));
    options.onWorkspace?.(next);
  };

  ctx.workspaceItems = () => [
    {
      label: t("draw.workspace"),
      separator: true,
      submenu: true,
      items: (["full", "simple"] as const).map(
        (each): MenuItem => ({
          label: t(each === "full" ? "draw.workspace.full" : "draw.workspace.simple"),
          description: t(each === "full" ? "draw.workspace.full.hint" : "draw.workspace.simple.hint"),
          choice: "radio",
          checked: ctx.workspace === each,
          run: () => choose(each),
        }),
      ),
    },
    { label: t("draw.toolbar.customize"), run: () => ctx.customizeToolbar() },
  ];

  ctx.customizeToolbar = () => {
    if (ctx.asking || ctx.disposed) return;
    ctx.asking = true;
    ctx.cancelGesture();
    const before = ctx.column;
    const standard = defaultColumn(ctx);
    /// La colonna come si salva: vuota se è quella di serie.
    const saved = (on: readonly string[]): ToolId[] =>
      on.length === standard.length && on.every((id, at) => id === standard[at]) ? [] : (on as ToolId[]);
    const shown = columnOf(ctx, before);
    const name = (id: ToolId): string => t(ctx.toolLabel(id));
    void openToolbarDialog({
      rows: [...shown.map((id) => ({ id, name: name(id), on: true })), ...standard.filter((id) => !shown.includes(id)).map((id) => ({ id, name: name(id), on: false }))],
      standard,
      fixed: "select",
      // L'anteprima: la colonna vera cambia mentre si sceglie.
      preview: (on) => {
        if (ctx.disposed) return;
        ctx.column = saved(on);
        ctx.syncRail(ctx.editable());
      },
      announce: ctx.announce,
      lifetime: ctx.life,
    }).then((chosen) => {
      ctx.asking = false;
      if (ctx.disposed) return;
      ctx.column = chosen === null ? before : saved(chosen);
      ctx.syncRail(ctx.editable());
      if (chosen === null) return;
      ctx.announce(t("draw.toolbar.saved"));
      options.onToolbar?.(ctx.column);
    });
  };
}
