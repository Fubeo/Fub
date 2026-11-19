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
//
// I diagrammi (T75) si disegnano con lo stile della sezione Diagrammi: chi
// monta la resa riceve l'aspetto di ogni diagramma (`ExportMount`), e un
// cambio di stile, colori o fondo rimonta la resa che c'è, senza chiederla
// di nuovo al core (`vectors.ts`).
// Più note in un PDF (T78) passano dallo stesso spazio: `export/book.ts` dà
// la resa, il montaggio e la misura del libro, ogni nota un capitolo che
// comincia su una pagina sua; il resto (le pagine, le sezioni, la banda, la
// stampa) non sa che le note sono più d'una.
//
// Intorno alle pagine della nota lo spazio mette il frontespizio, l'indice e
// su ogni foglio la testata e il piè (T73): i fogli e i loro numeri li decide
// `paginate/toc.ts`, l'indice si misura su un foglio fuori dalla vista. Un
// cambio di testata, frontespizio o indice ridisegna i fogli e non rifà
// l'impaginazione della nota; col frontespizio il titolo in cima alla nota
// esce dall'impaginazione (sta sul frontespizio).
//
// Sulle pagine stanno anche le guide dei margini (`guides.ts`), lo specchio
// e la filigrana della sezione «Pagina» (T72); i caratteri del vault che il
// profilo nomina si caricano all'apertura e si tolgono alla chiusura
// (`PrintFonts`).

import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { printPages, type PrintMount, type PrintRenderer } from "../editors/media/print-view";
import type { RenderedDocument } from "../host/contract";
import type { DiagramLookOverride } from "../ui/mermaid";
import { reducedMotion } from "../theme/reduced-motion";
import { icon, iconEl, registerIcon } from "../ui/icons";
import { openLifetime } from "../ui/lifetime";
import { showContextMenu } from "../ui/menu";
import { notify } from "../ui/notify";
import { promptText } from "../ui/dialogs";
import { createBand, type Band } from "./band";
import { inertComments } from "./content/comments";
import { ExportContent } from "./content/index";
import { renderPdfPages, type PdfPagesPorts } from "./content/pdf-pages";
import { attachGuides } from "./guides";
import { ExportPages, steppedZoom, type PageDecor } from "./pages";
import { decorOf as sheetsDecorOf, tocMeasurer } from "./decor";
import { PrintMeasure } from "./paginate/measure";
import { PrintPaginator, type PrintSettings, type Scheduler, type SlicedResult } from "./paginate/slices";
import type { BlockSource } from "./paginate/slices";
import { defaultProfile, MM, paperSize, printSettingsOf, type ExportProfile, type ProfileStore, type StoredProfile } from "./profile";
import { coverFactsOf, type CoverFacts } from "./sections/cover-toc";
import { PrintFonts, type VaultFontSource } from "./sections/fonts";
import { displayPath, longDate } from "./sections/header-footer";
import { SECTIONS, type ExportSection, type SectionContext } from "./sections/index";
import { pageMarksOf } from "./sections/page";
import { numberHeadings } from "./themes";
import { createToolbar, profileMenuItems, type ExportView, type Toolbar } from "./toolbar";
import { DiagramMemory, diagramLookKey, diagramPrintLook, overrideFor, preparePrintVectors, type DiagramPrintLook } from "./vectors";

/// Come si disegna un diagramma della resa montata: per la sua posizione fra
/// i diagrammi della nota, `null` per quello di una nota trasclusa.
export interface ExportMountLook {
  diagramLook(index: number | null): DiagramLookOverride | null;
}

/// Chi monta la resa per lo spazio: un `PrintMount` che sa anche disegnare i
/// diagrammi nello stile dell'esportazione.
export type ExportMount = (container: HTMLElement, rendered: RenderedDocument, look: ExportMountLook) => ReturnType<PrintMount>;

/// Quanto si aspetta dopo l'ultimo cambio della nota prima di rifare la resa.
export const FOLLOW_QUIET_MS = 400;

