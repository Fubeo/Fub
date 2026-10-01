// Il profilo SVG della famiglia di testo: un file che nessun formato del vault
// serve, scritto come XML accanto alla sua anteprima.
//
// L'anteprima è un `<img>` da un `Blob` del buffer, mai un SVG in linea: gli
// script e i gestori che il file contenesse restano inerti come in una nota.
// Ogni versione si prova prima fuori schermo, e la vista cambia soltanto
// quando il browser l'ha disegnata: mentre si scrive un tag a metà resta
// l'ultima versione buona, con accanto il motivo per cui la nuova non lo è.
//
// I tre modi sono gli id di Markdown — `source`, `live_preview`, `reading` —
// con i nomi di qui (Sorgente, Diviso, Anteprima): così valgono le stesse
// scorciatoie, `Mod-e` e la modalità predefinita dell'editor.
import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { onLanguage, t } from "../../../i18n/strings";
import { currentTheme } from "../../../theme/theme";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { imageInfo, svgSize, svgStart } from "../../media/image-view";
import { mountZoomView, type Size, type ZoomView } from "../../media/zoom-view";
import type { EditorSurface, SurfaceMode, SurfaceMountContext } from "../../core/registry";
import type { EditorChange } from "../../core/text-operation";
import { createTextEngine } from "../engine";

export const SVG_PROFILE = "svg";

/// Quanto aspetta l'anteprima dopo l'ultima battuta: abbastanza per non
/// ridisegnare a ogni carattere di un tag, poco per sembrare dal vivo.
export const SVG_PREVIEW_MS = 150;

/// Sotto questa larghezza il modo Diviso mette l'anteprima sotto il sorgente.
const SIDE_BY_SIDE_MIN = 640;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const SVG_MODES: readonly SurfaceMode[] = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source" },
  { id: "live_preview", label: () => t("svg.mode.split"), presentation: "surface", contextMode: "live_preview" },
  { id: "reading", label: () => t("svg.mode.preview"), presentation: "rendered", contextMode: "reading" },
];

type SvgMode = "source" | "live_preview" | "reading";

function isSvgMode(mode: string): mode is SvgMode {
  return SVG_MODES.some((candidate) => candidate.id === mode);
}

// --- il linguaggio -----------------------------------------------------------

let xmlSupport: LanguageSupport | null = null;
let xmlLoading: Promise<LanguageSupport | null> | null = null;

/// Il pezzo XML di `language-data`, lo stesso che colora i blocchi di codice
/// delle note: caricato una volta, alla prima richiesta.
function loadXml(): Promise<LanguageSupport | null> {
  xmlLoading ??= (LanguageDescription.matchFilename(languages, "disegno.svg")?.load() ?? Promise.resolve(null))
    .then((support) => (xmlSupport = support), () => null);
  return xmlLoading;
}

/// L'evidenziazione XML come estensione che si completa da sola: finché il
/// pezzo pigro non c'è il testo resta semplice, e quando arriva l'estensione si
/// riconfigura senza che chi monta l'editor debba saperlo — vale nel riquadro
/// come nella finestra staccata, che ha soltanto un `TextEngine` nudo.
export function svgLanguage(): Extension {
  if (xmlSupport) return xmlSupport;
  const slot = new Compartment();
  return [
    slot.of([]),
    ViewPlugin.define((view) => {
      let alive = true;
      void loadXml().then((support) => {
        if (alive && support) view.dispatch({ effects: slot.reconfigure(support) });
      });
      return { destroy: () => { alive = false; } };
    }),
  ];
}

// --- la verifica ---------------------------------------------------------------

/// Perché una versione del sorgente non si può disegnare.
export type SvgProblem =
  | { readonly kind: "parse"; readonly line: number | null; readonly column: number | null; readonly reason: string }
  | { readonly kind: "root" }
  | { readonly kind: "namespace" }
  | { readonly kind: "render" };

export type SvgCheck =
  | { readonly ok: true; readonly size: Size | null }
  | { readonly ok: false; readonly problem: SvgProblem };

