// L'editor del disegno: il Contagocce. Un pezzo di createDrawEditor
// (`../editor.ts`): lavora sul contesto che i pezzi condividono.

import { describe } from "../../describe";
import type { InkPointerType } from "../../pen/pen-input";
import type { Point } from "../../scene/matrix";
import { tagName, type DocumentModel, type ElementPart, type LeafNode } from "../../scene/model";
import { href as parseHref } from "../../scene/values";
import { plural, t, type DrawKey } from "../../strings";
import type { OverlayHandle, SamplePaint } from "../../painter/overlay";
import { nodeOf } from "../arrange";
import { lookOf as selectionLook, nodeStyle, styleOps } from "../look";
import { SceneIndex, type ForeignBlock, type Unit } from "../hit";
import { dataBlob, type Decoded } from "../images";
import {
  colorSeen,
  imagePixel,
  pixelColor,
  shownPaint,
  sightAt,
  sightStyle,
  styleColor,
  type Beneath,
  type ImageSight,
  type ShapeSight,
  type Shown,
} from "../eyedropper";
import { swatchOf } from "../palette";
import { HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import type { Dropped, DropperGesture, DropperHover, PixelSeen } from "./types";

/// Quante immagini il contagocce tiene aperte: quella sotto il puntatore, e
/// quelle che lascia vedere dove è trasparente.
const DROPPER_IMAGES = 3;

/// Un'immagine che il contagocce legge, del disegno aperto per `loaded`:
/// aperta (`decoded`), o perché non si legge (`reason`); `ready` finisce
/// quando si sa. Una chiusa non serve più.
interface DropperImage {
  readonly loaded: number;
  decoded: Decoded | null;
  reason: DrawKey | null;
  ready: Promise<void>;
  closed: boolean;
}

/// Ciò che il Contagocce dà agli altri pezzi dell'editor.
export interface DropperToolContext {
  foreignNow: () => readonly ForeignBlock[];
  dropPixels: () => void;
  dropperAt: (p: Point, pointer: InkPointerType) => Dropped | null;
  dropperText: (seen: Dropped, p: Point) => string;
  dropperHandles: () => OverlayHandle[];
  hoverDropper: (p: Point | null, pointer: InkPointerType, keyboard?: boolean) => void;
  dropperMove: (g: DropperGesture, p: Point) => void;
  dropperFor: () => string;
  takeAt: (p: Point, pointer: InkPointerType, colorOnly: boolean) => Promise<void>;
  dropFromRow: (key: string, colorOnly: boolean) => boolean;
}

/// Monta il Contagocce.
export function installDropperTool(ctx: EditorContext): void {
  const {
    life, has, measureText, panel, indexer, editable, currentIndex, newIds, announce, selectedUnits, showHandles, outlineNow, syncProperties, withFaces,
    styleFromPanel, keyOfNode, nameOfNode, rememberColors, setColor, cancelGesture, seenUnits, options
  } = ctx;
  // --- Il contagocce -----------------------------------------------------------

  /// I blocchi estranei del disegno di adesso, per la scena in cui li si è
  /// trovati: il contagocce li vede, ma non li legge.
  let foreignCache: { readonly index: SceneIndex; readonly blocks: readonly ForeignBlock[] } | null = null;
  const foreignNow = (): readonly ForeignBlock[] => {
    const index = currentIndex();
    const model = ctx.engine.model;
    if (model === null) return [];
    if (foreignCache?.index !== index) foreignCache = { index, blocks: indexer.foreignBlocks(model) };
    return foreignCache.blocks;
  };
  ctx.foreignNow = foreignNow;

  /// Le immagini che il contagocce legge, per `href`, dalla meno recente:
  /// restano aperte finché lo strumento è quello, al più
  /// [`DROPPER_IMAGES`].
  const dropperImages = new Map<string, DropperImage>();

  const closeImage = (image: DropperImage): void => {
    image.closed = true;
    image.decoded?.close();
    image.decoded = null;
  };

  /// Chiude le immagini del contagocce.
  const dropPixels = (): void => {
    for (const image of dropperImages.values()) closeImage(image);
    dropperImages.clear();
  };
  ctx.dropPixels = dropPixels;
  life.add(dropPixels);

  /// L'immagine `href` per il contagocce: aperta, che si apre adesso, o
  /// perché non si legge.
  const dropperImage = (href: string): DropperImage => {
    const known = dropperImages.get(href);
    dropperImages.delete(href);
    if (known !== undefined && known.loaded === ctx.loads) {
      dropperImages.set(href, known);
      return known;
    }
    if (known !== undefined) closeImage(known);
    const image: DropperImage = { loaded: ctx.loads, decoded: null, reason: null, ready: Promise.resolve(), closed: false };
    const kind = parseHref(href).kind;
    if (kind === "remote") image.reason = "draw.eyedropper.remote";
    else if (ctx.codec === null || (kind !== "vault" && kind !== "data")) image.reason = "draw.image.unreadable";
    else image.ready = openPixels(image, href, kind);
    dropperImages.set(href, image);
    for (const [key, old] of dropperImages) {
      if (dropperImages.size <= DROPPER_IMAGES) break;
      closeImage(old);
      dropperImages.delete(key);
    }
    return image;
  };

  /// Apre per il contagocce l'immagine `href`, del vault o scritta nel
  /// disegno, in `image`; poi l'anteprima si rifà.
  async function openPixels(image: DropperImage, href: string, kind: "vault" | "data"): Promise<void> {
    const port = options.images;
    const blob = kind === "data" ? dataBlob(href) : port === undefined ? null : await port.read(href).catch(() => null);
    const decoded = blob === null || image.closed || ctx.codec === null ? null : await ctx.codec.decode(blob).catch(() => null);
    if (image.closed || ctx.disposed) {
      decoded?.close();
      return;
    }
    if (decoded === null || decoded.pixels === undefined) {
      decoded?.close();
      // Un file del vault che non si apre forse non c'è più.
      image.reason = blob === null && kind === "vault" ? "draw.image.gone" : "draw.image.unreadable";
    } else {
      image.decoded = decoded;
    }
    refreshDropper();
  }

  /// Il colore del pixel che `sight` vede.
  const pixelAt = (sight: ImageSight): PixelSeen => {
    const image = dropperImage(sight.source.href);
    if (image.reason !== null) return image.reason;
    const decoded = image.decoded;
    if (decoded === null) return "reading";
    const at = imagePixel(sight, [decoded.width, decoded.height]);
    if (at === null) return "clear";
    const data = decoded.pixels?.({ x: at[0], y: at[1], width: 1, height: 1 }, 1)?.data;
    if (data === undefined) return "draw.image.unreadable";
    const color = pixelColor(data);
    return color === null ? "clear" : { color };
  };

  /// Ciò che il contagocce vede nel punto `p` della scena, col puntatore
  /// `pointer`; dove un'immagine è trasparente, o il suo riquadro non la
  /// mostra, ciò che le sta sotto.
  const dropperAt = (p: Point, pointer: InkPointerType): Dropped | null => {
    const units = seenUnits();
    const blocks = foreignNow();
    const tolerance = HIT_PX[pointer] / ctx.camera.scale;
    let under: Beneath | null = null;
    for (;;) {
      const sight = sightAt(units, blocks, p, tolerance, under);
      if (sight === null) return null;
      if (sight.kind === "foreign") return { kind: "foreign" };
      if (sight.kind === "shape") return { kind: "shape", sight };
      const pixel = pixelAt(sight);
      if (pixel !== "clear") return { kind: "image", sight, pixel };
      under = { unit: sight.unit, leaf: sight.sampled.leaf };
    }
  };
  ctx.dropperAt = dropperAt;

  /// Il nome a parole della forma `leaf`, anche dentro un gruppo, come
  /// nell'albero: il colore il contagocce lo dice a parte.
  const sightName = (leaf: LeafNode): string => nameOfNode(leaf);

  /// Il nome a parole di ciò da cui il contagocce prende l'aspetto, una forma
  /// o un oggetto, come nell'albero ma senza lo stato e le parti: «Aspetto
  /// di Rettangolo», anche se è bloccato.
  const lookName = (node: ElementPart): string => {
    const outlined = outlineNow().byKey.get(keyOfNode(node));
    return outlined === undefined ? tagName(node) : describe(outlined, { state: false });
  };

  /// Il nome breve di un colore, per l'anteprima: quello della tavolozza, o
  /// il codice.
  const shortColor = (code: string): string => {
    const swatch = swatchOf(code);
    return swatch === null ? code : t(swatch.label);
  };

  /// Come si dice il colore `shown`.
  const shownName = (shown: Shown): string => {
    switch (shown.kind) {
      case "color":
        return ctx.colorName(shown.code);
      case "swatch":
        return shown.name;
      case "gradient":
        return t("draw.eyedropper.gradient", { color: ctx.colorName(shown.code) });
      case "pattern":
        return t("draw.eyedropper.pattern.name");
      case "none":
        return t("draw.eyedropper.none.name");
    }
  };

  /// Il nome breve del colore `shown`, per l'anteprima.
  const shownLabel = (shown: Shown): string => {
    switch (shown.kind) {
      case "color":
      case "gradient":
        return shortColor(shown.code);
      case "swatch":
        return shown.name;
      case "pattern":
        return t("draw.eyedropper.label.pattern");
      case "none":
        return t("draw.eyedropper.label.none");
    }
  };

  /// Come l'anteprima mostra il colore `shown`: di una sfumatura, il colore
  /// nel punto.
  const samplePaint = (shown: Shown): SamplePaint => (shown.kind === "none" || shown.kind === "pattern" ? shown.kind : { color: shown.code });

  /// Ciò che il contagocce vede, a parole: la forma e il colore nel punto
  /// `p`.
  const dropperText = (seen: Dropped, p: Point): string => {
    if (seen.kind === "foreign") return t("draw.eyedropper.cursor.foreign");
    const name = sightName(seen.sight.sampled.leaf);
    if (seen.kind === "image") {
      const pixel = seen.pixel;
      if (typeof pixel === "object") return t("draw.eyedropper.cursor", { name, color: ctx.colorName(pixel.color) });
      return t(pixel === "reading" ? "draw.eyedropper.cursor.reading" : "draw.eyedropper.cursor.unreadable", { name });
    }
    const color = colorSeen(ctx.engine.model!, seen.sight, p);
    return color === null ? name : t("draw.eyedropper.cursor", { name, color: shownName(color.shown) });
  };
  ctx.dropperText = dropperText;

  /// Vero se il contagocce prende l'aspetto: ci sono oggetti scelti, e
  /// Maiusc non chiede il solo colore.
  const takesLook = (): boolean => !ctx.shift && selectedUnits().length > 0;

  /// Il contagocce sopra il foglio, o mentre si preme: il contorno tenue
  /// della forma da cui prende e, accanto al punto, ciò che prende. Per gli
  /// oggetti scelti l'aspetto, col nome della forma: il riempimento nel
  /// disco e il contorno nell'anello attorno, vuoti se la forma non li dà;
  /// con Maiusc, da un'immagine o senza selezione il colore, col suo nome.
  const dropperHandles = (): OverlayHandle[] => {
    const model = ctx.engine.model;
    if (ctx.tool !== "eyedropper" || model === null) return [];
    const g = ctx.current?.kind === "dropper" ? ctx.current : null;
    // Dopo un passo la scena è un'altra, e forse anche ciò che si vede.
    if (g === null && ctx.dropperHover !== null && ctx.dropperHover.index !== currentIndex()) {
      ctx.dropperHover = { ...ctx.dropperHover, index: currentIndex(), seen: dropperAt(ctx.dropperHover.at, ctx.dropperHover.pointer) };
    }
    const spot = g === null ? ctx.dropperHover : g.at === null ? null : { at: g.at, pointer: g.pointer, seen: g.seen };
    if (spot === null || spot.seen === null) return [];
    const { at, pointer, seen } = spot;
    const sample = (fill: SamplePaint | null, text: string, ring: SamplePaint | null = null): OverlayHandle => ({
      kind: "sample",
      x: at[0],
      y: at[1],
      fill,
      text,
      ...(ring === null ? {} : { ring }),
      ...(pointer === "touch" ? { lifted: true } : {}),
    });
    if (seen.kind === "foreign") return [sample(null, t("draw.eyedropper.label.foreign"))];
    const { sampled } = seen.sight;
    const out: OverlayHandle[] = [{ kind: "outline", segments: sampled.segments, matrix: sampled.matrix, hint: true }];
    if (seen.kind === "image") {
      const pixel = seen.pixel;
      if (typeof pixel === "object") out.push(sample({ color: pixel.color }, shortColor(pixel.color)));
      else out.push(sample(null, t(pixel === "reading" ? "draw.eyedropper.label.reading" : "draw.eyedropper.label.unreadable")));
      return out;
    }
    if (takesLook()) {
      const style = sightStyle(model, seen.sight);
      const paint = (value: string | null): SamplePaint | null => {
        const shown = value === null ? null : shownPaint(model, seen.sight, at, value);
        return shown === null ? null : samplePaint(shown);
      };
      out.push(style === null ? sample(null, t("draw.eyedropper.label.unreadable")) : sample(paint(style.fill), sightName(sampled.leaf), paint(style.stroke)));
      return out;
    }
    const color = colorSeen(model, seen.sight, at);
    out.push(color === null ? sample(null, t("draw.eyedropper.label.unreadable")) : sample(samplePaint(color.shown), shownLabel(color.shown)));
    return out;
  };
  ctx.dropperHandles = dropperHandles;

  /// Il puntatore, o il cursore della tastiera (`keyboard`), passa sopra `p`
  /// senza premere: col contagocce si vede che cosa prenderebbe. Il dito
  /// non passa: tocca.
  const hoverDropper = (p: Point | null, pointer: InkPointerType, keyboard = false): void => {
    let next: DropperHover | null = null;
    if (p !== null && pointer !== "touch" && ctx.tool === "eyedropper" && has("eyedropper") && editable()) {
      next = { index: currentIndex(), at: p, pointer, keyboard, seen: dropperAt(p, pointer) };
    }
    if (next === null && ctx.dropperHover === null) return;
    ctx.dropperHover = next;
    showHandles();
  };
  ctx.hoverDropper = hoverDropper;

  /// Un'immagine si è aperta: l'anteprima del contagocce si rifà, e la
  /// tastiera sente il colore appena lo si legge.
  const refreshDropper = (): void => {
    const g = ctx.current?.kind === "dropper" ? ctx.current : null;
    if (g !== null && g.at !== null) g.seen = dropperAt(g.at, g.pointer);
    const hovered = ctx.dropperHover;
    if (hovered !== null) ctx.dropperHover = { ...hovered, index: currentIndex(), seen: dropperAt(hovered.at, hovered.pointer) };
    if (g === null && hovered === null) return;
    showHandles();
    if (g === null && hovered !== null && hovered.keyboard && hovered.at === ctx.cursor) ctx.announceCursor();
  };

  /// Il gesto del contagocce arriva a `p`: l'anteprima lo segue, anche
  /// sotto un dito.
  const dropperMove = (g: DropperGesture, p: Point): void => {
    g.at = p;
    g.seen = dropperAt(p, g.pointer);
    showHandles();
  };
  ctx.dropperMove = dropperMove;

  /// Dove va ciò che il contagocce prende, a parole: agli oggetti scelti, o
  /// a ciò che si disegna.
  const dropperFor = (): string => {
    const count = selectedUnits().length;
    return count === 0 ? t("draw.eyedropper.for.drawing") : plural(count, "draw.eyedropper.for.one", "draw.eyedropper.for.other");
  };
  ctx.dropperFor = dropperFor;

  /// Il bersaglio del colore negli oggetti scelti `units`: quello scelto in
  /// «Applica a», se lo hanno, o quello che hanno; `null` se non hanno né
  /// riempimento né contorno.
  const dropperTarget = (model: DocumentModel, units: readonly Unit[]): "fill" | "stroke" | null => {
    const look = selectionLook(model, units);
    const targets = (["fill", "stroke"] as const).filter((each) => look[each].count > 0);
    const chosen = panel.colorTarget();
    return targets.includes(chosen) ? chosen : (targets[0] ?? null);
  };

  /// Il contagocce prende nel punto `p`, col puntatore `pointer`: per gli
  /// oggetti scelti l'aspetto della forma che vede; con `colorOnly`, da
  /// un'immagine o senza selezione, il colore. Un'immagine che si apre
  /// adesso si aspetta.
  async function takeAt(p: Point, pointer: InkPointerType, colorOnly: boolean): Promise<void> {
    if (!has("eyedropper") || !editable()) return;
    const loaded = ctx.loads;
    let seen = dropperAt(p, pointer);
    for (let waits = 0; seen?.kind === "image" && seen.pixel === "reading" && waits <= DROPPER_IMAGES; waits++) {
      await dropperImage(seen.sight.source.href).ready;
      if (ctx.disposed || ctx.loads !== loaded || !editable()) return;
      seen = dropperAt(p, pointer);
    }
    give(seen, p, colorOnly);
  }
  ctx.takeAt = takeAt;

  /// Dà ciò che il contagocce vede nel punto `p`, `seen`.
  function give(seen: Dropped | null, p: Point, colorOnly: boolean): void {
    const model = ctx.engine.model;
    if (model === null) return;
    if (seen === null) {
      announce(t("draw.eyedropper.nothing"));
      return;
    }
    if (seen.kind === "foreign") {
      announce(t("draw.eyedropper.foreign"));
      return;
    }
    if (seen.kind === "image") {
      const pixel = seen.pixel;
      if (typeof pixel === "object") giveColor(pixel.color, { kind: "color", code: pixel.color });
      else announce(t(pixel === "reading" ? "draw.image.unreadable" : pixel));
      return;
    }
    const units = selectedUnits();
    if (units.length > 0 && !colorOnly) {
      giveLook(seen.sight, units);
      return;
    }
    const color = colorSeen(model, seen.sight, p);
    const shown = color?.shown;
    if (color === null || shown === undefined || shown.kind === "none") announce(t("draw.eyedropper.no_color"));
    else giveColor(color.value, shown);
  }

  /// Dà agli oggetti scelti `units` l'aspetto della forma di `sight`, in un
  /// passo.
  function giveLook(sight: ShapeSight, units: readonly Unit[]): void {
    const model = ctx.engine.model!;
    const name = lookName(sight.sampled.leaf);
    const style = sightStyle(model, sight);
    if (style === null) {
      announce(t("draw.eyedropper.no_style", { name }));
      return;
    }
    cancelGesture();
    withFaces((late) => {
      const restyled = styleOps(model, units, style, measureText, newIds());
      if (late() || ctx.arrange("draw.action.eyedropper", restyled) === null) return;
      announce(`${plural(units.length, "draw.eyedropper.given.one", "draw.eyedropper.given.other", { name })}${restyled.overflow ? ` ${t("draw.text.overflow")}` : ""}`);
    });
  }

  /// Dà il colore `value`, come lo scrive il file, che si mostra come
  /// `shown`: agli oggetti scelti, al riempimento o al contorno come dice
  /// «Applica a»; senza selezione, a ciò che si disegna.
  function giveColor(value: string, shown: Exclude<Shown, { readonly kind: "none" }>): void {
    const model = ctx.engine.model!;
    const units = selectedUnits();
    const name = shownName(shown);
    if (units.length === 0) {
      if (shown.kind === "pattern") {
        announce(t("draw.eyedropper.pattern"));
        return;
      }
      setColor(shown.code, { swatch: shown.kind === "swatch" ? shown.id : null });
      announce(t("draw.announce.color", { color: name }));
      return;
    }
    const target = dropperTarget(model, units);
    if (target === null) {
      announce(t("draw.eyedropper.no_target"));
      return;
    }
    const outcome = styleFromPanel(target, value);
    if (outcome !== null) {
      announce(outcome);
      return;
    }
    if (shown.kind === "color" || shown.kind === "gradient") rememberColors(shown.code);
    announce(t("draw.colors.applied", { target: t(target === "fill" ? "draw.properties.fill" : "draw.properties.stroke"), name }));
    ctx.panelShown = null;
    syncProperties();
  }

  /// Il contagocce sulla riga `key` dell'albero, senza puntatore: agli
  /// oggetti scelti l'aspetto del suo oggetto, anche bloccato o nascosto,
  /// come «Copia lo stile»; con `colorOnly`, o senza selezione, il suo
  /// colore. Falso se il contagocce non c'è: il tasto sceglie lo strumento.
  function dropFromRow(key: string, colorOnly: boolean): boolean {
    if (!has("eyedropper")) return false;
    const model = ctx.engine.model;
    const outlined = outlineNow().byKey.get(key);
    if (model === null || outlined === undefined || !editable()) return true;
    if (outlined.item.role === "layer") {
      announce(t("draw.eyedropper.row.layer"));
      return true;
    }
    const node = nodeOf(model, outlined.item);
    const name = lookName(node);
    const style = nodeStyle(model, node);
    if (style === null) {
      announce(t("draw.eyedropper.no_style", { name }));
      return true;
    }
    const units = selectedUnits();
    if (units.length > 0 && !colorOnly) {
      cancelGesture();
      withFaces((late) => {
        const restyled = styleOps(model, units, style, measureText, newIds());
        if (late() || ctx.arrange("draw.action.eyedropper", restyled) === null) return;
        announce(`${plural(units.length, "draw.eyedropper.given.one", "draw.eyedropper.given.other", { name })}${restyled.overflow ? ` ${t("draw.text.overflow")}` : ""}`);
      });
      return true;
    }
    const color = styleColor(model, style);
    if (color === "gradient") announce(units.length > 0 ? `${t("draw.eyedropper.row.gradient")} ${t("draw.eyedropper.row.whole")}` : t("draw.eyedropper.row.gradient"));
    else if (color === null || color.shown.kind === "none") announce(t(outlined.item.role === "image" ? "draw.eyedropper.row.image" : "draw.eyedropper.no_color"));
    else giveColor(color.value, color.shown);
    return true;
  }
  ctx.dropFromRow = dropFromRow;
}
