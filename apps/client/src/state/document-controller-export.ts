// Il gestore del documento: l'esportazione e la stampa.
import { pickFromList } from "../ui/dialogs";
import { lineFeeds, operationFromText } from "../editors/core/text-operation";
import { loadPdf } from "../editors/core/bootstrap";
import { type EditorSurface, type SurfaceExport, type SurfaceExportWindow } from "../editors/core/registry";
import { pageName } from "../rules/organizer";
import { declaredFences } from "../rules/syntax";
import { openResourcePort } from "../editors/media/resource-port";
import { lazyPart } from "../ui/lazy-part";
import { mountRenderedDocument } from "../editors/text/profiles/markdown/mount";
import type { ExportMount } from "../export/space";
import type { PdfPagesPorts } from "../export/content/pdf-pages";
import { api } from "../host/ipc";
import { renderPrint, resolvedReference } from "../host/query";
import { drawingFonts } from "./drawing-fonts";
import type { VaultFontList, VaultFontSource } from "../export/sections/fonts";
import { state } from "./store";
import { noteProperties, syntaxForms } from "../host/query";
import type { RenderedDocument } from "../host/contract";
import { documentSessions, flushPendingSave } from "./document-session";
import { EXPORT_COMMAND } from "../ui/shell-ids.generated";
import { nameJob, queuedJob, showActivity } from "../panels/activity";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { plural, t } from "../i18n/strings";
import { Pane, panes } from "./document-controller-state";
import { mediaTransport } from "./document-controller-ports";
import { docTitle } from "./document-controller-draw";
import { reveal } from "./document-controller-modes";
import { deniedSaves, heldWhy } from "./document-controller-save";

const exportSpacePart = lazyPart(() => import("../export/space"));
const exportProfilePart = lazyPart(() => import("../export/profile"));
/// L'esportazione chiesta da fuori (T79): fuori dal pacchetto dell'avvio,
/// come lo spazio; la presenza comincia quando arriva.
export const headlessExportPart = lazyPart(() => import("../export/headless"));

/// Chi monta la resa per la stampa di una nota, per lo spazio e per
/// l'esportazione fuori dallo schermo: le forme che la nota dichiara si
/// leggono prima, i diagrammi in luce chiara nello stile dell'esportazione.
export async function exportMountOf(doc: string): Promise<ExportMount> {
  const declared = await syntaxForms(doc).then(
    (forms) => new Set(declaredFences(forms).map((info) => info.toLowerCase())),
    () => new Set<string>(),
  );
  return (container, rendered, look) => mountRenderedDocument(container, rendered, { documentId: doc, declaredFences: declared, diagramAppearance: "light", diagramLook: (index) => look.diagramLook(index) });
}

/// Lo spazio «Esporta in PDF» impagina una nota Markdown: la resa per la
/// stampa di una tela è già un foglio suo.
export function exportableNote(surface: EditorSurface | null | undefined): boolean {
  return surface?.printable === true && surface.family === "text" && surface.profile === "markdown";
}

/// Chi scrive nella nota dallo spazio «Esporta in PDF» (l'interruzione di
/// pagina a mano, T76): per la sessione è una superficie come un riquadro.
const EXPORT_SURFACE = "esporta-pdf";

/// Lo spazio «Esporta in PDF» aperto, e il riquadro della sua nota: uno solo
/// per finestra, perché prende la finestra intera.
export let openExport: { pane: Pane; close: () => void } | null = null;

/// Apre lo spazio «Esporta in PDF» sulla nota del riquadro (E28, T70): la
/// salva prima, perché la resa per la stampa il core la legge dal disco, e
/// la segue mentre cambia in un altro riquadro.
/// I caratteri del vault per la stampa (T72), per una nota sola e per il
/// libro: l'elenco dal core, i byte dalla stessa porta dei caratteri dei
/// disegni.
/// I PDF incorporati di una nota, per le loro pagine in coda (T74): allo
/// spazio e all'esportazione chiesta da fuori.
export const printPdfPages: PdfPagesPorts = {
  resolve: async (target, from) => (await resolvedReference({ kind: "wiki", value: { page: target, heading: null, block: null } }, from).catch(() => null))?.doc ?? null,
  read: async (id) => {
    const port = await openResourcePort(mediaTransport, id);
    try {
      return await port.readAll();
    } finally {
      await port.close();
    }
  },
  // Letto alla chiamata, non quando il modulo si carica.
  load: (...args) => loadPdf(...args),
};

export const printVaultFonts: VaultFontSource = {
  list: async () => {
    const outcome = await api.invokeCommand("pdf.vault_fonts", {}, "apply");
    const effect = outcome.effect;
    if (effect.kind !== "custom" || effect.ns !== "fub.pdf.vault_fonts") throw new Error(`pdf.vault_fonts answered ${effect.kind}`);
    return effect.payload as VaultFontList;
  },
  read: (file, limit) => drawingFonts.read(file, limit),
};

