// La superficie delle annotazioni di un PDF: il profilo `pdf` della famiglia
// `canvas`, sui file `.fubann` (`docs/product/pdf-annotations.md`).
//
// Monta l'editor del disegno con un foglio: una pagina alla volta, la pagina
// del PDF sotto e sopra i soli gruppi di quella pagina. Le modalità sono due,
// Annota (`draw`) e Lettura (`read`): in Lettura le pagine si sfogliano senza
// scrivere, e accanto c'è l'elenco delle annotazioni, note per esteso, che si
// legge anche senza vedere le pagine.
//
// Il PDF è quello che `fub:annotates` nomina, o quello del nome del file. Si
// legge una volta, se ne calcola l'impronta e si apre con pdf.js; impronta e
// numero di pagine si confrontano con quelli scritti sulla radice:
//
// - uguali, o non ancora scritti: niente da dire. Quelli che mancano li
//   scrive il primo gesto, nello stesso passo di annulla;
// - diversi: un avviso, le annotazioni restano dove sono, e «Conferma questa
//   versione» scrive il legame nuovo, un passo di annulla. Nessuno sposta le
//   annotazioni da sé;
// - il PDF non c'è, o non si legge: pagine bianche della misura scritta nei
//   gruppi, e si annota lo stesso, senza scrivere il legame.
//
// Aprire non scrive mai: il legame lo scrive un gesto.

import { errorText, isErrorKind } from "../../../host/errors";
import { onLanguage, plural, t } from "../../../i18n/strings";
import { iconEl } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { EditorRange, EditorSelections, EditorSurface, SelectedText, SurfaceMountContext } from "../../core/registry";
import type { EditorChange } from "../../core/text-operation";
import type { PdfEngine, PdfEngineLoader } from "../../media/pdf-view";
import { readAllResource, type ResourceTransport } from "../../media/resource-port";
import { keyOf } from "../describe";
import { PDF_EXPORTS, PDF_MODES, PDF_PROFILE } from "../modes";
import type { ElementItem } from "../scene/classify";
import type { SceneEngine } from "../scene/engine";
import { elementChildren, type DocumentModel } from "../scene/model";
import { fileName, open, readOnlyText, unreadableText, type Opened } from "../surface";
import { createDrawEditor, type DrawEditor, type DrawSheet } from "../tools/editor";
import { createPageBackground } from "./background";
import {
  A4,
  groupsOf,
  listAnnotations,
  outside,
  pageDestination,
  pageGroups,
  pdfOf,
  rootFacts,
  sha256,
  verdict,
  writtenSize,
  type PdfFacts,
} from "./pages";

type PdfMode = "draw" | "read";

/// Ciò che serve per leggere il PDF: i byte dal vault e pdf.js. Senza, le
/// pagine sono bianche.
export interface PdfPorts {
  readonly transport: ResourceTransport;
  readonly loader?: PdfEngineLoader;
}

export interface PdfSurfaceOptions {
  onChange(change: EditorChange): void;
  onSelectionChange(): void;
  readonly pdf?: PdfPorts;
}

/// Il PDF delle annotazioni, mentre si cerca e dopo.
type Binding =
  | { readonly kind: "pending" }
  | { readonly kind: "unbound" }
  | { readonly kind: "missing"; readonly pdf: string }
  | { readonly kind: "unreadable"; readonly pdf: string; readonly reason: string }
  | { readonly kind: "loaded"; readonly pdf: string; readonly engine: PdfEngine; readonly facts: PdfFacts };

