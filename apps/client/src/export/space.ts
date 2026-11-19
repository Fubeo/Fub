// Lo spazio «Esporta in PDF» (E28, T70; il prototipo `.px-root`, righe
// 1040–1213, passi 28 e 29).
//
// Prende tutta la finestra sotto la barra del titolo: in alto la barra
// (`toolbar.ts`), sotto le pagine come usciranno su un fondo neutro
// (`pages.ts`), a destra il pannello delle dieci sezioni
// (`sections/index.ts`), in fondo la banda (`band.ts`). Si apre dal menu «…»
// del riquadro e dallo spazio dei comandi; Esc, o «Torna alla nota», lo
// chiude e il fuoco torna dov'era. Chi lo apre ha già salvato la nota: la
// resa per la stampa il core la legge dal disco.
//
// Le due velocità dell'impaginatore valgono anche qui: un cambio che rifà le
// misure (pagina, colonne, interruzioni) ricomincia l'impaginazione, un
// colore cambia soltanto le variabili sulle pagine. Mentre si trascina un
// controllo (`live`) il pannello non si ridisegna: cambiano solo le pagine.
//
// La nota cambiata in un altro riquadro si segue: dopo una breve quiete si
// salva e si chiede la resa nuova, con le stesse pagine sotto gli occhi.

import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { printPages, type PrintMount, type PrintRenderer } from "../editors/media/print-view";
import { reducedMotion } from "../theme/reduced-motion";
import { icon, iconEl, registerIcon } from "../ui/icons";
import { openLifetime } from "../ui/lifetime";
import { showContextMenu } from "../ui/menu";
import { notify } from "../ui/notify";
import { createBand, type Band } from "./band";
import { ExportPages, steppedZoom } from "./pages";
import { PrintPaginator, type Scheduler, type SlicedResult } from "./paginate/slices";
import type { BlockSource } from "./paginate/slices";
import { defaultProfile, printSettingsOf, type ExportProfile } from "./profile";
import { SECTIONS, type ExportSection } from "./sections/index";
import { createToolbar, type ExportView, type Toolbar } from "./toolbar";

/// Quanto si aspetta dopo l'ultimo cambio della nota prima di rifare la resa.
export const FOLLOW_QUIET_MS = 400;

export interface ExportSpaceOptions {
  readonly doc: string;
  /// Il nome della nota, nella barra e in cima alla prima pagina.
  readonly title: string;
  readonly render: PrintRenderer;
  readonly mount?: PrintMount;
  /// Dove sta lo spazio: di serie `#app`, sotto la barra del titolo.
  readonly container?: HTMLElement;
  /// Ciò che sta sotto lo spazio e non deve prendere il fuoco finché è
  /// aperto: di serie l'area di lavoro e la banda di stato.
  readonly behind?: readonly HTMLElement[];
  /// La nota cambia o si salva: lo spazio si iscrive e rifà la resa.
  readonly follow?: (changed: (event: "changed" | "saved") => void) => () => void;
  /// Salva la nota, prima di rifare la resa.
  readonly save?: () => Promise<void>;
  /// Scrive il PDF (T77a). Finché non c'è, «Esporta» passa alla stampa del
  /// sistema le stesse pagine.
  readonly exportPdf?: (profile: ExportProfile) => Promise<void>;
  readonly profile?: ExportProfile;
  readonly onClose?: () => void;
  readonly scheduler?: Scheduler;
  readonly waitMs?: number;
  readonly measure?: (page: HTMLElement) => BlockSource & { dispose?(): void };
  /// Lo spazio della prima resa, per chi vuole aspettarla (il banco, i test).
  readonly onReady?: (result: SlicedResult) => void;
}

export interface ExportSpace {
  readonly element: HTMLElement;
  readonly paginator: PrintPaginator;
  readonly profile: ExportProfile;
  readonly view: ExportView;
  setView(view: Exclude<ExportView, "libera">): void;
  setProfile(next: ExportProfile, options?: { readonly live?: boolean }): void;
  openSection(id: string): void;
  print(): Promise<void>;
  close(): void;
}

const ICONS: Readonly<Record<string, readonly string[]>> = {
  "export-open": ["M6.75 9.3L12 14.7l5.25-5.4"],
};

/// Il conto dei segnalibri del PDF: i titoli della nota impaginata.
function bookmarksOf(result: SlicedResult): number {
  return result.boxes.filter((box) => box.kind === "heading").length;
}

