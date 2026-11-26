// Il motore della lavagna: copia, taglia e incolla. Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t, plural, type Key } from "../../i18n/strings";
import { type SurfaceClipboardOp } from "../core/editor-menu";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../platform/clipboard";
import { openLifetime } from "../../ui/lifetime";
import { parsePageRanges } from "./page-ranges";
import { cardKindOf } from "../core/cards/contract";
import { inkKey } from "./ink-erase";
import { isEmptyBoard, transferOf } from "./chrome/empty";
import { checkProblemText, clipboardText, codeTextProblem, problemPhrase, readCodeList, summaryText, warningsText } from "./code-text";
import { asCopies, asUpdates, codeClashes, placedAt, type CodeClashes } from "./code-paste";
import {
  CANVAS_CLIPBOARD_TYPE,
  CANVAS_PASTE_STEP,
  cardsMarkdown,
  clipboardJson,
  copiedSelection,
  joinedInkPatches,
  pastedInkOps,
  placedSelection,
  readCanvasClipboard,
  type CanvasClipboard,
} from "./clipboard";
import { openDialog, textField } from "../../kit";
import { cardTarget } from "./sources";
import { INK_KEY, type InkLayerRef } from "./ink-record";
import { newNodeId } from "./operation";
import { type CanvasNode } from "./model";
import { CanvasCoreError, type CanvasCheckReport, type CanvasIntentOp } from "./wasm/core";
import { SPREAD_CONFIRM_ABOVE } from "./engine-options";
import { LastPaste, PasteChoice, isTextTarget } from "./engine-parts";
import { snap, isVaultPath } from "./engine-geometry";
import { lostCore, fileName } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const clipboardMethods = {
  // --- copia e incolla le schede (T68) --------------------------------------------

  /**
   * Lo spostamento che Ctrl+D ripete: le schede `nodes` sono proprio le copie
   * dell'ultimo Ctrl+D e la prima scheda di partenza c'è ancora; si ripete la
   * distanza di adesso fra le due, anche se la copia è stata spostata. `null`
   * sennò, o se la copia sta sopra la sua scheda.
   */
  _repeatedOffset(this: CanvasEngine, nodes: readonly CanvasNode[]): { readonly x: number; readonly y: number } | null {
    const last = this._lastDuplicate;
    if (!last || !this._doc || last.copies.length !== nodes.length) return null;
    const chosen = new Set(nodes.map((node) => node.id));
    if (!last.copies.every((id) => chosen.has(id))) return null;
    const copy = this._doc.nodes.find((node) => node.id === last.copies[0]);
    const source = this._doc.nodes.find((node) => node.id === last.sources[0]);
    if (!copy || !source) return null;
    const x = copy.x - source.x;
    const y = copy.y - source.y;
    return x === 0 && y === 0 ? null : { x, y };
  },

  /**
   * Gli appunti sono della lavagna: lo chiede il menu, oppure il fuoco è sulla
   * vista o su una scheda, non in un campo né nel contenuto della scheda
   * attiva, e dentro la lavagna non c'è un testo scelto (quello lo copia il
   * browser, com'è).
   */
  _ownsClipboard(this: CanvasEngine): boolean {
    if (this._clipboardCommand !== null) return true;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this._viewport.contains(active)) return false;
    if (isTextTarget(active) || this._insideActive(active, false)) return false;
    const selection = document.getSelection();
    return !(selection && !selection.isCollapsed && this._viewport.contains(selection.anchorNode));
  },

  /**
   * Ctrl+C e Ctrl+X, e «Copia» e «Taglia» del menu: le schede scelte e i
   * tratti liberi scelti col Lazo negli appunti; tagliando, poi tolti.
   */
  _copyEvent(this: CanvasEngine, event: ClipboardEvent, cut: boolean): void {
    if (event.defaultPrevented || !event.clipboardData || !this._doc || this._destroyed) return;
    if (!this._ownsClipboard()) return;
    const cutting = cut || this._clipboardCommand === "cut";
    if (cutting && this._readOnly) return;
    const clipboard = copiedSelection(this._doc, this._selection, this._chosenFreeStrokes());
    if (!clipboard) return;
    event.preventDefault();
    event.clipboardData.setData(CANVAS_CLIPBOARD_TYPE, clipboardJson(clipboard));
    event.clipboardData.setData("text/plain", cardsMarkdown(clipboard.nodes));
    // Appunti nuovi: il prossimo incolla parte di nuovo sotto il puntatore.
    this._lastPaste = null;
    if (cutting) this._cutSelection(clipboard);
  },

  /** Gli id dei tratti liberi scelti col Lazo, quelli che vanno negli appunti (T94). */
  _chosenFreeStrokes(this: CanvasEngine): string[] {
    return this._chosenStrokes().filter((unit) => unit.node === null).map((unit) => unit.id);
  },

  /**
   * Toglie ciò che `clipboard` ha appena copiato, in un commit solo: le
   * schede come «Togli dalla lavagna» (i file restano, e l'avviso lo dice col
   * suo «Annulla») e i tratti liberi dal livello della radice.
   */
  _cutSelection(this: CanvasEngine, clipboard: CanvasClipboard): void {
    const ids = clipboard.nodes.map((node) => node.id);
    const strokes = (clipboard[INK_KEY]?.strokes ?? []).map((stroke) => stroke.id);
    if (this._readOnly || !this._removeCards(ids, [], strokes)) return;
    this._selection = this._selection.filter((id) => !ids.includes(id));
    this._edgeSelection = [];
    if (strokes.length > 0) {
      const gone = new Set(strokes.map((id) => inkKey("board", id)));
      this._strokeSelection = new Set([...this._strokeSelection].filter((key) => !gone.has(key)));
    }
    this._options.onSelectionChange();
    this._displaySelection();
  },

  /**
   * Un incolla che il browser manda fuori dalla vista (al corpo della pagina,
   * o dove sta la selezione di testo) mentre il fuoco è sulla lavagna: passa
   * da `_intake` come uno sulla vista. Quello sulla vista l'ha già preso lei.
   */
  _pasteFromOutside(this: CanvasEngine, event: ClipboardEvent): void {
    if (event.defaultPrevented || (event.target instanceof Node && this._viewport.contains(event.target))) return;
    if (this._clipboardCommand !== null || !this._ownsClipboard()) return;
    void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
  },

  /**
   * Incolla le schede e i tratti liberi di Fub dal testo `raw` degli
   * appunti, nel punto dell'incolla (T15): un commit, un annulla, le schede
   * incollate scelte. Lo stesso testo incollato di nuovo nello stesso punto si
   * sfalsa. Una versione futura non incolla niente e lo dice; un `fub:ink`
   * rotto o fuori dai limiti non incolla niente e lo dice come una forma che
   * il nucleo rifiuta. `false` se `raw` non è la forma di Fub: allora si
   * incolla come testo.
   */
  _pasteCards(this: CanvasEngine, event: ClipboardEvent | DragEvent, raw: string): boolean {
    const read = readCanvasClipboard(raw);
    if (read.kind === "broken") return false;
    event.preventDefault();
    this._recordPending();
    if (read.kind === "future") {
      this._showNotice(t("canvas.clipboard.future"));
      return true;
    }
    if (read.kind === "refused") {
      this._showNotice(t("canvas.clipboard.refused"));
      return true;
    }
    const spot = this._pasteSpot(raw);
    if (!this._commitPasted(read.clipboard, spot.at)) {
      this._showNotice(t("canvas.clipboard.refused"));
      return true;
    }
    this._lastPaste = spot.last;
    this._showNotice("");
    return true;
  },

  /**
   * Dove cade un incolla (Ctrl+V, «Aggiungi come copie» di «Incolla codice»):
   * l'angolo del blocco sul puntatore (o al centro della vista), sulla
   * griglia; lo stesso testo incollato di nuovo nello stesso punto scende di
   * `CANVAS_PASTE_STEP` ogni volta. `last` va in `_lastPaste` solo se
   * l'incolla scrive.
   */
  _pasteSpot(this: CanvasEngine, raw: string): { readonly at: { x: number; y: number }; readonly last: LastPaste } {
    const point = this._intakePoint(null, false);
    const x = snap(point.x);
    const y = snap(point.y);
    const last = this._lastPaste;
    const count = last && last.raw === raw && last.x === x && last.y === y ? last.count + 1 : 0;
    const step = count * CANVAS_PASTE_STEP;
    return { at: { x: x + step, y: y + step }, last: { raw, x, y, count } };
  },

  /**
   * Le schede e i tratti liberi di `clipboard` con l'angolo del loro
   * riquadro in `at`, in un commit solo, poi scelti (i tratti solo col Lazo,
   * l'unico che li tiene scelti). Le schede e i fili entrano con `insert`
   * (il frammento di N6 T68, con id nuovi dal nucleo), i tratti nel livello
   * della radice con `add_strokes` e `move_strokes` (T24), tutto in una
   * compilazione. `false` se il nucleo rifiuta qualcosa (un filo senza una
   * delle sue schede, un tratto che non vale): allora non entra niente.
   */
  _commitPasted(this: CanvasEngine, clipboard: CanvasClipboard, at: { readonly x: number; readonly y: number }): boolean {
    const doc = this._doc;
    if (!doc || this._readOnly) return false;
    // Lo spostamento del blocco e gli id nuovi dei tratti: le schede si
    // spostano quanto i tratti, così restano dove erano gli uni per gli altri.
    const placed = placedSelection(clipboard, at, newNodeId);
    const ops: CanvasIntentOp[] = [];
    if (clipboard.nodes.length > 0) {
      let left = Infinity;
      let top = Infinity;
      for (const node of clipboard.nodes) {
        left = Math.min(left, node.x);
        top = Math.min(top, node.y);
      }
      const fragment = { version: clipboard.version, nodes: clipboard.nodes, edges: clipboard.edges };
      ops.push({ op: "insert", fragment: JSON.parse(JSON.stringify(fragment)) as Record<string, unknown>, x: left + placed.dx, y: top + placed.dy });
    }
    ops.push(...pastedInkOps(placed));
    const compiled = this._compileIntent(ops, null);
    if (!compiled) return false;
    const patches = joinedInkPatches(compiled.patches);
    if (patches.length === 0 || !this._commit(patches, "input")) return false;
    this._selection = compiled.created.slice(0, clipboard.nodes.length);
    this._edgeSelection = [];
    this._strokeSelection = this._tool === "lasso"
      ? new Set(placed.strokes.map((stroke) => inkKey("board", stroke.id)))
      : new Set();
    this._options.onSelectionChange();
    this._displaySelection();
    return true;
  },

  /**
   * «Copia», «Taglia» e «Incolla» del tasto destro. Copia e taglia mandano la
   * copia del browser, la stessa di Ctrl+C; dove non parte, scrivono con gli
   * appunti della shell (il tipo di Fub solo dove la shell lo accetta, come
   * formato della pagina). Incolla legge gli appunti e passa da `_intake`
   * come un Ctrl+V.
   */
  _clipboardMenu(this: CanvasEngine, op: SurfaceClipboardOp): void {
    if (op === "paste") {
      this._pasteFromMenu();
      return;
    }
    if (op !== "copy" && op !== "cut") return;
    this._clipboardCommand = op;
    let sent = false;
    try {
      sent = typeof document.execCommand === "function" && document.execCommand("copy");
    } catch {
      sent = false;
    } finally {
      this._clipboardCommand = null;
    }
    if (!sent) this._writeCards(op === "cut");
  },

  /**
   * Scrive le schede e i tratti liberi scelti con gli appunti della shell;
   * con `cut` li toglie, solo dopo averli scritti. Dei soli tratti, dove la
   * shell non accetta il tipo di Fub, non resterebbe niente negli appunti:
   * l'avviso dice che la copia non è riuscita, e niente si toglie.
   */
  _writeCards(this: CanvasEngine, cut: boolean): void {
    if (!this._doc || (cut && this._readOnly)) return;
    const clipboard = copiedSelection(this._doc, this._selection, this._chosenFreeStrokes());
    if (!clipboard) return;
    const markdown = cardsMarkdown(clipboard.nodes);
    const web = `web ${CANVAS_CLIPBOARD_TYPE}`;
    const typed = clipboardSupports(web);
    if (!typed && clipboard.nodes.length === 0) {
      this._showNotice(t("editor_menu.copy_failed"));
      return;
    }
    const write = typed
      ? writeClipboardData({
          "text/plain": new Blob([markdown], { type: "text/plain" }),
          [web]: new Blob([clipboardJson(clipboard)], { type: CANVAS_CLIPBOARD_TYPE }),
        })
      : writeClipboardText(markdown);
    const source = this._source;
    this._lastPaste = null;
    void write.then(
      () => {
        if (cut && !this._destroyed && this._source === source) this._cutSelection(clipboard);
      },
      () => {
        if (!this._destroyed) this._showNotice(t("editor_menu.copy_failed"));
      },
    );
  },

  /** «Incolla» del menu: gli appunti letti come li legge la lavagna vuota (`transferOf`, schede di Fub comprese). */
  _pasteFromMenu(this: CanvasEngine): void {
    if (this._readOnly || this._destroyed) return;
    readClipboard().then(async (entries) => {
      const data = await transferOf(entries);
      if (this._destroyed) return;
      if (data === null) this._showNotice(t("canvas.blank.paste_none"));
      else this._receive(data);
    }).catch(() => {
      if (!this._destroyed) this._showNotice(t("editor_menu.paste_failed"));
    });
  },

  _deleteSelection(this: CanvasEngine): void {
    if (!this._doc || this._readOnly) return;
    if (this._removeCards(this._selection, this._edgeSelection)) {
      this._selection = [];
      this._edgeSelection = [];
      this._options.onSelectionChange();
    }
  },

  /**
   * «Togli dalla lavagna» (Canc, Backspace, il menu, la scheda mancante):
   * toglie le schede `nodes` e le linee `edges`, mai i file, e lo dice con
   * «Annulla». «I file restano» solo se fra le tolte c'è una scheda di file;
   * togliere solo dei fili, o dei tratti liberi `strokes` (il taglia del
   * Lazo), non dice niente.
   */
  _removeCards(this: CanvasEngine, nodes: readonly string[], edges: readonly string[], strokes: readonly string[] = []): boolean {
    if (!this._doc) return false;
    const gone = this._doc.nodes.filter((node) => nodes.includes(node.id));
    if (!this._removeNodes(nodes, edges, strokes)) return false;
    if (gone.length > 0) {
      const files = gone.some((node) => node.type === "file");
      const many = gone.length > 1;
      const key = files
        ? (many ? "canvas.card.removed_many" : "canvas.card.removed")
        : (many ? "canvas.card.removed_plain_many" : "canvas.card.removed_plain");
      this._showRemoval(t(key, { n: String(gone.length) }), true);
    }
    return true;
  },

  /**
   * L'avviso di un togliere appena fatto, legato al suo passo d'annulla; con
   * `undo` porta «Annulla». Va nel posto degli avvisi della tela.
   */
  _showRemoval(this: CanvasEngine, text: string, undo: boolean, free?: { readonly layer: InkLayerRef; readonly ids: readonly string[] }): void {
    if (this._destroyed) return;
    this._removal = free
      ? { text, step: this._undo[this._undo.length - 1], undo, free }
      : { text, step: this._undo[this._undo.length - 1], undo };
    this._drawToolbar();
  },

  /** La modifica dopo il togliere: il suo avviso se ne va. */
  _dropRemoval(this: CanvasEngine): void {
    if (this._removal === null) return;
    this._removal = null;
    this._drawToolbar();
  },

  /**
   * «Annulla» dell'avviso: ciò che fa Ctrl+Z, finché il togliere è l'ultimo
   * passo; dopo, l'avviso non c'è già più.
   */
  _undoRemoval(this: CanvasEngine): void {
    const removal = this._removal;
    if (removal === null || removal.step === undefined || this._undo[this._undo.length - 1] !== removal.step) {
      this._dropRemoval();
      return;
    }
    this.undo();
    this._dropRemoval();
    this._statusSettle();
    this._viewport.focus({ preventScroll: true });
  },

  /**
   * «Sposta anche il file nel cestino» (T17): i file delle schede scelte nel
   * cestino, uno alla volta, con la porta dell'host (il gesto dell'albero);
   * poi via dalla lavagna ogni scheda di un file che ci è andato, anche quelle
   * non scelte (la stessa nota in due schede), e le schede scelte senza file.
   * Un file che l'host rifiuta lascia le sue schede, e l'errore dell'host si
   * legge nel posto degli avvisi. Mai da un tasto: il comando non ne ha.
   */
  async _trashSelectedFiles(this: CanvasEngine): Promise<void> {
    const trash = this._options.onTrashPath;
    if (!trash || !this._doc || this._readOnly) return;
    const chosen = this._selectedNodes();
    const paths = [...new Set(chosen.filter((node) => node.type === "file").map((node) => cardTarget(node).path))]
      .filter(isVaultPath);
    if (!paths.length) return;
    const plain = chosen.filter((node) => node.type !== "file").map((node) => node.id);
    const document = this._source;
    const trashed: string[] = [];
    let failure: unknown = null;
    for (const path of paths) {
      try {
        if (await trash(path)) trashed.push(path);
      } catch (error) {
        failure = error;
        break;
      }
      if (this._destroyed) return;
    }
    if (this._destroyed) return;
    if (failure !== null) this._showIntakeError(failure);
    if (!trashed.length || !this._doc || this._readOnly) return;
    // Le schede dei file andati, come sono adesso: il documento può essere
    // cambiato durante l'attesa. Le schede senza file si tolgono solo se il
    // documento è quello di quando il gesto è partito.
    const gone = new Set(trashed);
    const cards = this._doc.nodes.filter((node) => node.type === "file" && gone.has(cardTarget(node).path)).map((node) => node.id);
    const ids = [...cards, ...(this._source === document ? plain : [])];
    if (!this._removeNodes(ids, [])) return;
    this._pruneSelection();
    this._options.onSelectionChange();
    const key = trashed.length > 1
      ? "canvas.card.trashed_files"
      : ids.length > 1 ? "canvas.card.trashed_many" : "canvas.card.trashed";
    this._showRemoval(t(key, { n: String(ids.length), name: fileName(trashed[0]!), files: String(trashed.length) }), false);
  },

  /**
   * «Spargi le pagine…» (T72): una scheda per pagina del PDF scelto, in riga
   * accanto alla sua, a capo ogni 10 e in gruppo oltre 12. Chiede le pagine (di
   * serie tutte), chiede conferma oltre `SPREAD_CONFIRM_ABOVE`, misura ogni
   * pagina come nasce un PDF (T29) e scrive tutto con `spread_pages` (T23), in
   * un passo solo: un annulla le toglie. Il file non si cambia.
   */
  async _spreadPages(this: CanvasEngine): Promise<void> {
    const pages = this._options.cards?.pdfPages;
    const chosen = this._selectedNodes();
    const one = chosen.length === 1 ? chosen[0]! : null;
    if (!pages || !this._doc || this._readOnly || one?.type !== "file" || cardKindOf(one) !== "pdf") return;
    const path = cardTarget(one).path;
    if (!isVaultPath(path)) return;
    const id = one.id;
    const epoch = this._epoch;
    // Dopo ogni attesa: la lavagna è ancora quella, e la scheda c'è ancora.
    const alive = (): boolean => !this._destroyed && !this._readOnly && this._epoch === epoch
      && this._doc !== null && this._doc.nodes.some((node) => node.id === id);
    const count = await pages.count(path);
    if (!alive()) return;
    if (count === null) {
      this._markBroken(path);
      this._showIntakeError(t("canvas.card.unreadable", { name: fileName(path) }));
      return;
    }
    this._forgetBroken(path);
    const wanted = await this._askPages(fileName(path), count);
    if (wanted === null || !alive()) return;
    if (wanted.length > SPREAD_CONFIRM_ABOVE && !(await this._confirmSpread(wanted.length))) return;
    if (!alive()) return;
    const measured = await pages.sizes(path, wanted);
    if (!alive()) return;
    this._writeOps(this._spreadOps(id, wanted, count, measured));
  },

  /**
   * La forma in codice di «Spargi le pagine» (T23): `page_sizes` va per numero
   * di pagina, e una pagina non misurata ha `[0, 0]`, che il nucleo fa nascere
   * come la GUI senza misura. L'etichetta del gruppo è quella della lingua.
   */
  _spreadOps(
    this: CanvasEngine,
    id: string,
    wanted: readonly number[],
    count: number,
    measured: readonly ({ readonly width: number; readonly height: number } | null | undefined)[] = [],
  ): CanvasIntentOp[] {
    const last = Math.max(0, ...wanted);
    const sizes: number[][] = Array.from({ length: last }, () => [0, 0]);
    wanted.forEach((page, index) => {
      const size = measured[index];
      if (size) sizes[page - 1] = [size.width, size.height];
    });
    return [{
      op: "spread_pages", id, pages: [...wanted], page_count: count,
      ...(measured.some(Boolean) ? { page_sizes: sizes } : {}),
      label: t("canvas.spread.group", { count: String(wanted.length) }),
    }];
  },

  /**
   * Chiede quali pagine «Spargi le pagine» deve fare (T72): `null` se si rinuncia.
   * Il campo parte da tutte le pagine e dice a ogni tasto che cosa nascerà; un
   * pezzo che non si legge non chiude il dialogo, e il dialogo dice quale.
   */
  _askPages(this: CanvasEngine, name: string, count: number): Promise<readonly number[] | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const note = document.createElement("p");
    note.className = "kit-dialog-description";
    const field = textField({
      label: t("canvas.spread.field"),
      value: count > 1 ? `1-${count}` : "1",
      placeholder: t("canvas.spread.placeholder"),
      lifetime: own,
      onInput: () => say(),
    });
    const say = (): void => {
      const ranges = parsePageRanges(field.value(), count);
      note.textContent = ranges.ok
        ? (ranges.cut
          ? t("canvas.spread.cut", { pages: String(count), n: String(ranges.pages.length) })
          : t("canvas.spread.count", { n: String(ranges.pages.length) }))
        : ranges.bad === null
          ? t("canvas.spread.none", { pages: String(count) })
          : t("canvas.spread.bad", { text: ranges.bad });
    };
    const body = document.createElement("div");
    body.append(field.element, note);
    say();
    const handle = openDialog<"spread" | "cancel">({
      title: t("canvas.spread.title"),
      description: t("canvas.spread.description", { name, pages: String(count) }),
      body,
      actions: [
        { id: "cancel", label: t("app.cancel"), value: "cancel" },
        { id: "spread", label: t("canvas.spread.action"), kind: "primary", value: "spread" },
      ],
      dismissValue: "cancel",
      lifetime: own,
      submit: "spread",
      confirm: (value) => value === "cancel" || parsePageRanges(field.value(), count).ok,
    });
    return handle.result.then((value) => {
      own.close();
      if (value !== "spread") return null;
      const ranges = parsePageRanges(field.value(), count);
      return ranges.ok ? ranges.pages : null;
    });
  },

  /** La conferma prima di far nascere più di `SPREAD_CONFIRM_ABOVE` schede (T72); «Annulla» di serie. */
  _confirmSpread(this: CanvasEngine, count: number): Promise<boolean> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const handle = openDialog<boolean>({
      title: t("canvas.spread.confirm.title", { n: String(count) }),
      description: t("canvas.spread.confirm.description", { n: String(count) }),
      actions: [
        { id: "cancel", label: t("app.cancel"), value: false, autofocus: true },
        { id: "spread", label: t("canvas.spread.action"), kind: "primary", value: true },
      ],
      dismissValue: false,
      lifetime: own,
    });
    return handle.result.then((yes) => {
      own.close();
      return yes;
    });
  },

  /**
   * Che cosa copia «Copia come codice»: senza niente di scelto la lavagna
   * intera (`null`); se no le schede scelte (con gli archi fra loro e il loro
   * inchiostro) e i tratti liberi scelti col Lazo. Un arco o un tratto di
   * scheda scelti senza le loro schede non si copiano da soli: allora
   * `"partial"`, e la voce è spenta col perché.
   */
  _codeSelection(this: CanvasEngine): { readonly cards: readonly string[]; readonly free: readonly string[] } | null | "partial" {
    const cards = this._selectedNodes().map((node) => node.id);
    const strokes = this._chosenStrokes();
    if (cards.length === 0 && this._edgeSelection.length === 0 && strokes.length === 0) return null;
    const chosen = new Set(cards);
    const edges = this._doc?.edges ?? [];
    const lonely = this._edgeSelection.some((id) => {
      const edge = edges.find((one) => one.id === id);
      return !edge || !chosen.has(edge.fromNode) || !chosen.has(edge.toNode);
    });
    if (lonely || strokes.some((unit) => unit.node !== null)) return "partial";
    return { cards, free: strokes.map((unit) => unit.id) };
  },

  /** Perché «Copia come codice» è spento: la lavagna vuota, o una scelta che non si copia. */
  _copyCodeWhy(this: CanvasEngine): string | null {
    if (!this._doc || isEmptyBoard(this._doc)) return t("canvas.commands.why.empty");
    return this._codeSelection() === "partial" ? t("canvas.copy_code.why") : null;
  },

  /**
   * «Copia come codice» (LIC T25): ciò che è scelto, o la lavagna intera
   * senza selezione, come la lista di operazioni che lo rifà, negli appunti
   * come testo. Le schede le scrive il nucleo (`canvas_describe`); i tratti
   * liberi scelti seguono in una `add_strokes` della radice, com'è nel file
   * (la stessa forma di `describe`). Non scrive la lavagna.
   */
  _copyCode(this: CanvasEngine): void {
    const core = this._core;
    const doc = this._doc;
    if (this._destroyed || !core || !doc || this._copyCodeWhy() !== null) return;
    this._recordPending();
    const chosen = this._codeSelection();
    if (chosen === "partial") return;
    let text: string;
    try {
      if (chosen === null) text = core.describe();
      else {
        const ops = chosen.cards.length > 0 ? JSON.parse(core.describe(chosen.cards)) as unknown[] : [];
        const free = copiedSelection(doc, [], chosen.free)?.[INK_KEY]?.strokes ?? [];
        if (free.length > 0) ops.push({ op: "add_strokes", layer: "board", strokes: free });
        text = JSON.stringify(ops, null, 2);
      }
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return;
      }
      if (error instanceof CanvasCoreError) {
        this._showNotice(t("editor_menu.copy_failed"));
        return;
      }
      throw error;
    }
    writeClipboardText(text).catch(() => {
      if (!this._destroyed) this._showNotice(t("editor_menu.copy_failed"));
    });
  },

  /** Un avviso di «Incolla codice» senza finestra: il fuoco torna alla tela, dove si era. */
  _pasteNotice(this: CanvasEngine, text: string): void {
    this._showNotice(text);
    if (!this._destroyed) this._viewport.focus({ preventScroll: true });
  },

  /** Il controllo del nucleo, o `null` se il nucleo è morto (allora la tela si riapre) o rifiuta la chiamata. */
  _checkCode(this: CanvasEngine, ops: readonly unknown[], seed: bigint): CanvasCheckReport | null {
    const core = this._core;
    if (!core) return null;
    try {
      return core.check(ops, seed);
    } catch (error) {
      if (lostCore(error)) {
        this._lose();
        return null;
      }
      if (error instanceof CanvasCoreError) {
        this._pasteNotice(t("canvas.change_refused"));
        return null;
      }
      throw error;
    }
  },

  /**
   * «Incolla codice» (LIC T25): legge il testo degli appunti una volta come
   * lista (`readCodeList`), e dà lo stesso valore al controllo del nucleo
   * (`canvas_check`) e poi alla scrittura, con lo stesso seme: gli id nati
   * sono quelli del riassunto. Se la lista nomina schede, archi o tratti che
   * la lavagna ha già, la finestra offre «Aggiorna le schede» e «Aggiungi
   * come copie» (`code-paste.ts`); se no «Incolla». Un passo d'annulla in
   * ogni caso. Un problema, appunti vuoti o una lista che non cambia niente
   * li dice l'avviso, senza finestra; Esc o «Annulla» non scrivono.
   */
  async _pasteCode(this: CanvasEngine): Promise<void> {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    // L'avviso di un incolla di prima non resta dietro la finestra di questo.
    if (this._intakeError) this._showNotice("");
    let text: string;
    try {
      text = await clipboardText();
    } catch {
      if (!this._destroyed) this._pasteNotice(t("editor_menu.paste_failed"));
      return;
    }
    if (this._destroyed || this._readOnly || !this._core || !this._doc || this._isSceneOversized()) return;
    const read = readCodeList(text);
    if (!read.ok) {
      this._pasteNotice(codeTextProblem(read.problem));
      return;
    }
    this._recordPending();
    const doc = this._doc;
    const clashes = codeClashes(doc, read.ops);
    if (!clashes.ok) {
      const { index, id, kind } = clashes.kind;
      this._pasteNotice(t("canvas.paste_code.kind", {
        n: String(index + 1), id, kind: t(`canvas.paste_code.kind.${kind}` as Key),
      }));
      return;
    }
    const seed = this._seed();
    const source = this._source;
    // Le copie cadono come un Ctrl+V: il punto si prende ora, dov'era il puntatore.
    const spot = this._pasteSpot(text);
    const choices: PasteChoice[] = [];
    if (!clashes.clashes) {
      const report = this._checkCode(read.ops, seed);
      if (!report) return;
      if (!report.ok || !report.summary) {
        this._pasteNotice(checkProblemText(report.problems[0]));
        return;
      }
      const said = summaryText(report.summary);
      if (said === "") {
        this._pasteNotice(t("canvas.paste_code.nothing"));
        return;
      }
      choices.push({ id: "paste", ops: read.ops, said, report });
    } else {
      const update = asUpdates(doc, read.ops);
      const copies = asCopies(doc, read.ops, seed, placedAt(spot.at));
      for (const [id, ops, updated] of [["update", update.ops, update.updated], ["copies", copies, new Set<string>()]] as const) {
        const report = this._checkCode(ops, seed);
        if (!report) return;
        const said = report.ok && report.summary ? summaryText(report.summary, updated) : "";
        choices.push({ id, ops, said, report });
      }
      if (choices.every((choice) => choice.said === "")) {
        const refused = choices.find((choice) => !choice.report.ok);
        this._pasteNotice(refused ? checkProblemText(refused.report.problems[0]) : t("canvas.paste_code.nothing"));
        return;
      }
    }
    const chosen = await this._confirmPaste(choices, clashes.clashes);
    if (!chosen || this._destroyed) return;
    // Intanto la lavagna può essere cambiata (un altro riquadro, il disco), o
    // diventata di sola lettura o troppo grande: il riassunto non dice più il
    // vero, e non si scrive. Mai il silenzio.
    if (this._readOnly || this._isSceneOversized() || !this._doc) {
      this._pasteNotice(t("canvas.paste_code.locked"));
      return;
    }
    if (this._source !== source) {
      this._pasteNotice(t("canvas.paste_code.changed"));
      return;
    }
    const created = this._writeOps(chosen.ops as CanvasIntentOp[], "canvas.change_refused", seed);
    if (!created || this._destroyed || !this._doc) return;
    if (chosen.id === "copies") this._lastPaste = spot.last;
    const born = new Set(this._doc.nodes.map((node) => node.id));
    const cards = created.filter((id) => born.has(id));
    if (cards.length > 0) {
      this._selection = cards;
      this._edgeSelection = [];
      this._displaySelection();
      this._options.onSelectionChange();
    }
  },

  /**
   * La conferma di «Incolla codice»: il riassunto di ogni scelta e gli
   * avvisi. Senza id presi una scelta, «Incolla»; con id presi «Aggiorna le
   * schede» (proposta) e «Aggiungi come copie», ognuna col suo riassunto, o
   * col suo problema e senza bottone se non si può. «Annulla» di serie, Esc
   * come «Annulla».
   */
  _confirmPaste(this: CanvasEngine, choices: readonly PasteChoice[], clashes: CodeClashes | null): Promise<PasteChoice | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const sentences: string[] = [];
    const usable = choices.filter((choice) => choice.said !== "");
    if (!clashes) sentences.push(t("canvas.paste_code.description", { summary: choices[0]!.said }));
    else {
      const named = [
        [clashes.cards.length, "cards"], [clashes.edges.length, "edges"], [clashes.strokes, "strokes"],
      ] as const;
      const list = named.filter(([count]) => count > 0)
        .map(([count, what]) => plural(count, `canvas.paste_code.count.${what}.one` as Key, `canvas.paste_code.count.${what}` as Key));
      sentences.push(t("canvas.paste_code.clash", { list: list.join(", ") }));
      for (const choice of choices) {
        const problem = choice.report.ok ? null : choice.report.problems[0];
        const summary = problem
          ? t("canvas.paste_code.option_refused", { n: String((problem.index ?? 0) + 1), problem: problemPhrase(problem) })
          : choice.said || t("canvas.paste_code.option_nothing");
        sentences.push(t(choice.id === "update" ? "canvas.paste_code.as_update" : "canvas.paste_code.as_copies", { summary }));
      }
    }
    // Gli avvisi della scelta proposta (la prima che si può).
    const first = usable[0];
    const warnings = first ? warningsText(first.report.warnings, first.report.warnings_omitted) : "";
    if (warnings !== "") sentences.push(warnings);
    const labels: Readonly<Record<PasteChoice["id"], Key>> = {
      paste: "canvas.paste_code.action",
      update: "canvas.paste_code.update",
      copies: "canvas.paste_code.copies",
    };
    const handle = openDialog<PasteChoice | null>({
      title: t("canvas.paste_code.title"),
      description: sentences.join(" "),
      actions: [
        { id: "cancel", label: t("app.cancel"), value: null, autofocus: true },
        // Prima le copie, poi la proposta, che è il bottone pieno in fondo.
        ...[...usable].reverse().map((choice, index, all) => ({
          id: choice.id,
          label: t(labels[choice.id]),
          value: choice,
          ...(index === all.length - 1 ? { kind: "primary" as const } : {}),
        })),
      ],
      dismissValue: null,
      lifetime: own,
    });
    return handle.result.then((chosen) => {
      own.close();
      return chosen;
    });
  },

  /** Un PDF che non si apre: «Spargi le pagine» si spegne, finché il file non cambia (T72). */
  _markBroken(this: CanvasEngine, path: string): void {
    if (this._destroyed || this._pdfBroken.has(path)) return;
    const stop = this._options.cards?.watch(path, () => this._forgetBroken(path));
    this._pdfBroken.set(path, stop ?? (() => {}));
  },

  /** Il file di un PDF guasto è cambiato, è tornato o si è aperto: il comando torna acceso. */
  _forgetBroken(this: CanvasEngine, path: string): void {
    const stop = this._pdfBroken.get(path);
    if (stop === undefined) return;
    this._pdfBroken.delete(path);
    stop();
  },

  /**
   * Toglie le schede `nodes` e le linee `edges`, con le linee che le tengono,
   * e i tratti `strokes` del livello della radice: un commit solo, che un
   * annulla riporta. `false` se non c'era niente da togliere, o se un tratto
   * non si toglie (allora non si toglie niente).
   */
  _removeNodes(this: CanvasEngine, nodes: readonly string[], edges: readonly string[], strokes: readonly string[] = []): boolean {
    if (!this._doc) return false;
    if (strokes.length === 0) return this._writeOps(this._removeOps(nodes, edges)) !== null;
    // Il taglia del Lazo, coi tratti liberi: un gesto degli appunti (T24),
    // con `erase_strokes` e `remove` in una lista sola.
    const ops: CanvasIntentOp[] = [{ op: "erase_strokes", layer: "board", ids: [...strokes] }];
    ops.push(...(this._removeOps(nodes, edges) ?? []));
    return this._writeOps(ops, null) !== null;
  },

  /**
   * `remove` delle schede `nodes` e dei fili `edges` che ci sono (i fili che
   * toccano una scheda tolta li toglie il nucleo); `null` se nessuno c'è.
   */
  _removeOps(this: CanvasEngine, nodes: readonly string[], edges: readonly string[]): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const cards = new Set(doc.nodes.map((node) => node.id));
    const wires = new Set(doc.edges.map((edge) => edge.id));
    const ids = [...new Set([...nodes.filter((id) => cards.has(id)), ...edges.filter((id) => wires.has(id))])];
    return ids.length > 0 ? [{ op: "remove", ids }] : null;
  },

  _reorderSelection(this: CanvasEngine, where: "front" | "back"): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._reorderOps(where));
  },

  /** `reorder` delle schede scelte, nell'ordine in cui sono state scelte. */
  _reorderOps(this: CanvasEngine, where: "front" | "back"): CanvasIntentOp[] | null {
    const ids = this._selectedNodes().map((node) => node.id);
    if (ids.length === 0) return null;
    return [where === "front" ? { op: "reorder", ids } : { op: "reorder", ids, to: "back" }];
  },
};
export type ClipboardMethods = typeof clipboardMethods;
