// Le opzioni della Penna e della Gomma nella riga delle opzioni (P3, P8).
//
// Con la Penna, la penna con cui scrive: un pulsante col suo nome che apre la
// galleria, le sei penne della Penna (`ink/pens.ts`) con l'anteprima del
// tratto, poi «Le mie penne» e «Salva come penna…». Con la Penna e con
// l'Evidenziatore, la misura (un campo e un cursore logaritmico da 0,25 a
// 200) e l'opacità. Con la Gomma, come cancella: il tratto intero, o soltanto
// dove passa.
//
// La penna e la gomma sono della macchina, come la curva della penna: stanno
// nella griglia ricordata (`draw.grid`). Le mie penne anche, nella loro chiave
// (`draw.pens`). Misura e opacità valgono finché l'editor vive, come gli
// spessori della barra.
//
// «Mano» apre la levigatura e la curva della pressione (P5): gli stessi
// gruppi della finestra «Penna e dita» (`hand-controls.ts`), che scrivono la
// griglia appena una scelta è fatta.

import { numberField } from "../../../../../kit/number-field";
import { openPopover, type PopoverHandle } from "../../../../../kit/popover";
import { inkPath } from "../../../../../ink/outline";
import {
  DEFAULT_PEN,
  MAX_PEN_NAME,
  MAX_PEN_SIZE,
  MAX_SAVED_PENS,
  MIN_PEN_SIZE,
  PEN_IDS,
  penBrush,
  penLook,
  SIZE_SLIDER_STEPS,
  sizeToSlider,
  sliderToSize,
  type PenId,
  type SavedPen,
} from "../../../../../ink/pens";
import { quantizeInk } from "../../../../../ink/sample";
import { identifier } from "../../../../../ui/a11y";
import { promptText } from "../../../../../ui/dialogs";
import { formatNumber } from "../../../number";
import { t, type DrawKey } from "../../../strings";
import type { EraseMode, Fidelity } from "../../grid";
import { pressureGroup, steadyGroup } from "../../hand-controls";
import type { EditorContext } from "../context";

export interface PenOptionsContext {
  /// Mostra le opzioni dello strumento di adesso, con le scelte di adesso.
  syncPenOptions: () => void;
  /// Sceglie la penna della Penna, e la ricorda.
  setPen: (pen: PenId) => void;
  /// Sceglie come cancella la gomma, e lo ricorda.
  setEraser: (mode: EraseMode) => void;
  /// Prende una penna salvata: penna, misura, colore e opacità.
  useSavedPen: (pen: SavedPen) => void;
}

/// Le uscite della Penna: l'inchiostro, o il tracciato con una fedeltà.
type OutputChoice = "ink" | Fidelity;
const OUTPUT_CHOICES: readonly OutputChoice[] = ["ink", "high", "medium", "low"];
const OUTPUT_LABELS: Readonly<Record<OutputChoice, DrawKey>> = {
  ink: "draw.pen.output.ink",
  high: "draw.pen.output.high",
  medium: "draw.pen.output.medium",
  low: "draw.pen.output.low",
};

/// Il nome di ogni penna.
export const PEN_LABELS: Readonly<Record<PenId, DrawKey>> = {
  ballpoint: "draw.pen.ballpoint",
  fountain: "draw.pen.fountain",
  brush: "draw.pen.brush",
  marker: "draw.pen.marker",
  pencil: "draw.pen.pencil",
  calligraphy: "draw.pen.calligraphy",
  highlighter: "draw.pen.highlighter",
};

const ERASE_MODES: ReadonlyArray<{ readonly mode: EraseMode; readonly label: DrawKey }> = [
  { mode: "stroke", label: "draw.eraser.stroke" },
  { mode: "precise", label: "draw.eraser.precise" },
];

/// Il tratto d'esempio della galleria: un'onda con la pressione che cresce e
/// cala, nelle unità dell'inchiostro (centesimi).
const SAMPLE = Array.from({ length: 24 }, (_, i) => {
  const k = i / 23;
  return { x: 400 + k * 5200, y: 1400 - Math.sin(k * Math.PI * 2) * 700, p: Math.sin(k * Math.PI), t: i * 16 };
});

