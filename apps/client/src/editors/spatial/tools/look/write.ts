// L'aspetto degli oggetti scelti, scrivere: un cambio del pannello delle
// proprietà diventa le operazioni su ogni parte che può averlo
// (`../look.ts`).

import { formatNumber } from "../../number";
import type { Role } from "../../scene/analysis";
import type { SwatchFacts } from "../../scene/classify";
import type { Bounds } from "../../scene/geometry";
import type { Matrix } from "../../scene/matrix";
import { DEFS_ID } from "../../scene/ids";
import { pathOf, type DocumentModel, type ElementPart, type LeafNode } from "../../scene/model";
import { ROOT, type Op } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { spineOf, WIDTH_CAPS, WIDTH_JOINS, type WidthCap, type WidthJoin } from "../../scene/varwidth";
import {
  BLEND_MODES,
  blendStyle,
  length,
  letterSpacing,
  nonNegativeLength,
  opacity as parseOpacity,
  paintReference,
  trim,
  type BlendStyle,
  type PaintReference,
} from "../../scene/values";
import { elemOf, fubAttributes, Plan, type Arranged } from "../arrange";
import { NewIds } from "../edit";
import { effectsAttrs, effectsRefusal, effectsStates, type Effect } from "../effects";
import { geometryBox, type Unit } from "../hit";
import type { Measure } from "../measure";
import { dashOf, dashValue, writtenDashes } from "../outline";
import { nameKey } from "../naming";
import { profileWidth, scaledProfile, widthAttrs } from "../profile";
import { homeOf, paintCode, ResourceCopies, resourcesOf, type Home } from "../resources";
import { arrowPath } from "../shapes";
import {
  emphasisOf,
  emphasizeKeeping,
  emphasizeWhole,
  restyleKeeping,
  restyleWhole,
  richElem,
  sameRich,
  seenValues,
  weightOf,
  withLeading,
  withSpacing,
  type Emphasis,
  type Rich,
} from "../rich";
import { Tipper, tippable, type TipsStyle } from "../tips";
import { replaceElem } from "../topath";
import { rewrapped } from "../wrap";
import { type Anchor, blendOf, INKED, isContainer, nodesOf, OPACITY_PLACES, ownOf, paintText, type Part, partsOf, passedBy, place, richOfPart, seen, sizeOf } from "./read";

// ---------------------------------------------------------------------------
// Scrivere.
// ---------------------------------------------------------------------------

/// Un valore da dare a tutta la selezione.
export type LookChange =
  | { readonly fill: string }
  | { readonly stroke: string }
  | { readonly width: number }
  | { readonly opacity: number }
  /// Un modo di fusione di `BLEND_MODES`; `normal` toglie la dichiarazione.
  | { readonly blend: string }
  /// L'isolamento della fusione di ciò che contengono i gruppi e i
  /// collegamenti scelti.
  | { readonly isolate: boolean }
  | { readonly family: string }
  | { readonly size: number }
  | { readonly weight: number }
  | { readonly italic: boolean }
  | { readonly underline: boolean }
  | { readonly strike: boolean }
  /// In volte il corpo, come in [`Look`].
  | { readonly leading: number }
  | { readonly spacing: number }
  /// Uno stile del testo: il corpo e il peso insieme.
  | { readonly preset: { readonly size: number; readonly weight: number } }
  | { readonly anchor: Anchor };

/// Un cambio pronto, e quante parti cambia.
export interface Restyled extends Arranged {
  readonly changed: number;
  /// Vero se un testo in area, andato di nuovo a capo, ha una riga più larga
  /// del riquadro.
  readonly overflow: boolean;
}

/// Lo `style` che dice `style`, com'è nel formato: la fusione, poi
/// l'isolamento, separati da `; `. `null` se non dice niente.
export function blendText(style: BlendStyle): string | null {
  const declarations: string[] = [];
  if (style.blend !== null && style.blend !== "normal") declarations.push(`mix-blend-mode: ${style.blend}`);
  if (style.isolate === true) declarations.push("isolation: isolate");
  return declarations.length === 0 ? null : declarations.join("; ");
}

/// Due valori scritti che si vedono uguali.
export type Same = (a: string, b: string) => boolean;

