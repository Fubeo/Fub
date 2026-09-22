import type { Mermaid } from "mermaid";
import { onLanguage, t } from "../i18n/strings";
import { identifier } from "./a11y";
import { openLifetime, type Teardown } from "./lifetime";

const MAX_SOURCE_LENGTH = 50_000;
// Mermaid has process-wide configuration. Theme selection and rendering must
// share the same queue, not just calls to mermaid.render().
let rendering: Promise<unknown> = Promise.resolve();
let library: Promise<{ default: Mermaid }> | undefined;

export interface MermaidView {
  readonly element: HTMLElement;
  destroy(): void;
}

/** A diagram is an image, never active SVG/HTML in the shell. The source is
 * always available, including syntax errors and unavailable lazy chunks. */
export function createMermaidView(
  source: string,
  options: { revealSource?: () => void; onResize?: () => void } = {},
): MermaidView {
  const life = openLifetime();
  const element = document.createElement("figure");
  element.className = "mermaid-diagram";
  element.contentEditable = "false";
  const caption = document.createElement("figcaption");
  const name = document.createElement("span");
  name.textContent = "Mermaid";
  caption.append(name);
  const reveal = options.revealSource ? document.createElement("button") : null;
  if (reveal) {
    reveal.type = "button";
    life.listen(reveal, "click", () => options.revealSource?.());
    caption.append(reveal);
  }
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const image = document.createElement("img");
  image.hidden = true;
  image.decoding = "async";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const pre = document.createElement("pre");
  pre.tabIndex = 0;
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  details.append(summary, pre);
  element.append(caption, status, image, details);

  let generation = 0;
  let url: string | undefined;
  let phase: "loading" | "ready" | "error" = "loading";
  let reason = "";
  let accessibleDescription = "";
  let light = document.documentElement.dataset.theme;
  const labels = () => {
    element.setAttribute("aria-label", t("mermaid.diagram"));
    image.alt = accessibleDescription || t("mermaid.diagram");
    summary.textContent = t("mermaid.source");
    pre.setAttribute("aria-label", t("mermaid.source"));
    if (reveal) reveal.textContent = t("mermaid.edit");
    status.textContent = phase === "error" ? t("mermaid.error", { reason }) : t("mermaid.loading");
    status.hidden = phase === "ready";
    element.dataset.state = phase;
    element.setAttribute("aria-busy", String(phase === "loading"));
  };
  const fail = (error: unknown) => {
    phase = "error";
    reason = error instanceof Error ? error.message : String(error);
    reason = reason.slice(0, 1200);
    image.hidden = true;
    details.open = true;
    labels();
    options.onResize?.();
  };
  const resize = () => options.onResize?.();
  life.listen(details, "toggle", resize);
  life.listen(image, "load", resize);
  life.listen(image, "error", () => fail(new Error(t("mermaid.image_failed"))));
  life.add(onLanguage(labels));
  life.add(() => {
    generation++;
    if (url) URL.revokeObjectURL(url);
    image.removeAttribute("src");
  });

  const render = () => {
    const request = ++generation;
    const current = () => !life.closed && request === generation;
    phase = "loading";
    labels();
    if (source.length > MAX_SOURCE_LENGTH) {
      fail(new Error(t("mermaid.too_large", { limit: MAX_SOURCE_LENGTH })));
      return;
    }
    const task = rendering.then(async () => {
      if (!current()) return;
      const { default: mermaid } = await (library ??= import("mermaid").catch((error) => {
        library = undefined;
        throw error;
      }));
      if (!current()) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        maxTextSize: MAX_SOURCE_LENGTH,
        maxEdges: 500,
        htmlLabels: false,
        fontFamily: "Arial, sans-serif",
        theme: light === "light" ? "default" : "dark",
        // A note cannot relax the security policy or inject a global stylesheet.
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges",
          "suppressErrorRendering", "htmlLabels", "dompurifyConfig", "themeCSS", "themeVariables", "theme", "fontFamily"],
        dompurifyConfig: { FORBID_TAGS: ["style", "script", "iframe", "object", "img", "image"] },
      });
      const staging = document.createElement("div");
      staging.setAttribute("aria-hidden", "true");
      // SVG measurement needs layout, not display:none. This temporary root is
      // owned by the queued render and removed on success, failure, or teardown.
      staging.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:1200px";
      document.body.append(staging);
      try {
        const result = await mermaid.render(identifier("fub-mermaid"), source, staging);
        if (!current()) return;
        const svgDocument = new DOMParser().parseFromString(result.svg, "image/svg+xml");
        accessibleDescription = Array.from(svgDocument.querySelectorAll("title, desc"))
          .map((node) => node.textContent?.trim()).filter(Boolean).join(". ");
        const nextUrl = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
        if (url) URL.revokeObjectURL(url);
        url = nextUrl;
        image.src = nextUrl;
        image.hidden = false;
        phase = "ready";
        labels();
        resize();
      } finally {
        staging.remove();
      }
    });
    // Failure of one diagram never poisons the queue for the rest of the note.
    rendering = task.catch((error) => { if (current()) fail(error); });
  };
  const observer = new MutationObserver(() => {
    const next = document.documentElement.dataset.theme;
    if (next === light) return;
    light = next;
    render();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  life.add(() => observer.disconnect());
  render();
  return { element, destroy: () => life.close() };
}

/** Hydrates only provider code fences; does not grant arbitrary HTML new tags. */
export function mountMermaidBlocks(container: HTMLElement): Teardown {
  const life = openLifetime();
  for (const code of container.querySelectorAll<HTMLElement>("pre > code")) {
    if (!Array.from(code.classList).some((name) => name.toLowerCase() === "language-mermaid")) continue;
    const pre = code.parentElement!;
    const diagram = createMermaidView(code.textContent ?? "");
    // Keep byte source mapping and anchors used to move between Reading and Live.
    for (const attribute of Array.from(pre.attributes)) {
      if (attribute.name === "id" || attribute.name.startsWith("data-fub-source-")) {
        diagram.element.setAttribute(attribute.name, attribute.value);
      }
    }
    pre.replaceWith(diagram.element);
    life.add(diagram.destroy);
  }
  return () => life.close();
}
