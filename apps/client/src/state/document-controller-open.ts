// Il gestore del documento: le aperture (la coda, le letture, le sessioni).

import { type SurfaceDropDocument, type SurfaceDropOffer } from "../editors/core/registry";
import { pdfIdWithoutFragment, pdfPageFromFragment } from "../editors/media/pdf-ids";
import { mediaKindOfId } from "../editors/media/media-types";
import { Queue } from "../ui/race";
import { resolvedReference } from "../host/query";
import { on, state } from "./store";
import { documentSessions, flushPendingSave } from "./document-session";
import {
  openIn,
  split,
  activeDoc,
  focusPane,
  layout,
  panesWithDoc,
  panes as layoutPanes,
  activeTab,
  removeEverywhere,
  type LayoutNode,
} from "./layout";
import { createNote, openVaultRoot } from "./vault";
import { lentDocuments, mountLends, onLendChanged, provideLendGate, unlend } from "./lend";
import { notify } from "../ui/notify";
import { visibleRect } from "../ui/views";
import { renderOnOpen } from "./craft-previews";
import { t } from "../i18n/strings";
import { type Lifetime } from "../ui/lifetime";
import { panes, surfaceRegistry } from "./document-controller-state";
import { cardEditors } from "./document-controller-ports";
import { synchronize, redrawTabs, docTitle } from "./document-controller-draw";
import { handledByVault } from "./document-controller-surfaces";
import { selectedMode, publishContext, reveal, focusEditor } from "./document-controller-modes";
import { drawPaneConflict, setReadOnlyForDocument } from "./document-controller-save";

export function invalidateLoads(doc: string): void {
  for (const paneId of panesWithDoc(doc)) {
    const pane = panes.get(paneId);
    if (pane) pane.loadGeneration++;
  }
}

/// Le aperture, in fila (difetto 0033).
///
/// `openDocument` non ha niente da datare: l'`id` è il suo parametro e non
/// scade — il difetto era descritto come una identità da ricontrollare dopo
/// l'`await`, e quell'identità non esiste. Ciò che manca è **l'ordine**: due
/// aperture ravvicinate (un doppio click nell'esploratore, due Invio nel quick
/// switcher) aspettano tutte e due `flushPendingSave`, e chi finisce di aspettare
/// per primo apre per primo. Se è quella chiesta per prima a finire per seconda,
/// il documento che resta col fuoco è quello che l'utente aveva chiesto **prima**.
///
/// Buttare la vecchia sarebbe sbagliato: sono due note che l'utente ha chiesto
/// di aprire, e le vuole aperte tutte e due. Vanno in fila.
const openQueue = new Queue();

// --- aprire e chiudere ------------------------------------------------------

/// Apre un documento nel riquadro col fuoco.
/// Come si apre un documento. `gesture`: l'apertura nasce da un gesto di chi
/// usa Fub (un clic o Invio su una riga dell'albero, un risultato della
/// ricerca, il passaggio veloce, un link o una figura in una nota). Lo vede
/// soltanto il montaggio che l'apertura fa nascere (`SurfaceMountContext`).
export interface OpenOptions {
  readonly gesture?: boolean;
  /// La pagina che l'apertura chiede, da 1: un link a `x.pdf#page=3`. La
  /// prende la superficie che l'apertura monta (`SurfaceMountContext.page`)
  /// o, se il documento è già la scheda attiva, `EditorSurface.showPage`.
  readonly page?: number;
  /// Un'apertura che la shell decide da sola, senza un gesto (la prima nota
  /// di un vault senza schede, la nota d'avvio): il valore di
  /// [`openingsSoFar`] quando l'ha decisa. Se intanto è stata chiesta
  /// un'altra apertura, la decisione è vecchia: questa non parte, e non tocca
  /// schede, riquadro, contesto né fuoco.
  readonly unlessOpenedSince?: number;
}

/// Quante aperture sono state chieste finora, in tutto.
let openingsAsked = 0;

/// Il segno da passare come `unlessOpenedSince`: si prende quando si decide
/// di aprire, prima delle attese che precedono la chiamata.
export function openingsSoFar(): number {
  return openingsAsked;
}

/// La pagina chiesta dall'apertura in corso per il documento del riquadro:
/// `show` la prende al montaggio (una scheda nuova o una che torna attiva),
/// `openDocument` la toglie quando ha finito. Come `gestureBirths`, vive
/// quanto quell'apertura.
const openingPages = new Map<string, { readonly doc: string; readonly page: number }>();