export const sameText: Same = (a, b) => trim(a) === trim(b);
export const samePaint: Same = (a, b) => paintText(a) === paintText(b);
export const sameLength: Same = (a, b) => {
  const p = length(a);
  const q = length(b);
  return p !== null && q !== null && place(p) === place(q);
};
export const sameDashes: Same = (a, b) => (writtenDashes(a) ?? a) === (writtenDashes(b) ?? b);
export const sameWeight: Same = (a, b) => weightOf(a) === weightOf(b);
export const sameSpacing: Same = (a, b) => {
  const p = letterSpacing(a);
  const q = letterSpacing(b);
  return p !== null && q !== null && place(p) === place(q);
};

/// Un peso come lo scrive il file: le parole per il normale e il grassetto.
export const weightText = (weight: number): string => (weight === 400 ? "normal" : weight === 700 ? "bold" : String(Math.round(weight)));

/// Come `name` confronta due valori scritti.
export const SAME: Readonly<Record<string, Same>> = {
  fill: samePaint,
  "font-family": sameText,
  "font-size": sameLength,
  "font-weight": sameWeight,
  "font-style": sameText,
  "letter-spacing": sameSpacing,
  "text-anchor": sameText,
};

/// I cambi di un comando, parte per parte, e le operazioni che li scrivono.
export class Changes {
  private readonly attrs = new Map<ElementPart, Record<string, string | null>>();
  /// I testi che cambiano interi, com'erano e come diventano.
  private readonly texts = new Map<ElementPart, { readonly part: Part; readonly before: Rich; now: Rich }>();
  private replaced = 0;
  private overflow = false;
  private copies: ResourceCopies | null = null;
  private tipper: Tipper | null = null;
  private resources: Map<string, LeafNode> | null = null;
  /// Gli effetti da dare agli oggetti scelti, che si scrivono alla fine.
  private given: Array<{ readonly parts: readonly Part[]; readonly effects: readonly Effect[] }> = [];
  /// Vero se un valore dato a un testo intero lascia le righe e i pezzi che
  /// ne scrivono un altro, dove il testo non ha lo stesso valore dappertutto:
  /// come lo dà uno stile del disegno.
  keepRuns = false;

  constructor(
    private readonly plan: Plan,
    private readonly model: DocumentModel,
    private readonly measure: Measure,
    /// Le risorse private di uno stile copiato, com'erano.
    private readonly kept: ReadonlyMap<string, Elem> = new Map(),
    /// I campioni di uno stile copiato, per id.
    private readonly swatches: ReadonlyMap<string, SwatchFacts> = new Map(),
  ) {}

  of(part: Part): Record<string, string | null> {
    let attrs = this.attrs.get(part.node);
    if (attrs === undefined) {
      attrs = {};
      this.attrs.set(part.node, attrs);
    }
    return attrs;
  }

  /// Vero se il comando cambia `name` in `part`.
  touches(part: Part, name: string): boolean {
    return this.attrs.get(part.node)?.[name] !== undefined;
  }

  /// Scrive `value` in `name`, o lo toglie se la parte lo vede comunque.
  /// `same` dice quando due valori scritti si vedono uguali.
  write(part: Part, name: string, value: string, same: Same = (a, b) => a === b): void {
    const own = part.own.get(name);
    if (same(value, part.inherited.get(name)!)) {
      if (own !== undefined) this.of(part)[name] = null;
    } else if (own === undefined || !same(own, value)) {
      this.of(part)[name] = value;
    }
  }

  /// Il colore `value` in `name`, `fill` o `stroke`, su `part`: di un testo
  /// intero. Una risorsa privata di un altro oggetto, il cui riquadro è
  /// `box`, diventa una copia di `part`: una sfumatura nelle coordinate di
  /// chi la usa passa dall'uno all'altro.
  paint(part: Part, name: string, value: string, box: Bounds | null): void {
    // Ciò che la parte vede già resta suo, anche la sua copia di una risorsa
    // privata che si vede uguale.
    const now = seen(part, name);
    const written = samePaint(value, now) ? value : this.alike(part, value, now, box) ? now : this.copied(part, value, box);
    if (written === null) return;
    if (part.role === "text" && name === "fill") this.textWrite(part, name, written);
    else this.write(part, name, written, samePaint);
  }