export function mountPdfSurface(context: SurfaceMountContext, options: PdfSurfaceOptions): EditorSurface {
  const life = openLifetime();
  const root = document.createElement("div");
  root.className = "pdf-surface";
  const notice = document.createElement("div");
  notice.className = "vector-notice";
  // Cortese: dice com'è il documento appena aperto, non è un allarme.
  notice.setAttribute("role", "status");
  const messages = document.createElement("div");
  messages.className = "pdf-notice-messages";
  const adoptButton = document.createElement("button");
  adoptButton.type = "button";
  adoptButton.className = "primary vector-notice-action";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "vector-notice-action";
  notice.append(messages, adoptButton, confirmButton);
  const body = document.createElement("div");
  body.className = "pdf-body";
  const drawHost = document.createElement("div");
  drawHost.className = "vector-draw pdf-sheet";
  const list = document.createElement("section");
  list.className = "pdf-list";
  body.append(drawHost, list);
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  root.append(notice, body, live);
  context.parent.append(root);

  let mode: PdfMode = "draw";
  let readOnly = false;
  let disposed = false;
  /// Il testo grezzo del documento, coi terminatori del file.
  let text = "";
  let opened: Opened | null = null;
  let editor: DrawEditor | null = null;
  let editorLife: Lifetime | null = null;
  let binding: Binding = { kind: "pending" };
  /// Il PDF dell'ultimo legame cercato: `undefined` prima del primo.
  let bound: string | null | undefined;
  let bindToken = 0;
  /// La pagina che si vede, da 1, e la sua misura in punti.
  let page = 1;
  let size: readonly [number, number] = A4;
  let turning = 0;
  /// Il testo che l'elenco mostra: non si ricostruisce uguale.
  let listed: string | null = null;
  /// I byte del testo, per le selezioni: si ricavano una volta per testo.
  let encoded: { readonly text: string; readonly bytes: Uint8Array } | null = null;

  const background = createPageBackground({
    onError: (error) => announce(t("media.pdf.page_failed", { reason: errorText(error) })),
  });

  let echo = false;
  const announce = (message: string): void => {
    echo = !echo;
    live.textContent = echo ? message : `${message} `;
  };

  const model = (): DocumentModel | null => (opened?.kind === "scene" ? opened.engine.model : null);

  const pdfName = (): string => {
    const pdf = binding.kind === "pending" || binding.kind === "unbound" ? bound ?? null : binding.pdf;
    return fileName(pdf ?? context.documentId);
  };

  // --- Le pagine --------------------------------------------------------------

  /// Quante pagine si sfogliano: quelle del PDF, e ogni pagina che il file
  /// annota anche oltre; senza PDF quelle che il file dice di avere.
  const pageCount = (): number => {
    const current = model();
    let count = 1;
    if (current !== null) for (const group of pageGroups(current)) count = Math.max(count, group.number);
    if (binding.kind === "loaded") count = Math.max(count, binding.engine.pageCount);
    else if (current !== null) count = Math.max(count, rootFacts(current).pages ?? 0);
    return count;
  };

  /// La misura della pagina `k`: quella del PDF, o quella scritta nel file,
  /// o quella della prima pagina che ne ha una, o A4.
  const sizeOf = async (k: number): Promise<readonly [number, number]> => {
    if (binding.kind === "loaded" && k <= binding.engine.pageCount) {
      try {
        return await binding.engine.pageSize(k - 1);
      } catch {
        // Sotto: la misura scritta.
      }
    }
    const current = model();
    if (current === null) return A4;
    return writtenSize(current, k) ?? pageGroups(current).find((group) => group.size !== null)?.size ?? A4;
  };

  /// Porta il foglio alla pagina `k`; `speak` la annuncia, per chi l'ha
  /// chiesta dalla tastiera.
  const goTo = async (k: number, speak: boolean): Promise<void> => {
    const target = Math.min(Math.max(1, Math.trunc(k)), pageCount());
    const token = ++turning;
    const next = await sizeOf(target);
    if (disposed || token !== turning) return;
    const changed = target !== page || next[0] !== size[0] || next[1] !== size[1];
    page = target;
    size = next;
    background.show(page - 1, size);
    showBar();
    if (changed) editor?.showSheet();
    if (speak) announce(t("media.pdf.page", { page, count: pageCount() }));
  };

  // La barra delle pagine, nella testata dell'editor.
  const bar = document.createElement("div");
  bar.className = "pdf-pages";
  bar.setAttribute("role", "group");
  const pageButton = (className: string, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = `draw-button ${className}`;
    const svg = iconEl("chevron");
    if (svg !== null) control.append(svg);
    life.listen(control, "click", run);
    return control;
  };
  const previous = pageButton("pdf-page-previous", () => void goTo(page - 1, true));
  previous.setAttribute("aria-keyshortcuts", "PageUp");
  const field = document.createElement("input");
  field.type = "text";
  field.inputMode = "numeric";
  field.autocomplete = "off";
  field.className = "pdf-page-input";
  const count = document.createElement("span");
  count.className = "pdf-page-count";
  const next = pageButton("pdf-page-next", () => void goTo(page + 1, true));
  next.setAttribute("aria-keyshortcuts", "PageDown");
  bar.append(previous, field, count, next);
  const fromField = (): void => {
    const wanted = Number(field.value.trim());
    if (Number.isSafeInteger(wanted) && wanted >= 1) void goTo(wanted, false);
    else field.value = String(page);
  };
  life.listen(field, "change", fromField);
  life.listen(field, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      fromField();
    } else if (event.key === "Escape") {
      field.value = String(page);
    }
  });

  const showBar = (): void => {
    const total = pageCount();
    if (document.activeElement !== field) field.value = String(page);
    count.textContent = t("pdf.page.count", { count: total });
    previous.disabled = page <= 1;
    next.disabled = page >= total;
    for (const button of list.querySelectorAll<HTMLButtonElement>(".pdf-list-page")) {
      if (Number(button.dataset.page) === page) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  };

  const relabelBar = (): void => {
    bar.setAttribute("aria-label", t("pdf.pages"));
    for (const [control, key] of [[previous, "pdf.page.previous"], [next, "pdf.page.next"]] as const) {
      control.setAttribute("aria-label", t(key));
      control.title = t(key);
    }
    field.setAttribute("aria-label", t("pdf.page.number"));
  };

  const sheet: DrawSheet = {
    page: () => ({ x: 0, y: 0, width: size[0], height: size[1] }),
    scope: (current) => groupsOf(current, page),
    destination: (current, index, _ids, taken) => pageDestination(current, index, page, size, taken),
    extra: (current) => {
      if (binding.kind !== "loaded") return [];
      const op = verdict(rootFacts(current), binding.facts).op;
      return op === null ? [] : [op];
    },
    turn: (delta) => void goTo(page + delta, true),
    label: () => t("pdf.sheet", { name: pdfName(), page, count: pageCount() }),
    background: background.element,
    controls: bar,
    view: (camera, width, height) => background.view(camera, width, height),
  };

  // --- Il PDF -----------------------------------------------------------------

  const release = (): void => {
    if (binding.kind === "loaded") binding.engine.destroy();
  };

  /// Legge il PDF `pdf`: i byte, l'impronta, pdf.js.
  const load = async (pdf: string, token: number): Promise<void> => {
    const settle = (next: Binding): void => {
      if (disposed || token !== bindToken) {
        if (next.kind === "loaded") next.engine.destroy();
        return;
      }
      binding = next;
      background.setEngine(next.kind === "loaded" ? next.engine : null);
      void goTo(page, false);
      paint();
    };
    const ports = options.pdf;
    if (ports === undefined || ports.loader === undefined) {
      settle({ kind: "unreadable", pdf, reason: t("media.pdf.no_engine") });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = (await readAllResource(ports.transport, pdf)).bytes;
    } catch (error) {
      settle(isErrorKind(error, "not_found") ? { kind: "missing", pdf } : { kind: "unreadable", pdf, reason: errorText(error) });
      return;
    }
    try {
      // L'impronta prima di pdf.js, che può tenersi i byte.
      const digest = await sha256(bytes);
      const engine = await ports.loader(bytes);
      if (engine.pageCount === 0) {
        engine.destroy();
        settle({ kind: "unreadable", pdf, reason: t("media.pdf.empty", { id: fileName(pdf) }) });
        return;
      }
      settle({ kind: "loaded", pdf, engine, facts: { digest, pages: engine.pageCount } });
    } catch (error) {
      settle({ kind: "unreadable", pdf, reason: errorText(error) });
    }
  };

  /// Cerca il PDF che il documento nomina adesso, se è cambiato.
  const rebind = (): void => {
    const current = model();
    const pdf = current === null ? null : pdfOf(context.documentId, rootFacts(current).annotates);
    if (pdf === bound) return;
    bound = pdf;
    release();
    const token = ++bindToken;
    binding = pdf === null ? { kind: "unbound" } : { kind: "pending" };
    background.setEngine(null);
    if (pdf !== null) void load(pdf, token);
  };

  // --- L'editor ---------------------------------------------------------------

  const mountEditor = (engine: SceneEngine): DrawEditor => {
    const owner = openLifetime();
    const mounted = createDrawEditor(drawHost, engine, owner, {
      profile: "pdf",
      // Le note e le forme sono del livello Standard: chi annota un PDF le
      // ha subito.
      level: "standard",
      sheet,
      onChange: (change) => {
        text = change.text;
        opened = { kind: "scene", engine: mounted.engine };
        options.onChange(change);
        paint();
      },
      onSelectionChange: () => options.onSelectionChange(),
    });
    editorLife = owner;
    editor = mounted;
    mounted.setReadOnly(readOnly || mode === "read");
    return mounted;
  };

  const unmountEditor = (): void => {
    const had = editor !== null && editor.selection.length > 0;
    editorLife?.close();
    editorLife = null;
    editor = null;
    if (had) options.onSelectionChange();
  };

  /// Mostra `next`: in un editor che c'è già la scena si ricostruisce, e con
  /// `fresh` il documento è un altro e la cronologia riparte.
  const show = (next: Opened, fresh: boolean): void => {
    opened = next;
    listed = null;
    if (fresh) page = 1;
    if (next.kind === "scene") {
      rebind();
      if (editor === null) {
        mountEditor(next.engine);
      } else if (fresh) {
        editor.load(next.engine);
      } else {
        editor.setEngine(next.engine);
      }
      void goTo(page, false);
    } else {
      unmountEditor();
    }
    paint();
  };

  // --- L'elenco ---------------------------------------------------------------

  const noteItem = (label: string, text: string): HTMLLIElement => {
    const item = document.createElement("li");
    item.className = "pdf-list-note";
    const title = document.createElement("strong");
    title.textContent = label;
    const content = document.createElement("p");
    content.className = "pdf-list-body";
    content.textContent = text;
    item.append(title, content);
    return item;
  };

  const showList = (): void => {
    const current = model();
    if (current === null) {
      list.replaceChildren();
      listed = null;
      return;
    }
    if (listed === text) return;
    listed = text;
    const { pages, outside: loose } = listAnnotations(current);
    const heading = document.createElement("h2");
    heading.className = "pdf-list-heading";
    heading.textContent = t("pdf.list");
    const parts: HTMLElement[] = [heading];
    if (pages.length === 0 && loose.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = t("pdf.list.empty");
      parts.push(empty);
    }
    for (const listedPage of pages) {
      const section = document.createElement("section");
      const title = document.createElement("h3");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "pdf-list-page";
      go.dataset.page = String(listedPage.number);
      go.textContent = t("pdf.list.page", { page: listedPage.number });
      life.listen(go, "click", () => void goTo(listedPage.number, true));
      title.append(go);
      section.append(title);
      if (listedPage.notes.length > 0) {
        const notes = document.createElement("ul");
        for (const note of listedPage.notes) notes.append(noteItem(note.label || note.body.split("\n")[0]!, note.body));
        section.append(notes);
      }
      if (listedPage.marks > 0) {
        const marks = document.createElement("p");
        marks.className = "pdf-list-marks";
        marks.textContent = plural(listedPage.marks, "pdf.list.marks.one", "pdf.list.marks.other");
        section.append(marks);
      }
      parts.push(section);
    }
    if (loose.length > 0) {
      const section = document.createElement("section");
      const title = document.createElement("h3");
      title.textContent = t("pdf.list.outside");
      const notes = document.createElement("ul");
      for (const note of loose) notes.append(noteItem(note.label || note.body.split("\n")[0]!, note.body));
      section.append(title, notes);
      parts.push(section);
    }
    list.replaceChildren(...parts);
    showBar();
  };

  // --- Lo stato a vista -------------------------------------------------------

  const paragraph = (message: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    p.className = "vector-notice-text";
    p.textContent = message;
    return p;
  };

  /// Il fuoco nella parte che si vede: il foglio, un pulsante dell'avviso, o
  /// l'elenco.
  const focusShown = (): void => {
    if (!drawHost.hidden && editor !== null) editor.focus();
    else if (!adoptButton.hidden) adoptButton.focus();
    else root.focus({ preventScroll: true });
  };

  /// Porta la superficie a modalità, documento, PDF e scrittura di adesso.
  const paint = (): void => {
    root.dataset.mode = mode;
    const state = opened;
    const current = model();
    const foreign = state?.kind === "scene" && state.engine.status === "foreign";
    const said: string[] = [];
    let canAdopt = false;
    let canConfirm = false;
    if (state?.kind === "unreadable") {
      said.push(unreadableText(state.error));
    } else if (state?.kind === "inert") {
      said.push(t("vector.read_only", { reason: readOnlyText(state.engine.readOnly[0]!), command: t("commands.doc.source.open") }));
    } else if (current !== null) {
      if (foreign && mode === "draw") {
        said.push(t("vector.foreign"));
        canAdopt = !readOnly;
      }
      switch (binding.kind) {
        case "loaded": {
          const written = rootFacts(current);
          if (verdict(written, binding.facts).state !== "changed") break;
          let message = t("pdf.changed");
          if (written.pages !== null && written.pages !== binding.facts.pages) {
            message += ` ${t("pdf.changed.pages", { before: written.pages, after: binding.facts.pages })}`;
          }
          said.push(message);
          canConfirm = mode === "draw" && !readOnly && !foreign;
          break;
        }
        case "missing":
          said.push(t("pdf.missing", { name: fileName(binding.pdf) }));
          break;
        case "unreadable":
          said.push(t("pdf.unreadable", { name: fileName(binding.pdf), reason: binding.reason }));
          break;
        case "unbound":
          said.push(t("pdf.unbound"));
          break;
        case "pending":
          break;
      }
      const hidden = outside(current);
      if (hidden > 0) said.push(plural(hidden, "pdf.outside.one", "pdf.outside.other"));
    }
    const hadFocus = root.contains(document.activeElement);
    const signature = said.join("\n");
    if (messages.dataset.said !== signature) {
      messages.dataset.said = signature;
      messages.replaceChildren(...said.map(paragraph));
    }
    notice.hidden = said.length === 0;
    adoptButton.textContent = t("vector.foreign.edit");
    adoptButton.hidden = !canAdopt;
    confirmButton.textContent = t("pdf.confirm");
    confirmButton.hidden = !canConfirm;
    drawHost.hidden = editor === null;
    list.hidden = mode !== "read" || current === null;
    editor?.setReadOnly(readOnly || mode === "read");
    if (!list.hidden) showList();
    showBar();
    if (hadFocus && !root.contains(document.activeElement)) focusShown();
  };

  life.listen(adoptButton, "click", () => {
    if (editor?.adopt()) editor.focus();
  });
  life.listen(confirmButton, "click", () => {
    if (editor === null || binding.kind !== "loaded") return;
    const { digest, pages } = binding.facts;
    if (!editor.perform("draw.action.anchor", { op: "anchor", digest, pages })) return;
    announce(t("pdf.confirmed"));
    editor.focus();
  });
  life.add(
    onLanguage(() => {
      relabelBar();
      listed = null;
      paint();
    }),
  );
  relabelBar();

  // --- Le selezioni -----------------------------------------------------------

  const selectedItems = (): ElementItem[] => {
    if (mode !== "draw" || editor === null || editor.selection.length === 0) return [];
    const keys = new Set(editor.selection);
    return editor.engine.scene().filter((item): item is ElementItem => item.kind === "element" && keys.has(keyOf(item)));
  };

  const rangeOf = (item: ElementItem): EditorRange => {
    if (encoded === null || encoded.text !== text) encoded = { text, bytes: new TextEncoder().encode(text) };
    const [start, end] = item.bytes;
    return { start, end, text: new TextDecoder().decode(encoded.bytes.subarray(start, end)) };
  };

  /// Porta in vista l'oggetto che contiene il byte `offset`: prima la sua
  /// pagina. Il gruppo di pagina intero porta solo alla pagina.
  const reveal = (offset: number): boolean => {
    const current = model();
    if (editor === null || current === null) return false;
    const top = editor.engine.scene().find((item) => item.kind === "element" && item.path.length === 1 && offset >= item.bytes[0] && offset < item.bytes[1]);
    if (top === undefined || top.kind !== "element") return false;
    const node = elementChildren(current.root)[top.path[0]!];
    const group = pageGroups(current).find((candidate) => candidate.node === node);
    if (group === undefined) return false;
    const inside = offset !== top.bytes[0];
    void goTo(group.number, false).then(() => {
      if (inside && editor !== null) editor.reveal(offset);
    });
    return true;
  };

  life.add(() => {
    disposed = true;
    bindToken++;
    release();
    background.dispose();
    unmountEditor();
    root.remove();
  });

  root.tabIndex = -1;
  paint();

  return {
    family: "canvas",
    profile: PDF_PROFILE,
    surfaceId: context.paneId,
    modes: PDF_MODES,
    defaultMode: "draw",
    exports: PDF_EXPORTS,
    setMode(nextMode) {
      if (nextMode !== "draw" && nextMode !== "read") throw new RangeError(`surface mode ${nextMode} is not supported`);
      if (nextMode === mode) return;
      mode = nextMode;
      paint();
      options.onSelectionChange();
    },
    buffer: {
      setDoc: (nextText) => {
        text = nextText;
        show(open(nextText), true);
      },
      syncDoc: (update) => {
        const nextText = typeof update === "string" ? update : update.text;
        if (nextText === text) return;
        text = nextText;
        show(open(nextText), false);
      },
      getDoc: () => text,
    },
    focus: focusShown,
    reveal: ({ span }) => reveal(span.start),
    selections: (): EditorSelections | undefined => {
      const items = selectedItems();
      if (items.length === 0) return undefined;
      const [first, ...rest] = items.map(rangeOf);
      return { primary: first!, secondary: rest };
    },
    selectedText: (): SelectedText | null => {
      const items = selectedItems();
      if (items.length === 0) return null;
      const [first, ...rest] = items.map((item) => rangeOf(item).text);
      return { primary: first!, secondary: rest };
    },
    setReadOnly: (nextReadOnly) => {
      readOnly = nextReadOnly;
      paint();
    },
    destroy: () => life.close(),
  };
}