/// La pagina per la scheda di `doc` montata adesso nel riquadro `pane`, presa
/// una volta sola.
export function takeOpeningPage(pane: string, doc: string): number | null {
  const wanted = openingPages.get(pane);
  if (wanted?.doc !== doc) return null;
  openingPages.delete(pane);
  return wanted.page;
}

/// Il documento che l'apertura in corso con un gesto farà nascere in un
/// riquadro: `show` lo prende al montaggio, `openDocument` lo toglie quando
/// ha finito. Vive quanto quell'apertura, mai come «l'ultimo gesto».
const gestureBirths = new Map<string, string>();

/// Il gesto per la scheda di `doc` che nasce adesso nel riquadro `pane`, preso
/// una volta sola: un rimontaggio dopo non lo trova.
export function takeGesture(pane: string, doc: string): boolean {
  if (gestureBirths.get(pane) !== doc) return false;
  gestureBirths.delete(pane);
  return true;
}

/// Alla fine di un'apertura il fuoco va all'editor solo se nessuno l'ha
/// portato altrove intanto. Un'apertura lunga (un documento da impaginare)
/// finisce quando chi usa Fub è già passato oltre: se nel frattempo ha aperto
/// il lanciatore, un dialogo o un campo, quello che scrive e il suo Invio
/// restano lì e non finiscono nel documento. Il fuoco è ancora dell'apertura
/// se sta dov'era al gesto (`asked`), se non sta da nessuna parte, o se sta in
/// un riquadro (l'editor di prima, che l'apertura sostituisce).
///
/// Non lo è più se sta già dentro il documento aperto, nel riquadro col fuoco
/// (#395): la superficie si monta prima che l'apertura finisca, e chi usa Fub
/// può esserci entrato (il Tab dalla lavagna vuota al suo primo pulsante, un
/// clic su una scheda). Riportarlo all'editor glielo toglierebbe di mano.
/// `editorEl` tiene la superficie del solo documento mostrato: quella di prima
/// si toglie (`detachSurface`) prima che la nuova si monti.
function focusStillOpening(asked: Element | null, doc: string): boolean {
  const now = document.activeElement;
  if (now === null || now === document.body || now === document.documentElement) return true;
  const target = panes.get(layout.focus);
  if (target?.shown?.k === "doc" && target.shown.doc === doc && target.editorEl.contains(now)) return false;
  if (now === asked) return true;
  for (const r of panes.values()) if (r.root.contains(now)) return true;
  return false;
}

export async function openDocument(id: string, options: OpenOptions = {}): Promise<void> {
  // Un'apertura decisa prima di un'altra chiesta intanto è superata: quella
  // più nuova vince anche se arriva in fila prima (la regola delle gare in
  // `docs/architecture/runtime-events-and-jobs.md`).
  if (options.unlessOpenedSince !== undefined && options.unlessOpenedSince !== openingsAsked) return;
  openingsAsked++;
  // Dove sta il fuoco al gesto: alla fine si guarda se è ancora lì.
  const asked = document.activeElement;
  // Reserve the target before entering the shared flush queue. Otherwise the
  // last-tab release can close the owner while this opening is still waiting
  // for that same queue.
  const releaseIntent = documentSessions.retain(id);
  try {
    await openQueue.enqueue(async () => {
      // Cambio documento: prima si mette in salvo ciò che è appeso al debounce, così
      // nessuna modifica resta indietro. Tutti i buffer e non solo quello che si sta
      // lasciando: costa zero quando sono puliti, ed è la regola già scritta per le
      // azioni di view.
      await documentSessions.flushPendingSave();
      const pane = layout.focus;
      // Il gesto va soltanto alla scheda che questa apertura fa nascere: un
      // documento che è già una scheda del riquadro prende il fuoco, e basta.
      const born = options.gesture === true
        && !(layout.panes[pane]?.tabs ?? []).some((tab) => tab.k === "doc" && tab.doc === id);
      if (born) gestureBirths.set(pane, id);
      const page = options.page !== undefined && Number.isSafeInteger(options.page) && options.page >= 1 ? options.page : null;
      if (page !== null) openingPages.set(pane, { doc: id, page });
      openIn(pane, id);
      // Un PDF o un documento nato da un gesto, col consenso acceso: l'app ne
      // fa l'anteprima in sottofondo, per la nota e il passaggio (T31).
      if (born) void renderOnOpen(id);
      try {
        await synchronize();
      } finally {
        if (born && gestureBirths.get(pane) === id) gestureBirths.delete(pane);
      }
      // La scheda era già quella attiva e non si è rimontata: la pagina va
      // alla superficie che c'è, se è ancora questo documento a mostrarla.
      if (page !== null && takeOpeningPage(pane, id) !== null) {
        const r = panes.get(pane);
        if (r?.shown?.k === "doc" && r.shown.doc === id) r.surface?.showPage?.(page);
      }
      // Il contesto si pubblica DOPO aver caricato il buffer: prima, lo span della
      // selezione sarebbe quello del documento precedente.
      await publishContext();
      if (selectedMode(panes.get(layout.focus))?.presentation !== "rendered" && focusStillOpening(asked, id)) focusEditor();
    });
  } finally {
    releaseIntent();
    // A failed or superseded opening must not leave the owner retained solely
    // by its reservation. A tab already present still counts as a watcher.
    if (!isOpen(id) && !cardEditors.holds(id)) await documentSessions.release(id);
  }
}

