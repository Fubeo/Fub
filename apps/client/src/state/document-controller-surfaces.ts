// Il gestore del documento: le superfici (montarle, metterle da parte,
// riprenderle, seguirne la rinomina, i componenti spenti, i file senza editor).

import { setComponentEditors } from "../editors/core/bootstrap";
import { uisForFile } from "../editors/core/component-surfaces";
import { refreshComponents, type Components } from "./components";
import { type EditorSurface, type SurfaceReference } from "../editors/core/registry";
import { draggedEntries, ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE } from "../ui/drag-types";
import { looksLikeWebShortcut, webShortcut } from "../rules/web-shortcut";
import { pdfIdWithoutFragment } from "../editors/media/pdf-ids";
import { formatBytes, mediaKindOfId } from "../editors/media/media-types";
import { depositFiles, relativeUrl } from "../editors/media/attachment-target";
import { applyNoteCssClasses } from "../theme/snippets";
import { api } from "../host/ipc";
import { resolvedReference } from "../host/query";
import { theseDocuments } from "../host/contract";
import { linkPreference } from "./note-links";
import { state } from "./store";
import type { ComponentRefusal, ComponentRow } from "../host/contract";
import {
  documentSessions,
  type DocumentSurfaceDescriptor,
  type DocumentSurfaceUpdate,
  type DocumentSurfaceSource,
} from "./document-session";
import { type NavigateTarget } from "./document-bridge";
import {
  activeDoc,
  pane as paneState,
  panesWithDoc,
  panes as layoutPanes,
  sameOverride,
  tabOverride,
  activeTab,
  type Tab,
} from "./layout";
import { handToSystem, openVaultRoot, vaultArg } from "./vault";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import { openLifetime } from "../ui/lifetime";
import { Pane, ParkedSurface, MAX_PARKED, PARKED_HOST, panes, deps, view, surfaceRegistry } from "./document-controller-state";
import { attachmentDeposit } from "./document-controller-ports";
import { openExport } from "./document-controller-export";
import { synchronize, focusedVisiblyIn, showsFromBytes } from "./document-controller-draw";
import { openDocument, openWikilink, openFigure } from "./document-controller-open";
import { theme, noteReference, selectedMode, markMode, reveal } from "./document-controller-modes";
import { heldReadOnly } from "./document-controller-save";

/// Gli allegati depositati entrano nel documento come rimandi: come si
/// scrivono lo decide la superficie, nella sintassi del suo formato.
export function insertAttachmentLinks(r: Pane, doc: string, links: readonly string[]): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc || !r.surface?.insertReferences || heldReadOnly(doc)) return;
  const references = links.map((link): SurfaceReference => ({ kind: "attachment", link }));
  if (!r.surface.insertReferences(references)) {
    throw new Error(t("errors.document.no_editor"));
  }
}