export interface ExportSpaceOptions {
  /// La nota; per più note (`export/book.ts`, T78) la prima, e `render`,
  /// `mount` e `measure` sono quelli del libro.
  readonly doc: string;
  /// Il nome della nota, nella barra e in cima alla prima pagina; per più
  /// note quello della cartella o della scelta, col loro numero.
  readonly title: string;
  /// Ciò che dice «Torna…»: di serie «Torna alla nota». Più note, aperte
  /// dall'albero, tornano alle note.
  readonly backLabel?: string;
  readonly render: PrintRenderer;
  readonly mount?: ExportMount;
  /// Gli stili dati a un diagramma solo, per la sua posizione nella nota.
  readonly diagramStyles?: ReadonlyMap<number, string>;
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
  /// sistema le stesse pagine. `fontFaces`: le regole `@font-face` dei
  /// caratteri del vault caricati, per la sonda (`ProbeOptions.fontFaces`).
  readonly exportPdf?: (profile: ExportProfile, extra: { readonly fontFaces: readonly string[] }) => Promise<void>;
  /// I caratteri del vault per la sezione «Caratteri» (T72). Senza, ci sono
  /// solo quelli di Fub.
  readonly vaultFonts?: VaultFontSource;
  readonly profile?: ExportProfile;
  /// L'id del profilo salvato da cui si parte (vuoto: «Di serie»).
  readonly profileId?: string;
  /// I profili salvati del vault (T79): il menu del profilo li elenca, li
  /// salva, li copia, li rinomina e ne fa il predefinito. Senza, il menu ha
  /// solo il profilo da cui si parte.
  readonly profiles?: ProfileStore;
  /// Le proprietà della nota (il frontmatter, dall'indice): l'icona, l'autore
  /// e le proprietà in evidenza del frontespizio, l'autore della testata. Si
  /// richiedono all'apertura e quando la nota cambia; senza, il frontespizio
  /// ha il titolo e la data.
  readonly properties?: () => Promise<readonly { readonly key: string; readonly value: unknown }[]>;
  /// Come trovare, leggere e aprire un PDF incorporato, per «tutte le pagine
  /// in coda» del Contenuto (T74); senza, il PDF esce con la sua anteprima.
  readonly pdf?: PdfPagesPorts;
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
  /// Dà a un diagramma solo uno stile suo (`null`: torna a quello di tutti).
  setDiagramStyle(index: number, style: string | null): void;
  /// Gli stili dati a un diagramma solo, per la sua posizione.
  readonly diagramStyles: ReadonlyMap<number, string>;
  print(): Promise<void>;
  close(): void;
}

/// Le icone dello spazio e delle sue sezioni: si registrano all'apertura, una
/// volta sola (il selettore libero dei Colori e dei Diagrammi è `export-pick`).
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "export-open": ["M6.75 9.3L12 14.7l5.25-5.4"],
  "export-pick": ["M4.5 19.5l3.6-.9 10.95-10.95-2.7-2.7L5.4 15.9z", "M3.75 21.75h16.5"],
};

/// Il conto dei segnalibri del PDF: i titoli della nota impaginata.
function bookmarksOf(result: SlicedResult): number {
  return result.boxes.filter((box) => box.kind === "heading").length;
}

/// Registra le icone dello spazio (una volta: un tema può ridisegnarle).
export function registerExportSpaceIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