/// Apre una nota chiesta da una view che sta in un riquadro (il grafo, una
/// dashboard): la view resta dov'è e la nota si apre accanto — nel primo altro
/// riquadro, o in uno nuovo a destra. Chi clicca un nodo vuole leggere la nota
/// senza perdere il grafo che stava guardando.
export async function openFromView(id: string): Promise<void> {
  const here = layout.focus;
  if (activeTab(here)?.k !== "view") {
    await openDocument(id);
    return;
  }
  const other = layoutPanes().find((pane) => pane !== here) ?? split(here, "row");
  if (!other) {
    await openDocument(id);
    return;
  }
  focusPane(other);
  await openDocument(id);
}

/// Le lavagne che i riquadri mostrano adesso, dove può cadere un blocco
/// staccato da una nota (T48): una per riquadro che si vede, col nome della
/// sua linguetta. Il riquadro acceso dice il bersaglio col suo bordo.
export function boardOffers(document: SurfaceDropDocument): SurfaceDropOffer[] {
  if (document.vault !== undefined && document.vault !== openVaultRoot()) return [];
  const out: SurfaceDropOffer[] = [];
  for (const id of layoutPanes()) {
    const doc = activeDoc(id);
    const pane = panes.get(id);
    if (doc === null || !pane || !/\.canvas$/i.test(doc)) continue;
    const rect = visibleRect(pane.root);
    if (!rect) continue;
    const root = pane.root;
    out.push({
      kind: "board",
      document: { documentId: doc, vault: document.vault },
      title: docTitle(doc),
      rect,
      hover: (on) => {
        if (on) root.dataset.dropHot = "true";
        else delete root.dataset.dropHot;
      },
    });
  }
  return out;
}

/// Come si apre un documento accanto.
export interface BesideOptions extends OpenOptions {
  /// Se il riquadro vicino (quello che `split` metterebbe accanto: il
  /// fratello dopo, nella stessa fila) mostra già il documento, si va lì
  /// invece di dividere, e la pagina chiesta arriva alla superficie che c'è.
  /// Assente: si divide sempre, come per un `fub://open`.
  readonly reuse?: boolean;
}

/// Apre un documento in un riquadro nuovo accanto a quello col fuoco, a
/// destra (`row`) o sotto (`col`): è il `split` di un `fub://open`. Con
/// `reuse` torna al vicino che lo mostra già.
export async function openDocumentBeside(id: string, dir: "row" | "col", options: BesideOptions = {}): Promise<void> {
  const { reuse, ...open } = options;
  const near = reuse === true ? neighbourShowing(layout.focus, dir, id) : null;
  const other = near ?? split(layout.focus, dir);
  if (other) focusPane(other);
  await openDocument(id, open);
}