/// La misura del tratto d'esempio: le penne si confrontano alla stessa misura.
const SAMPLE_SIZE = 6;

/// L'anteprima del tratto di `pen`, in `color`.
function penPreview(pen: PenId, color: string, opacity = 1): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "draw-pen-preview");
  svg.setAttribute("viewBox", "0 0 60 28");
  svg.setAttribute("aria-hidden", "true");
  const brush = penBrush(pen, SAMPLE_SIZE, true);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", inkPath(quantizeInk(SAMPLE.map((s) => ({ x: s.x / 100, y: s.y / 100, p: s.p, t: s.t })), 100), brush));
  path.setAttribute("fill", color);
  const look = penLook(brush, pen === "highlighter" ? "highlighter" : "pen");
  const covers = look.opacity * opacity;
  if (covers < 1) path.setAttribute("fill-opacity", String(covers));
  svg.append(path);
  return svg;
}

export function installPenOptions(ctx: EditorContext, penGroup: HTMLElement, eraserGroup: HTMLElement): void {
  const { life } = ctx;

  // La penna: un pulsante che apre la galleria della Penna.
  const penButton = document.createElement("button");
  penButton.type = "button";
  penButton.className = "draw-button draw-pen-choice";
  penButton.tabIndex = -1;
  penButton.setAttribute("aria-haspopup", "dialog");
  penButton.setAttribute("aria-expanded", "false");
  penButton.id = identifier("draw-pen-choice");
  const penName = document.createElement("span");
  penName.className = "draw-pen-name";
  penButton.append(penName);
  penGroup.append(penButton);
  const pens = PEN_IDS.filter((pen) => pen !== "highlighter");
  let gallery: PopoverHandle | null = null;
  life.listen(penButton, "click", () => {
    if (gallery !== null && !gallery.closed) {
      gallery.close();
      return;
    }
    openGallery();
  });

  /// Apre la galleria: le penne, le mie penne, «Salva come penna…».
  const openGallery = (): void => {
    const content = document.createElement("div");
    content.className = "draw-pen-gallery";
    const heading = (key: DrawKey): void => {
      const title = document.createElement("h2");
      title.className = "draw-pen-gallery-heading";
      title.textContent = t(key);
      content.append(title);
    };
    const item = (parent: HTMLElement, label: string, preview: SVGSVGElement, chosen: boolean, run: () => void): HTMLButtonElement => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "draw-pen-gallery-item";
      control.setAttribute("aria-pressed", String(chosen));
      const name = document.createElement("span");
      name.textContent = label;
      control.append(preview, name);
      control.addEventListener("click", () => {
        run();
        gallery?.close();
      });
      parent.append(control);
      return control;
    };
    const color = ctx.style().color;
    heading("draw.pen.gallery");
    const system = document.createElement("div");
    system.className = "draw-pen-gallery-list";
    content.append(system);
    for (const pen of pens) item(system, t(PEN_LABELS[pen]), penPreview(pen, color), pen === ctx.penId, () => setPen(pen));
    heading("draw.pen.mine");
    const mine = document.createElement("div");
    mine.className = "draw-pen-gallery-list";
    content.append(mine);
    if (ctx.savedPens.length === 0) {
      const empty = document.createElement("p");
      empty.className = "draw-pen-gallery-empty";
      empty.textContent = t("draw.pen.mine.empty");
      mine.append(empty);
    }
    for (const saved of ctx.savedPens) {
      const row = document.createElement("div");
      row.className = "draw-pen-saved";
      item(row, saved.name, penPreview(saved.pen, saved.color, saved.opacity), false, () => useSavedPen(saved));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "draw-pen-saved-remove";
      remove.textContent = "×";
      const label = t("draw.pen.remove", { name: saved.name });
      remove.setAttribute("aria-label", label);
      remove.title = label;
      remove.addEventListener("click", () => {
        changePens(ctx.savedPens.filter((each) => each !== saved));
        ctx.announce(t("draw.pen.removed", { name: saved.name }));
        gallery?.close();
        openGallery();
      });
      row.append(remove);
      mine.append(row);
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "draw-pen-gallery-save";
    save.textContent = t("draw.pen.save");
    save.disabled = ctx.savedPens.length >= MAX_SAVED_PENS;
    save.addEventListener("click", () => {
      gallery?.close();
      void savePen();
    });
    content.append(save);
    penButton.setAttribute("aria-expanded", "true");
    gallery = openPopover({
      anchor: penButton,
      content,
      label: t("draw.pen.gallery"),
      className: "draw-pen-popover",
      lifetime: life,
      onClose: () => penButton.setAttribute("aria-expanded", "false"),
    });
    (content.querySelector<HTMLElement>("[aria-pressed='true']") ?? content.querySelector<HTMLElement>("button"))?.focus();
  };

  /// «Salva come penna…»: la penna, la misura, il colore e l'opacità di
  /// adesso, con un nome. Lo stesso nome sostituisce la penna di prima.
  const savePen = async (): Promise<void> => {
    if (ctx.asking) return;
    ctx.asking = true;
    let name: string | null;
    try {
      name = await promptText({ title: t("draw.pen.save.title"), label: t("draw.pen.save.name"), value: t(PEN_LABELS[ctx.penId]) });
    } finally {
      ctx.asking = false;
    }
    if (ctx.disposed || name === null) return;
    const clean = name.trim().slice(0, MAX_PEN_NAME);
    if (clean === "") return;
    const { color, width } = ctx.style();
    const saved: SavedPen = { name: clean, pen: ctx.penId, size: width, color, opacity: ctx.inkOpacity.pen };
    changePens([...ctx.savedPens.filter((each) => each.name !== clean), saved].slice(-MAX_SAVED_PENS));
    ctx.announce(t("draw.pen.saved", { name: clean }));
  };

  const changePens = (next: readonly SavedPen[]): void => {
    ctx.savedPens = next;
    ctx.options.onPensChange?.(next);
  };

  /// Prende una penna salvata.
  const useSavedPen = (saved: SavedPen): void => {
    if (ctx.tool !== "pen") ctx.setTool("pen");
    setPen(saved.pen, false);
    ctx.inkOpacity.pen = saved.opacity;
    ctx.setWidth(saved.size);
    ctx.setColor(saved.color);
    syncPenOptions();
    ctx.announce(t("draw.pen.chosen", { pen: saved.name }));
  };
  ctx.useSavedPen = useSavedPen;

  // La mano: la levigatura e la curva della pressione, dal livello che ha i
  // gesti, come «Penna e dita».
  const handButton = document.createElement("button");
  handButton.type = "button";
  handButton.className = "draw-button draw-pen-choice";
  handButton.tabIndex = -1;
  handButton.setAttribute("aria-haspopup", "dialog");
  handButton.setAttribute("aria-expanded", "false");
  const handName = document.createElement("span");
  handName.className = "draw-pen-name";
  handButton.append(handName);
  penGroup.append(handButton);
  let hand: PopoverHandle | null = null;
  life.listen(handButton, "click", () => {
    if (hand !== null && !hand.closed) {
      hand.close();
      return;
    }
    const content = document.createElement("div");
    content.className = "draw-hand-panel";
    const steady = steadyGroup(ctx.grid.steady, (next) => ctx.changeGrid({ ...ctx.grid, steady: next }));
    const pressure = pressureGroup(ctx.grid.pen, (next) => ctx.changeGrid({ ...ctx.grid, pen: next }));
    content.append(steady.element, pressure.element);
    handButton.setAttribute("aria-expanded", "true");
    hand = openPopover({
      anchor: handButton,
      content,
      label: t("draw.pen.hand"),
      lifetime: life,
      onClose: () => handButton.setAttribute("aria-expanded", "false"),
    });
    steady.focus();
  });

  // L'uscita (P11): l'inchiostro, o un tracciato con la sua fedeltà. Il
  // tracciato non tiene i campioni, e la scelta lo dice prima.
  const outputButton = document.createElement("button");
  outputButton.type = "button";
  outputButton.className = "draw-button draw-pen-choice";
  outputButton.tabIndex = -1;
  outputButton.setAttribute("aria-haspopup", "dialog");
  outputButton.setAttribute("aria-expanded", "false");
  const outputName = document.createElement("span");
  outputName.className = "draw-pen-name";
  outputButton.append(outputName);
  penGroup.append(outputButton);
  let output: PopoverHandle | null = null;
  const outputNow = (): OutputChoice => (ctx.grid.output === "path" ? (ctx.grid.fidelity ?? "medium") : "ink");
  life.listen(outputButton, "click", () => {
    if (output !== null && !output.closed) {
      output.close();
      return;
    }
    const content = document.createElement("div");
    content.className = "draw-pen-gallery";
    const title = document.createElement("h2");
    title.className = "draw-pen-gallery-heading";
    title.textContent = t("draw.pen.output");
    const note = document.createElement("p");
    note.className = "draw-pen-gallery-empty";
    note.textContent = t("draw.pen.output.note");
    const list = document.createElement("div");
    list.className = "draw-pen-gallery-list";
    const now = outputNow();
    let first: HTMLButtonElement | null = null;
    for (const choice of OUTPUT_CHOICES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "draw-pen-gallery-item";
      item.textContent = t(OUTPUT_LABELS[choice]);
      item.setAttribute("aria-pressed", String(choice === now));
      if (choice === now || first === null) first = item;
      life.listen(item, "click", () => {
        ctx.changeGrid(choice === "ink" ? { ...ctx.grid, output: "ink" } : { ...ctx.grid, output: "path", fidelity: choice });
        output?.close();
        syncPenOptions();
        ctx.announce(t("draw.pen.output.chosen", { output: t(OUTPUT_LABELS[choice]) }));
      });
      list.append(item);
    }
    content.append(title, note, list);
    outputButton.setAttribute("aria-expanded", "true");
    output = openPopover({
      anchor: outputButton,
      content,
      label: t("draw.pen.output"),
      lifetime: life,
      onClose: () => outputButton.setAttribute("aria-expanded", "false"),
    });
    first?.focus();
  });

  // La misura: un campo, e un cursore logaritmico.
  const inkTool = (): "pen" | "highlighter" => (ctx.tool === "highlighter" ? "highlighter" : "pen");
  const sizeBox = document.createElement("div");
  sizeBox.className = "draw-pen-size";
  const size = numberField({
    label: t("draw.pen.size"),
    labelHidden: true,
    value: null,
    places: 2,
    min: MIN_PEN_SIZE,
    max: MAX_PEN_SIZE,
    mixedText: t("draw.chrome.mixed"),
    problem: () => t("draw.pen.size.problem", { min: formatNumber(MIN_PEN_SIZE, 2), max: formatNumber(MAX_PEN_SIZE, 0) }),
    lifetime: life,
    onCommit: (value) => {
      ctx.setWidth(Math.min(MAX_PEN_SIZE, Math.max(MIN_PEN_SIZE, value)));
      syncPenOptions();
      ctx.repenSelection({ size: ctx.style().width });
    },
  });
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "draw-pen-size-slider";
  slider.min = "0";
  slider.max = String(SIZE_SLIDER_STEPS);
  slider.tabIndex = -1;
  life.listen(slider, "input", () => {
    ctx.setWidth(sliderToSize(Number(slider.value)));
    syncPenOptions();
  });
  // I tratti scelti si ripennano quando il cursore si lascia: un passo solo.
  life.listen(slider, "change", () => ctx.repenSelection({ size: ctx.style().width }));
  sizeBox.append(size.element, slider);
  penGroup.append(sizeBox);

  // L'opacità, in percento.
  const opacity = numberField({
    label: t("draw.pen.opacity"),
    labelHidden: true,
    value: 100,
    unit: "%",
    places: 0,
    min: 1,
    max: 100,
    mixedText: t("draw.chrome.mixed"),
    problem: () => t("draw.pen.opacity.problem"),
    lifetime: life,
    onCommit: (value) => {
      ctx.inkOpacity[inkTool()] = Math.min(100, Math.max(1, value)) / 100;
      syncPenOptions();
      ctx.repenSelection({ opacity: ctx.inkOpacity[inkTool()] });
    },
  });
  opacity.element.classList.add("draw-pen-opacity");
  penGroup.append(opacity.element);

  // La gomma: due scelte, come gli spessori.
  const eraserButtons = ERASE_MODES.map(({ mode, label }) => {
    const control = ctx.button(eraserGroup, "draw-button draw-eraser-mode", () => t(label), null, () => setEraser(mode));
    control.setAttribute("role", "radio");
    const text = document.createElement("span");
    text.className = "draw-eraser-mode-name";
    control.append(text);
    return { mode, label, control, text };
  });

  const setPen = (pen: PenId, speak = true): void => {
    if (pen === ctx.penId) return;
    ctx.penId = pen;
    ctx.changeGrid({ ...ctx.grid, penId: pen });
    syncPenOptions();
    if (!speak) return;
    ctx.announce(t("draw.pen.chosen", { pen: t(PEN_LABELS[pen]) }));
    // Con dei tratti scelti, la penna nuova li ridisegna (P10).
    ctx.repenSelection({ pen });
  };
  ctx.setPen = (pen) => setPen(pen);

  const setEraser = (mode: EraseMode): void => {
    if (mode === (ctx.grid.eraser ?? "stroke")) return;
    ctx.changeGrid({ ...ctx.grid, eraser: mode });
    syncPenOptions();
    ctx.announce(t(mode === "precise" ? "draw.eraser.precise" : "draw.eraser.stroke"));
  };
  ctx.setEraser = setEraser;

  const syncPenOptions = (): void => {
    const canEdit = ctx.editable();
    // In «Semplice» bastano il pozzo del colore e gli spessori della barra.
    const inking = (ctx.tool === "pen" || ctx.tool === "highlighter") && ctx.workspace !== "simple";
    penGroup.hidden = !inking;
    penButton.hidden = ctx.tool !== "pen";
    eraserGroup.hidden = ctx.tool !== "eraser";
    const name = t(PEN_LABELS[ctx.penId]);
    if (penName.textContent !== name) penName.textContent = name;
    const label = `${t("draw.pen.choose")}: ${name}`;
    if (penButton.getAttribute("aria-label") !== label) {
      penButton.setAttribute("aria-label", label);
      penButton.title = label;
    }
    penButton.disabled = !canEdit;
    handButton.hidden = !ctx.has("gestures");
    handButton.disabled = !canEdit;
    outputButton.hidden = ctx.tool !== "pen";
    outputButton.disabled = !canEdit;
    const outputLabel = t(OUTPUT_LABELS[outputNow()]);
    if (outputName.textContent !== outputLabel) {
      outputName.textContent = outputLabel;
      outputButton.setAttribute("aria-label", `${t("draw.pen.output")}: ${outputLabel}`);
      outputButton.title = t("draw.pen.output.note");
    }
    const handLabel = t("draw.pen.hand");
    if (handName.textContent !== handLabel) {
      handName.textContent = handLabel;
      handButton.title = t("draw.pen.hand.hint");
    }
    if (inking) {
      const width = ctx.style().width;
      if (size.value() !== width) size.setValue(width);
      const step = String(sizeToSlider(width));
      if (slider.value !== step) slider.value = step;
      const text = t("draw.pen.size.value", { size: formatNumber(width, 2) });
      if (slider.getAttribute("aria-valuetext") !== text) slider.setAttribute("aria-valuetext", text);
      const percent = Math.round(ctx.inkOpacity[inkTool()] * 100);
      if (opacity.value() !== percent) opacity.setValue(percent);
    }
    const sliderLabel = t("draw.pen.size.slider");
    if (slider.getAttribute("aria-label") !== sliderLabel) slider.setAttribute("aria-label", sliderLabel);
    size.setDisabled(!canEdit);
    opacity.setDisabled(!canEdit);
    slider.disabled = !canEdit;
    const mode = ctx.grid.eraser ?? "stroke";
    for (const each of eraserButtons) {
      each.control.setAttribute("aria-checked", String(each.mode === mode));
      each.control.disabled = !canEdit;
      const text = t(each.label);
      if (each.text.textContent !== text) each.text.textContent = text;
    }
  };
  ctx.syncPenOptions = syncPenOptions;
  // La penna ricordata, se è una della Penna.
  const remembered = ctx.grid.penId;
  ctx.penId = remembered !== undefined && remembered !== "highlighter" ? remembered : DEFAULT_PEN;
}