  /// `value` per `part`, con le copie delle risorse private che usa; `null`
  /// se una copia non si sa scrivere. Un campione porta come ripiego il suo
  /// colore di adesso. Una risorsa che il disegno non ha, perché lo stile
  /// viene da un altro disegno o lei se n'è andata, lascia il posto a ciò
  /// che dice [`elsewhere`].
  private copied(part: Part, value: string, box: Bounds | null): string | null {
    const used = paintReference(value);
    if (used === null) return value;
    if (!this.kept.has(used.id)) {
      this.resources ??= resourcesOf(this.model);
      const there = this.resources.get(used.id);
      const swatch = there?.details?.swatch;
      if (swatch !== undefined) return `url(#${used.id}) ${swatch.color}`;
      if (there === undefined) return this.elsewhere(used);
    }
    this.copies ??= new ResourceCopies(this.model, this.plan.ids, elemOf, this.kept);
    return this.copies.paint(value, part.node, this.fit(part, box));
  }

  /// Vero se `now`, il colore che `part` vede, usa una sua risorsa privata
  /// che è già la copia di quella di `value`, adattata al suo riquadro: dare
  /// di nuovo lo stesso aspetto non fa un'altra copia.
  private alike(part: Part, value: string, now: string, box: Bounds | null): boolean {
    if (paintReference(value) === null || paintReference(now) === null) return false;
    this.copies ??= new ResourceCopies(this.model, this.plan.ids, elemOf, this.kept);
    return this.copies.same(value, now, this.fit(part, box), () => {
      const elem = elemOf(part.node);
      return elem === null ? null : geometryBox(elem);
    });
  }

  /// La trasformazione che porta il riquadro `box` di un altro oggetto su
  /// quello di `part`, quando serve.
  private fit(part: Part, box: Bounds | null): () => Matrix | null {
    return () => {
      const elem = box === null ? null : elemOf(part.node);
      const target = elem === null ? null : geometryBox(elem);
      return target === null ? null : boxFit(box!, target);
    };
  }

  /// Il colore al posto di `used`, una risorsa che il disegno non ha: il
  /// suo campione con lo stesso nome e lo stesso colore, se lei era un
  /// campione e il disegno ne ha uno così, o il colore che si vedeva.
  private elsewhere(used: PaintReference): string {
    const swatch = this.swatches.get(used.id);
    if (swatch === undefined) return used.fallback === null ? "none" : paintCode(used.fallback);
    const key = nameKey(swatch.name);
    for (const [id, node] of this.resources!) {
      const other = node.details?.swatch;
      if (other !== undefined && other.color === swatch.color && nameKey(other.name) === key) return `url(#${id}) ${other.color}`;
    }
    return swatch.color;
  }

  /// L'opacità `value` sull'oggetto scelto `part`: senza attributo se è
  /// piena.
  opacity(part: Part, value: number): void {
    const written = formatNumber(value, OPACITY_PLACES);
    const own = part.own.get("opacity");
    if (written === "1") {
      if (own !== undefined) this.of(part).opacity = null;
    } else if (own === undefined || parseOpacity(own) === null || formatNumber(parseOpacity(own)!, OPACITY_PLACES) !== written) {
      this.of(part).opacity = written;
    }
  }

  /// Il modo di fusione `mode` sull'oggetto scelto `part`, e l'isolamento
  /// com'era; `normal` lo toglie. Uno `style` che ha altro è di un altro
  /// programma, e non si scrive; né un modo che il formato non ha.
  blend(part: Part, mode: string): void {
    if (!BLEND_MODES.includes(mode)) return;
    const now = this.styled(part);
    if (now !== null) this.style(part, now, { blend: mode === "normal" ? null : mode, isolate: now.isolate });
  }

  /// L'isolamento `on` sul gruppo o sul collegamento scelto `part`, e la
  /// fusione com'era.
  isolate(part: Part, on: boolean): void {
    const now = isContainer(part.node) ? this.styled(part) : null;
    if (now !== null) this.style(part, now, { blend: now.blend, isolate: on ? true : null });
  }

  /// Lo `style` di `part` com'è adesso, anche se questo comando l'ha già
  /// cambiato; `null` se è di un altro programma.
  private styled(part: Part): BlendStyle | null {
    const pending = this.attrs.get(part.node)?.style;
    if (pending === undefined) return blendOf(part);
    return pending === null ? { blend: null, isolate: null } : blendStyle(pending, isContainer(part.node));
  }