/// Il messaggio di un `parsererror` ridotto a riga, colonna e motivo. Blink e
/// WebKit scrivono «error on line 3 at column 12: …», Gecko «XML Parsing
/// Error: … Line Number 3, Column 12»; ciò che non ha coordinate resta motivo.
export function parseProblem(message: string): SvgProblem {
  const clean = message.replace(/\s+/g, " ").trim();
  const blink = /line (\d+) at column (\d+):\s*(.+?)\s*(?:Below is a rendering of the page up to the first error\.?)?$/i.exec(clean);
  if (blink) return { kind: "parse", line: Number(blink[1]), column: Number(blink[2]), reason: blink[3]! };
  const gecko = /XML Parsing Error:\s*(.+?)\s*Location:.*?Line Number (\d+), Column (\d+)/i.exec(clean);
  if (gecko) return { kind: "parse", line: Number(gecko[2]), column: Number(gecko[3]), reason: gecko[1]! };
  return { kind: "parse", line: null, column: null, reason: clean };
}

/// Se il sorgente è un SVG che un `<img>` sa disegnare, con le misure che
/// dichiara. Un XML ben formato non basta: senza lo spazio dei nomi SVG sulla
/// radice il browser non disegna niente, e lo si dice invece di mostrare vuoto.
export function checkSvg(text: string): SvgCheck {
  const start = svgStart(text);
  if (start === null) return { ok: false, problem: { kind: "root" } };
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const error = parsed.getElementsByTagName("parsererror")[0];
  if (error) return { ok: false, problem: parseProblem(error.textContent ?? "") };
  const root = parsed.documentElement;
  if (root.localName !== "svg") return { ok: false, problem: { kind: "root" } };
  if (root.namespaceURI !== SVG_NAMESPACE) return { ok: false, problem: { kind: "namespace" } };
  return { ok: true, size: svgSize(text, start) };
}

export function problemText(problem: SvgProblem): string {
  switch (problem.kind) {
    case "parse":
      return problem.line !== null && problem.column !== null
        ? t("svg.error.parse", { line: problem.line, column: problem.column, reason: problem.reason })
        : t("svg.error.parse_unplaced", { reason: problem.reason });
    case "root":
      return t("svg.error.root");
    case "namespace":
      return t("svg.error.namespace");
    case "render":
      return t("svg.error.render");
  }
}

// --- la superficie ---------------------------------------------------------------

export interface SvgSurfaceOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
}

function fileName(id: string): string {
  return id.split("/").pop() || id;
}

