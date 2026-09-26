import type { EmbedContent, RenderedDocument } from "../../../../host/contract";
import { renderEmbed } from "../../../../host/query";
import { errorText } from "../../../../host/errors";
import { onLanguage, t } from "../../../../i18n/strings";
import { highlightMarkdownCode } from "./highlight-code";
import { openLifetime, type Lifetime, type Teardown } from "../../../../ui/lifetime";
import { mountMermaidBlocks } from "../../../../ui/mermaid";
import { mountMathBlocks } from "./math";
import { hydrateVaultMedia } from "./media";
import { mediaKindOfId } from "../../../media/media-types";
import type { MarkdownResources, NativeMarkdownContent } from "../../../../ui/markdown-resources";
import { mountTree, unmountTree } from "../../../../ui/node";
import { notify } from "../../../../ui/notify";
import { Race, type Expected } from "../../../../ui/race";
import { external, hasScheme, isAllowedLink, sanitizeMarkdownHtml, setSanitizedHtml } from "../../../../ui/sanitize";
import { writeClipboardText } from "../../../../platform/clipboard";

export interface MarkdownMountOptions {
  readonly documentId?: string;
  readonly resources?: MarkdownResources;
  readonly openWikilink?: (page: string, heading?: string, block?: string) => void | Promise<void>;
  readonly openPath?: (path: string, from?: string) => void | Promise<void>;
  readonly navigateFragment?: (id: string) => boolean;
  readonly searchTag?: (tag: string) => void;
  /** UTF-16 offset of the task symbol in the current, LF-normalized buffer. */
  readonly toggleTask?: (sourceOffset: number) => void;
  readonly openSource?: (sourceOffset: number) => void;
}

const MAX_EMBED_DEPTH = 5;
const mounts = new WeakMap<HTMLElement, Teardown>();


function hydrateAllowedHtml(container: HTMLElement): void {
  for (const block of container.querySelectorAll<HTMLElement>(".block-html-allowed[data-md-raw-html]")) {
    const source = block.dataset.mdRawHtml ?? "";
    block.removeAttribute("data-md-raw-html");
    const fragment = sanitizeMarkdownHtml(source);
    if (fragment.childNodes.length > 0) block.replaceChildren(fragment);
  }
}
function sourceNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** Finds source-backed content without counting hidden Markdown markers. */
export function sourceElementAt(container: HTMLElement, offset: number): HTMLElement | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  let containing: { element: HTMLElement; from: number; to: number } | undefined;
  let next: { element: HTMLElement; from: number } | undefined;
  let previous: { element: HTMLElement; from: number } | undefined;
  for (const element of container.querySelectorAll<HTMLElement>("[data-md-from][data-md-to]")) {
    // Transclusions and provider components have their own coordinate spaces.
    if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
    const from = sourceNumber(element.dataset.mdFrom);
    const to = sourceNumber(element.dataset.mdTo);
    if (from === null || to === null || to < from) continue;
    if (from <= offset && offset < to) {
      if (!containing || to - from < containing.to - containing.from) containing = { element, from, to };
    } else if (from > offset) {
      if (!next || from < next.from) next = { element, from };
    } else if (!previous || from > previous.from) previous = { element, from };
  }
  return (containing ?? next ?? previous)?.element ?? null;
}

