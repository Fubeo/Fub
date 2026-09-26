import type { Mermaid } from "mermaid";
import { onLanguage, t } from "../i18n/strings";
import { identifier } from "./a11y";
import { openLifetime, type Teardown } from "./lifetime";
import { registerCustomRenderer } from "./custom";
import { attributeValue, external, isAllowedLink } from "./sanitize";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Only explicit SVG anchors can become shell links; SVG nodes never cross into the shell. */
/// La larghezza con cui mermaid ha disegnato il diagramma: `max-width` nello
/// stile della radice, o la larghezza del `viewBox`.
export function naturalWidth(svg: Document): number | null {
  const root = svg.documentElement;
  const declared = /max-width:\s*([\d.]+)px/.exec(root.getAttribute("style") ?? "")?.[1];
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)[2];
  const width = Number(declared ?? box);
  return Number.isFinite(width) && width > 0 ? Math.ceil(width) : null;
}

function diagramLinks(svg: Document): Array<{ href: string; label: string }> {
  if (svg.documentElement.localName !== "svg" || svg.documentElement.namespaceURI !== SVG_NAMESPACE) return [];
  const links: Array<{ href: string; label: string }> = [];
  for (const anchor of svg.querySelectorAll("a")) {
    if (anchor.namespaceURI !== SVG_NAMESPACE || anchor.closest("foreignObject")) continue;
    const plain = anchor.getAttribute("href");
    const namespaced = anchor.getAttributeNS(XLINK_NAMESPACE, "href") ?? anchor.getAttribute("xlink:href");
    if (plain !== null && namespaced !== null && plain !== namespaced) continue;
    const href = plain ?? namespaced;
    if (href === null || href !== href.trim() || /[\s\x00-\x1F\x7F]/u.test(href)
      || /%(?![0-9a-f]{2})/iu.test(href) || !isAllowedLink(href)) continue;
    if (href.startsWith("#")) {
      if (href.length === 1) continue;
    } else if (/^https?:\/\//iu.test(href) || /^mailto:/iu.test(href)) {
      try {
        const parsed = new URL(href);
        if (parsed.protocol === "mailto:" ? !parsed.pathname || parsed.pathname.startsWith("//") : !parsed.hostname) continue;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    links.push({
      href: attributeValue("href", href),
      label: anchor.querySelector("text")?.textContent?.trim()
        || anchor.textContent?.trim() || href,
    });
  }
  return links;
}

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
  const linkList = document.createElement("nav");
  linkList.hidden = true;
  const linkItems = document.createElement("ul");
  linkList.append(linkItems);
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
  element.append(caption, status, image, linkList, details);

  let generation = 0;
  let url: string | undefined;
  let phase: "loading" | "ready" | "error" = "loading";
  let reason = "";
  let accessibleDescription = "";
  let light = document.documentElement.dataset.theme;
  const labels = () => {
    element.setAttribute("aria-label", t("mermaid.diagram"));
    linkList.setAttribute("aria-label", t("mermaid.links"));
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
    linkItems.replaceChildren();
    linkList.hidden = true;
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
    linkItems.replaceChildren();
    linkList.hidden = true;
    if (url) URL.revokeObjectURL(url);
    image.removeAttribute("src");
  });

  const render = () => {
    const request = ++generation;
    const current = () => !life.closed && request === generation;
    linkItems.replaceChildren();
    linkList.hidden = true;
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
        const links = diagramLinks(svgDocument);
        const items = links.map(({ href, label }) => {
          const item = document.createElement("li");
          const anchor = document.createElement("a");
          anchor.setAttribute("href", href);
          anchor.textContent = label;
          if (external(href)) {
            anchor.rel = "noopener noreferrer";
            anchor.target = "_blank";
          }
          item.append(anchor);
          return item;
        });
        const nextUrl = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
        if (url) URL.revokeObjectURL(url);
        url = nextUrl;
        image.src = nextUrl;
        // Un SVG servito come immagine con `width="100%"` non ha una larghezza
        // propria, e un diagramma di due nodi si allargava a tutto il riquadro.
        // La larghezza naturale è quella che mermaid dichiara; `max-width: 100%`
        // del tema continua a stringere i diagrammi grandi.
        const natural = naturalWidth(svgDocument);
        if (natural !== null) image.width = natural;
        else image.removeAttribute("width");
        linkItems.replaceChildren(...items);
        linkList.hidden = items.length === 0;
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

/** The native provider uses the same viewer; other engines keep their fallback. */
export function registerMermaidRenderer(): void {
  registerCustomRenderer("fub:diagram", (host, payload) => {
    const { source } = payload as { source: string };
    const diagram = createMermaidView(source, {
      onResize: () => host.dispatchEvent(new Event("markdown-resize", { bubbles: true })),
    });
    host.append(diagram.element);
    return diagram.destroy;
  }, (payload) => typeof payload === "object" && payload !== null
    && "engine" in payload && payload.engine === "mermaid"
    && "source" in payload && typeof payload.source === "string");
}

/** Hydrates the same inert diagram component in Live, Reading and embeds. */
export function mountMermaidBlocks(
  container: HTMLElement,
  options: { revealSource?: (sourceOffset: number) => void } = {},
): Teardown {
  const life = openLifetime();
  for (const code of container.querySelectorAll<HTMLElement>("pre > code")) {
    if (code.closest("[data-ui-slot]")) continue;
    if (!Array.from(code.classList).some((name) => name.toLowerCase() === "language-mermaid")) continue;
    const pre = code.parentElement!;
    // Only a fence the vault declares is a diagram: with the diagrams syntax
    // off, a mermaid fence stays code, as it does in the model.
    if (!pre.hasAttribute("data-declared-fence")) continue;
    const rawFrom = pre.dataset.mdFrom;
    const from = rawFrom !== undefined && /^\d+$/.test(rawFrom) ? Number(rawFrom) : NaN;
    const diagram: MermaidView = createMermaidView(code.textContent ?? "", {
      revealSource: options.revealSource && Number.isSafeInteger(from)
        ? () => {
          const current = diagram.element.dataset.mdFrom;
          const offset = current !== undefined && /^\d+$/.test(current) ? Number(current) : NaN;
          if (Number.isSafeInteger(offset)) options.revealSource?.(offset);
        }
        : undefined,
      onResize: () => container.dispatchEvent(new Event("markdown-resize", { bubbles: true })),
    });
    // Preserve the coordinate space of the renderer that produced the fence.
    for (const attribute of Array.from(pre.attributes)) {
      if (attribute.name === "id" || attribute.name.startsWith("data-fub-source-") ||
          attribute.name === "data-md-from" || attribute.name === "data-md-to") {
        diagram.element.setAttribute(attribute.name, attribute.value);
      }
    }
    pre.replaceWith(diagram.element);
    life.add(diagram.destroy);
  }
  return () => life.close();
}