export function mountSvgSurface(context: SurfaceMountContext, options: SvgSurfaceOptions): EditorSurface {
  const { parent } = context;
  const life = openLifetime();
  let mode: SvgMode = "live_preview";

  const engine = createTextEngine(parent, {
    onChange: (change) => {
      options.onChange(change);
      schedule();
    },
    onSelectionChange: () => options.onSelectionChange(),
    theme: currentTheme(),
    extensions: () => svgLanguage(),
  });

  const preview = document.createElement("div");
  preview.className = "svg-preview";
  preview.setAttribute("role", "region");
  const status = document.createElement("p");
  status.className = "svg-error";
  // Cortese e non un allarme: mentre si scrive un tag il sorgente è rotto a
  // ogni battuta, e un lettore di schermo non deve interrompere per questo.
  status.setAttribute("role", "status");
  status.hidden = true;
  preview.append(status);
  parent.append(preview);
  parent.dataset.svgMode = mode;

  let view: ZoomView | null = null;
  /// L'URL che la vista mostra adesso, e quello della versione in prova.
  let shown: string | null = null;
  let shownBlob: Blob | null = null;
  let attempt: Lifetime | null = null;
  /// Il testo dell'ultima versione guardata, buona o no: non si riprova uguale.
  let judged: string | null = null;
  let problem: SvgProblem | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function label(): void {
    preview.setAttribute("aria-label", t("svg.preview", { name: fileName(context.documentId) }));
  }
  label();

  function report(next: SvgProblem | null): void {
    problem = next;
    status.hidden = next === null;
    status.textContent = next ? problemText(next) : "";
    if (next && view) preview.dataset.stale = "";
    else delete preview.dataset.stale;
  }

  function info(blob: Blob, width: number | null, height: number | null): string {
    return imageInfo({ format: "SVG", blob }, width, height);
  }

  function adopt(url: string, blob: Blob, size: Size | null): void {
    const previous = shown;
    shown = url;
    shownBlob = blob;
    if (!view) {
      view = mountZoomView(url, {
        label: fileName(context.documentId),
        size,
        backdrop: "checker",
        vector: true,
        info: info(blob, size?.width ?? null, size?.height ?? null),
        onError: () => report({ kind: "render" }),
      }, life);
      const mounted = view;
      life.listen(mounted.image, "load", () => {
        if (shownBlob) mounted.info(info(shownBlob, mounted.image.naturalWidth || null, mounted.image.naturalHeight || null));
      });
      preview.prepend(mounted.element);
    } else {
      view.replace(url, size);
    }
    // L'immagine di prima è già disegnata: il suo URL non serve più.
    if (previous) URL.revokeObjectURL(previous);
    report(null);
  }

  function cancel(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /// Prova la versione corrente fuori schermo e la adotta se si disegna.
  function render(): void {
    cancel();
    if (life.closed || mode === "source") return;
    const text = engine.getDoc();
    if (text === judged) return;
    judged = text;
    attempt?.close();
    attempt = null;
    const check = checkSvg(text);
    if (!check.ok) {
      report(check.problem);
      return;
    }
    const blob = new Blob([text], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const trial = openLifetime();
    attempt = trial;
    let adopted = false;
    const probe = new Image();
    trial.add(() => {
      probe.removeAttribute("src");
      if (!adopted) URL.revokeObjectURL(url);
    });
    trial.listen(probe, "load", () => {
      adopted = true;
      if (attempt === trial) attempt = null;
      trial.close();
      adopt(url, blob, check.size);
    });
    trial.listen(probe, "error", () => {
      if (attempt === trial) attempt = null;
      trial.close();
      report({ kind: "render" });
    });
    probe.src = url;
  }

  function schedule(): void {
    if (mode === "source") return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      render();
    }, SVG_PREVIEW_MS);
  }

  function setMode(next: SvgMode): void {
    mode = next;
    parent.dataset.svgMode = next;
    if (next === "source") cancel();
    else render();
  }

  // Diviso sta fianco a fianco finché c'è posto, poi uno sopra l'altro.
  if (typeof ResizeObserver !== "undefined") {
    const stacker = new ResizeObserver(() => {
      if (parent.clientWidth > 0 && parent.clientWidth < SIDE_BY_SIDE_MIN) parent.dataset.svgStack = "";
      else delete parent.dataset.svgStack;
    });
    stacker.observe(parent);
    life.add(() => stacker.disconnect());
  }

  life.add(onLanguage(() => {
    label();
    report(problem);
  }));
  life.add(() => {
    cancel();
    attempt?.close();
    attempt = null;
    if (shown) URL.revokeObjectURL(shown);
    shown = null;
    shownBlob = null;
  });

  return {
    family: "text",
    profile: SVG_PROFILE,
    surfaceId: context.paneId,
    modes: SVG_MODES,
    // Si scrive guardando ciò che si disegna.
    defaultMode: "live_preview",
    setMode(next) {
      if (!isSvgMode(next)) throw new RangeError(`surface mode ${next} is not supported`);
      setMode(next);
    },
    buffer: {
      setDoc: (text) => {
        engine.setDoc(text);
        render();
      },
      syncDoc: (update) => {
        engine.syncDoc(update);
        schedule();
      },
      getDoc: () => engine.getDoc(),
    },
    focus: () => {
      if (mode === "reading" && view) view.stage.focus();
      else engine.focus();
    },
    reveal: ({ span }) => {
      if (mode === "reading") return false;
      engine.revealByteOffset(span.start);
      return true;
    },
    selections: () => engine.selections(),
    setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
    setTheme: (theme) => engine.setTheme(theme),
    destroy: () => {
      life.close();
      preview.remove();
      engine.destroy();
      delete parent.dataset.svgMode;
      delete parent.dataset.svgStack;
    },
  };
}
