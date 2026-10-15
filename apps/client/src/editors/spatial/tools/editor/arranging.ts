// L'editor del disegno: i comandi per disporre. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { identifier } from "../../../../ui/a11y";
import { displayBinding } from "../../../../ui/commands";
import { showContextMenu, type MenuItem } from "../../../../ui/menu";
import { linkName } from "../../describe";
import type { Bounds } from "../../scene/geometry";
import type { Repeat } from "../../scene/repeat";
import type { Op } from "../../scene/ops";
import { plural, t, type DrawKey } from "../../strings";
import { gesture as asGesture, roundDelta } from "../edit";
import {
  alignOps,
  distributeOps,
  duplicateOps,
  groupOps,
  holdsLinks,
  isGroup,
  isLink,
  linkOps,
  linkTarget,
  nodeOf,
  orderOps,
  relinkOps,
  ungroupOps,
  unlinkOps,
  unwrappable,
  type Arranged,
  type Axis,
  type Edge,
  type Order,
} from "../arrange";
import { expandCopiesIn, expandOps, expandTargets, repeatOps, repeatTarget, type RepeatKind } from "../repeat-ops";
import { detachOps, isInstance, symbolOps } from "../symbols";
import { wholeSteps } from "../grid";
import type { Unit } from "../hit";
import type { Feature } from "../registry";
import { keepLook, refused, type Refusal as Unkept } from "../styled";
import { releasable } from "../masks";
import { AXES, COPY_STEP_PX, EDGES, ORDERS } from "./constants";
import type { EditorContext } from "./context";
import { translated } from "./helpers";

/// Come un comando che sposta gli elementi senza cambiarli tiene lo stile
/// che si vede (vedi `styled.ts`).
interface Styled {
  /// La frase del comando quando non si fa, col perché in `{reason}`.
  readonly key: DrawKey;
  /// Le altre parole della frase.
  readonly vars?: Readonly<Record<string, string>>;
  /// `take` se chi cambia contenitore ne prende l'opacità e la visibilità;
  /// se no tutto resta come si vedeva.
  readonly containers?: "keep" | "take";
  /// Gli effetti che il comando dà o toglie di proposito ai contenitori che
  /// aggiunge o toglie: `clip-path` e `mask` per le maschere.
  readonly effects?: readonly string[];
}

/// Che cosa si annuncia dopo un cambio d'ordine.
const ORDERED: Readonly<Record<Order, DrawKey>> = {
  front: "draw.ordered.front",
  forward: "draw.ordered.forward",
  backward: "draw.ordered.backward",
  back: "draw.ordered.back",
};

/// Ciò che i comandi per disporre dà agli altri pezzi dell'editor.
export interface ArrangingContext {
  arranging: (feature: Feature, settle?: boolean) => Unit[] | null;
  keptLook: (arranged: Arranged, styled: Styled) => (Arranged & { readonly kept: string }) | null;
  arrange: (label: DrawKey, arranged: Arranged, extent?: Bounds | null, styled?: Styled | null) => string | null;
  duplicateSelection: () => void;
  orderSelection: (order: Order) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  symbolFromSelection: () => void;
  detachSelection: () => void;
  repeatSelection: (kind: RepeatKind) => void;
  expandSelection: () => void;
  linkSelection: () => Promise<void>;
  unlinkSelection: () => void;
  openSelectedLink: () => boolean;
  alignReference: (units: readonly Unit[]) => Bounds | null;
  alignSelection: (edge: Edge) => void;
  drawn: (units: readonly Unit[]) => number;
  distributeSelection: (axis: Axis) => void;
  openMenu: (trigger: HTMLButtonElement, items: MenuItem[]) => void;
  orderItems: () => MenuItem[];
  alignItems: () => MenuItem[];
}

