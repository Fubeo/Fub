// Lo spazio di lavoro (G2) e la colonna personalizzata (G3). «Completo» ha
// tutto; «Semplice» offre le parti per disegnare a mano o col dito, con
// pulsanti grandi, e «Completo» resta a un clic, nel menu ≡ e in fondo alla
// colonna. «Personalizza la barra…» sceglie quali strumenti stanno nella
// colonna e in che ordine: quelli tolti restano nei tasti e nella ricerca
// dei comandi. Chi monta l'editor ricorda le scelte (`onWorkspace`,
// `onToolbar`); l'editor le applica subito.

import { textButton } from "../../../../../kit";
import { settings } from "../../../../../host/query";
import { components, onComponents } from "../../../../../state/components";
import type { MenuItem } from "../../../../../ui/menu";
import { t } from "../../../strings";
import type { ToolId, Workspace } from "../../registry";
import { openToolbarDialog } from "../../toolbar-dialog";
import type { EditorContext } from "../context";
import type { Sezioni } from "../../../completo/sezioni";
import { railLayout } from "./rail";

/// Fino a questa larghezza della finestra, in px, la colonna sta sotto il
/// foglio; e così in un riquadro largo fino a `NARROW_PANE`, anche in una
/// finestra larga. Un riquadro di 670 px fra le note e l'ispettore di una
/// finestra di 1280 tiene la colonna a sinistra.
const NARROW_WIDTH = 700;
const NARROW_PANE = 480;

/// Il componente del Disegno completo (`crates/fub-components`).
export const DISEGNO_COMPLETO = "fub.disegno-completo";

/// L'impostazione dello spazio di lavoro nel bundle del disegno: le stesse di
/// `preferences.ts` (`WORKSPACE_KEY`), che sta nel chunk della superficie e
/// da qui non si importa.
const DRAW_BUNDLE = "fub.draw";
const WORKSPACE_KEY = "draw.workspace";

/// Lo spazio che il vault ha scelto, letto adesso: `null` se è quello di
/// serie, o se la lettura non riesce.
async function spazioDelVault(): Promise<Workspace | null> {
  try {
    const entry = (await settings(DRAW_BUNDLE)).find((one) => one.spec.key === WORKSPACE_KEY);
    if (entry === undefined || entry.source === "default") return null;
    return entry.value === "simple" || entry.value === "full" ? entry.value : null;
  } catch {
    return null;
  }
}

export interface WorkspaceContext {
  workspace: Workspace;
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
  // In una scheda (T46) gli strumenti sono sempre una fila sopra il foglio:
  // la scheda è larga quanto la colonna del testo, e una colonna di lato le
  // ruberebbe il disegno.
  const compact = options.compact === true;
  // Nel Semplice le caselle sono bersagli da 44 px, anche col mouse; non in
  // una scheda, dove la fila deve stare accanto alla barra.
  const sizeOf = (workspace: Workspace): string => (workspace === "simple" && !compact ? "large" : "normal");
  ctx.rail.element.dataset.size = sizeOf(ctx.workspace);
  if (compact) {
    ctx.root.dataset.compact = "";
    ctx.rail.setOrientation("horizontal");
  }

  // Su uno schermo stretto, o in un riquadro molto stretto, la colonna va
  // sotto il foglio e scorre di lato.
  if (!compact && typeof ResizeObserver !== "undefined") {
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

  // «Completo» in fondo alla colonna, nello spazio Semplice. Non in una
  // scheda: lì il resto si trova aprendo il disegno.
  const full = textButton({ label: t("draw.workspace.full"), onPress: () => choose("full"), lifetime: ctx.life });
  full.classList.add("draw-rail-full");
  const fullHidden = (workspace: Workspace): boolean => compact || workspace !== "simple";
  full.hidden = fullHidden(ctx.workspace);
  ctx.railColumn.append(full);
  ctx.relabels.push(() => {
    full.textContent = t("draw.workspace.full");
    full.title = t("draw.workspace.full.hint");
  });

  // Il Disegno completo (K6): col componente acceso, entrare nel Completo
  // porta il suo ingresso con un `import()`, una volta per disegno aperto. Il
  // Semplice, una scheda e il componente spento non lo chiedono mai.
  //
  // Prima dell'`import()` si legge la scelta del vault: il primo disegno
  // della sessione nasce nel Completo finché la superficie non ha letto
  // l'impostazione (`preferences.ts`, il Completo è la scelta di serie), e
  // senza questa lettura un vault nel Semplice porterebbe il Completo a ogni
  // avvio. Una lettura che non riesce non ferma niente: decide lo spazio
  // dell'editor.
  let completo: "no" | "verifica" | "in-arrivo" | "aperto" = "no";
  // Le sezioni del Completo aperto (T10): la scheda Risorse le legge di qui.
  let sezioniAperte: Sezioni | null = null;
  const vuoleCompleto = (): boolean =>
    !compact && !ctx.disposed && ctx.workspace === "full" && components()?.on(DISEGNO_COMPLETO) === true;
  // La scheda Risorse c'è solo col Completo aperto, col componente acceso e
  // nello spazio «Completo»: spento o nel Semplice, il pannello si toglie.
  const mostraRisorse = (): void => {
    if (completo !== "aperto" || sezioniAperte === null) return;
    const attivo = !ctx.disposed && ctx.workspace === "full" && components()?.on(DISEGNO_COMPLETO) === true;
    ctx.collegaCompleto(attivo ? sezioniAperte : null, attivo ? (options.motore ?? null) : null);
  };
  const portaCompleto = (): void => {
    if (completo !== "no" || !vuoleCompleto()) return;
    completo = "verifica";
    void spazioDelVault().then((scelto) => {
      if (ctx.disposed) return;
      if (scelto === "simple" || !vuoleCompleto()) {
        // La superficie porterà l'editor nel Semplice; il prossimo ingresso
        // nel Completo ci riprova.
        completo = "no";
        return;
      }
      completo = "in-arrivo";
      import("../../../completo").then(
        ({ apri }) => {
          if (ctx.disposed) return;
          const aperto = apri({ motore: options.motore ?? null, life: ctx.life });
          sezioniAperte = aperto.sezioni;
          completo = "aperto";
          mostraRisorse();
        },
        // Un chunk che non arriva: il Completo di K5 resta, e il prossimo
        // ingresso ci riprova.
        () => {
          completo = "no";
        },
      );
    });
  };
  ctx.life.add(onComponents(() => {
    portaCompleto();
    mostraRisorse();
  }));

  ctx.setWorkspace = (next, toolbar) => {
    if (ctx.disposed) return;
    ctx.workspace = next;
    if (toolbar !== undefined) ctx.column = toolbar;
    ctx.root.dataset.workspace = next;
    ctx.rail.element.dataset.size = sizeOf(next);
    full.hidden = fullHidden(next);
    ctx.offer(ctx.featuresOf(next));
    ctx.syncRail(ctx.editable());
    ctx.syncPenOptions();
    portaCompleto();
    mostraRisorse();
  };
  portaCompleto();

  /// Lo spazio scelto da chi disegna: si applica, si dice e si ricorda.
  const choose = (next: Workspace): void => {
    if (next === ctx.workspace) return;
    ctx.setWorkspace(next);
    ctx.announce(t("draw.workspace.on", { name: t(next === "full" ? "draw.workspace.full" : "draw.workspace.simple") }));
    options.onWorkspace?.(next);
  };

  // In una scheda lo spazio e la colonna restano quelli dati: si cambiano
  // nel disegno aperto, dove valgono per tutti i disegni.
  ctx.workspaceItems = () => compact ? [] : [
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