/// Il riquadro accanto a `pane` nella direzione `dir` (a destra per `row`,
/// sotto per `col`: dove `split` mette il riquadro nuovo), se la sua scheda
/// attiva è `doc`; `null` se non c'è o mostra altro.
///
/// Vale anche in una disposizione annidata (T102): fra le divisioni in quella
/// direzione che contengono `pane`, la più interna che ha qualcosa dopo il
/// ramo di `pane` dà il ramo accanto, e di quel ramo contano i riquadri che
/// toccano il lato verso `pane` (il primo di ogni divisione nella stessa
/// direzione, tutti in quella dell'altra). Con riga [colonna [A, B], C] il
/// riquadro accanto ad A e a B è C; con riga [A, colonna [C, D]] accanto ad A
/// sono C e D, e vince il primo che mostra `doc`.
function neighbourShowing(pane: string, dir: "row" | "col", doc: string): string | null {
  const contains = (node: LayoutNode): boolean =>
    node.k === "leaf" ? node.pane === pane : node.children.some(contains);
  // Il ramo dopo quello di `pane` nella divisione più interna in `dir`.
  let beside: LayoutNode | null = null;
  let node: LayoutNode = layout.tree;
  while (node.k !== "leaf") {
    const at = node.children.findIndex(contains);
    if (at < 0) return null;
    if (node.dir === dir && at + 1 < node.children.length) beside = node.children[at + 1]!;
    node = node.children[at]!;
  }
  if (beside === null) return null;
  // I riquadri del ramo accanto che toccano il lato verso `pane`, in ordine.
  const edge = (branch: LayoutNode): string[] => {
    if (branch.k === "leaf") return [branch.pane];
    if (branch.dir === dir) return edge(branch.children[0]!);
    return branch.children.flatMap(edge);
  };
  return edge(beside).find((near) => activeDoc(near) === doc) ?? null;
}

/// Il frammento di un percorso dopo il `#` (`page=3`, `Titolo`, `B3`), o
/// `null` se non ce n'è uno.
function pathFragment(path: string): string | null {
  const at = path.indexOf("#");
  const fragment = at < 0 ? "" : path.slice(at + 1).trim();
  return fragment === "" ? null : fragment;
}

/// «Apri a lato» di un percorso del vault (il menu di una scheda della
/// lavagna, T17; «Apri a lato per questo», T45): accanto, o nel riquadro
/// vicino che lo mostra già, allo stesso punto. `#page=N` di un PDF arriva
/// alla pagina; un punto che la risoluzione porta (`at`) si rivela; un altro
/// frammento che non arriva da nessuna parte (una cella, `#B3`: la griglia
/// non sa ancora riceverla) apre il file in cima, e lo dice.
export async function openPathBeside(path: string, from?: string): Promise<void> {
  const target = await resolvedReference({ kind: "path", value: path }, from ?? activeDoc() ?? undefined);
  if (!target) throw new Error(t("preview.target_missing"));
  const fragment = pathFragment(path);
  const page = fragment === null ? null : linkedPdfPage(target.doc, fragment);
  await openDocumentBeside(target.doc, "row", { reuse: true, ...(page === null ? {} : { page }) });
  if (target.at) await reveal(target.doc, { span: target.at.span });
  else if (fragment !== null && page === null && activeDoc() === target.doc) {
    notify(t("document.reveal_unavailable", { doc: docTitle(target.doc) }), "info");
  }
}

/// Chiude il documento aperto **in ogni riquadro**, senza salvarlo: lo si usa
/// quando il documento non c'è più (cancellato qui o da fuori), cioè quando
/// salvarlo lo resusciterebbe.
///
/// Senza argomento chiude quello attivo, che è la forma con cui la chiamava chi
/// aveva un riquadro solo.
export function closeDocument(id: string | null = state.currentDoc): void {
  if (!id) return;
  documentSessions.close(id);
  invalidateLoads(id);
  removeEverywhere(id);
  // Il kernel svuota già il documento del contesto in `remove_document`: qui
  // si ripubblica per allineare i due stati **e** per farsi dire quali view
  // ridisegnare, che è cosa che il kernel non fa da sé.
  void publishContext();
}

/// Il documento è aperto in **qualche** riquadro?
export function isOpen(id: string): boolean {
  return panesWithDoc(id).length > 0;
}