  /// Lo `style` di `part` che dice `next`, scritto sempre allo stesso modo;
  /// se si vede come adesso non lo tocca, e se non dice niente lo toglie.
  private style(part: Part, now: BlendStyle, next: BlendStyle): void {
    if ((now.blend ?? "normal") === (next.blend ?? "normal") && (now.isolate === true) === (next.isolate === true)) return;
    const text = blendText(next);
    const own = part.own.get("style");
    const attrs = this.of(part);
    if (text === (own ?? null)) delete attrs.style;
    else attrs.style = text;
  }

  /// La linea a spessore variabile `part` spessa `width` nel punto più largo:
  /// tutto il profilo si allarga o si stringe nella stessa proporzione, e
  /// con lui gli estremi e gli angoli che chiede `outline`, se li dice.
  widthTo(part: Part, width: number, outline?: { readonly cap: string; readonly join: string }): void {
    const v = part.node.details!.varwidth!;
    const k = width / profileWidth(v.profile);
    const cap = trim(outline?.cap ?? "");
    const join = trim(outline?.join ?? "");
    if (!(k > 0 && Number.isFinite(k))) return;
    const written = widthAttrs({
      cap: (WIDTH_CAPS as readonly string[]).includes(cap) ? (cap as WidthCap) : v.cap,
      join: (WIDTH_JOINS as readonly string[]).includes(join) ? (join as WidthJoin) : v.join,
      profile: scaledProfile(v.profile, k),
      spine: spineOf(v),
    });
    if (written === null) return;
    if (written.geom !== fubAttributes(part.node).get("geom")) {
      this.of(part)["fub:geom"] = written.geom;
      this.of(part).d = written.d;
    }
  }

  /// Le punte `tips` di uno stile copiato su `part`, se può averne.
  tips(part: Part, tips: TipsStyle): void {
    if (!tippable(part.node)) return;
    this.tipper ??= new Tipper(this.model, this.plan.ids);
    const attrs = this.tipper.give(part.node, tips);
    if (attrs !== null) Object.assign(this.of(part), attrs);
  }

  /// Una freccia il cui spessore cambia ridisegna la punta.
  arrow(part: Part): void {
    const arrow = part.node.details?.arrow;
    const width = this.attrs.get(part.node)?.["stroke-width"];
    if (part.role !== "arrow" || arrow === undefined || width === undefined) return;
    const [x1, y1, x2, y2] = arrow;
    this.of(part).d = arrowPath(x1, y1, x2, y2, width === null ? nonNegativeLength(part.inherited.get("stroke-width")!) ?? 1 : Number(width));
  }

  /// Cambia il testo `part` intero con `edit`. Falso se il testo non si
  /// legge coi suoi pezzi, e non cambia.
  text(part: Part, edit: (rich: Rich) => Rich): boolean {
    let entry = this.texts.get(part.node);
    if (entry === undefined) {
      const rich = richOfPart(part);
      if (rich === null) return false;
      entry = { part, before: rich, now: rich };
      this.texts.set(part.node, entry);
    }
    entry.now = edit(entry.now);
    return true;
  }

  /// `value` in `name` sul testo `part` intero, che il file scrive corto:
  /// senza, se il testo lo vede comunque da chi lo contiene, e com'era
  /// scritto, se si vede uguale.
  textWrite(part: Part, name: string, value: string): void {
    const same = SAME[name] ?? sameText;
    const whole = (rich: Rich): boolean => {
      if (!this.keepRuns) return true;
      const values = seenValues(rich, name);
      return values.every((each) => same(each, values[0]!));
    };
    if (!this.text(part, (rich) => shorter(part, whole(rich) ? restyleWhole(rich, name, value) : restyleKeeping(rich, name, value), name))) this.write(part, name, value, same);
  }

  /// L'enfasi `which` accesa o spenta sul testo `part` intero.
  textEmphasis(part: Part, which: Emphasis, on: boolean): void {
    if (which === "bold" || which === "italic") {
      this.textWrite(part, which === "bold" ? "font-weight" : "font-style", which === "bold" ? (on ? "bold" : "normal") : on ? "italic" : "normal");
      return;
    }
    this.text(part, (rich) => (this.keepRuns && emphasisOf(rich, which) === null ? emphasizeKeeping(rich, which, on) : emphasizeWhole(rich, which, on)));
  }