export function openExportSpace(options: ExportSpaceOptions): ExportSpace {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const lifetime = openLifetime();
  const container = options.container ?? document.getElementById("app") ?? document.body;
  const behind = options.behind ?? [document.getElementById("workspace"), document.getElementById("status-band")].filter((node): node is HTMLElement => node !== null);
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let profile = options.profile ?? defaultProfile();
  const base = profile;
  let view: ExportView = "adatta";
  let free = 1;
  let closed = false;
  let latest: SlicedResult | null = null;
  const finals: ((result: SlicedResult) => void)[] = [];
  let readyTold = false;
  let settings = printSettingsOf(profile);

  const root = document.createElement("div");
  root.className = "export-space";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", t("pdf_export.title"));
  root.tabIndex = -1;

  const toolbar: Toolbar = createToolbar(options.title, {
    back: () => space.close(),
    zoom: (step) => {
      free = steppedZoom(pages.zoom, step);
      view = "libera";
      toolbar.setView(view);
      toolbar.setZoom(pages.setView("libera", free));
    },
    view: (next) => space.setView(next),
    profile: (anchor) => openProfileMenu(anchor),
    print: () => void space.print(),
    exportPdf: () => void exportNow(),
  });

  const main = document.createElement("div");
  main.className = "export-main";
  const stage = document.createElement("div");
  stage.className = "export-stage";
  stage.setAttribute("role", "region");
  stage.setAttribute("aria-label", t("pdf_export.pages"));
  stage.tabIndex = 0;
  const side = document.createElement("aside");
  side.className = "export-side";
  side.setAttribute("aria-label", t("pdf_export.side"));
  main.append(stage, side);
  const band: Band = createBand();
  band.status(t("pdf_export.band.loading"));
  band.setHint(t("pdf_export.band.hint"));
  root.append(toolbar.element, main, band.element);

  const pages = new ExportPages({
    stage,
    onVisible: (visible) => paginator.setVisible(visible),
    onPick: (index) => {
      space.setView("adatta");
      pages.reveal(index);
    },
  });

  const opened = new Set<string>();
  const heads = new Map<string, { head: HTMLButtonElement; summary: HTMLElement }>();

  function sectionContext() {
    return {
      get profile() {
        return profile;
      },
      change: (next: ExportProfile, change?: { readonly live?: boolean }) => space.setProfile(next, change),
      open: (id: string) => space.openSection(id),
    };
  }

  function renderSection(section: ExportSection): HTMLElement {
    const wrap = document.createElement("section");
    wrap.className = "export-section";
    wrap.dataset["section"] = section.id;
    const open = opened.has(section.id);
    wrap.classList.toggle("is-open", open);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "export-section-head";
    head.id = `export-section-${section.id}`;
    head.setAttribute("aria-expanded", String(open));
    head.setAttribute("aria-controls", `export-section-body-${section.id}`);
    const name = document.createElement("b");
    name.className = "export-section-name";
    name.textContent = t(section.title);
    const summary = document.createElement("span");
    summary.className = "export-section-summary";
    summary.textContent = section.summary(profile);
    const chevron = document.createElement("span");
    chevron.className = "export-icon export-icon-small export-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    const svg = iconEl("export-open");
    if (svg) chevron.append(svg);
    head.append(name, summary, chevron);
    head.addEventListener("click", () => toggleSection(section.id));
    const body = document.createElement("div");
    body.className = "export-section-body";
    body.id = `export-section-body-${section.id}`;
    body.setAttribute("role", "region");
    body.setAttribute("aria-labelledby", head.id);
    body.hidden = !open;
    if (open) {
      if (section.body) body.append(section.body(sectionContext()));
      else {
        const note = document.createElement("p");
        note.className = "export-note";
        note.textContent = t("pdf_export.section.coming");
        body.append(note);
      }
    }
    wrap.append(head, body);
    heads.set(section.id, { head, summary });
    return wrap;
  }

  /// Rifà il pannello, col fuoco sul controllo che l'aveva (per `id`, se ce
  /// l'ha, se no la testa della sua sezione).
  function renderSide(): void {
    const active = document.activeElement instanceof HTMLElement && side.contains(document.activeElement) ? document.activeElement : null;
    const activeId = active?.id ?? "";
    const activeSection = active?.closest<HTMLElement>(".export-section")?.dataset["section"] ?? "";
    const scroll = side.scrollTop;
    heads.clear();
    side.replaceChildren(...SECTIONS.map(renderSection));
    side.scrollTop = scroll;
    if (!active) return;
    const again = (activeId ? side.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`) : null) ?? heads.get(activeSection)?.head ?? null;
    again?.focus({ preventScroll: true });
  }

  function toggleSection(id: string): void {
    if (opened.has(id)) opened.delete(id);
    else opened.add(id);
    renderSide();
  }

  function renderSummaries(): void {
    for (const section of SECTIONS) {
      const entry = heads.get(section.id);
      if (entry) entry.summary.textContent = section.summary(profile);
    }
  }

  function onUpdate(result: SlicedResult): void {
    latest = result;
    pages.show(result, paginator.host, settings.layout);
    band.update(profile, {
      pages: result.final ? result.pagination.pages.length : result.total,
      bookmarks: profile.frontespizio.segnalibri ? bookmarksOf(result) : null,
      ms: result.workMs,
    });
    toolbar.setZoom(pages.zoom);
    if (result.final) {
      for (const resolve of finals.splice(0)) resolve(result);
      if (!readyTold) {
        readyTold = true;
        options.onReady?.(result);
      }
    }
  }

  function onError(error: unknown): void {
    band.status(t("pdf_export.band.failed"));
    notify(t("pdf_export.failed", { reason: errorText(error) }), "guasto");
  }

  const paginator = new PrintPaginator({
    doc: options.doc,
    title: options.title,
    render: options.render,
    mount: options.mount,
    settings,
    onUpdate,
    onError,
    scheduler: options.scheduler,
    waitMs: options.waitMs,
    measure: options.measure,
  });
  pages.setColors(settings.look.colors);

  function whenFinal(): Promise<SlicedResult> {
    if (latest?.final) return Promise.resolve(latest);
    return new Promise((resolve) => finals.push(resolve));
  }

  function openProfileMenu(anchor: HTMLElement): void {
    showContextMenu(anchor, [
      { label: base.nome, choice: "radio", checked: true, run: () => space.setProfile(base) },
    ], { label: t("pdf_export.profile.menu") });
  }

  async function printNow(): Promise<boolean> {
    const result = await whenFinal();
    if (closed) return false;
    const printable = pages.printable();
    if (printable.length === 0 || result.pagination.pages.length === 0) {
      notify(t("errors.print.no_pages"), "guasto");
      return false;
    }
    try {
      const { page } = settings.layout;
      printPages(printable, { width: page.width, height: page.height });
      return true;
    } catch (error) {
      notify(t("document.print_unavailable", { reason: errorText(error) }), "guasto");
      return false;
    }
  }

  async function exportNow(): Promise<void> {
    if (options.exportPdf) {
      try {
        await options.exportPdf(profile);
      } catch (error) {
        notify(t("pdf_export.failed", { reason: errorText(error) }), "guasto");
      }
      return;
    }
    if (await printNow()) notify(t("pdf_export.via_print"), "info");
  }

  // La nota cambiata altrove: una quiete, poi salva e rifà la resa.
  let followTimer = 0;
  let saving = false;
  const follow = (event: "changed" | "saved") => {
    if (closed || (saving && event === "saved")) return;
    window.clearTimeout(followTimer);
    followTimer = window.setTimeout(() => void refollow(), FOLLOW_QUIET_MS);
  };
  async function refollow(): Promise<void> {
    if (closed) return;
    try {
      saving = true;
      await options.save?.();
    } catch {
      // Un salvataggio fallito lo dice già la nota; la resa resta quella di prima.
      return;
    } finally {
      saving = false;
    }
    if (!closed) void paginator.reload();
  }
  if (options.follow) lifetime.add(options.follow(follow));
  lifetime.add(() => window.clearTimeout(followTimer));

  lifetime.listen(root, "keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      space.close();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      event.stopPropagation();
      void space.print();
    }
  });

  const restore = behind.map((node) => [node, node.inert] as const);
  for (const node of behind) node.inert = true;
  lifetime.add(() => {
    for (const [node, inert] of restore) node.inert = inert;
  });

  const space: ExportSpace = {
    element: root,
    paginator,
    get profile() {
      return profile;
    },
    get view() {
      return view;
    },
    setView(next) {
      view = next;
      toolbar.setView(next);
      toolbar.setZoom(pages.setView(next, free));
    },
    setProfile(next, change) {
      profile = next;
      settings = printSettingsOf(next);
      paginator.update(settings);
      pages.setColors(settings.look.colors);
      toolbar.setProfile(next.nome, next !== base);
      if (change?.live) return;
      renderSummaries();
      if (latest) band.update(profile, { pages: latest.final ? latest.pagination.pages.length : latest.total, bookmarks: profile.frontespizio.segnalibri ? bookmarksOf(latest) : null, ms: latest.workMs });
    },
    openSection(id) {
      if (!SECTIONS.some((section) => section.id === id)) return;
      opened.add(id);
      renderSide();
      heads.get(id)?.head.scrollIntoView({ block: "nearest" });
    },
    print: async () => {
      await printNow();
    },
    close() {
      if (closed) return;
      closed = true;
      finals.length = 0;
      lifetime.close();
      paginator.dispose();
      pages.dispose();
      root.remove();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      options.onClose?.();
    },
  };

  toolbar.setProfile(profile.nome, false);
  renderSide();
  container.append(root);
  // Entra salendo di poco, come nel prototipo; col moto ridotto compare.
  if (!reducedMotion() && typeof root.animate === "function") {
    root.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  root.focus({ preventScroll: true });
  void paginator.open();
  return space;
}
