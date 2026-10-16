// L'editor del disegno: il testo e il cursore del foglio. Un pezzo di
// createDrawEditor (`../editor.ts`): lavora sul contesto che i pezzi
// condividono.

import { INK_MAX_SAMPLES, type InkSample } from "../../../../ink/sample";
import { formatNumber } from "../../number";
import type { InkPointerType, StrokeStart } from "../../../../ink/dom/pen-input";
import { apply, compose, invert, rotate, translate, type Matrix, type Point } from "../../scene/matrix";
import type { Op } from "../../scene/ops";
import { plural, t } from "../../strings";
import { addOp, gesture as asGesture, removeOps } from "../edit";
import { elemOf, nodeOf, Plan } from "../arrange";
import { ownMatrix } from "../follow";
import { initialText, textInherited } from "../look";
import { insideShape, labelable, labelledPair, labelOf as labelIn, labelTarget } from "../label-hosts";
import { blockMiddle, labelExtent, labelOps, labelPlace, labelWidth, unlabelOps } from "../labels";
import { replaceElem } from "../topath";
import { lineBeyond, snapValue } from "../grid";
import { panned, toScene, toScreen, viewMatrix } from "../../view";
import { elemBounds, linesBounds, type TextLook, type Unit } from "../hit";
import {
  editableRich,
  JOIN,
  lineRuns,
  lineText as richLineText,
  newLeading,
  richChange,
  richElem,
  richLine,
  richOf,
  sameRich,
  tidyRich,
  type Rich,
  type RichChange,
} from "../rich";
import { LINE_SPACING, TEXT_FAMILY } from "../text";
import { LINES_FORM, type FieldForm } from "../text-field";
import { unwrap, WRAP, wrapParagraphs, wrapValue } from "../wrap";
import { HIT_PX } from "./constants";
import type { EditorContext } from "./context";
import { scaleOf, sign } from "./helpers";
import type { Typing, TypingLabel } from "./types";

/// Un campione ogni tanti pixel quando il cursore traccia, a un intervallo
/// da mouse: il tratto da tastiera è fitto come uno col puntatore.
const CURSOR_SAMPLE_PX = 4;

const CURSOR_SAMPLE_MS = 16;

/// Quanto il cursore resta lontano dal bordo del foglio, in pixel: oltre, la
/// vista lo segue.
const CURSOR_MARGIN_PX = 24;

/// Dove sta la linea di base nella riga di un campo di testo, in volte il
/// corpo, sotto la metà della riga: metà della differenza fra la parte sopra
/// e quella sotto del carattere. Il browser la misura; dove non sa, vale
/// quella di Inter.
const BASELINE_EM = 0.363;

/// Ciò che il testo e il cursore del foglio dà agli altri pezzi dell'editor.
export interface TextToolContext {
  placeText: () => void;
  showTyping: () => void;
  editText: (unit: Unit, chosen?: string) => void;
  labelHost: (unit: Unit) => boolean;
  labelHostAt: (p: Point) => Unit | null;
  editLabel: (unit: Unit) => boolean;
  editSelectedText: () => void;
  openText: (p: Point, pointer: InkPointerType) => void;
  openArea: (from: Point, end: Point) => void;
  finishText: (write?: boolean) => void;
  cursorPoint: () => Point;
  announceCursor: () => void;
  moveCursor: (dx: number, dy: number) => void;
  moveCursorOnGrid: (x: number, y: number, lines: number) => void;
  press: (timeStamp: number) => void;
  release: () => void;
  cancelPress: () => void;
}