  /// I testi che cambiano: un'operazione `set` se cambia soltanto il
  /// `text`, e il testo riscritto intero, coi cambi che ha già, se cambiano
  /// le righe o i pezzi.
  private finishTexts(): void {
    for (const { part, before, now: changed } of this.texts.values()) {
      const now = part.node.details?.textPath === undefined ? this.area(before, changed) : changed;
      if (sameRich(before, now)) continue;
      if (sameRich({ ...before, attrs: {} }, { ...now, attrs: {} })) {
        const attrs = this.of(part);
        for (const name of new Set([...Object.keys(before.attrs), ...Object.keys(now.attrs)])) {
          if (before.attrs[name] !== now.attrs[name] && attrs[name] === undefined) attrs[name] = now.attrs[name] ?? null;
        }
        continue;
      }
      const old = elemOf(part.node);
      if (old === null) continue;
      const merged: Record<string, string> = { ...now.attrs };
      for (const [name, value] of Object.entries(this.attrs.get(part.node) ?? {})) {
        if (value === null) delete merged[name];
        else merged[name] = value;
      }
      // Le righe si riscrivono con l'elemento: il resto passa da lui. Se la
      // `defs` nasce prima, in testa alla radice, il testo arriva un posto più in là.
      const path = pathOf(part.node);
      const at = this.makesDefs() ? [path[0]! + 1, ...path.slice(1)] : path;
      if (replaceElem(this.plan, part.node, richElem(old, { ...now, attrs: merged }), at)) {
        this.attrs.delete(part.node);
        this.replaced++;
      }
    }
  }

  /// Vero se fra le operazioni nasce la `defs` della radice.
  private makesDefs(): boolean {
    return this.plan.ops.some(isDefsAdd);
  }

  /// Dà gli effetti `effects` agli oggetti scelti `parts` che possono
  /// averli; gli altri tengono i loro. Una lista vuota toglie quelli di
  /// FubDraw, ma non il filtro d'un altro programma.
  giveEffects(parts: readonly Part[], effects: readonly Effect[]): void {
    this.given.push({ parts, effects });
  }

  /// I filtri degli effetti dati, dopo le copie delle risorse e le punte,
  /// con la loro `defs` se nessuno l'ha già fatta nascere, e gli attributi
  /// degli oggetti con gli altri cambi: un testo riscritto intero li porta.
  private finishEffects(): void {
    if (this.given.length === 0) return;
    const states = effectsStates(this.model, this.given.flatMap(({ parts }) => parts.map((part) => part.node)));
    let made: Home | null = null;
    const home = (): Home => {
      if (made !== null) return { parent: made.parent, prelude: [] };
      made = homeOf(this.model);
      return this.makesDefs() ? { parent: made.parent, prelude: [] } : made;
    };
    let at = 0;
    const done = new Set<ElementPart>();
    for (const { parts, effects } of this.given) {
      for (const part of parts) {
        const state = states[at++]!;
        // Un oggetto che due stili raggiungono, come un gruppo e una sua
        // parte, prende gli effetti una volta.
        if (done.has(part.node)) continue;
        done.add(part.node);
        if (effects.length === 0 ? state.kind !== "effects" : effectsRefusal(this.model, part.node, this.measure) !== null) continue;
        const attrs = effectsAttrs(this.plan, part.node, state, effects, this.measure, home);
        if (attrs !== null && Object.keys(attrs).length > 0) Object.assign(this.of(part), attrs);
      }
    }
  }

  /// Il testo in area `now`, che era `before`, col riquadro dov'era e di
  /// nuovo a capo se serve.
  private area(before: Rich, now: Rich): Rich {
    const flowed = rewrapped(before, now, this.measure);
    this.overflow ||= flowed.overflow;
    return flowed.rich;
  }

  /// Ciò che il comando cambierebbe, senza scriverlo: gli attributi di ogni
  /// parte, effetti compresi, e i testi che cambiano interi, com'erano e
  /// come diventerebbero.
  dry(): { readonly attrs: ReadonlyMap<ElementPart, Readonly<Record<string, string | null>>>; readonly texts: ReadonlyArray<{ readonly part: Part; readonly before: Rich; readonly now: Rich }> } {
    this.finishEffects();
    return { attrs: this.attrs, texts: [...this.texts.values()] };
  }