/// Monta i comandi per disporre.
export function installArranging(ctx: EditorContext): void {
  const {
    has, editable, currentIndex, currentPage, grownPage, newIds, announce, objects, stepNow, selectedUnits, chosenCount, openLink, originalUnits, commit,
    withLabels, select, cancelGesture, gridOn, boundsOf, options
  } = ctx;
  // --- Disporre ----------------------------------------------------------------

  /// Gli oggetti su cui lavora un comando della selezione, della parte
  /// `feature`: quelli scelti, se il livello offre la parte e il disegno si
  /// scrive. `null`, e lo si dice, se non c'è niente di scelto. Un ritaglio
  /// aperto si applica prima, e il comando lavora sull'immagine ritagliata:
  /// salvo con `settle` falso, per chi il ritaglio lo apre.
  const arranging = (feature: Feature, settle = true): Unit[] | null => {
    if (!has(feature) || !editable()) return null;
    if (settle) ctx.settleCrop();
    const units = selectedUnits();
    if (units.length === 0) {
      announce(t("draw.selected.none"));
      return null;
    }
    cancelGesture();
    return units;
  };
  ctx.arranging = arranging;

  /// Le parole di `refusal`, il perché di un comando che non si fa.
  const unkeptText = (refusal: Unkept): string => {
    switch (refusal.kind) {
      case "selector":
        return t("draw.styled.selector", { selector: refusal.text });
      case "condition":
        return t("draw.styled.condition", { rule: refusal.text });
      case "lost":
        return t("draw.styled.lost", { property: refusal.property });
      case "new":
        return t("draw.styled.new", { property: refusal.property });
      case "object":
        return t("draw.styled.object", { property: refusal.property });
      case "copy":
        return t("draw.styled.copy");
      case "import":
        return t("draw.styled.import");
      case "unknown":
        return t("draw.styled.unknown");
    }
  };

  /// `arranged`, un comando che sposta gli elementi senza cambiarli, con lo
  /// stile che serve perché si vedano com'erano (vedi `styled.ts`), e la
  /// frase che dice su quanti elementi lo si è scritto, con lo spazio
  /// davanti; `null` se non si può, e lo si dice con la frase `styled.key`.
  const keptLook = (arranged: Arranged, styled: Styled): (Arranged & { readonly kept: string }) | null => {
    const model = ctx.engine.model;
    if (arranged.ops.length === 0 || model === null) return { ...arranged, kept: "" };
    const result = keepLook(ctx.engine.text, model, arranged.ops, {
      containers: styled.containers ?? "keep",
      taken: (id) => ctx.engine.holder(id) !== null,
      ...(styled.effects === undefined ? {} : { effects: styled.effects }),
    });
    if (refused(result)) {
      announce(t(styled.key, { ...styled.vars, reason: unkeptText(result) }));
      return null;
    }
    // Un oggetto scelto che riceve un id per lo stile lo tiene come chiave.
    const named = new Map<string, string>();
    for (const op of result.ops.slice(arranged.ops.length)) if (op.op === "ident" && op.id !== null) named.set(`@${op.path.join(".")}`, op.id);
    const kept = result.written === 0 ? "" : ` ${plural(result.written, "draw.styled.kept.one", "draw.styled.kept.other")}`;
    return { ops: result.ops, keys: arranged.keys.map((key) => named.get(key) ?? key), kept };
  };
  ctx.keptLook = keptLook;

  /// Scrive `arranged` col nome `label`, e la selezione diventa la sua; la
  /// pagina cresce se `extent` ne esce. `null` se non c'era niente da
  /// cambiare, e lo si dice, o se il motore ha rifiutato; se no la frase da
  /// aggiungere a ciò che si dice, vuota o con lo spazio davanti. Con
  /// `styled`, un comando che sposta gli elementi senza cambiarli: lo stile
  /// resta com'era, o il comando non si fa e lo si dice (vedi
  /// [`keptLook`]).
  const arrange = (label: DrawKey, arranged: Arranged, extent: Bounds | null = null, styled: Styled | null = null): string | null => {
    if (arranged.ops.length === 0) {
      announce(t("draw.unchanged"));
      return null;
    }
    let kept = "";
    if (styled !== null) {
      const looked = keptLook(arranged, styled);
      if (looked === null) return null;
      arranged = looked;
      kept = looked.kept;
    }
    const ops: Op[] = [...arranged.ops];
    const page = grownPage(extent);
    if (page !== null) ops.push({ op: "page", viewBox: page });
    // La selezione è già quella di dopo quando l'editor si rinfresca: la
    // barra non sparisce per un istante, e il fuoco che ci sta resta.
    const before = ctx.selection;
    ctx.selection = [...arranged.keys];
    if (commit(label, asGesture(ops)) === null) {
      select(before);
      return null;
    }
    select(arranged.keys);
    return kept;
  };
  ctx.arrange = arrange;

  /// Copia gli oggetti scelti un passo più in basso a destra, sopra gli
  /// originali; la selezione passa alle copie, così un secondo Ctrl+D
  /// prosegue la fila.
  function duplicateSelection(): void {
    const units = arranging("arrange");
    if (units === null) return;
    // Con l'aggancio le copie si scostano di passi interi della griglia, e
    // ciò che ci stava sopra ci resta.
    const distance = COPY_STEP_PX / ctx.camera.scale;
    const step = gridOn() ? wholeSteps(distance, stepNow()) : roundDelta(distance);
    const copied = withLabels(units);
    const arranged = duplicateOps(ctx.engine.model!, copied, step, step, newIds());
    if (arranged === null) {
      announce(t("draw.duplicate.foreign"));
      return;
    }
    if (arrange("draw.action.duplicate", arranged, translated(boundsOf(copied), step, step)) === null) return;
    announce(`${plural(units.length, "draw.duplicated.one", "draw.duplicated.other")} ${objects()}`);
  }
  ctx.duplicateSelection = duplicateSelection;

  function orderSelection(order: Order): void {
    const units = arranging("arrange");
    if (units === null) return;
    const kept = arrange("draw.action.order", orderOps(ctx.engine.model!, currentIndex(), units, order, newIds()), null, { key: "draw.order.styled" });
    if (kept !== null) announce(`${t(ORDERED[order])}${kept}`);
  }
  ctx.orderSelection = orderSelection;

  function groupSelection(): void {
    const units = arranging("arrange");
    if (units === null) return;
    if (units.length < 2) {
      announce(t("draw.group.few"));
      return;
    }
    const arranged = groupOps(ctx.engine.model!, units, newIds());
    if (arranged === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      return;
    }
    const kept = arrange("draw.action.group", arranged, null, { key: "draw.group.styled" });
    if (kept !== null) announce(`${t("draw.grouped", { count: units.length })}${kept}`);
  }
  ctx.groupSelection = groupSelection;

  function ungroupSelection(): void {
    const units = arranging("arrange");
    if (units === null) return;
    const all = units.filter(isGroup);
    if (all.length === 0) {
      announce(t("draw.ungroup.none"));
      return;
    }
    const groups = all.filter((unit) => unwrappable(ctx.engine.model!, unit)).length;
    if (groups === 0) {
      // Un gruppo che non si separa per la sua maschera si rilascia.
      const masked = has("masks") && all.some((unit) => releasable(ctx.engine.model!, unit));
      announce(masked ? `${t("draw.ungroup.effect")} ${t("draw.ungroup.release")}` : t("draw.ungroup.effect"));
      return;
    }
    const kept = arrange("draw.action.ungroup", ungroupOps(ctx.engine.model!, units, newIds(), expandCopiesIn), null, { key: "draw.ungroup.styled" });
    const whole = groups < all.length ? ` ${t("draw.ungroup.effect_some")}` : "";
    if (kept !== null) announce(`${plural(groups, "draw.ungrouped.one", "draw.ungrouped.other")}${whole}${kept}`);
  }
  ctx.ungroupSelection = ungroupSelection;

  /// «Crea simbolo»: gli oggetti scelti, con le etichette dei loro
  /// connettori, diventano il contenuto di un simbolo nuovo, e al loro posto
  /// resta una sua istanza, che diventa la selezione.
  function symbolFromSelection(): void {
    const units = arranging("symbols");
    if (units === null) return;
    const made = symbolOps(ctx.engine.model!, withLabels(units), t("draw.symbol.base"), newIds());
    if (typeof made === "string") {
      announce(t(`draw.symbol.refused.${made}`));
      return;
    }
    const kept = arrange("draw.action.symbol_make", made, null, { key: "draw.symbol.styled" });
    if (kept !== null) announce(`${t("draw.symbol.made", { name: made.name })}${kept}`);
  }
  ctx.symbolFromSelection = symbolFromSelection;

  /// «Scollega dal simbolo»: ogni istanza scelta diventa un gruppo con una
  /// copia del contenuto del suo simbolo, e il resto della selezione resta.
  function detachSelection(): void {
    const units = arranging("symbols");
    if (units === null) return;
    const count = units.filter(isInstance).length;
    if (count === 0) {
      announce(t("draw.symbol.detach.none"));
      return;
    }
    const detached = detachOps(ctx.engine.model!, units, newIds());
    if (detached === "content") {
      announce(t("draw.symbol.detach.content"));
      return;
    }
    if (arrange("draw.action.symbol_detach", detached) !== null) announce(plural(count, "draw.symbol.detached.one", "draw.symbol.detached.other"));
  }
  ctx.detachSelection = detachSelection;

  /// La frase di una ripetizione fatta o cambiata in `repeat`.
  const repeatText = (repeat: Repeat): string => {
    switch (repeat.kind) {
      case "radial":
        return t("draw.repeat.made.radial", { count: repeat.count });
      case "grid":
        return t("draw.repeat.made.grid", { columns: repeat.columns, rows: repeat.rows });
      case "mirror":
        return t("draw.repeat.made.mirror");
    }
  };

  /// «Ripetizione radiale», «a griglia» o «a specchio»: l'oggetto scelto,
  /// o gli oggetti scelti messi prima in un gruppo, diventano l'originale di
  /// una ripetizione nuova, che diventa la selezione. Una ripetizione
  /// scelta, o i suoi originali, cambiano tipo e ricominciano coi valori di
  /// partenza; il tipo che hanno già non cambia niente.
  function repeatSelection(kind: RepeatKind): void {
    const units = arranging("repeat");
    if (units === null) return;
    const target = repeatTarget(units);
    if (target?.details?.repeat?.kind === kind) {
      announce(t("draw.unchanged"));
      return;
    }
    const made = repeatOps(ctx.engine.model!, withLabels(units), kind, newIds(), originalUnits);
    if (typeof made === "string") {
      announce(t(`draw.repeat.refused.${made}`));
      return;
    }
    const kept = arrange(target === null ? "draw.action.repeat" : "draw.action.repeat_change", made, null, { key: "draw.repeat.styled" });
    if (kept !== null) announce(`${repeatText(made.repeat)}${kept}`);
  }
  ctx.repeatSelection = repeatSelection;

  /// «Espandi la ripetizione»: ogni copia delle ripetizioni scelte, o di
  /// quella degli originali scelti, diventa una copia vera del suo
  /// originale, e la ripetizione un gruppo; la selezione resta.
  function expandSelection(): void {
    const units = arranging("repeat");
    if (units === null) return;
    const count = expandTargets(units).length;
    const expanded = expandOps(ctx.engine.model!, units, newIds());
    if (typeof expanded === "string") {
      announce(t(`draw.repeat.expand.${expanded}`));
      return;
    }
    if (arrange("draw.action.repeat_expand", expanded) !== null) announce(plural(count, "draw.repeat.expanded.one", "draw.repeat.expanded.other"));
  }
  ctx.expandSelection = expandSelection;

  /// Il collegamento scelto da solo, se c'è.
  const lonelyLink = (units: readonly Unit[]): Unit | null => (units.length === 1 && isLink(units[0]!) ? units[0]! : null);

  /// Ctrl+K, o «Collega a una nota…»: collega gli oggetti scelti a una nota
  /// che sceglie chi monta l'editor, o porta a un'altra nota il collegamento
  /// scelto da solo. Il collegamento nuovo è un passo di annulla, e la
  /// selezione passa a lui.
  async function linkSelection(): Promise<void> {
    const links = options.links;
    if (links === undefined || ctx.asking) return;
    const units = arranging("links");
    if (units === null) return;
    const single = lonelyLink(units);
    if (single === null && holdsLinks(ctx.engine.model!, units)) {
      announce(t("draw.link.nested"));
      return;
    }
    const current = single === null ? null : linkTarget(nodeOf(ctx.engine.model!, single));
    const opened = ctx.loads;
    ctx.asking = true;
    let href: string | null;
    try {
      href = await links.choose(current);
    } catch {
      // Chi sceglie dice da sé perché non ha potuto.
      href = null;
    } finally {
      ctx.asking = false;
    }
    if (href === null || ctx.disposed || ctx.loads !== opened) return;
    // Mentre si sceglieva il disegno può essere cambiato: valgono gli oggetti
    // scelti adesso.
    const now = arranging("links");
    if (now === null) return;
    const again = lonelyLink(now);
    if (again !== null) {
      if (arrange("draw.action.relink", relinkOps(ctx.engine.model!, again, href, newIds())) !== null) announce(t("draw.relinked", { note: linkName(href) }));
      return;
    }
    const arranged = linkOps(ctx.engine.model!, now, href, newIds());
    if (arranged === "nested") {
      announce(t("draw.link.nested"));
      return;
    }
    if (arranged === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      return;
    }
    const kept = arrange("draw.action.link", arranged, null, { key: "draw.link.styled" });
    if (kept !== null) announce(`${t("draw.linked", { note: linkName(href) })}${kept}`);
  }
  ctx.linkSelection = linkSelection;

  /// Ctrl+Maiusc+K, o «Togli il collegamento»: gli oggetti dei collegamenti
  /// scelti restano dov'erano, e la selezione passa a loro.
  function unlinkSelection(): void {
    const units = arranging("links");
    if (units === null) return;
    const all = units.filter(isLink);
    if (all.length === 0) {
      announce(t("draw.unlink.none"));
      return;
    }
    const count = all.filter((unit) => unwrappable(ctx.engine.model!, unit)).length;
    if (count === 0) {
      announce(t("draw.unlink.effect"));
      return;
    }
    const kept = arrange("draw.action.unlink", unlinkOps(ctx.engine.model!, units, newIds()), null, { key: "draw.unlink.styled" });
    const whole = count < all.length ? ` ${t("draw.unlink.effect_some")}` : "";
    if (kept !== null) announce(`${plural(count, "draw.unlinked.one", "draw.unlinked.other")}${whole}${kept}`);
  }
  ctx.unlinkSelection = unlinkSelection;

  /// Alt+Invio, o «Apri»: la nota del collegamento scelto da solo, a ogni
  /// livello e anche quando il disegno non si scrive. `false` se non ce n'è
  /// uno che porta nel vault.
  function openSelectedLink(): boolean {
    const single = lonelyLink(selectedUnits());
    const target = single === null || ctx.engine.model === null ? null : linkTarget(nodeOf(ctx.engine.model, single));
    if (options.links === undefined || target === null) return false;
    openLink(target);
    return true;
  }
  ctx.openSelectedLink = openSelectedLink;

  /// Il riquadro a cui si allinea la selezione: la pagina per un oggetto
  /// solo, il riquadro della selezione per più d'uno. `null` per un oggetto
  /// solo in un disegno senza pagina.
  const alignReference = (units: readonly Unit[]): Bounds | null => {
    if (units.length > 1) return boundsOf(units);
    const page = currentPage();
    return page === null ? null : { min: [page.x, page.y], max: [page.x + page.width, page.y + page.height] };
  };
  ctx.alignReference = alignReference;

  /// «Allinea»: gli oggetti scelti, o con lo strumento Nodi i nodi scelti.
  function alignSelection(edge: Edge): void {
    if (ctx.nodeKeysOn() && chosenCount() > 0) {
      ctx.alignNodes(edge);
      return;
    }
    const units = arranging("arrange");
    if (units === null) return;
    const reference = alignReference(units);
    if (reference === null) return;
    if (arrange("draw.action.align", alignOps(units, edge, reference, newIds())) !== null) {
      announce(plural(units.length, "draw.aligned.one", "draw.aligned.other"));
    }
  }
  ctx.alignSelection = alignSelection;

  /// Gli oggetti scelti che disegnano qualcosa: quelli che si distribuiscono.
  const drawn = (units: readonly Unit[]): number => units.filter((unit) => unit.bounds !== null).length;
  ctx.drawn = drawn;

  function distributeSelection(axis: Axis): void {
    const units = arranging("arrange");
    if (units === null) return;
    const count = drawn(units);
    if (count < 3) {
      announce(t("draw.distribute.few"));
      return;
    }
    if (arrange("draw.action.distribute", distributeOps(units, axis, newIds())) !== null) announce(t("draw.distributed", { count }));
  }
  ctx.distributeSelection = distributeSelection;

  /// Apre il menu di un pulsante, sotto il pulsante, col nome del pulsante.
  function openMenu(trigger: HTMLButtonElement, items: MenuItem[]): void {
    if (trigger.id === "") trigger.id = identifier("draw-menu-button");
    trigger.setAttribute("aria-expanded", "true");
    showContextMenu(trigger, items, {
      labelledBy: trigger.id,
      onClose: () => trigger.setAttribute("aria-expanded", "false"),
    });
  }
  ctx.openMenu = openMenu;

  /// Le voci dell'ordine: spenta quella che non cambierebbe niente.
  const orderItems = (): MenuItem[] => {
    const units = selectedUnits();
    const model = ctx.engine.model;
    const index = currentIndex();
    return ORDERS.map(({ order, label, binding }) => ({
      label: t(label),
      hint: displayBinding(binding),
      disabled: model === null || units.length === 0 || orderOps(model, index, units, order, newIds()).ops.length === 0,
      run: () => orderSelection(order),
    }));
  };
  ctx.orderItems = orderItems;

  /// Le voci dell'allineamento e della distribuzione. Per un oggetto solo il
  /// riferimento è la pagina, e il nome lo dice; distribuire chiede almeno
  /// tre oggetti, e la voce spenta dice perché.
  const alignItems = (): MenuItem[] => {
    const units = selectedUnits();
    const single = units.length === 1;
    const usable = units.length > 0 && alignReference(units) !== null;
    const items: MenuItem[] = EDGES.map(({ edge, label }) => ({
      label: single ? t("draw.align.to_page", { action: t(label) }) : t(label),
      disabled: !usable,
      run: () => alignSelection(edge),
    }));
    const few = drawn(units) < 3;
    for (const { axis, label } of AXES) {
      items.push({
        label: t(label),
        separator: axis === "x",
        disabled: few,
        ...(few ? { description: t("draw.distribute.few") } : {}),
        run: () => distributeSelection(axis),
      });
    }
    return items;
  };
  ctx.alignItems = alignItems;
}