export function openExportSpace(options: ExportSpaceOptions): ExportSpace {
  registerExportSpaceIcons();
  const lifetime = openLifetime();
  const container = options.container ?? document.getElementById("app") ?? document.body;
  const behind = options.behind ?? [document.getElementById("workspace"), document.getElementById("status-band")].filter((node): node is HTMLElement => node !== null);
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let profile = options.profile ?? defaultProfile();
  /// Il profilo scelto com'era, e il suo id: le regolazioni «ne escono»
  /// quando il profilo di adesso non è più lui.
  let base = profile;
  let baseId = options.profileId ?? "";
  let view: ExportView = "adatta";
  let free = 1;
  let closed = false;
  let latest: SlicedResult | null = null;
  const finals: ((result: SlicedResult) => void)[] = [];
  let readyTold = false;
  let settings = printSettingsOf(profile);
  const diagramStyles = new Map(options.diagramStyles ?? []);
  let diagramLook: DiagramPrintLook = diagramPrintLook(profile, diagramStyles);
  let diagramKey = diagramLookKey(diagramLook);
  const diagramMemory = new DiagramMemory();
  let cover: CoverFacts = { title: options.title, path: displayPath(options.doc), author: "", date: longDate(), icon: null, properties: [] };
  const fonts = new PrintFonts(options.vaultFonts ?? null);

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
  if (options.backLabel) {
    const back = toolbar.element.querySelector<HTMLElement>(".export-back");
    const label = back?.querySelector<HTMLElement>(".export-back-label");
    if (label) label.textContent = options.backLabel;
    back?.setAttribute("aria-label", options.backLabel);
  }

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
  const memory = new Map<string, unknown>();
  /// Il profilo che le pagine mostrano senza che sia scelto (il passaggio su
  /// un tema), o `null`.
  let previewing: ExportProfile | null = null;

  /// Le pagine mostrano `settings`: le misure all'impaginatore, i colori e i
  /// caratteri sulle pagine (le copie dei blocchi si vestono come la resa che
  /// si è misurata).
  function showSettings(next: PrintSettings): void {
    settings = next;
    paginator.update(next);
    pages.setColors({ ...next.layout.type, ...next.look.colors });
  }

  function preview(next: ExportProfile | null): void {
    if (closed || next === previewing) return;
    previewing = next;
    showSettings(printSettingsOf(next ?? profile));
    pages.setMarks(pageMarksOf(next ?? profile));
    // Un tema in anteprima cambia anche i diagrammi che seguono il tema.
    restyleDiagrams();
  }

  /// Carica i caratteri del vault che il profilo nomina; quando arrivano, le
  /// pagine si rifanno col carattere vero.
  function loadFonts(of: ExportProfile): void {
    void fonts.ensure(of).then((fresh) => {
      if (fresh && !closed) showSettings(printSettingsOf(previewing ?? profile));
    });
  }

  function sectionContext(): SectionContext {
    return {
      get profile() {
        return profile;
      },
      change: (next, change) => space.setProfile(next, change),
      open: (id) => space.openSection(id),
      preview,
      highlight: (color) => {
        if (color) pages.element.dataset["highlight"] = color;
        else delete pages.element.dataset["highlight"];
      },
      redraw: () => renderSide(),
      memory,
      diagrams: {
        get own() {
          return diagramStyles.size;
        },
        clearOwn: () => {
          diagramStyles.clear();
          restyleDiagrams();
          renderSide();
        },
      },
      fonts,
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
    // Con la sezione «Pagina» aperta le guide dei margini si vedono appena.
    pages.element.dataset["guides"] = String(opened.has("pagina"));
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

  /// L'indice su un foglio fuori dalla vista, coi caratteri delle pagine
  /// (anche quelle di un tema in anteprima).
  const measureToc = tocMeasurer(pages, () => settings.layout);

  /// I fogli di un'impaginazione (`decor.ts`, gli stessi dell'esportazione
  /// fuori dallo schermo): frontespizio, indice, pagine della nota, e su
  /// ognuno testata e piè.
  function decorOf(result: SlicedResult): PageDecor {
    return sheetsDecorOf({ result, host: paginator.host, profile, layout: settings.layout, cover, measureToc }).decor;
  }

  /// Il numero delle pagine del PDF: i fogli prima della nota e le sue.
  function pageTotal(result: SlicedResult, decor: PageDecor): number | null {
    const flow = result.final ? result.pagination.pages.length : result.total;
    return flow === null ? null : decor.front + flow;
  }

  function updateBand(result: SlicedResult, decor: PageDecor): void {
    band.update(profile, {
      pages: pageTotal(result, decor),
      bookmarks: profile.frontespizio.segnalibri ? bookmarksOf(result) : null,
      ms: result.workMs,
    });
  }

  /// Ridisegna i fogli intorno alla stessa impaginazione.
  function redecorate(): void {
    if (!latest) return;
    const decor = decorOf(latest);
    pages.decorate(decor);
    updateBand(latest, decor);
  }

  function onUpdate(result: SlicedResult): void {
    latest = result;
    const decor = decorOf(result);
    pages.show(result, paginator.host, settings.layout, decor);
    updateBand(result, decor);
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

  const content = new ExportContent({
    title: options.title,
    properties: options.properties,
    cardPages: options.pdf ? (target, width) => renderPdfPages(options.pdf!, target, options.doc, width) : undefined,
    onChange: () => {
      if (!closed) paginator.remeasure();
    },
  });

  const exportMount = options.mount;
  const mount: PrintMount | undefined = exportMount && ((container, rendered) =>
    exportMount(container, rendered, { diagramLook: (index) => overrideFor(diagramLook, index) }));

  /// Lo stile dei diagrammi è cambiato: la resa che c'è si rimonta. Vale il
  /// profilo che le pagine mostrano, anche quello in anteprima.
  function restyleDiagrams(): void {
    diagramLook = diagramPrintLook(previewing ?? profile, diagramStyles);
    const key = diagramLookKey(diagramLook);
    if (key === diagramKey) return;
    diagramKey = key;
    if (!closed) void paginator.remount();
  }

  const paginator: PrintPaginator = new PrintPaginator({
    doc: options.doc,
    title: options.title,
    // I commenti della resa diventano segnaposti che il sanificatore lascia
    // passare (`inertComments`): senza, la scelta «Commenti» non avrebbe niente.
    render: async (doc, target) => {
      const rendered = await options.render(doc, target);
      return { ...rendered, html: inertComments(rendered.html) };
    },
    mount,
    prepare: (page) => preparePrintVectors(page, diagramMemory),
    settings,
    onUpdate,
    onError,
    scheduler: options.scheduler,
    waitMs: options.waitMs,
    // Prima di misurare, ogni titolo prende il suo numero: lo mostra solo un
    // tema coi titoli numerati, ma la resa misurata e le copie lo portano già.
    // Poi il Contenuto cambia la resa secondo le scelte (T74), e la rimette
    // com'era alla misura dopo.
    measure: (page) => {
      numberHeadings(page);
      return content.measure(page, paginator.host, settings.layout, (shaped) => (options.measure ? options.measure(shaped) : new PrintMeasure(shaped)));
    },
  });
  pages.setColors({ ...settings.layout.type, ...settings.look.colors });
  pages.setMarks(pageMarksOf(profile));
  lifetime.add(
    attachGuides({
      pages: pages.element,
      root,
      pxPerMm: () => pages.zoom * MM,
      profile: () => profile,
      paper: (of) => paperSize(of.pagina),
      change: (next, live) => space.setProfile(next, { live }),
      done: () => space.openSection("pagina"),
    }),
  );
  lifetime.add(() => fonts.dispose());
  loadFonts(profile);

  function whenFinal(): Promise<SlicedResult> {
    if (latest?.final) return Promise.resolve(latest);
    return new Promise((resolve) => finals.push(resolve));
  }

  function openProfileMenu(anchor: HTMLElement): void {
    const store = options.profiles;
    if (!store) {
      showContextMenu(anchor, [
        { label: base.nome, choice: "radio", checked: true, run: () => space.setProfile(base) },
      ], { label: t("pdf_export.profile.menu") });
      return;
    }
    void store.list(options.doc).then(
      (shelf) => {
        if (closed || !anchor.isConnected) return;
        showContextMenu(anchor, profileMenuItems({ shelf, currentId: baseId, base, modified: profile !== base }, profileActions(store, shelf.noteType?.name ?? "")), {
          label: t("pdf_export.profile.menu"),
        });
      },
      (error) => notify(t("pdf_export.profiles.list_failed", { reason: errorText(error) }), "guasto"),
    );
  }

  /// Sceglie `next` come profilo da cui si parte: le pagine lo mostrano, e
  /// le regolazioni non ne sono uscite.
  function adopt(id: string, next: ExportProfile): void {
    base = next;
    baseId = id;
    space.setProfile(next);
  }

  /// Un nome chiesto a chi esporta; `null` se rinuncia.
  async function askName(title: string, ok: string, value: string): Promise<string | null> {
    const name = await promptText({ title, label: t("pdf_export.profiles.name"), value, okLabel: ok });
    const clean = name?.trim() ?? "";
    return clean === "" ? null : clean;
  }

  function profileActions(store: ProfileStore, typeName: string) {
    const failed = (error: unknown) => notify(t("pdf_export.profiles.failed", { reason: errorText(error) }), "guasto");
    return {
      choose: (entry: StoredProfile | null) => {
        if (entry === null) adopt("", defaultProfile());
        else if (entry.profile) adopt(entry.id, entry.profile);
      },
      saveNew: () => void (async () => {
        const name = await askName(t("pdf_export.profiles.save_new.title"), t("pdf_export.profiles.save_ok"), t("pdf_export.profiles.new_name"));
        if (name === null || closed) return;
        try {
          const next = { ...profile, nome: name };
          const id = await store.save(null, next);
          if (closed) return;
          adopt(id, next);
          notify(t("pdf_export.profiles.saved", { name }), "info");
        } catch (error) {
          failed(error);
        }
      })(),
      saveOver: () => void (async () => {
        if (baseId === "") return;
        try {
          const next = { ...profile, nome: base.nome };
          await store.save(baseId, next);
          if (closed) return;
          adopt(baseId, next);
          notify(t("pdf_export.profiles.saved_over", { name: next.nome }), "info");
        } catch (error) {
          failed(error);
        }
      })(),
      copy: () => void (async () => {
        if (baseId === "") return;
        const name = await askName(t("pdf_export.profiles.copy.title"), t("pdf_export.profiles.copy_ok"), t("pdf_export.profiles.copy_name", { name: base.nome }));
        if (name === null || closed) return;
        try {
          await store.copy(baseId, name);
          notify(t("pdf_export.profiles.copied", { name }), "info");
        } catch (error) {
          failed(error);
        }
      })(),
      rename: () => void (async () => {
        if (baseId === "") return;
        const name = await askName(t("pdf_export.profiles.rename.title"), t("pdf_export.profiles.rename_ok"), base.nome);
        if (name === null || closed) return;
        try {
          await store.rename(baseId, name);
          if (closed) return;
          // Il nome cambia, le regolazioni di adesso restano come sono.
          const renamed = { ...base, nome: name };
          const changed = profile !== base;
          base = renamed;
          space.setProfile(changed ? { ...profile, nome: name } : renamed);
          notify(t("pdf_export.profiles.renamed", { name }), "info");
        } catch (error) {
          failed(error);
        }
      })(),
      toggleDefault: (scope: "vault" | "type") => void (async () => {
        try {
          const shelf = await store.list(options.doc);
          const now = scope === "vault" ? (shelf.vaultDefault ?? "") : (shelf.typeDefault ?? null);
          const on = now === baseId;
          await store.setDefault(on ? "" : baseId, scope, options.doc);
          if (closed) return;
          if (on && scope === "type") notify(t("pdf_export.profiles.default_off_type", { type: typeName }), "info");
          else if (on || baseId === "") notify(t("pdf_export.profiles.default_off"), "info");
          else if (scope === "vault") notify(t("pdf_export.profiles.default_set_vault", { name: base.nome }), "info");
          else notify(t("pdf_export.profiles.default_set_type", { name: base.nome, type: typeName }), "info");
        } catch (error) {
          failed(error);
        }
      })(),
      revert: () => space.setProfile(base),
    };
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
        await options.exportPdf(profile, { fontFaces: fonts.fontFaces() });
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
    if (!closed) {
      content.refresh();
      void paginator.reload();
      void loadProperties();
    }
  }

  /// Le proprietà della nota per il frontespizio e la testata; una risposta
  /// vecchia arrivata dopo una nuova si scarta, un errore lascia quelle di
  /// prima.
  let propertiesAsked = 0;
  async function loadProperties(): Promise<void> {
    if (!options.properties) return;
    const asked = ++propertiesAsked;
    let read: readonly { readonly key: string; readonly value: unknown }[];
    try {
      read = await options.properties();
    } catch {
      return;
    }
    if (closed || asked !== propertiesAsked) return;
    const facts = coverFactsOf(read);
    cover = { ...cover, ...facts };
    redecorate();
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
      const before = profile;
      profile = next;
      previewing = null;
      showSettings(printSettingsOf(next));
      pages.setMarks(pageMarksOf(next));
      toolbar.setProfile(next.nome, next !== base);
      restyleDiagrams();
      // Testata, frontespizio e indice non cambiano le misure della nota:
      // si ridisegnano i fogli, anche dal vivo (un testo tuo mentre si scrive).
      const decorChanged = before.testata !== next.testata || before.frontespizio !== next.frontespizio || before.pagina.specchio !== next.pagina.specchio;
      if (decorChanged) redecorate();
      if (change?.live) return;
      loadFonts(next);
      renderSide();
      if (latest && !decorChanged) updateBand(latest, decorOf(latest));
    },
    openSection(id) {
      if (!SECTIONS.some((section) => section.id === id)) return;
      opened.add(id);
      renderSide();
      heads.get(id)?.head.scrollIntoView({ block: "nearest" });
    },
    get diagramStyles() {
      return diagramStyles;
    },
    setDiagramStyle(index, style) {
      if (!Number.isSafeInteger(index) || index < 0) return;
      if (style === null) diagramStyles.delete(index);
      else diagramStyles.set(index, style);
      restyleDiagrams();
      renderSide();
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
      content.dispose();
      diagramMemory.dispose();
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
  void loadProperties();
  return space;
}