  /// Le operazioni, con le chiavi di `units` dopo.
  finish(units: readonly Unit[]): Restyled {
    // Le copie delle risorse e i marcatori delle punte prima di chi li usa;
    // la `defs` che manca nasce una volta sola, anche se l'ha fatta nascere
    // chi ha messo le sue operazioni prima.
    const defs = this.makesDefs();
    const copies = this.copies === null ? [] : this.copies.ops(!defs);
    this.plan.ops.push(...copies);
    if (this.tipper !== null) this.plan.ops.push(...this.tipper.ops(copies.length === 0 && !defs));
    this.finishEffects();
    this.finishTexts();
    for (const [node, attrs] of this.attrs) {
      if (Object.keys(attrs).length === 0) continue;
      this.plan.ops.push({ op: "set", id: this.plan.idOf(node), attrs } satisfies Op);
    }
    const nodes = nodesOf(this.model, units);
    const keys = units.map((unit, at) => this.plan.keyOf(nodes[at]!, unit.key));
    const changed = [...this.attrs.values()].filter((attrs) => Object.keys(attrs).length > 0).length + this.replaced;
    return { ...this.plan.finish(keys), changed, overflow: this.overflow };
  }
}

/// La trasformazione che porta il riquadro `from` su `to`: un lato nullo
/// dell'uno o dell'altro non si scala.
export function boxFit(from: Bounds, to: Bounds): Matrix {
  const scale = (a: number, b: number): number => (a > 0 && b > 0 ? b / a : 1);
  const sx = scale(from.max[0] - from.min[0], to.max[0] - to.min[0]);
  const sy = scale(from.max[1] - from.min[1], to.max[1] - to.min[1]);
  return [sx, 0, 0, sy, to.min[0] - sx * from.min[0], to.min[1] - sy * from.min[1]];
}

/// Il testo `rich` di `part` col valore di `name` scritto corto: senza, se il
/// testo lo vede comunque da chi lo contiene, e com'era scritto prima, se si
/// vede uguale.
export function shorter(part: Part, rich: Rich, name: string): Rich {
  const value = rich.attrs[name];
  if (value === undefined) return rich;
  const same = SAME[name] ?? sameText;
  const own = part.own.get(name);
  const attrs: Record<string, string> = { ...rich.attrs };
  if (same(value, part.inherited.get(name)!)) delete attrs[name];
  else if (own !== undefined && same(own, value)) attrs[name] = own;
  return { ...rich, attrs };
}

/// Le operazioni che danno `change` a `units`. La selezione resta la
/// stessa; un elemento che cambia senza id ne riceve uno.
export function lookOps(model: DocumentModel, units: readonly Unit[], change: LookChange, measure: Measure, ids: NewIds): Restyled {
  const changes = new Changes(new Plan(model, ids), model, measure);
  const parts = partsOf(model, units);

  if ("fill" in change) {
    for (const part of parts.fills) changes.paint(part, "fill", change.fill, null);
  } else if ("stroke" in change) {
    for (const part of parts.strokes) changes.paint(part, INKED.has(part.role) ? "fill" : "stroke", change.stroke, null);
  } else if ("width" in change) {
    const width = place(change.width);
    for (const part of parts.widths) changes.widthTo(part, change.width);
    for (const { part, outline } of parts.outlines) {
      changes.write(part, "stroke-width", width, sameLength);
      // Il tratteggio del menu resta quello che si vedeva, sullo spessore
      // nuovo.
      const dash = dashOf(outline.dashes, outline.width, outline.cap);
      if (dash !== null && dash !== "solid") changes.write(part, "stroke-dasharray", dashValue(dash, change.width, outline.cap), sameDashes);
      changes.arrow(part);
    }
  } else if ("opacity" in change) {
    for (const part of parts.chosen) changes.opacity(part, change.opacity);
  } else if ("blend" in change) {
    for (const part of parts.chosen) changes.blend(part, change.blend);
  } else if ("isolate" in change) {
    for (const part of parts.chosen) changes.isolate(part, change.isolate);
  } else if ("family" in change) {
    for (const part of parts.texts) changes.textWrite(part, "font-family", change.family);
  } else if ("anchor" in change) {
    for (const part of parts.texts) changes.textWrite(part, "text-anchor", change.anchor);
  } else if ("size" in change) {
    for (const part of parts.texts) changes.textWrite(part, "font-size", place(change.size));
  } else if ("weight" in change) {
    for (const part of parts.texts) changes.textWrite(part, "font-weight", weightText(change.weight));
  } else if ("preset" in change) {
    for (const part of parts.texts) {
      changes.textWrite(part, "font-size", place(change.preset.size));
      changes.textWrite(part, "font-weight", weightText(change.preset.weight));
    }
  } else if ("leading" in change) {
    for (const part of parts.texts) changes.text(part, (rich) => withLeading(rich, change.leading));
  } else if ("spacing" in change) {
    for (const part of parts.texts) {
      if (!changes.text(part, (rich) => shorter(part, withSpacing(rich, change.spacing), "letter-spacing"))) {
        const size = sizeOf(part);
        if (size !== null) changes.write(part, "letter-spacing", change.spacing === 0 ? "0" : place(change.spacing * size), sameSpacing);
      }
    }
  } else {
    const which: Emphasis = "italic" in change ? "italic" : "underline" in change ? "underline" : "strike";
    const on = "italic" in change ? change.italic : "underline" in change ? change.underline : change.strike;
    for (const part of parts.texts) changes.textEmphasis(part, which, on);
  }
  return changes.finish(units);
}

