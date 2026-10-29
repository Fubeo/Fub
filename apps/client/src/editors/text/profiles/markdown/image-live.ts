// L'immagine in Live (D8, D9). Un clic la seleziona, come in Word: contorno e
// maniglia, e la selezione copre esattamente i suoi byte. Con `mai` Invio o il
// doppio clic aprono il riquadro «Immagine» (testo alternativo, file,
// larghezza), che riscrive soltanto i byte dell'immagine; con `elemento` mettono
// il cursore nella sorgente. Mod-clic resta la lightbox della resa. Tirare la
// maniglia mostra la larghezza e scrive `|larghezza` una volta sola, al
// rilascio: un passo di annulla per trascinamento.
import { EditorSelection, type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { openPopover, type PopoverHandle, textButton, textField } from "../../../../kit";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { liveReveal } from "../../live-reveal";
import { liveStrings } from "./strings";

/// Un'immagine come sta scritta: `![alt|320](file "titolo")` o `![[file|320]]`.
export interface ImageSource {
  readonly syntax: "markdown" | "wiki";
  /// Il testo alternativo, senza la dimensione; vuoto per `![[…]]`.
  readonly alt: string;
  /// Il testo alternativo com'è scritto, con le sue barre rovesciate.
  readonly rawAlt: string;
  /// Il file come si legge, senza `<…>`.
  readonly file: string;
  readonly width: number | null;
  readonly height: number | null;
  /// Markdown: la destinazione com'è scritta e il titolo, che restano se il
  /// file non cambia. Wiki: l'alias che non è una dimensione.
  readonly destination: string;
  readonly rest: string;
}

const MARKDOWN = /^!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\s*\)$/u;
const WIKI = /^!\[\[([^\]|#^]+)(?:\|([^\]]*))?\]\]$/u;
const SIZE = /^\s*([1-9]\d{0,4})(?:x([1-9]\d{0,4}))?\s*$/u;
const ALT_SIZE = /^(.*)\|([1-9]\d{0,4})(?:x([1-9]\d{0,4}))?$/u;

/// La lettura di un'immagine scritta; `null` se il testo non è un'immagine sola.
export function parseImage(text: string): ImageSource | null {
  const markdown = MARKDOWN.exec(text);
  if (markdown) {
    const label = markdown[1]!;
    const sized = ALT_SIZE.exec(label);
    const destination = markdown[2]!;
    return {
      syntax: "markdown",
      alt: (sized ? sized[1]! : label).replace(/\\([\]\[\\|])/g, "$1"),
      rawAlt: sized ? sized[1]! : label,
      file: destination.startsWith("<") ? destination.slice(1, -1) : destination,
      width: sized ? Number(sized[2]) : null,
      height: sized?.[3] ? Number(sized[3]) : null,
      destination,
      rest: markdown[3] ?? "",
    };
  }
  const wiki = WIKI.exec(text);
  if (!wiki) return null;
  const alias = wiki[2] ?? "";
  const size = SIZE.exec(alias);
  return {
    syntax: "wiki",
    alt: "",
    rawAlt: "",
    file: wiki[1]!.trim(),
    width: size ? Number(size[1]) : null,
    height: size?.[2] ? Number(size[2]) : null,
    destination: wiki[1]!,
    rest: size ? "" : alias,
  };
}

/// Un'immagine `![[…]]` con un alias che non è una dimensione non ha dove
/// scrivere la larghezza: la barra è già presa.
export function widthWritable(image: ImageSource): boolean {
  return image.syntax === "markdown" || image.rest === "";
}

/// Il testo nuovo di un'immagine. Il file, se non cambia, resta scritto
/// com'era; una larghezza nuova lascia cadere l'altezza, così le proporzioni
/// restano quelle del file.
export function writeImage(image: ImageSource, next: { alt?: string; file?: string; width?: number | null }): string {
  const width = next.width === undefined ? image.width : next.width;
  const height = width === image.width ? image.height : null;
  const size = width === null ? "" : `${width}${height === null ? "" : `x${height}`}`;
  const file = next.file ?? image.file;
  if (image.syntax === "wiki") {
    const tail = image.rest ? `|${image.rest}` : size ? `|${size}` : "";
    return `![[${file === image.file ? image.destination : file}${tail}]]`;
  }
  const alt = next.alt === undefined || next.alt === image.alt ? image.rawAlt : next.alt.replace(/([\]\[\\])/g, "\\$1");
  const destination = file === image.file ? image.destination : /[\s()<>]/.test(file) ? `<${file}>` : file;
  return `![${alt}${size ? `|${size}` : ""}](${destination}${image.rest})`;
}

/// La modifica che porta l'immagine fra `from` e `to` al testo nuovo; la
/// selezione resta sull'immagine. `null` se lì non c'è un'immagine o se non
/// cambia niente.
export function rewriteImage(
  state: EditorState,
  from: number,
  to: number,
  next: { alt?: string; file?: string; width?: number | null },
) {
  const image = parseImage(state.sliceDoc(from, to));
  if (!image) return null;
  const text = writeImage(image, next);
  if (text === state.sliceDoc(from, to)) return null;
  return {
    changes: { from, to, insert: text },
    selection: EditorSelection.single(from, from + text.length),
    userEvent: "input",
  } as const;
}

/// L'immagine selezionata: la selezione copre esattamente un'immagine scritta.
export function selectedImage(state: EditorState): { from: number; to: number; image: ImageSource } | null {
  if (state.selection.ranges.length > 1) return null;
  const { from, to } = state.selection.main;
  if (from === to) return null;
  const image = parseImage(state.sliceDoc(from, to));
  return image ? { from, to, image } : null;
}

const MIN_WIDTH = 16;

/// Dove sta l'immagine di un widget nel documento.
function rangeOf(view: EditorView, root: HTMLElement): { from: number; to: number } | null {
  const length = Number(root.dataset.fubImage);
  if (!Number.isFinite(length) || length <= 0) return null;
  const from = view.posAtDOM(root);
  return { from, to: from + length };
}

function rootAt(view: EditorView, from: number): HTMLElement | null {
  for (const root of view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-image[data-fub-image]")) {
    if (rangeOf(view, root)?.from === from) return root;
  }
  return null;
}

// ── Il riquadro «Immagine» ───────────────────────────────────────────────────

function openImageDialog(view: EditorView, from: number, to: number, anchor: Element, owner: Lifetime): PopoverHandle | null {
  const image = parseImage(view.state.sliceDoc(from, to));
  if (!image) return null;
  const life = openLifetime();
  const content = document.createElement("form");
  content.className = "cm-fub-image-dialog";
  const readOnly = view.state.readOnly;
  const apply = () => {
    // Una larghezza vuota la toglie; una che non è un numero lascia quella di prima.
    const written = widthField.value().trim();
    const parsed = /^\d{1,5}$/.test(written) ? Math.max(MIN_WIDTH, Number(written)) : image.width;
    const next = {
      alt: altField?.value(),
      file: fileField.value().trim() || image.file,
      width: written === "" ? null : parsed,
    };
    popover.close();
    const spec = readOnly ? null : rewriteImage(view.state, from, to, next);
    view.dispatch(spec ?? { selection: EditorSelection.single(from, to) });
    view.focus();
  };
  const altField = image.syntax === "markdown"
    ? textField({ label: liveStrings.t("live.image.alt"), value: image.alt, onSubmit: apply, lifetime: life })
    : null;
  const fileField = textField({ label: liveStrings.t("live.image.file"), value: image.file, onSubmit: apply, lifetime: life });
  const widthField = textField({
    label: liveStrings.t("live.image.width"),
    value: image.width === null ? "" : String(image.width),
    onSubmit: apply,
    lifetime: life,
  });
  widthField.input.inputMode = "numeric";
  const writable = widthWritable(image);
  if (!writable) widthField.input.disabled = true;
  for (const field of [altField, fileField, widthField]) {
    if (!field) continue;
    field.input.spellcheck = false;
    if (readOnly) field.input.readOnly = true;
    content.append(field.element);
  }
  // Le quote della pagina: la larghezza della colonna di testo.
  const shares = document.createElement("div");
  shares.className = "cm-fub-image-shares";
  const page = view.contentDOM.getBoundingClientRect().width;
  for (const percent of [25, 50, 75, 100]) {
    const share = textButton({
      label: `${percent}%`,
      onPress: () => widthField.setValue(String(Math.max(MIN_WIDTH, Math.round(page * percent / 100)))),
      lifetime: life,
    });
    share.setAttribute("aria-label", liveStrings.t("live.image.width.share", { percent: String(percent) }));
    share.disabled = readOnly || !writable;
    shares.append(share);
  }
  content.append(shares);
  const submit = textButton({ label: liveStrings.t("live.image.apply"), kind: "primary", onPress: apply, lifetime: life });
  submit.disabled = readOnly;
  content.append(submit);
  life.listen(content, "submit", (event: Event) => event.preventDefault());
  const popover = openPopover({
    anchor,
    content,
    label: liveStrings.t("live.image.title"),
    className: "cm-fub-image-popover",
    lifetime: owner,
    onClose: (reason) => {
      life.close();
      if (reason === "escape") {
        view.dispatch({ selection: EditorSelection.single(from, Math.min(to, view.state.doc.length)) });
        view.focus();
      }
    },
  });
  (altField ?? fileField).input.focus();
  (altField ?? fileField).input.select();
  return popover;
}

// ── La maniglia ──────────────────────────────────────────────────────────────

function drag(view: EditorView, root: HTMLElement, handle: HTMLElement, event: PointerEvent, owner: Lifetime): void {
  const img = root.querySelector<HTMLElement>("img");
  const range = rangeOf(view, root);
  if (!img || !range) return;
  const life = openLifetime();
  owner.add(() => life.close());
  const startX = event.clientX;
  const start = img.getBoundingClientRect().width;
  const page = view.contentDOM.getBoundingClientRect().width || Number.POSITIVE_INFINITY;
  const badge = document.createElement("span");
  badge.className = "cm-fub-image-size";
  badge.setAttribute("aria-live", "polite");
  root.append(badge);
  root.classList.add("is-resizing");
  let width = Math.round(start);
  const show = () => {
    img.style.width = `${width}px`;
    img.style.height = "auto";
    img.style.maxHeight = "none";
    badge.textContent = liveStrings.t("live.image.size", { width: String(width) });
  };
  show();
  handle.setPointerCapture?.(event.pointerId);
  const finish = (write: boolean) => {
    life.close();
    badge.remove();
    root.classList.remove("is-resizing");
    const spec = write && width !== Math.round(start) && !view.state.readOnly
      ? rewriteImage(view.state, range.from, range.to, { width })
      : null;
    if (spec) view.dispatch(spec);
    else {
      img.style.width = img.style.height = img.style.maxHeight = "";
    }
    view.focus();
  };
  life.listen(handle, "pointermove", (move: PointerEvent) => {
    width = Math.round(Math.min(page, Math.max(MIN_WIDTH, start + move.clientX - startX)));
    show();
  });
  life.listen(handle, "pointerup", () => finish(true));
  life.listen(handle, "pointercancel", () => finish(false));
}

// ── I gesti ──────────────────────────────────────────────────────────────────

const active = (state: EditorState) => {
  const policy = state.facet(liveReveal);
  return policy === "mai" || policy === "elemento";
};

/// I gesti dell'immagine in Live: selezione, riquadro, maniglia.
export function imageGestures(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      readonly life = openLifetime();
      dialog: PopoverHandle | null = null;
      constructor(readonly view: EditorView) {}
      /// Invio o doppio clic sull'immagine fra `from` e `to`.
      open(from: number, to: number): boolean {
        const view = this.view;
        if (view.state.facet(liveReveal) === "elemento") {
          view.dispatch({ selection: { anchor: Math.min(from + 2, to) }, userEvent: "select" });
          return true;
        }
        const anchor = rootAt(view, from);
        if (!anchor) return false;
        this.dialog?.close();
        this.dialog = openImageDialog(view, from, to, anchor, this.life);
        return this.dialog !== null;
      }
      destroy(): void { this.life.close(); }
    },
    {
      eventHandlers: {
        mousedown(event, view) {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || !active(view.state)) return false;
          const target = event.target instanceof Element ? event.target : null;
          const root = target?.closest<HTMLElement>(".cm-fub-image[data-fub-image]");
          const range = root ? rangeOf(view, root) : null;
          if (!root || !range) return false;
          event.preventDefault();
          if (target?.closest(".cm-fub-image-handle")) return true;
          if (event.detail >= 2) return this.open(range.from, range.to);
          view.dispatch({ selection: EditorSelection.single(range.from, range.to), userEvent: "select.pointer" });
          view.focus();
          return true;
        },
        pointerdown(event, view) {
          if (event.button !== 0 || !active(view.state)) return false;
          const handle = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-fub-image-handle") : null;
          const root = handle?.closest<HTMLElement>(".cm-fub-image[data-fub-image]");
          if (!handle || !root) return false;
          event.preventDefault();
          drag(view, root, handle, event, this.life);
          return true;
        },
      },
    },
  );
  const enter = (view: EditorView): boolean => {
    if (!active(view.state)) return false;
    const found = selectedImage(view.state);
    return found ? view.plugin(plugin)?.open(found.from, found.to) ?? false : false;
  };
  return [plugin, Prec.high(keymap.of([{ key: "Enter", run: enter }]))];
}