function wireContent(container: HTMLElement, options: MarkdownMountOptions, life: Lifetime): void {
  for (const table of container.querySelectorAll<HTMLTableElement>("table")) {
    if (!table.closest("[data-ui-slot]")) table.tabIndex = 0;
  }
  const codeLabels: { pre: HTMLElement; button: HTMLButtonElement | null }[] = [];
  for (const pre of container.querySelectorAll<HTMLElement>("pre")) {
    if (pre.closest("[data-ui-slot]")) continue;
    pre.tabIndex = 0;
    pre.setAttribute("role", "document");
    pre.dataset.i18nLabel = "preview.code_block";
    const code = pre.querySelector("code");
    let button: HTMLButtonElement | null = null;
    if (code) {
      const text = code.textContent ?? "";
      button = document.createElement("button");
      button.type = "button";
      button.className = "markdown-code-copy";
      pre.append(button);
      life.listen(button, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void writeClipboardText(text).then(
          () => { if (!life.closed) notify(t("preview.code_copied")); },
          (error: unknown) => {
            if (!life.closed) notify(t("preview.copy_failed", { reason: errorText(error) }), "guasto");
          },
        );
      });
    }
    codeLabels.push({ pre, button });
  }
  const tasks = Array.from(container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-md-task]:not([data-ui-slot] input)',
  ));
  for (const task of tasks) {
    const offset = sourceNumber(task.dataset.mdTask);
    const symbol = task.parentElement?.dataset.task;
    task.indeterminate = !!symbol && symbol !== "x" && symbol !== "X";
    task.disabled = !options.toggleTask || offset === null;
    if (!task.disabled && offset !== null) {
      life.listen(task, "mousedown", (event) => { event.preventDefault(); });
      life.listen(task, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentOffset = sourceNumber(task.dataset.mdTask);
        if (currentOffset !== null) options.toggleTask?.(currentOffset);
      });
    }
  }
  const labels = () => {
    for (const { pre, button } of codeLabels) {
      pre.setAttribute("aria-label", t("preview.code_block"));
      if (button) button.textContent = t("preview.copy_code");
    }
    for (const task of tasks) {
      const key = task.checked ? "editor.task.completed" : "editor.task.pending";
      task.dataset.i18nLabel = key;
      task.setAttribute("aria-label", t(key));
    }
  };
  labels();
  if (codeLabels.length || tasks.length) life.add(onLanguage(labels));

  for (const tag of container.querySelectorAll<HTMLElement>(".tag[data-tag]")) {
    if (tag.closest("[data-ui-slot]") || !options.searchTag) continue;
    tag.tabIndex = 0;
    tag.setAttribute("role", "link");
    life.listen(tag, "keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      tag.click();
    });
  }
  life.listen(container, "click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[data-ui-slot]")) return;
    const tag = target.closest<HTMLElement>(".tag[data-tag]");
    if (tag && options.searchTag) {
      event.preventDefault();
      options.searchTag(tag.dataset.tag ?? "");
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a");
    if (!link) return;
    const openPath = (path: string): void => {
      if (options.openPath) void Promise.resolve().then(() => options.openPath?.(path)).catch((error: unknown) => {
        if (life.closed) return;
        link.classList.add("unresolved");
        notify(t("preview.open_failed", { page: path, reason: errorText(error) }), "guasto");
      });
    };
    if (link.classList.contains("internal-path")) {
      event.preventDefault();
      openPath(link.dataset.path ?? "");
      return;
    }
    if (link.classList.contains("wikilink") && options.openWikilink) {
      event.preventDefault();
      const page = link.dataset.wikilinkPage ?? "";
      void Promise.resolve().then(() => options.openWikilink?.(page, link.dataset.wikilinkHeading, link.dataset.wikilinkBlock))
        .catch((error: unknown) => {
          if (life.closed) return;
          link.classList.add("unresolved");
          notify(t("preview.open_failed", { page, reason: errorText(error) }), "guasto");
        });
      return;
    }
    const href = link.getAttribute("href");
    if (!href || !isAllowedLink(href)) {
      event.preventDefault();
      return;
    }
    if (href.startsWith("#")) {
      event.preventDefault();
      if (link.dataset.mdAnchor && options.navigateFragment?.(link.dataset.mdAnchor)) return;
      const scope = container.closest<HTMLElement>(".embed-loaded, .pane-preview, .cm-editor") ?? container;
      const embeddedScope = scope.closest(".embed-loaded");
      const destination = Array.from(scope.querySelectorAll<HTMLElement>("[id]"))
        .find((element) => element.id === href.slice(1)
          && element.closest(".embed-loaded") === embeddedScope);
      if (destination) {
        event.preventDefault();
        destination.scrollIntoView({ block: "start" });
      }
      return;
    }
    // Nessun link naviga la webview: la shell è una pagina sola, e seguirne uno
    // la scaricherebbe con i buffer, le bozze in volo e la storia di ogni
    // riquadro. Un indirizzo con schema va al sistema, uno relativo è un
    // documento del vault.
    event.preventDefault();
    if (hasScheme(href) || external(href)) window.open(href, "_blank", "noopener,noreferrer");
    else openPath(safeDecode(href));
  });
}