/// Monta il testo e il cursore del foglio.
export function installTextTool(ctx: EditorContext): void {
  const {
    life, has, drawingFonts, measureText, textStyle, toolbar, surface, live, suggestions, textLayer, field, textInput, labelText, painter, cursorMark,
    editable, currentIndex, grownPage, newIds, announce, objects, showCursor, setCamera, stepNow, coordText, viewArea, viewCenter, selectedUnits, labelOf,
    cited, syncControls, drawnPaint, commit, select, keyOfNode, cancelGesture, target, snapped, cutSpotAt, cutSpotText, hoverCut, widthSpotAt,
    widthSpotText, hoverWidth, dropperAt, dropperText, hoverDropper, gradientNow, gradientSpotAt, gradientSpotText, drawing, bezierTarget, middlePoint,
    showBezier, bezierNodeText, handlers
  } = ctx;
  // --- Il testo ------------------------------------------------------------------
  //
  // Il campo prende il posto del testo che si scrive: il testo che c'è si
  // nasconde, e il campo ha le sue righe e i suoi pezzi, coi loro caratteri,
  // corpi, colori e linee, e la sua trasformazione, così le righe stanno
  // dove resteranno (`text-field.ts`). Si scrive quando il campo si chiude,
  // in un passo di annulla solo.

  /// Dove comincia il testo che si scrive: quello che c'è, o uno nuovo dal
  /// punto del tocco. Un'etichetta tiene il mezzo delle righe dov'era: la
  /// prima linea di base sale o scende quanto cambiano le righe.
  const placeOf = (now: Typing): Pick<TextLook, "x" | "y" | "anchor" | "wrap" | "along"> => {
    const place = now.look ?? { x: now.at[0], y: now.at[1], anchor: now.label === null ? "start" : "middle", wrap: now.wrap, along: null };
    if (now.label === null) return place;
    const rich = field.rich;
    return { ...place, y: now.label.middle - blockMiddle({ ...rich, attrs: { ...rich.attrs, y: "0" } }) };
  };

  /// Come va a capo il campo del testo che si scrive: su una riga sola sul
  /// tracciato, da sé in un riquadro, o con Invio.
  const formOf = (now: Typing): FieldForm => {
    const place = placeOf(now);
    if (place.along !== null) return { kind: "line" };
    return place.wrap === null ? LINES_FORM : { kind: "area", width: place.wrap, measure: measureText };
  };

  /// Gli attributi di un testo nuovo: il colore e la dimensione dello
  /// strumento.
  const newTextAttrs = (): Record<string, string> => ({ fill: drawnPaint(textStyle.color), "font-family": TEXT_FAMILY, "font-size": formatNumber(textStyle.width, 2) });

  /// Il contesto con cui il browser misura un carattere; `null` dove non sa.
  let probe: CanvasRenderingContext2D | null | undefined;
  /// La linea di base sotto la metà della riga, in volte il corpo, per un
  /// carattere scritto come `font-style`, `font-weight` e `font-family`, con
  /// la famiglia viva del disegno.
  const baselineOf = (style: string, weight: string, family: string): number => {
    probe ??= document.createElement("canvas").getContext("2d");
    if (probe === null) return BASELINE_EM;
    probe.font = `${style} ${weight} 100px ${drawingFonts.live(family)}`;
    const metrics = probe.measureText("");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent + descent <= 0) return BASELINE_EM;
    return (ascent - descent) / 200;
  };

  /// Porta il campo sopra il testo che si scrive, sullo schermo: la prima
  /// linea di base dove il file la mette, il punto d'ancoraggio al suo
  /// posto, e la larghezza delle righe, più il cursore.
  function placeText(): void {
    const now = ctx.typing;
    if (now === null) return;
    const look = placeOf(now);
    // Dalle coordinate del testo a quelle dello strato, che copre il foglio.
    const [va, vb, vc, vd, ve, vf] = viewMatrix(ctx.camera);
    const view: Matrix = [va, vb, vc, vd, ve + surface.offsetLeft + surface.clientLeft, vf + surface.offsetTop + surface.clientTop];
    const m = compose(view, now.matrix);
    const k = scaleOf(m);
    const style = textInput.style;
    // Un testo schiacciato su una linea non ha un campo da mostrare.
    style.visibility = k > 0 && Number.isFinite(k) ? "" : "hidden";
    if (style.visibility === "hidden") return;
    const { width, baseline, inset } = field.layout(k, baselineOf);
    const frame = `matrix(${m[0] / k}, ${m[1] / k}, ${m[2] / k}, ${m[3] / k}, ${m[4]}, ${m[5]})`;
    const shift = look.anchor === "middle" ? width / 2 : look.anchor === "end" ? width : 0;
    if (look.along !== null) {
      // Il testo su tracciato si scrive dritto, dove comincia, girato come
      // il tracciato lì.
      const turn = (Math.atan2(look.along[1], look.along[0]) * 180) / Math.PI;
      style.transform = `${frame} translate(${look.x * k}px, ${look.y * k}px) rotate(${turn}deg) translate(${-shift}px, ${-baseline}px)`;
      return;
    }
    // Il riquadro di un testo in area comincia da `x`, ci sta in mezzo o ci
    // finisce.
    const box = look.wrap === null ? null : look.anchor === "middle" ? look.x - look.wrap / 2 : look.anchor === "end" ? look.x - look.wrap : look.x;
    const left = box === null ? look.x * k - shift : box * k - inset;
    const top = look.y * k - baseline;
    style.transform = `${frame} translate(${left}px, ${top}px)`;
  }
  ctx.placeText = placeText;

  /// Il testo che si cambia resta nascosto sotto il campo anche quando il
  /// painter ridisegna, e il campo lo segue.
  function showTyping(): void {
    if (ctx.typing === null) return;
    const unit = ctx.typing.key === null ? null : currentIndex().get(ctx.typing.key);
    if (unit !== null) painter.setDraft({ hidden: new Set(unit.paints) });
    placeText();
  }
  ctx.showTyping = showTyping;

  /// Apre il campo col testo di `next`, col cursore alla fine, e il fuoco
  /// ci va. Il testo di prima si conclude.
  const startTyping = (next: Typing): void => {
    finishText();
    cancelGesture();
    ctx.typing = next;
    if (next.look?.family) drawingFonts.prefetch(next.look.family, next.look.weight ?? "normal");
    field.form(formOf(next));
    field.open(next.before);
    labelText();
    textLayer.hidden = false;
    cursorMark.hidden = true;
    select([]);
    showTyping();
    textInput.focus({ preventScroll: true });
    field.toEnd();
  };

  /// Apre il campo su `unit`, un testo che c'è, coi suoi pezzi. Un testo che
  /// un'operazione non sa scrivere intero si apre con le sue righe.
  /// L'etichetta di una forma resta al centro mentre si scrive, e dopo torna
  /// scelto `chosen`: la forma, il suo gruppo o l'etichetta stessa.
  const editText = (unit: Unit, chosen = unit.key): void => {
    const look = unit.look;
    const model = ctx.engine.model;
    if (look === null || model === null || !editable() || !has("text")) return;
    const node = nodeOf(model, unit);
    const elem = elemOf(node);
    const inherited = textInherited(node);
    const file = elem === null ? null : richOf(elem, inherited);
    const plain: Rich = { attrs: {}, inherited, lines: (node.details?.lines ?? [""]).map((line) => richLine({}, line)) };
    const label = file !== null && labelTarget(node) !== null ? { middle: blockMiddle(file), select: chosen, shape: null } : null;
    startTyping({ key: unit.key, before: editableRich(file ?? plain), file, look, wrap: null, at: [look.x, look.y], matrix: unit.matrix, label });
  };
  ctx.editText = editText;

  /// Vero se `unit` può avere un'etichetta che si scrive col doppio tocco o
  /// con F2: una forma chiusa, o un gruppo fatto di una forma e della sua
  /// etichetta.
  function labelHost(unit: Unit): boolean {
    return has("text") && (labelledPair(unit.node) !== null || labelable(unit.node));
  }
  ctx.labelHost = labelHost;

  /// La forma chiusa, o il gruppo fatto di una forma e della sua etichetta,
  /// più in alto fra quelli che hanno `p` dentro, riempiti o no; `null` se
  /// non ce n'è.
  const labelHostAt = (p: Point): Unit | null => {
    if (!has("text")) return null;
    const { units } = currentIndex();
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!;
      const box = unit.bounds;
      if (box === null || p[0] < box.min[0] || p[0] > box.max[0] || p[1] < box.min[1] || p[1] > box.max[1] || !labelHost(unit)) continue;
      const shape = labelledPair(unit.node)?.shape ?? unit.node;
      const inverse = invert(shape === unit.node ? unit.matrix : compose(unit.matrix, ownMatrix(shape)));
      if (inverse !== null && insideShape(shape, apply(inverse, p))) return unit;
    }
    return null;
  };
  ctx.labelHostAt = labelHostAt;

  /// Il doppio tocco o F2 su `unit`, una forma chiusa o un gruppo fatto di
  /// una forma e della sua etichetta: apre il campo sull'etichetta, o su una
  /// nuova al centro della forma, larga quanto il suo riquadro del testo, col
  /// colore e il corpo dello strumento Testo. Vero se l'ha aperto.
  const editLabel = (unit: Unit): boolean => {
    const model = ctx.engine.model;
    if (model === null || !editable() || !labelHost(unit)) return false;
    const label = labelledPair(unit.node)?.label ?? labelIn(unit.node);
    if (label !== null) {
      const found = currentIndex().get(keyOfNode(label));
      if (found === null || found.look === null) return false;
      editText(found, unit.key);
      return true;
    }
    const place = labelPlace(model, unit);
    if (place === null) return false;
    const width = labelWidth(place.frame, textStyle.width);
    const before: Rich = {
      attrs: { ...newTextAttrs(), "text-anchor": "middle", [WRAP]: wrapValue(width) },
      inherited: initialText(),
      lines: [{ attrs: { dy: "0" }, spans: [] }],
    };
    const [cx, cy] = place.frame.centre;
    const matrix = compose(translate(cx, cy), rotate(place.frame.angle));
    startTyping({ key: null, before, file: null, look: null, wrap: width, at: [0, 0], matrix, label: { middle: 0, select: unit.key, shape: unit.key } });
    return true;
  };
  ctx.editLabel = editLabel;

  /// F2, o «Modifica il testo»: il testo scelto, se è solo, o l'etichetta
  /// della forma scelta.
  function editSelectedText(): void {
    if (!editable() || !has("text")) return;
    const units = selectedUnits();
    if (units.length === 1 && units[0]!.look === null && editLabel(units[0]!)) return;
    if (units.length !== 1 || units[0]!.look === null) {
      announce(t("draw.text.none"));
      return;
    }
    editText(units[0]!);
  }
  ctx.editSelectedText = editSelectedText;

  /// Lo strumento Testo in `p`: cambia il testo che c'è sotto, o ne comincia
  /// uno nuovo con la prima riga a metà su `p`, come il cursore di testo.
  /// Con l'aggancio la linea di base va sulla griglia.
  const openText = (p: Point, pointer: InkPointerType): void => {
    if (!editable() || !has("text")) return;
    const hit = currentIndex().at(p, HIT_PX[pointer] / ctx.camera.scale);
    if (hit !== null && hit.look !== null) {
      editText(hit);
      return;
    }
    const to = target(newIds());
    if (to === null) return;
    const local = apply(to.inverse, p);
    const below = baselineOf("normal", "400", TEXT_FAMILY) * textStyle.width;
    const base = snapped(apply(to.matrix, [local[0], local[1] + below]));
    const before: Rich = { attrs: newTextAttrs(), inherited: initialText(), lines: [{ attrs: { dy: "0" }, spans: [] }] };
    startTyping({ key: null, before, file: null, look: null, wrap: null, at: apply(to.inverse, base), matrix: to.matrix, label: null });
  };
  ctx.openText = openText;

  /// Lo strumento Testo trascinato da `from` a `end`: un testo in area
  /// nuovo, largo quanto il trascinamento e almeno quanto il corpo, con la
  /// prima riga in cima al riquadro. L'aggancio vale per i due angoli.
  const openArea = (from: Point, end: Point): void => {
    if (!editable() || !has("text")) return;
    const to = target(newIds());
    if (to === null) return;
    const a = apply(to.inverse, snapped(from));
    const b = apply(to.inverse, snapped(end));
    const size = textStyle.width;
    const width = Math.max(Math.abs(b[0] - a[0]), size);
    // Dalla cima della riga alla sua linea di base, come la mette il campo.
    const drop = size * (LINE_SPACING / 2 + baselineOf("normal", "400", TEXT_FAMILY));
    const before: Rich = { attrs: { ...newTextAttrs(), [WRAP]: wrapValue(width) }, inherited: initialText(), lines: [{ attrs: { dy: "0" }, spans: [] }] };
    startTyping({ key: null, before, file: null, look: null, wrap: width, at: [Math.min(a[0], b[0]), Math.min(a[1], b[1]) + drop], matrix: to.matrix, label: null });
  };
  ctx.openArea = openArea;

  /// Chiude il campo; con `write` scrive ciò che è cambiato, in un passo di
  /// annulla. Un testo nuovo entra nel livello che riceve, uno che c'è
  /// cambia le sue righe, e uno svuotato se ne va.
  function finishText(write = true): void {
    const now = ctx.typing;
    if (now === null) return;
    ctx.typing = null;
    const draft = field.rich;
    // Il fuoco torna al foglio prima che il campo sparisca: altrimenti
    // andrebbe alla pagina, e i tasti del disegno non varrebbero più.
    if (document.activeElement === textInput) surface.focus({ preventScroll: true });
    textLayer.hidden = true;
    field.close();
    painter.setDraft(null);
    const unit = now.key === null ? null : currentIndex().get(now.key);
    // Un testo in area va a capo come lo scrive il file: i paragrafi come li
    // mostra SVG, nella larghezza del riquadro.
    const place = placeOf(now);
    const flowed = place.wrap === null ? null : wrapParagraphs(tidyRich(unwrap(draft)), place.wrap, measureText, newLeading(draft));
    const tidy = flowed?.rich ?? tidyRich(draft);
    const lines = tidy.lines.map(lineRuns);
    if (!write || sameRich(draft, now.before) || !editable() || (now.key === null && lines.length === 0)) {
      const back = now.label?.select ?? unit?.key ?? null;
      if (back !== null) select([back]);
      else syncControls();
      return;
    }
    if (now.key === null && now.label !== null) {
      finishLabel(now.label, tidy, flowed?.overflow === true);
      return;
    }
    if (now.key === null) {
      const ids = newIds();
      const to = target(ids);
      if (to === null) {
        syncControls();
        return;
      }
      const id = ids.next("object");
      // Il testo come l'ha lasciato il campo, nel punto dove si è aperto;
      // ogni riga comincia dalla stessa `x`.
      const at = apply(to.inverse, apply(now.matrix, now.at));
      const x = formatNumber(at[0], 2);
      const placed: Rich = {
        ...tidy,
        attrs: { id, x, y: formatNumber(at[1], 2), ...tidy.attrs },
        lines: tidy.lines.map((line) => ({ ...line, attrs: { x, ...line.attrs } })),
      };
      const elem = richElem({ tag: "text", attrs: {} }, placed);
      const ops: Op[] = [...to.prelude, addOp(to, elem)];
      const page = grownPage(elemBounds(elem, to.matrix));
      if (page !== null) ops.push({ op: "page", viewBox: page });
      if (commit("draw.action.text", asGesture(ops)) === null) return;
      select([id]);
      announce(`${t("draw.added.text")} ${objects()}${flowed?.overflow === true ? ` ${t("draw.text.overflow")}` : ""}`);
      return;
    }
    const model = ctx.engine.model;
    if (unit === null || model === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.missing_target") }));
      syncControls();
      return;
    }
    if (lines.length === 0 && now.label !== null) {
      // Un'etichetta svuotata se ne va, e la forma torna com'era.
      const group = unit.node.parent === null ? null : currentIndex().get(keyOfNode(unit.node.parent));
      const removed = unlabelOps(model, unit, group, newIds(), (id) => cited(id));
      if (commit("draw.action.label_remove", asGesture(removed.ops)) === null) return;
      select(removed.keys);
      announce(t("draw.label.removed"));
      return;
    }
    if (lines.length === 0) {
      if (commit("draw.action.delete", asGesture(removeOps([unit]))) === null) return;
      select([]);
      announce(`${plural(1, "draw.deleted.one", "draw.deleted.other")} ${objects()}`);
      return;
    }
    const node = nodeOf(model, unit);
    // Un testo che un'operazione non sa riscrivere intero cambia le righe;
    // in area, anche come continuano i paragrafi.
    const joins = flowed === null ? undefined : tidy.lines.map((line) => line.attrs[JOIN] ?? null);
    const change: RichChange = now.file !== null ? richChange(now.file, tidy) : joins === undefined ? { kind: "lines", lines } : { kind: "lines", lines, joins };
    if (change.kind === "none") {
      select([unit.key]);
      return;
    }
    const plan = new Plan(model, newIds());
    const id = plan.idOf(node);
    const old = change.kind === "elem" ? elemOf(node) : null;
    if (change.kind === "lines") plan.ops.push(change.joins === undefined ? { op: "text", id, lines: change.lines } : { op: "text", id, lines: change.lines, joins: change.joins });
    else if (old === null || !replaceElem(plan, node, richElem(old, change.rich))) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      select([unit.key]);
      return;
    }
    const ops: Op[] = [...plan.finish([id]).ops];
    // L'etichetta di una forma torna al centro nello stesso passo: la pagina
    // cresce se ne esce da lì.
    const shape = now.label === null ? null : labelTarget(node);
    const page = grownPage(shape !== null ? labelExtent(shape, tidy, measureText) : linesBounds(unit.look ?? now.look!, tidy.lines.map(richLineText), unit.matrix));
    if (page !== null) ops.push({ op: "page", viewBox: page });
    if (commit("draw.action.text_edit", asGesture(ops)) === null) return;
    select([now.label?.select ?? id]);
    announce(flowed?.overflow === true ? `${t("draw.text.edited")} ${t("draw.text.overflow")}` : t("draw.text.edited"));
  }
  ctx.finishText = finishText;

  /// Scrive l'etichetta nuova `draft` nella forma di `label`, in un passo di
  /// annulla: in un gruppo nuovo con la forma, o accanto a lei nel suo.
  function finishLabel(label: TypingLabel, draft: Rich, overflow: boolean): void {
    const model = ctx.engine.model;
    const shape = label.shape === null ? null : currentIndex().get(label.shape);
    if (model === null || shape === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.missing_target") }));
      syncControls();
      return;
    }
    const made = labelOps(model, shape, draft, measureText, newIds());
    if (made === null) {
      announce(t("draw.rejected", { reason: t("draw.reason.invalid") }));
      select([shape.key]);
      return;
    }
    const page = grownPage(made.extent);
    if (commit("draw.action.label", asGesture(page === null ? made.ops : [...made.ops, { op: "page", viewBox: page }])) === null) return;
    suggestions.done("label-shape");
    select(made.keys);
    announce(overflow ? `${t("draw.label.added")} ${t("draw.text.overflow")}` : t("draw.label.added"));
  }

  // Il fuoco che va altrove conclude il testo. Una finestra dell'editor, come
  // «Altro colore…», lo ridà al campo quando si chiude, e così la finestra
  // del browser quando ci si torna.
  life.listen(textInput, "blur", () => {
    if (ctx.asking || !document.hasFocus()) return;
    finishText();
  });
  // Lo strato non scorre: il campo resta sopra il suo testo.
  life.listen(textLayer, "scroll", () => {
    textLayer.scrollTop = 0;
    textLayer.scrollLeft = 0;
  });
  // Un carattere che arriva dopo cambia le misure del campo, e così una
  // famiglia del vault che ora c'è.
  if (typeof document.fonts?.addEventListener === "function") life.listen(document.fonts, "loadingdone", () => placeText());
  life.add(drawingFonts.watch(() => placeText()));
  // Il tocco che apre un testo col dito manda dopo, per compatibilità, un
  // `mousedown` che porterebbe il fuoco al foglio.
  life.listen(surface, "mousedown", (event) => {
    if (ctx.typing !== null) event.preventDefault();
  });
  // Un pulsante della barra non toglie il fuoco al campo: il colore e la
  // dimensione scelti mentre si scrive valgono per il testo nuovo, e i
  // pulsanti che cambiano altro lo concludono da sé.
  life.listen(toolbar, "mousedown", (event) => {
    if (ctx.typing !== null && (event.target as Element | null)?.closest("button")) event.preventDefault();
  });

  // --- Il cursore del foglio ----------------------------------------------------
  //
  // La tastiera disegna con gli stessi gesti del puntatore: Spazio preme e,
  // di nuovo, rilascia, e in mezzo le frecce portano il cursore. I campioni
  // vanno ai gestori della pipeline come quelli di un mouse, così ogni
  // strumento funziona da tastiera senza un secondo codice.

  /// Il cursore dov'è, o al centro di ciò che si vede.
  const cursorPoint = (): Point => {
    ctx.cursor ??= toScene(ctx.camera, viewCenter());
    return ctx.cursor;
  };
  ctx.cursorPoint = cursorPoint;

  /// La vista segue il cursore quando arriva al bordo, o sotto i righelli.
  const keepInView = (p: Point): void => {
    const { x: left, y: top, w, h } = viewArea();
    if (w === 0 || h === 0) return;
    const margin = Math.min(CURSOR_MARGIN_PX, w / 4, h / 4);
    const [sx, sy] = toScreen(ctx.camera, p);
    const x = sx - left;
    const y = sy - top;
    const dx = x < margin ? margin - x : x > w - margin ? w - margin - x : 0;
    const dy = y < margin ? margin - y : y > h - margin ? h - margin - y : 0;
    if (dx === 0 && dy === 0) return;
    ctx.placed = true;
    setCamera(panned(ctx.camera, dx, dy));
  };

  /// Dove è il cursore, e che cosa c'è sotto: con la penna di Bézier, il
  /// primo nodo o l'ultimo, se un tocco lì chiude o conclude il tracciato;
  /// con la Curvatura anche un punto in mezzo, che un tocco cambia; col
  /// contagocce la forma e il colore; con lo strumento Sfumatura un capo, un
  /// punto o la linea.
  const announceCursor = (): void => {
    const p = cursorPoint();
    const at = t("draw.cursor.at", { x: coordText(p[0]), y: coordText(p[1]) });
    const aim = ctx.pressed === null && drawing() !== null ? bezierTarget(p, "mouse") : "add";
    if (aim === "point") {
      announce(`${at}: ${bezierNodeText(drawing()!.nodes, middlePoint(p, "mouse"))} ${t("draw.bezier.cursor.point")}`);
      return;
    }
    if (aim !== "add") {
      announce(`${at}: ${t(aim === "close" ? "draw.bezier.cursor.close" : "draw.bezier.cursor.last")}`);
      return;
    }
    if (ctx.pressed === null && ctx.tool === "scissors" && has("scissors")) {
      const found = cutSpotAt(p, "mouse");
      if (typeof found !== "string") {
        announce(`${at}: ${cutSpotText(found)}`);
        return;
      }
    }
    if (ctx.pressed === null && ctx.tool === "width" && has("width")) {
      const found = widthSpotAt(p, "mouse");
      if (typeof found !== "string") {
        announce(`${at}: ${widthSpotText(found)}`);
        return;
      }
    }
    if (ctx.pressed === null && ctx.tool === "gradient") {
      const read = gradientNow();
      const spot = read === null ? null : gradientSpotAt(read, p, "mouse", false);
      if (read !== null && spot !== null) {
        announce(`${at}: ${gradientSpotText(read, spot, true)}`);
        return;
      }
    }
    if (ctx.pressed === null && ctx.tool === "eyedropper" && has("eyedropper")) {
      const hovered = ctx.dropperHover;
      const seen = hovered !== null && hovered.at === p && hovered.index === currentIndex() ? hovered.seen : dropperAt(p, "mouse");
      if (seen !== null) {
        announce(`${at}: ${dropperText(seen, p)}`);
        return;
      }
    }
    const hit = ctx.pressed === null ? currentIndex().at(p, HIT_PX.mouse / ctx.camera.scale) : null;
    announce(hit === null ? at : `${at}: ${labelOf(hit)}`);
  };
  ctx.announceCursor = announceCursor;

  /// Il gesto da tastiera arriva a `p`, con un campione ogni
  /// [`CURSOR_SAMPLE_PX`] pixel. Al limite dei campioni si rilascia.
  const trace = (p: Point): void => {
    const g = ctx.pressed;
    if (g === null) return;
    const [x0, y0] = g.at;
    const steps = Math.max(1, Math.ceil((Math.hypot(p[0] - x0, p[1] - y0) * ctx.camera.scale) / CURSOR_SAMPLE_PX));
    const samples: InkSample[] = [];
    for (let i = 1; i <= steps && g.samples.length + samples.length < INK_MAX_SAMPLES; i++) {
      g.time += CURSOR_SAMPLE_MS;
      samples.push({ x: x0 + ((p[0] - x0) * i) / steps, y: y0 + ((p[1] - y0) * i) / steps, t: g.time });
    }
    g.at = p;
    g.samples.push(...samples);
    if (samples.length > 0) handlers.onSamples(g.start.id, samples);
    if (g.samples.length >= INK_MAX_SAMPLES) release();
  };

  /// Porta il cursore in `next`, un punto della scena.
  const placeCursor = (next: Point): void => {
    ctx.cursor = next;
    cursorMark.hidden = false;
    keepInView(next);
    showCursor();
    trace(next);
    if (ctx.pressed === null && drawing() !== null) {
      ctx.hover = { at: next, pointer: "mouse" };
      showBezier();
    }
    if (ctx.pressed === null) {
      hoverCut(next, "mouse");
      hoverWidth(next, "mouse");
      hoverDropper(next, "mouse", true);
    }
    announceCursor();
  };

  /// Muove il cursore di (`dx`, `dy`) pixel dello schermo.
  const moveCursor = (dx: number, dy: number): void => {
    const [x, y] = cursorPoint();
    if (ctx.camera.angle === 0) {
      placeCursor([x + dx / ctx.camera.scale, y + dy / ctx.camera.scale]);
      return;
    }
    // Sul foglio girato, dove punta sullo schermo.
    const [ox, oy] = toScene(ctx.camera, [0, 0]);
    const [px, py] = toScene(ctx.camera, [dx, dy]);
    placeCursor([x + px - ox, y + py - oy]);
  };
  ctx.moveCursor = moveCursor;

  /// Con l'aggancio, una freccia porta il cursore all'incrocio `lines` righe
  /// più in là nel suo verso, e sulla riga più vicina sull'altro asse.
  const moveCursorOnGrid = (x: number, y: number, lines: number): void => {
    const [cx, cy] = cursorPoint();
    placeCursor([
      x === 0 ? snapValue(cx, stepNow()) : lineBeyond(cx, stepNow(), sign(x), lines),
      y === 0 ? snapValue(cy, stepNow()) : lineBeyond(cy, stepNow(), sign(y), lines),
    ]);
  };
  ctx.moveCursorOnGrid = moveCursorOnGrid;

  /// Spazio: il gesto comincia dove è il cursore.
  const press = (timeStamp: number): void => {
    if (ctx.pressed !== null || !editable()) return;
    cancelGesture();
    ctx.closedTyping = false;
    const at = cursorPoint();
    const start: StrokeStart = { id: --ctx.keyStrokes, pointerType: "mouse", pressure: false, timeStamp, continued: false };
    const first: InkSample = { x: at[0], y: at[1], t: 0 };
    ctx.pressed = { start, samples: [first], at, time: 0 };
    cursorMark.hidden = false;
    showCursor();
    handlers.onStart(start);
    handlers.onSamples(start.id, [first]);
    announce(t("draw.cursor.down"));
  };
  ctx.press = press;

  /// Spazio di nuovo, o Invio: il gesto finisce e scrive. Se non dice niente
  /// lui, si dice che il cursore è su.
  function release(): void {
    const g = ctx.pressed;
    if (g === null) return;
    ctx.pressed = null;
    showCursor();
    const before = live.textContent;
    handlers.onEnd({ ...g.start, samples: g.samples, tilt: false, split: false });
    if (live.textContent === before) announce(t("draw.cursor.up"));
  }
  ctx.release = release;

  /// Il gesto da tastiera non scrive niente.
  function cancelPress(): void {
    const g = ctx.pressed;
    if (g === null) return;
    ctx.pressed = null;
    showCursor();
    handlers.onCancel(g.start.id, "api");
  }
  ctx.cancelPress = cancelPress;

  // Il fuoco che lascia il foglio porta via il gesto e il cursore.
  life.listen(surface, "blur", () => {
    cancelPress();
    cursorMark.hidden = true;
  });
}