/// Il prestito (T17) visto dalle schede. Una scheda aperta che mostra il
/// documento si può prestare; un'immagine o un PDF che il visore mostra dai
/// byte no: Fub non li scrive, e non c'è niente da tenere fermo. Le schede di
/// un documento prestato sono in sola lettura (`heldReadOnly`), la riga
/// «Aperto in {app}» la disegna `panels/document.ts`, e il prestito finisce
/// quando si chiude l'ultima scheda del documento, comunque si chiuda.
export function mountDocumentLends(lifetime: Lifetime): void {
  mountLends(lifetime);
  lifetime.add(provideLendGate({
    lendable: (doc) => isOpen(doc) && (handledByVault(doc) || !surfaceRegistry.showsBytes(doc)),
    flush: flushPendingSave,
  }));
  lifetime.add(onLendChanged((doc) => {
    setReadOnlyForDocument(doc, documentSessions.isDeletionPending(doc));
    redrawTabs(doc);
    drawPaneConflict(doc);
  }));
  lifetime.add(on("layout", () => {
    for (const doc of lentDocuments()) if (!isOpen(doc)) unlend(doc);
  }));
}

/// Risolve un wikilink e lo apre; se non risolve, crea la nota che manca col
/// nome scritto nel link. Il backlink c'è già prima ancora
/// che l'utente abbia scritto la prima riga — è il grafo a ricucirlo.
///
/// `heading` e `block` sono il **punto** che il link nomina, quando lo nomina.
/// Fino alla [0049](../../../docs/decisions/0181-modello-documento-e-arene.md)
/// arrivavano fin qui e si fermavano: la risposta di `resolve` sapeva dire
/// *quale documento* e non *dove dentro*, quindi `[[Nota#^blocco]]` apriva la
/// nota in cima e niente lo diceva. Adesso la posizione torna dal kernel e la
/// si porta a schermo con lo stesso `reveal` dell'outline — uno span in byte
/// UTF-8, che la superficie traduce nella sua vista come ogni altro.
///
/// **Da dove si sta guardando** è la seconda metà, ed era il buco: un
/// `[[#Sezione]]` non nomina una pagina, nomina *questa*, e chi arrivava qui
/// usciva su un `if (!page) return` — cioè un click che non faceva niente e non
/// diceva perché. Il documento corrente non si rilegge dallo stato: lo dice
/// `activeDoc()`, che è il proprietario di quella domanda (il riquadro col
/// fuoco, la sua tab attiva). A saperne fare qualcosa è il kernel, dove la
/// regola vale anche per chi non è questa shell.
export async function openWikilink(
  page: string,
  heading?: string,
  block?: string,
  from?: string,
  options: OpenOptions = {},
): Promise<void> {
  const target = await resolvedReference(
    { kind: "wiki", value: { page, heading: heading ?? null, block: block ?? null } },
    from ?? activeDoc() ?? undefined,
  );
  if (target) {
    const page = linkedPdfPage(target.doc, heading);
    await openDocument(target.doc, page === null ? options : { ...options, page });
    // Il punto può non esserci — un heading rinominato, un `^abc` cancellato —
    // e allora resta la nota aperta in cima: è il degrado dichiarato di
    // `ResolvedRef.at`, non un caso da nascondere.
    if (target.at) await reveal(target.doc, { span: target.at.span });
    return;
  }
  // Un link senza pagina che non ha risolto non crea niente: non c'è un nome da
  // dare alla nota che si creerebbe, e crearla col nome vuoto sarebbe la
  // risposta peggiore di tutte.
  if (!page) return;
  const created = await createNote(page);
  if (created) await openDocument(created);
}

/// La pagina che un link a un PDF nomina dopo il `#`: `[[x.pdf#page=3]]` e
/// `![[x.pdf#page=3]]` arrivano con `heading` = `page=3`. Un numero che non è
/// un intero positivo (`page=0`, `page=abc`, `page=`) non nomina niente, e il
/// PDF si apre alla prima pagina; un altro documento non ha pagine.
export function linkedPdfPage(doc: string, heading: string | null | undefined): number | null {
  if (!heading || mediaKindOfId(pdfIdWithoutFragment(doc)) !== "pdf") return null;
  return pdfPageFromFragment(`#${heading.trim()}`);
}

/// Il clic su una figura di una nota (un file Craft, un PDF): apre il suo
/// documento col gesto, come un link a un percorso. A differenza di
/// `openWikilink` non crea mai niente: se il file non c'è più (rinominato o
/// tolto fuori da Fub) è un errore, e chi ha cliccato lo dice con un avviso.
export async function openFigure(doc: string): Promise<void> {
  const target = await resolvedReference({ kind: "wiki", value: { page: doc, heading: null, block: null } }, doc);
  if (!target) throw new Error(t("preview.target_missing"));
  await openDocument(target.doc, { gesture: true });
}