/// Un `href` relativo arriva codificato (`Nota%20uno.md`), un path del vault no.
function safeDecode(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function enhanceContent(
  container: HTMLElement,
  parts: RenderedDocument["parts"],
  options: MarkdownMountOptions,
  life: Lifetime,
): void {
  if (parts.length) {
    const slots = new Map(Array.from(container.querySelectorAll<HTMLElement>("[data-ui-slot]"),
      (element) => [element.dataset.uiSlot, element] as const));
    for (const part of parts) {
      const slot = slots.get(String(part.slot));
      if (!slot) continue;
      slot.dataset.kind = part.kind;
      mountTree(slot, part.node, async () => {}, { container: options.documentId ?? null });
      life.add(() => unmountTree(slot));
    }
  }
  life.add(mountMermaidBlocks(container, { revealSource: options.openSource }));
  life.add(mountMathBlocks(container));
  wireContent(container, options, life);
  life.add(highlightMarkdownCode(container));
}

function mountContent(
  container: HTMLElement,
  rendered: RenderedDocument,
  options: MarkdownMountOptions,
  life: Lifetime,
): void {
  setSanitizedHtml(container, rendered.html);
  hydrateAllowedHtml(container);
  enhanceContent(container, rendered.parts, options, life);
}

async function hydrateEmbeds(
  container: HTMLElement,
  chain: ReadonlySet<string>,
  memo: Map<string, Promise<EmbedContent>>,
  expected: Expected,
  options: MarkdownMountOptions,
  life: Lifetime,
): Promise<void> {
  await Promise.all(Array.from(container.querySelectorAll<HTMLElement>(".embed[data-embed-page]")).map(async (slot) => {
    const page = slot.dataset.embedPage || options.documentId;
    if (!page) return;
    // Un media non è una nota da trascludere: lo idrata `hydrateVaultMedia`.
    if (slot.dataset.embedPage && mediaKindOfId(slot.dataset.embedPage) !== "other") return;
    if (chain.size > MAX_EMBED_DEPTH) {
      slot.classList.add("embed-too-deep");
      slot.dataset.embedNote = t("markdown.embed_too_deep");
      return;
    }
    const heading = slot.dataset.embedHeading ?? null;
    const block = slot.dataset.embedBlock ?? null;
    const key = JSON.stringify([page, heading, block]);
    let requested = memo.get(key);
    if (!requested) {
      requested = options.resources
        ? options.resources.embed(page, heading, block)
        : renderEmbed(page, heading, block);
      memo.set(key, requested);
    }
    const content = await expected(requested.catch(() => null));
    if (!content) {
      slot.classList.add("unresolved");
      return;
    }
    const identity = JSON.stringify([content.doc_id, heading, block]);
    if (chain.has(identity)) {
      slot.classList.add("embed-cycle");
      slot.dataset.embedNote = t("markdown.embed_cycle");
      return;
    }
    // Embedded offsets never mutate the containing note.
    const embeddedOptions: MarkdownMountOptions = {
      ...options,
      documentId: content.doc_id,
      toggleTask: undefined,
      openSource: undefined,
      navigateFragment: undefined,
      openWikilink: (page, heading, block) => options.openWikilink?.(page || content.doc_id, heading, block),
      openPath: (path, from = content.doc_id) => options.openPath?.(path, from),
    };
    mountContent(slot, content, embeddedOptions, life);
    slot.classList.add("embed-loaded");
    container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
    await Promise.all([
      hydrateEmbeds(slot, new Set([...chain, identity]), memo, expected, embeddedOptions, life),
      hydrateVaultMedia(slot, content.doc_id, expected, life),
    ]);
  }));
}

/** Shared Live/Reading mount: sanitization precedes every component and fetch. */
export function mountMarkdown(
  container: HTMLElement,
  html: string,
  options: MarkdownMountOptions = {},
): Teardown {
  mounts.get(container)?.();
  const life = openLifetime();
  let contentLife: Lifetime | undefined;
  let contentRace: Race | undefined;
  let firstFrom: number | null = null;
  let nativeUses: NativeMarkdownContent[] = [];
  let hasEmbeds = false;
  const dispose = () => {
    contentRace?.cancel();
    contentLife?.close();
    life.close();
    if (mounts.get(container) === dispose) {
      mounts.delete(container);
      container.replaceChildren();
    }
  };
  mounts.set(container, dispose);

  function render(): void {
    const currentFrom = sourceNumber(container.querySelector<HTMLElement>("[data-md-from]")?.dataset.mdFrom);
    const delta = firstFrom !== null && currentFrom !== null ? currentFrom - firstFrom : 0;
    contentRace?.cancel();
    contentLife?.close();
    const mountedLife = contentLife = openLifetime();
    const mountedRace = contentRace = new Race();
    setSanitizedHtml(container, html);
    hydrateAllowedHtml(container);
    if (firstFrom === null) {
      firstFrom = sourceNumber(container.querySelector<HTMLElement>("[data-md-from]")?.dataset.mdFrom);
    }
    if (delta) {
      for (const element of container.querySelectorAll<HTMLElement>("[data-md-from], [data-md-to], [data-md-task]")) {
        for (const key of ["mdFrom", "mdTo", "mdTask"] as const) {
          const value = sourceNumber(element.dataset[key]);
          if (value !== null) element.dataset[key] = String(value + delta);
        }
      }
    }
    nativeUses = [];
    const parts: RenderedDocument["parts"] = [];
    if (options.resources) {
      for (const element of container.querySelectorAll<HTMLElement>("[data-md-from][data-md-to]")) {
        if (!container.contains(element)) continue;
        const from = sourceNumber(element.dataset.mdFrom);
        const to = sourceNumber(element.dataset.mdTo);
        if (from === null || to === null) continue;
        const rendered = options.resources.match(from, to);
        if (!rendered) continue;
        const replacement = document.createElement("div");
        replacement.appendChild(rendered.createFragment());
        replacement.dataset.mdFrom = String(from);
        replacement.dataset.mdTo = String(to);
        if (element.id) replacement.id = element.id;
        element.replaceWith(replacement);
        nativeUses.push(rendered);
        for (const part of rendered.parts) parts.push(part);
      }
    }
    enhanceContent(container, parts, options, mountedLife);
    hasEmbeds = !!container.querySelector(".embed[data-embed-page]");
    const hasImages = !!container.querySelector("img[data-vault-src]");
    if (options.documentId && (hasEmbeds || hasImages)) {
      const documentId = options.documentId;
      void mountedRace.last((expected) => Promise.all([
        hydrateEmbeds(container, new Set([JSON.stringify([documentId, null, null])]), new Map(), expected, options, mountedLife),
        hydrateVaultMedia(container, documentId, expected, mountedLife),
      ])).catch((error: unknown) => {
        if (!mountedLife.closed) notify(t("preview.embed_failed", { reason: errorText(error) }), "guasto");
      });
    }
    container.dispatchEvent(new Event("markdown-resize", { bubbles: true }));
  }

  render();
  if (options.resources) {
    life.add(options.resources.subscribe((change) => {
      if (life.closed) return;
      const projected: NativeMarkdownContent[] = [];
      for (const element of container.querySelectorAll<HTMLElement>("[data-md-from][data-md-to]")) {
        if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
        const from = sourceNumber(element.dataset.mdFrom);
        const to = sourceNumber(element.dataset.mdTo);
        if (from === null || to === null) continue;
        const rendered = options.resources!.match(from, to);
        if (rendered) projected.push(rendered);
      }
      const same = projected.length === nativeUses.length
        && projected.every((rendered, index) => rendered === nativeUses[index]);
      if (!same || (change === "embeds" && hasEmbeds)) render();
    }));
  }
  return dispose;
}