export async function presentExport(r: Pane, doc: string): Promise<void> {
  try {
    await documentSessions.flush(doc);
    const mount = await exportMountOf(doc);
    const [{ openExportSpace }, { commandProfileStore }] = await Promise.all([exportSpacePart.load(), exportProfilePart.load()]);
    // Il profilo da cui si parte è quello che vale per la nota: il suo tipo,
    // il vault, «Di serie». Senza i profili (un core che non li ha) si parte
    // da «Di serie».
    const profiles = commandProfileStore((command, args, mode) => api.invokeCommand(command, args, mode));
    const start = await profiles.list(doc).then(
      (shelf) => {
        const chosen = shelf.profiles.find((entry) => entry.id === shelf.effective && entry.profile !== null);
        return chosen?.profile ? { profileId: chosen.id, profile: chosen.profile } : {};
      },
      () => ({}),
    );
    if (r.shown?.k !== "doc" || r.shown.doc !== doc) return;
    openBook?.();
    openExport?.close();
    // Il testo di cui la resa montata è la resa: il core la legge dal disco,
    // e chi la chiede ha appena salvato; con modifiche ancora da salvare non
    // si sa, e il clic sulla pagina non ci scrive (T76). Vale da quando la
    // resa si monta: prima le pagine sono ancora quelle di prima.
    const sources = new WeakMap<RenderedDocument, string | null>();
    let shown: string | null = null;
    const space = openExportSpace({
      doc,
      title: pageName(doc),
      render: async (target) => {
        const text = documentSessions.isDirty(doc) ? null : (documentSessions.text(doc) ?? null);
        const rendered = await renderPrint(target);
        sources.set(rendered, text);
        return rendered;
      },
      note: {
        shown: () => shown,
        current: () => documentSessions.text(doc) ?? null,
        readOnly: () => heldWhy(doc) ?? (deniedSaves.has(doc) ? t("pdf_export.block.read_only", { doc: pageName(doc) }) : null),
        write: (before, after) =>
          documentSessions.acceptSurfaceChange(doc, EXPORT_SURFACE, { text: after, operation: operationFromText(lineFeeds(before), lineFeeds(after)) }).kind === "accepted",
        reveal: (span) => {
          space.close();
          void reveal(doc, { span });
        },
      },
      mount: (container, rendered, look) => {
        shown = sources.get(rendered) ?? null;
        return mount(container, rendered, look);
      },
      profiles,
      ...start,
      // Il disposer torna allo spazio, che lo chiude con la sua `Lifetime`.
      follow: (changed) => {
        const unsubscribe = documentSessions.subscribe((event) => {
          if (event.id !== doc) return;
          if (event.kind === "changed" || event.kind === "saved") changed(event.kind);
        });
        return unsubscribe;
      },
      save: async () => {
        await documentSessions.flush(doc);
      },
      vaultFonts: printVaultFonts,
      // Il frontmatter dall'indice: icona, autore e proprietà del frontespizio.
      properties: () => noteProperties(doc),
      // I PDF incorporati, per le loro pagine in coda (T74).
      pdf: printPdfPages,
      onClose: () => {
        if (openExport?.close === close) openExport = null;
      },
    });
    const close = () => space.close();
    openExport = { pane: r, close };
  } catch (error) {
    notify(t("pdf_export.failed", { reason: errorText(error) }), "guasto");
  }
}

const bookPart = lazyPart(() => import("../export/book"));
let openBook: (() => void) | null = null;