/// Una parte della selezione che mostra un riempimento o un contorno, come la
/// cambia il pannello.
export interface PaintPart {
  readonly node: ElementPart;
  readonly role: Role;
  /// L'attributo che scrive il colore: `fill` per un riempimento e per il
  /// contorno di un tratto a penna o di una linea a spessore variabile,
  /// `stroke` per gli altri contorni.
  readonly name: "fill" | "stroke";
  /// Il colore che vede, suo o ereditato, com'è scritto.
  readonly value: string;
  /// I suoi attributi senza namespace.
  readonly own: ReadonlyMap<string, string>;
}

/// Le parti di `units` che mostrano `channel`, il riempimento o il contorno,
/// nell'ordine in cui le cambia [`lookOps`]: un gruppo passa alle sue, e una
/// parte bloccata dentro di lui resta fuori.
export function paintParts(model: DocumentModel, units: readonly Unit[], channel: "fill" | "stroke"): PaintPart[] {
  const parts = partsOf(model, units);
  return (channel === "fill" ? parts.fills : parts.strokes).map((part) => {
    const name = channel === "stroke" && INKED.has(part.role) ? "fill" : channel;
    return { node: part.node, role: part.role, name, value: seen(part, name), own: part.own };
  });
}

/// Le operazioni che danno a ogni parte di `values`, fra quelle di `units`
/// che mostrano `channel`, il suo colore, a un testo intero, dopo `before`:
/// le risorse che i colori usano, già pronte. Un colore si scrive com'è,
/// ripiego compreso. La selezione resta la stessa.
export function paintEachOps(
  model: DocumentModel,
  units: readonly Unit[],
  channel: "fill" | "stroke",
  values: ReadonlyMap<ElementPart, string>,
  before: readonly Op[],
  measure: Measure,
  ids: NewIds,
): Restyled {
  const plan = new Plan(model, ids);
  plan.ops.push(...before);
  const changes = new Changes(plan, model, measure);
  const parts = partsOf(model, units);
  for (const part of channel === "fill" ? parts.fills : parts.strokes) {
    const value = values.get(part.node);
    if (value === undefined) continue;
    const name = channel === "stroke" && INKED.has(part.role) ? "fill" : channel;
    if (part.role !== "text" || name !== "fill" || !changes.text(part, (rich) => restyleWhole(rich, name, value))) changes.write(part, name, value, sameText);
  }
  return changes.finish(units);
}

/// Il testo `node` con le sue righe e i suoi pezzi, e ciò che eredita da chi
/// lo contiene; `null` se un'operazione non saprebbe riscriverlo intero.
export function textRich(node: ElementPart): Rich | null {
  return node.details?.role === "text" ? richOfPart({ node, role: "text", own: ownOf(node), inherited: passedBy(node.parent) }) : null;
}

/// Vero se `op` crea la `defs` della radice, quella di FubDraw, in testa.
export const isDefsAdd = (op: Op): boolean => op.op === "add" && "elem" in op && op.parent === ROOT && op.elem.tag === "defs" && op.elem.attrs.id === DEFS_ID;