/// Trascinare, rilasciare e incollare file o note: soltanto su una superficie
/// che sa scrivere un rimando nel suo documento.
export function mountDocumentAttachments(r: Pane, doc: string): void {
  const surface = r.surface;
  if (!surface?.insertReferences) return;
  const life = openLifetime();
  r.disposeAttachments = () => life.close();
  const insert = (links: readonly string[]) => {
    if (!life.closed) insertAttachmentLinks(r, doc, links);
  };
  const fail = (error: unknown) => {
    if (!life.closed) notify(t("document.attachment_failed", { reason: errorText(error) }), "guasto");
  };
  // Un collegamento che l'editor non riesce a scrivere si dice: mai un rifiuto
  // che nessuno ascolta.
  const linkFailed = (error: unknown) => {
    if (!life.closed) notify(t("document.link_drop_failed", { reason: errorText(error) }), "guasto");
  };
  const accept = (files: readonly File[]) => {
    if (life.closed || r.surface !== surface || heldReadOnly(doc)) {
      fail(new Error("The document is read-only or no longer open"));
      return;
    }
    void attachmentDeposit(doc).then((target) => {
      if (!life.closed && r.surface === surface && !heldReadOnly(doc)) {
        return depositFiles(files, target, insert);
      }
    }).catch(fail);
  };
  life.listen(r.editorEl, "dragover", (event) => {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes("Files") && !types.includes(NOTE_DRAG_TYPE) && !types.includes(ENTRIES_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = "copy";
  }, { capture: true });
  life.listen(r.editorEl, "drop", (event) => {
    // Una nota dall'albero diventa un collegamento dove cade, non il suo
    // percorso scritto in chiaro.
    const note = event.dataTransfer?.getData(NOTE_DRAG_TYPE);
    if (note) {
      event.preventDefault();
      event.stopPropagation();
      const { clientX: x, clientY: y } = event;
      void linkPreference().then((preference) => noteReference(doc, note, preference)).then((reference) => {
        if (life.closed || r.surface !== surface) return;
        surface.insertReferences?.([reference], { x, y });
      }).catch(linkFailed);
      return;
    }
    // Più voci, o un file del vault: ogni nota un collegamento, ogni file un
    // rimando relativo al documento che lo riceve, nell'ordine dell'albero.
    const entries = draggedEntries(event.dataTransfer?.getData(ENTRIES_DRAG_TYPE));
    if (entries.length) {
      event.preventDefault();
      event.stopPropagation();
      const { clientX: x, clientY: y } = event;
      // Senza un punto vero (un rilascio sintetico) si scrive al cursore.
      const at = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      void linkPreference().then((preference) => Promise.all(entries.map(async (each): Promise<SurfaceReference> =>
        each.note ? noteReference(doc, each.id, preference) : { kind: "attachment", link: relativeUrl(doc, each.id) },
      ))).then((references) => {
        if (life.closed || r.surface !== surface) return;
        surface.insertReferences?.(references, at);
      }).catch(linkFailed);
      return;
    }
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    const shortcuts = files.filter((file) => looksLikeWebShortcut(file.name, file.size));
    if (!shortcuts.length) {
      accept(files);
      return;
    }
    // Un `.webloc` o un `.url` diventa un link alla pagina dove cade; uno che
    // non si legge entra come gli altri file, allegato.
    const { clientX: x, clientY: y } = event;
    const at = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
    void Promise.all(shortcuts.map(async (file) => ({ file, link: webShortcut(file.name, await file.text()) }))).then((read) => {
      if (life.closed || r.surface !== surface) return;
      const links = read.flatMap(({ link }): SurfaceReference[] => (link ? [{ kind: "web", ...link }] : []));
      if (links.length) surface.insertReferences?.(links, at);
      const rest = files.filter((file) => !read.some((each) => each.file === file && each.link));
      if (rest.length) accept(rest);
    }).catch(fail);
  }, { capture: true });
  life.listen(r.editorEl, "paste", (event) => {
    if (!event.clipboardData?.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    accept(Array.from(event.clipboardData.files));
  }, { capture: true });
}

export function refreshNoteClasses(r: Pane, doc: string): void {
  const generation = ++r.noteClassGeneration;
  void api.queryIndex({
    kind: "documents", matching: theseDocuments([doc]), sort: null,
    select: { kind: "keys", keys: ["cssclasses", "cssclass"] },
    page: { offset: 0, limit: 1 }, excerpts: "omit",
  }, ...vaultArg(openVaultRoot())).then((result) => {
    if (r.noteClassGeneration !== generation || r.shown?.k !== "doc" || r.shown.doc !== doc) return;
    if (result.kind !== "documents") throw new Error(`expected document properties, got ${result.kind}`);
    const properties = result.value.items[0]?.properties;
    const classes = properties?.find((item) => item.key === "cssclasses")?.value
      ?? properties?.find((item) => item.key === "cssclass")?.value;
    applyNoteCssClasses(r.root, classes);
  }).catch((error: unknown) => {
    if (r.noteClassGeneration === generation) notify(t("document.properties_unavailable", { reason: errorText(error) }), "guasto");
  });
}

/// L'elenco dei comandi è cambiato (arrivato dopo l'apertura del vault, o un
/// componente acceso o spento): un riquadro il cui documento ha cambiato
/// legame coi byte si rimonta, senza gesto; gli altri non si toccano, e una
/// scheda di testo tiene buffer e cursore. Anche un riquadro rimasto senza
/// tab mostrata (una lettura fallita) riprova.
export function commandsChanged(): void {
  let stale = false;
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const tab = activeTab(id);
    if (!r || tab?.k !== "doc") continue;
    if (r.shown === null) {
      stale = true;
      continue;
    }
    if (r.shown.k !== "doc" || r.bytes === showsFromBytes(r.shown.doc)) continue;
    detachSurface(r);
    destroySurface(r);
    r.shown = null;
    stale = true;
  }
  if (stale) {
    void synchronize().catch((e) => {
      notify(t("panes.redraw_failed", { reason: errorText(e) }), "guasto");
    });
  }
}

/// Un formato del vault gestisce il file: lo dicono le estensioni dei
/// provider registrati nel backend, non la tabella dei media della shell.
export function handledByVault(doc: string): boolean {
  const base = pdfIdWithoutFragment(doc).split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  return point > 0 && state.handledExtensions.includes(base.slice(point + 1).toLowerCase());
}

/// Un file che nessun formato del vault gestisce si apre soltanto se una
/// superficie registrata sa mostrarlo: dai suoi byte (un'immagine, un PDF) o
/// come testo con un profilo suo (un SVG). L'esploratore chiede qui, invece di
/// ripetere la classificazione della shell.
///
/// Un file di un componente si apre sempre: col componente spento nel
/// riquadro «solo come file».
export function canShowFile(id: string): boolean {
  return uisForFile(id).length > 0 || (surfaceRegistry?.opensWithoutFormat(id) ?? false);
}

/// Il file si mostra dai byte e non ha un testo da condividere: una finestra
/// staccata, che monta soltanto un `TextEngine`, non ha niente da scrivere.
export function showsFileBytes(id: string): boolean {
  // Un PDF col lettore spento resta un file di byte.
  return mediaKindOfId(pdfIdWithoutFragment(id)) === "pdf" || (surfaceRegistry?.showsBytes(id) ?? false);
}

/// Il profilo di testo con cui il registro mostrerebbe questo documento, o
/// `null` se la sua superficie non è di testo: una tela, un foglio, una base
/// hanno un motore che una finestra con il solo `TextEngine` non sa montare.
export function textProfileFor(id: string, source: DocumentSurfaceDescriptor): string | null {
  const resolved = surfaceRegistry?.resolve({ formatId: source.formatId, sourceKind: source.sourceKind, documentId: id });
  return resolved?.family === "text" ? resolved.profile : null;
}

/// La famiglia del riquadro «solo come file». Non viene dal registro: non è
/// un editor, è il posto di uno che è spento.
export const FILE_ONLY_FAMILY = "file-only";

const FILE_ONLY_MODES = [
  { id: "file", label: () => t("file_only.mode"), presentation: "surface", contextMode: "reading", looks: ["tema"] },
] as const;

/// I pezzi di interfaccia che restano registrati anche col componente spento:
/// quelli di un editor aperto il cui salvataggio non è riuscito, che resta a
/// mostrare l'errore della sessione finché le modifiche non sono al sicuro.
export const heldEditors = new Set<string>();

/// Il registro segue la mappa: i pezzi accesi si registrano, gli altri si
/// tolgono, tranne quelli tenuti.
export function applyComponentEditors(current: Components | null): void {
  if (!surfaceRegistry) return;
  const on = (ui: string) => !current || current.uiOn(ui) || heldEditors.has(ui);
  setComponentEditors(surfaceRegistry, on, current?.uis ?? []);
}

/// I pezzi spenti di cui il file ha bisogno per il suo editor.
function offFor(doc: string, current: Components): string[] {
  return uisForFile(doc).filter((ui) => !current.uiOn(ui));
}

/// Il documento che il riquadro mostra in un editor, non nel posto vuoto di
/// uno; `null` altrimenti.
function editorDoc(r: Pane): string | null {
  return r.shown?.k === "doc" && r.surface && r.surface.family !== FILE_ONLY_FAMILY ? r.shown.doc : null;
}

/// Ciò che è acceso è cambiato. Un riquadro «solo come file» il cui
/// componente è tornato si rimonta nel suo editor; un editor il cui
/// componente si è spento prima salva ciò che la sessione ha in sospeso, poi
/// passa a «solo come file». Se il salvataggio non riesce l'editor resta, con
/// l'errore della sessione: niente si perde. Vale per ogni strada della
/// scelta, anche la riga di comando, dove non c'è nessuno a cui chiedere.
/// Gira nella coda dei disegni, e chi la accoda ridisegna dopo.
export async function componentsChanged(next: Components): Promise<void> {
  if (next.root !== openVaultRoot()) return;
  // Le forme sintattiche di una nota vengono dai componenti montati, e una
  // superficie le legge al montaggio: quelle da parte si rimontano al ritorno.
  for (const r of panes.values()) dropParked(r);
  const leaving = [...panes.values()].filter((r) => {
    const doc = editorDoc(r);
    return doc !== null && offFor(doc, next).length > 0;
  });
  for (const r of leaving) {
    for (const ui of offFor(editorDoc(r)!, next)) heldEditors.add(ui);
  }
  applyComponentEditors(next);
  for (const r of panes.values()) {
    if (r.shown?.k !== "doc" || r.surface?.family !== FILE_ONLY_FAMILY) continue;
    if (offFor(r.shown.doc, next).length === 0 || r.surface.profile !== offFor(r.shown.doc, next)[0]) {
      detachSurface(r);
      destroySurface(r);
      r.shown = null;
    }
  }
  const flushed = new Map<string, Promise<boolean>>();
  for (const r of leaving) {
    const doc = editorDoc(r);
    if (doc === null) continue;
    const surface = r.surface;
    let saving = flushed.get(doc);
    if (!saving) {
      saving = documentSessions.flush(doc).catch((error: unknown) => {
        console.error(error);
        return true;
      });
      flushed.set(doc, saving);
    }
    const dirty = await saving;
    if (r.surface !== surface || r.shown?.k !== "doc" || r.shown.doc !== doc) continue;
    if (dirty) continue;
    detachSurface(r);
    destroySurface(r);
    r.shown = null;
  }
  // Tenuti restano soltanto i pezzi degli editor che non hanno salvato.
  heldEditors.clear();
  for (const r of panes.values()) {
    const doc = editorDoc(r);
    if (doc !== null) for (const ui of offFor(doc, next)) heldEditors.add(ui);
  }
  applyComponentEditors(next);
}

/// Monta nel riquadro il posto «solo come file» di `doc`: nome, dimensione,
/// «Accendi …» col nome della riga spenta che servirebbe, e «Apri con un'altra
/// app». Il profilo della pseudo-superficie è il pezzo spento: cambia quale,
/// e il riquadro si ridisegna.
export function showFileOnly(r: Pane, doc: string, current: Components, ui: string): void {
  const host = document.createElement("div");
  host.className = "document-surface document-surface-file-only";
  host.tabIndex = 0;
  r.editorEl.replaceChildren(host);
  const row: ComponentRow | null = current.offRowFor(ui);
  const vault = openVaultRoot();
  let active = true;
  let size: string | null = null;
  let busy = false;
  let problem: string | null = null;
  const draw = (): void => {
    if (!active) return;
    view.drawFileOnly(r, host, {
      doc,
      name: doc.split("/").pop() ?? doc,
      size,
      component: row?.nome || null,
      busy,
      problem,
      switchOn: () => void switchOn(),
      openOutside: () => void handToSystem(pdfIdWithoutFragment(doc), true),
    });
  };
  const switchOn = async (): Promise<void> => {
    if (!row || busy) return;
    busy = true;
    problem = null;
    draw();
    try {
      const answer = await api.componentsApply({ azione: "accendi", id: row.id }, true, ...vaultArg(vault));
      if (answer.risposta === "rifiuto") problem = refusalText(answer, row.nome);
      // Acceso: lo dice la mappa, che si rilegge con gli eventi della scelta,
      // e il riquadro torna al suo editor da `componentsChanged`.
      else await refreshComponents();
    } catch (error) {
      problem = t("file_only.failed", { name: row.nome, reason: errorText(error) });
    }
    busy = false;
    draw();
  };
  const stopLanguage = onLanguage(draw);
  const surface: EditorSurface = {
    family: FILE_ONLY_FAMILY,
    profile: ui,
    surfaceId: r.id,
    modes: FILE_ONLY_MODES,
    setMode(mode) {
      host.dataset.mode = mode;
    },
    focus() {
      host.focus();
    },
    setTheme(next) {
      host.dataset.theme = next;
    },
    destroy() {
      if (!active) return;
      active = false;
      stopLanguage();
      host.remove();
    },
  };
  r.surface = surface;
  surface.setMode("file");
  markMode(r, "file");
  if (theme) surface.setTheme?.(theme);
  draw();
  void fileSize(pdfIdWithoutFragment(doc), vault).then((bytes) => {
    if (bytes === null) return;
    size = formatBytes(bytes);
    draw();
  });
}

/// La dimensione del file, dall'apertura della sua risorsa: `null` se l'host
/// non la dice.
async function fileSize(id: string, vault: string | undefined): Promise<number | null> {
  try {
    const resource = await api.resourceOpen(id, vault ?? null);
    void Promise.resolve(api.resourceClose(resource.handle)).catch(() => {});
    return resource.len;
  } catch {
    return null;
  }
}

/// Perché «Accendi …» non si è fatto, detto a chi legge.
function refusalText(refusal: ComponentRefusal, name: string): string {
  return refusal.rifiuto === "sconosciuto"
    ? t("file_only.refused_unknown", { name })
    : t("file_only.refused", { name });
}

export async function followRemote(target: NavigateTarget, from: string): Promise<void> {
  try {
    if (target.kind === "tag") {
      deps.searchTag(target.tag);
      return;
    }
    if (target.kind === "wikilink") {
      // Il clic su un link nella finestra staccata è un gesto come qui.
      await openWikilink(target.page, target.heading ?? undefined, target.block ?? undefined, from, { gesture: true });
      return;
    }
    if (target.kind === "figure") {
      await openFigure(target.doc);
      return;
    }
    const resolved = await resolvedReference({ kind: "path", value: target.path }, from);
    if (!resolved) throw new Error(t("preview.target_missing"));
    await openDocument(resolved.doc, { gesture: true });
    if (resolved.at) await reveal(resolved.doc, { span: resolved.at.span });
  } catch (error) {
    const page = target.kind === "wikilink" ? target.page
      : target.kind === "path" ? target.path
      : target.kind === "figure" ? target.doc
      : target.tag;
    notify(t("preview.open_failed", { page, reason: errorText(error) }), "guasto");
  }
}

/// Una lettura fallita non lascia la tab «mostrata»: la superficie d'errore
/// dice il motivo, ma la prossima sincronizzazione deve poter riprovare invece
/// di trovarla già a posto. Un disco che non risponde è spesso un momento, non
/// il contenuto del documento.
export function forgetFailedRead(r: Pane): void {
  r.shown = null;
}

/// La politica d'errore di ogni formato: un documento che non si legge, una
/// superficie che non si monta o che non accetta il testo mostrano la
/// superficie d'errore col motivo, invece di un riquadro vuoto o del contenuto
/// di prima.
///
/// La superficie d'errore resta iscritta alla sessione del documento, se c'è:
/// quando il testo cambia (l'altra app lo ripara, un undo lo riporta indietro)
/// il riquadro riprova a montare la superficie vera.
export function showSurfaceError(r: Pane, doc: string, error: unknown): void {
  const surface = surfaceRegistry.mount(
    { formatId: null, sourceKind: "text", documentId: doc, override: { family: "error" } },
    { paneId: r.id, documentId: doc, parent: r.editorEl, errorReason: errorText(error) },
  );
  r.surface = surface;
  surface.setMode("error");
  markMode(r, "error");
  if (theme) surface.setTheme?.(theme);
  if (documentSessions.text(doc) === null) return;
  r.disposeSurface = documentSessions.attachSurface(doc, {
    id: surface.surfaceId,
    sync: () => retryShow(r, doc),
  });
}

/// Rimonta la superficie di un riquadro fermo sulla superficie d'errore, se
/// mostra ancora quel documento.
function retryShow(r: Pane, doc: string): void {
  const tab = r.shown;
  if (tab?.k !== "doc" || tab.doc !== doc) return;
  detachSurface(r);
  destroySurface(r);
  r.shown = null;
  void synchronize().catch((error) => console.error(error));
}

/// Una superficie che non accetta più il testo della sessione (un canvas
/// diventato JSON invalido, uno sheet rotto da una sync) non deve restare a
/// mostrare il contenuto di prima: chi la guarda crederebbe di modificare un
/// documento che non si salva. Passa alla superficie d'errore.
export function failSurface(r: Pane, doc: string, error: unknown): void {
  detachSurface(r);
  destroySurface(r);
  showSurfaceError(r, doc, error);
}

/// La sottoscrizione di un riquadro alla sessione del documento mostrato.
/// L'identità di registrazione è l'id del riquadro: stabile per quanto il
/// riquadro vive, opaco per la sessione. Attacare due volte con lo stesso id
/// è la stessa superficie rimontata, non due superfici.
export function attachSurface(r: Pane, doc: string): void {
  const surface = r.surface;
  if (!surface) return;
  const buffer = surface.buffer;
  r.disposeSurface = documentSessions.attachSurface(doc, {
    id: surface.surfaceId,
    sync: (update) => applySurfaceUpdate(r, doc, update),
    // Il testo che la superficie tiene ancora (una scheda prima della pausa):
    // la sessione lo mette in bozza e lo fa registrare prima di leggere il buffer.
    pendingText: buffer?.pendingText ? () => buffer.pendingText?.() ?? null : undefined,
    commitPending: buffer?.commitPending ? () => buffer.commitPending?.() : undefined,
    watchPending: buffer?.watchPending ? (listener) => buffer.watchPending!(listener) : undefined,
  });
  surface.setReadOnly?.(heldReadOnly(doc));
}

/// Prima di staccarsi la superficie registra il testo che tiene ancora: va alla
/// sessione del documento che il riquadro mostra, finché è attaccata. La
/// registrazione nella `destroy` della superficie resta soltanto una rete.
export function detachSurface(r: Pane): void {
  if (r.disposeSurface) {
    try {
      r.surface?.buffer?.commitPending?.();
    } catch (error) {
      console.error(error);
    }
  }
  r.disposeSurface?.();
  r.disposeSurface = null;
}

export function destroySurface(r: Pane): void {
  releaseSurfaceExtras(r);
  r.surface?.destroy();
  r.surface = null;
  r.editorEl.replaceChildren();
}

/// Ciò che il riquadro appende alla superficie che mostra — le classi della
/// nota, il rilascio dei file, il registratore, le slide, la stampa — se ne va
/// con lei, smontata o messa da parte.
function releaseSurfaceExtras(r: Pane): void {
  r.noteClassGeneration++;
  applyNoteCssClasses(r.root, null);
  r.disposeAttachments?.();
  r.disposeAttachments = null;
  r.disposeRecorder?.();
  r.disposeRecorder = null;
  r.disposeSlides?.();
  r.disposeSlides = null;
  r.disposePrint?.();
  r.disposePrint = null;
  if (openExport?.pane === r) openExport.close();
}

// --- le superfici da parte (`ParkedSurface`) --------------------------------

/// La revisione dei byte da cui il testo della sessione di `doc` discende
/// adesso, o `null` se la sessione non ne ha una.
export function sessionBase(doc: string): string | null {
  const base = documentSessions.inspect(doc)?.base;
  return base?.kind === "descends_from" ? base.value : null;
}

/// Quanto pesa la superficie fra quelle da parte del riquadro, o `null` se
/// non si tiene da parte. Una nota sì, se il file non è di un componente: un
/// file di un componente segue l'acceso e lo spento dei componenti, che
/// smontano e rimontano da sé. Le altre superfici lo dichiarano
/// (`EditorSurface.parking`), e un cambio dei componenti le smonta comunque
/// (`componentsChanged`).
function parkingWeight(surface: EditorSurface, doc: string): number | null {
  if (surface.parking) return surface.parking.weight;
  if (surface.family !== "text" || (surface.profile !== "markdown" && surface.profile !== "plain-text")) return null;
  return uisForFile(doc).length > 0 ? null : 1;
}

/// Mette da parte la superficie del riquadro, se è montata, si tiene da parte
/// (`parkingWeight`) e la sua scheda resta aperta; `false` altrimenti, e chi
/// chiama la smonta come prima. Va chiamata con `r.shown` ancora sulla scheda
/// che si lascia.
export function parkSurface(r: Pane): boolean {
  const surface = r.surface;
  const tab = r.shown;
  if (!surface || tab?.k !== "doc" || !r.disposeSurface || r.bytes) return false;
  const weight = parkingWeight(surface, tab.doc);
  if (weight === null) return false;
  // Una scheda chiusa o portata altrove non torna: la sua superficie si smonta.
  const stays = paneState(r.id)?.tabs.some((each) => sameParked(each, tab)) ?? false;
  if (!stays) return false;
  // Staccata e nascosta: non riceve più il testo né input. La sola lettura
  // non si cambia qui: commutarla costa un ridisegno dell'editor a ogni
  // cambio, e al ritorno `attachSurface` la rimette comunque al valore giusto.
  detachSurface(r);
  releaseSurfaceExtras(r);
  const host = r.editorEl;
  host.classList.replace("pane-editor", PARKED_HOST);
  host.hidden = true;
  const next = document.createElement("div");
  next.className = "pane-editor";
  r.viewEl.before(next);
  r.editorEl = next;
  r.surface = null;
  r.parked.push({ tab, surface, host, sourceView: r.sourceView, weight, base: sessionBase(tab.doc), theme, redraw: false });
  while (parkedWeight(r) > MAX_PARKED) destroyParked(r.parked.shift()!);
  return true;
}

/// Il peso delle superfici da parte del riquadro.
function parkedWeight(r: Pane): number {
  return r.parked.reduce((sum, entry) => sum + entry.weight, 0);
}

/// Rimostra la superficie messa da parte per `tab` nel riquadro, che in quel
/// momento non ne mostra nessuna. `false` se non si è potuto: la superficie da
/// parte è già smontata, e chi chiama monta la scheda da capo.
export function unparkSurface(r: Pane, tab: Extract<Tab, { k: "doc" }>, entry: ParkedSurface): boolean {
  const { surface } = entry;
  const buffer = surface.buffer;
  const text = documentSessions.text(tab.doc);
  if (!buffer || text === undefined) {
    destroyParked(entry);
    return false;
  }
  // Il contenitore vuoto lasciato dalla scheda di prima se ne va; quello della
  // superficie torna visibile dov'era, senza spostarsi.
  r.editorEl.remove();
  entry.host.classList.replace(PARKED_HOST, "pane-editor");
  entry.host.hidden = false;
  r.editorEl = entry.host;
  r.surface = surface;
  r.sourceView = entry.sourceView;
  try {
    if (theme && theme !== entry.theme) surface.setTheme?.(theme);
    const mode = selectedMode(r);
    if (!mode) throw new Error(`surface ${surface.surfaceId} declares no modes`);
    surface.setMode(mode.id);
    markMode(r, mode.id);
    // Il testo cambiato mentre era da parte arriva come ogni aggiornamento
    // venuto da fuori: non entra nella cronologia locale. Anche i byte
    // cambiati sotto lo stesso testo (un salvataggio, un'altra app): chi
    // legge i byte, come il foglio, li rilegge.
    if (buffer.getDoc() !== text || sessionBase(tab.doc) !== entry.base
      || (entry.redraw && mode.presentation === "rendered")) buffer.syncDoc(text);
  } catch (error) {
    console.error(error);
    destroySurface(r);
    return false;
  }
  attachSurface(r, tab.doc);
  refreshNoteClasses(r, tab.doc);
  mountDocumentAttachments(r, tab.doc);
  return true;
}

// --- la rinomina sotto una superficie montata --------------------------------

/// Una superficie che resta montata quando il file cambia nome. Una di testo
/// (Markdown o testo semplice) segue la sessione: la sessione è la stessa
/// (`rename`) e la superficie legge l'identità da lei. Un'altra lo dichiara
/// (`followRename`, il documento di Word): un file di un componente resta coi
/// componenti di prima, perché l'estensione è la stessa. Un cambio di
/// estensione può chiedere un'altra superficie: lì il riquadro rimonta, e
/// `renameCaret` riporta fuoco e cursore.
function surfaceFollowsRename(surface: EditorSurface, from: string, to: string): boolean {
  if (extensionOf(from) !== extensionOf(to)) return false;
  if (surface.followRename) return true;
  if (surface.family !== "text" || (surface.profile !== "markdown" && surface.profile !== "plain-text")) return false;
  return uisForFile(from).length === 0 && uisForFile(to).length === 0;
}

function extensionOf(doc: string): string {
  const base = doc.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(point + 1).toLowerCase() : "";
}

/// Il file mostrato ha cambiato nome (da questa finestra o da fuori): la scheda
/// è la stessa, solo il nome cambia. Le superfici che reggono il nome nuovo
/// passano alla scheda nuova **senza rimontarsi**: rimontarle buttava via il
/// fuoco (le battute dopo una rinomina da fuori finivano sul body, IMP-046),
/// il cursore, la cronologia locale e lo scorrimento. La registrazione nella
/// sessione si rifà col nome nuovo, perché gli aggiornamenti e le battute
/// cercano la sessione per nome. Lo stesso per le superfici da parte.
///
/// Una superficie che non regge il nome nuovo si rimonta al giro di disegno
/// che `rename` annuncia: se aveva il fuoco, il riquadro si segna il cursore
/// (`renameCaret`) e il montaggio nuovo lo riprende.
export function followRenameInPanes(from: string, to: string): void {
  for (const r of panes.values()) {
    const shown = r.shown;
    const surface = r.surface;
    if (shown?.k === "doc" && shown.doc === from && surface && r.disposeSurface && !r.bytes
      && surfaceFollowsRename(surface, from, to)) {
      // La scheda prima, poi lo stacco: il testo che la superficie registra
      // staccandosi va alla sessione col nome nuovo, l'unico che c'è ancora.
      r.shown = { ...shown, doc: to };
      surface.followRename?.(to);
      detachSurface(r);
      // Gli allegati e il registratore scrivono nel documento per nome.
      r.disposeAttachments?.();
      r.disposeAttachments = null;
      r.disposeRecorder?.();
      r.disposeRecorder = null;
      attachSurface(r, to);
      refreshNoteClasses(r, to);
      mountDocumentAttachments(r, to);
    } else if (shown?.k === "doc" && shown.doc === from && surface) {
      // Il giro di disegno rimonta questa superficie: chi ci scriveva ritrova
      // fuoco e cursore nel montaggio nuovo. Chi stava altrove resta dov'è.
      r.renameCaret = r.editorEl.contains(document.activeElement) ? { doc: to, at: caretOf(surface) } : null;
    }
    r.parked = r.parked.map((entry) => {
      if (entry.tab.doc !== from || !surfaceFollowsRename(entry.surface, from, to)) return entry;
      entry.surface.followRename?.(to);
      return { ...entry, tab: { ...entry.tab, doc: to } };
    });
  }
}

/// Il cursore di una superficie che lo dice, in byte del sorgente: l'inizio
/// della selezione principale (il cursore stesso, se è vuota). `null`
/// per chi non ha intervalli del sorgente (un documento di Word, una tela).
function caretOf(surface: EditorSurface): number | null {
  try {
    return surface.selections?.()?.primary.start ?? null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

/// Dopo una rinomina che ha rimontato la superficie: se chi scriveva aveva il
/// fuoco lì, il montaggio nuovo lo riprende, col cursore dove la superficie
/// sa metterlo (`reveal`). Un fuoco andato intanto altrove (un altro
/// pannello, un dialogo) non si tocca. Vale una volta, per quel documento.
export function restoreRenameCaret(r: Pane, doc: string): void {
  const caret = r.renameCaret;
  r.renameCaret = null;
  const surface = r.surface;
  if (!caret || caret.doc !== doc || !surface) return;
  const now = document.activeElement;
  if (now instanceof HTMLElement && now !== document.body && now.isConnected && !r.root.contains(now)) return;
  if (caret.at !== null && surface.reveal?.({ span: { start: caret.at, end: caret.at } })) {
    if (focusedVisiblyIn(r.editorEl)) return;
  }
  surface.focus?.();
}

/// La stessa scheda di una superficie da parte: lo stesso documento con la
/// stessa scelta di superficie, come `show` decide se rimontare.
function sameParked(tab: Tab, parked: Extract<Tab, { k: "doc" }>): boolean {
  return tab.k === "doc" && tab.doc === parked.doc && sameOverride(tabOverride(tab), tabOverride(parked));
}

/// Toglie dal riquadro la superficie da parte per `tab`, se c'è, e la dà a chi
/// chiama.
export function takeParked(r: Pane, tab: Tab): ParkedSurface | null {
  const at = r.parked.findIndex((entry) => sameParked(tab, entry.tab));
  return at < 0 ? null : r.parked.splice(at, 1)[0]!;
}

/// Smonta le superfici da parte di schede che il riquadro non ha più (chiuse,
/// rinominate, con un'altra superficie scelta).
export function pruneParked(r: Pane, tabs: readonly Tab[]): void {
  if (r.parked.length === 0) return;
  const keep: ParkedSurface[] = [];
  for (const entry of r.parked) {
    if (tabs.some((tab) => sameParked(tab, entry.tab))) keep.push(entry);
    else destroyParked(entry);
  }
  r.parked = keep;
}

/// Smonta tutte le superfici da parte del riquadro.
export function dropParked(r: Pane): void {
  const all = r.parked;
  r.parked = [];
  for (const entry of all) destroyParked(entry);
}

export function destroyParked(entry: ParkedSurface): void {
  try {
    entry.surface.destroy();
  } catch (error) {
    console.error(error);
  }
  entry.host.remove();
}

/// Applica alla superficie di questo riquadro il dato che la sessione ha
/// diffuso, se ne tiene il testo. `syncDoc` e non `setDoc`: il documento è lo
/// stesso, è cambiato il testo sotto — e chi lo sta guardando non perde il
/// punto in cui era. Il cambio non entra nella history locale: un
/// aggiornamento arrivato da un altro riquadro non diventa un undo di questo.
/// Le classi della nota non si rileggono qui: vengono dall'indice, che cambia
/// al salvataggio e lo dice con `index_updated`; chiederle a ogni battuta era
/// un IPC per carattere.
function applySurfaceUpdate(r: Pane, doc: string, update: DocumentSurfaceUpdate): void {
  if (r.shown?.k !== "doc" || r.shown.doc !== doc) return;
  try {
    r.surface?.buffer?.syncDoc(
      update.kind === "operation" ? { text: update.text, operation: update.operation } : update.text,
    );
  } catch (error) {
    failSurface(r, doc, error);
  }
}

/// Il testo di un documento: dal buffer se qualcuno lo tiene già aperto, dal
/// disco altrimenti.
///
/// È qui che la regola del buffer unico si vede: aprire in un secondo riquadro
/// una nota con modifiche non salvate mostra **quelle modifiche**, non il file
/// su disco. L'alternativa — rileggere sempre dal disco — darebbe due riquadri
/// che mostrano due testi diversi dello stesso documento.
export async function readBuffer(doc: string): Promise<DocumentSurfaceSource> {
  return documentSessions.readForSurface(doc);
}

/// La sessione possiede il testo; questa notifica aggiorna soltanto la resa
/// delle superfici già aperte, senza ricreare buffer o cronologia.
export function redrawReading(doc: string): void {
  // Una superficie da parte si ridisegna quando torna, se mostra la lettura.
  for (const r of panes.values()) {
    for (const entry of r.parked) if (entry.tab.doc === doc) entry.redraw = true;
  }
  for (const id of panesWithDoc(doc)) {
    const r = panes.get(id);
    if (!r || selectedMode(r)?.presentation !== "rendered" || activeDoc(id) !== doc) {
      continue;
    }
    // `syncDoc` col testo corrente ridisegna senza toccare cronologia o
    // selezione: la superficie conserva il punto e ricuce gli embed.
    const buffer = r.surface?.buffer;
    buffer?.syncDoc(buffer.getDoc());
  }
}