/// Apre lo spazio «Esporta in PDF» su più note (E28, T78): le note Markdown
/// di una cartella o di una scelta, nell'ordine dato, ognuna un capitolo. Le
/// salva prima, come per una nota sola, e le segue mentre cambiano. `name` è
/// quello della cartella o della scelta, nella barra dello spazio.
export async function presentBookExport(paths: readonly string[], name: string): Promise<void> {
  try {
    const [{ openExportSpace }, { BOOK_LIMIT, bookNotes, createBook }] = await Promise.all([exportSpacePart.load(), bookPart.load()]);
    const { notes, others } = bookNotes(paths);
    if (others.length > 0) notify(plural(others.length, "pdf_export.book.not_notes.one", "pdf_export.book.not_notes.other"), "info");
    if (notes.length === 0) {
      notify(t("pdf_export.book.empty"), "info");
      return;
    }
    if (notes.length > BOOK_LIMIT) {
      notify(t("pdf_export.book.too_many", { n: notes.length, max: BOOK_LIMIT }), "guasto");
      return;
    }
    const saveAll = async () => {
      await Promise.all(notes.map((doc) => documentSessions.flush(doc)));
    };
    await saveAll();
    // Le note del libro sono tutte Markdown: le forme dichiarate sono quelle.
    const declared = await syntaxForms(notes[0]!).then(
      (forms) => new Set(declaredFences(forms).map((info) => info.toLowerCase())),
      () => new Set<string>(),
    );
    const book = createBook({
      docs: notes,
      render: renderPrint,
      title: pageName,
      mount: (container, rendered, doc, diagramLook) => mountRenderedDocument(container, rendered, { documentId: doc, declaredFences: declared, diagramAppearance: "light", diagramLook: () => diagramLook() }),
    });
    openBook?.();
    openExport?.close();
    const members = new Set(notes);
    let told = false;
    const space = openExportSpace({
      doc: notes[0]!,
      title: plural(notes.length, "pdf_export.book.title.one", "pdf_export.book.title.other", { name }),
      backLabel: t("pdf_export.back_notes"),
      render: book.render,
      mount: book.mount,
      measure: book.measure,
      // Caratteri e pagina sono del profilo, comuni a tutti i capitoli.
      vaultFonts: printVaultFonts,
      follow: (changed) => {
        // Lo spazio lo chiude col suo `Lifetime` alla chiusura.
        const unsubscribe = documentSessions.subscribe((event) => {
          if (!members.has(event.id)) return;
          if (event.kind === "changed" || event.kind === "saved") changed(event.kind);
        });
        return unsubscribe;
      },
      save: saveAll,
      onReady: () => {
        const skipped = book.skipped();
        if (told || skipped.length === 0) return;
        told = true;
        notify(plural(skipped.length, "pdf_export.book.skipped.one", "pdf_export.book.skipped.other", { names: skipped.map(pageName).join(", ") }), "info");
      },
      onClose: () => {
        if (openBook === close) openBook = null;
      },
    });
    const close = () => space.close();
    openBook = close;
  } catch (error) {
    notify(t("pdf_export.failed", { reason: errorText(error) }), "guasto");
  }
}

/// Gli export che il riquadro offre adesso: quelli che la sua superficie
/// dichiara, finché mostra un documento e il registro ha il comando che li
/// esegue.
export function offeredExports(r: Pane | undefined): readonly SurfaceExport[] {
  const offered = r?.surface?.exports ?? [];
  if (offered.length === 0 || r?.shown?.k !== "doc") return [];
  return state.commandSpecs.some((spec) => spec.id === EXPORT_COMMAND) ? offered : [];
}

/// La finestra «Esporta» del riquadro, se la sua superficie ne ha una che si
/// apre adesso, e l'export si può eseguire.
export function exportWindow(r: Pane | undefined): SurfaceExportWindow | null {
  const own = r?.surface?.exportWindow;
  return own !== undefined && offeredExports(r).length > 0 && own.available() ? own : null;
}

/// «Esporta…»: la finestra della superficie, se ne ha una; se no l'export che
/// la superficie offre, o quello che si sceglie fra i suoi.
export async function chooseExport(paneId: string): Promise<void> {
  const r = panes.get(paneId);
  const offered = offeredExports(r);
  if (r?.shown?.k !== "doc" || offered.length === 0) return;
  const doc = r.shown.doc;
  const own = exportWindow(r);
  let chosen: SurfaceExport | null | undefined;
  if (own !== null) chosen = await own.open();
  else if (offered.length === 1) chosen = offered[0]!;
  else {
    chosen = await pickFromList({
      title: t("document.export.title", { doc: pageName(doc) }),
      placeholder: t("document.export.placeholder"),
      items: offered.map((item) => ({ label: item.label(), detail: item.detail(), value: item })),
    });
  }
  if (chosen) await runExport(doc, chosen);
}

/// Esporta `doc`. L'host legge il documento dal vault, quindi prima si svuota
/// la coda di salvataggio: un export del testo di prima, con le ultime
/// modifiche sullo schermo, sarebbe un file che dice il falso. Il file arriva
/// al centro attività, che si apre senza prendere il fuoco e da cui lo si
/// salva dove si sceglie.
export async function runExport(doc: string, chosen: SurfaceExport): Promise<void> {
  const unsaved = await flushPendingSave();
  if (unsaved.includes(doc)) {
    notify(t("document.export.unsaved", { doc: pageName(doc) }), "guasto");
    return;
  }
  const request = {
    target: chosen.target,
    selection: { kind: "documents", value: [doc] },
    options: chosen.options?.() ?? {},
  };
  try {
    const outcome = await api.invokeCommand(EXPORT_COMMAND, { request_json: JSON.stringify(request) }, "apply");
    // Il nome del lavoro nel centro attività: il job dei trasferimenti non sa
    // dire in che lingua parla chi guarda, la shell sì.
    const id = queuedJob(outcome);
    if (id !== null) nameJob(id, () => t("activity.job.export", { doc: docTitle(doc), what: chosen.label() }));
  } catch (error) {
    notify(t("document.export.failed", { reason: errorText(error) }), "guasto");
    return;
  }
  notify(t("document.export.started", { doc: pageName(doc), what: chosen.label() }), "info");
  showActivity();
}
