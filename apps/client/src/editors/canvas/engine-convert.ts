// Il motore della lavagna: convertire una scheda (in nota, in file). Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { searchedName } from "../../rules/searched-name";
import { cardKindOf } from "../core/cards/contract";
import { withTextStyle } from "./text-style";
import { openDialog, textField } from "../../kit";
import { PARTS_KEY } from "./parts";
import { cardTarget } from "./sources";
import { type PartsHeading } from "./parts-picker";
import { noteExcerptOf, noteSectionsText, sectionHeading } from "./excerpt";
import { newNodeId } from "./operation";
import { type CanvasNode } from "./model";
import { linkedCardPlacement, nearestSides, sidePoint } from "./edges";
import { type CanvasIntentOp } from "./wasm/core";
import { MAX_CARD_TEXT_BYTES, utf8 } from "./engine-options";
import { CardLink } from "./engine-parts";
import { snap, TEXT_CARD_HEIGHT, NEXT_CARD_GAP, freeSpot, isVaultPath } from "./engine-geometry";
import { setOp, proposedNoteName, noteDisplayName } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const convertMethods = {
  // --- convertire (T70) ---------------------------------------------------------

  /** La cartella della lavagna nel vault, `""` alla radice: lì nascono le note estratte. */
  _boardFolder(this: CanvasEngine): string {
    const id = (this._options.documentId ?? "").replace(/^\/+/, "");
    const cut = id.lastIndexOf("/");
    return cut < 0 ? "" : id.slice(0, cut);
  },

  /**
   * «Estrai in una nota» (T70): chiede il nome (proposto dalla prima riga,
   * libero nella cartella della lavagna), fa nascere la nota col testo e
   * mette al posto della scheda di testo una scheda di file su di lei, con lo
   * stesso id: posto, misura, colore, fili e inchiostro restano. Un commit, un
   * annulla; la nota resta nel vault anche annullando, e la notifica lo dice.
   */
  async _extractNote(this: CanvasEngine, id: string): Promise<void> {
    const notes = this._options.notes;
    if (!notes || this._readOnly || this._destroyed || !this._doc) return;
    // Il testo che si sta scrivendo nella scheda va nella nota.
    if (!this._closeField(false)) return;
    const node = this._doc?.nodes.find((one) => one.id === id);
    if (node?.type !== "text") return;
    const text = node.text ?? "";
    const folder = this._boardFolder();
    const proposed = await notes.freeName(folder, proposedNoteName(text));
    if (this._destroyed || this._readOnly) return;
    const name = await this._askNoteName(proposed, folder);
    if (name === null || this._destroyed || this._readOnly) return;
    // La scheda è cambiata mentre si sceglieva il nome: nessuna nota nasce.
    const before = this._doc?.nodes.find((one) => one.id === id);
    if (before?.type !== "text" || (before.text ?? "") !== text) return;
    const path = await notes.create(folder, name, text);
    const opened = (): void => {
      void Promise.resolve(this._options.onOpenPath?.(`/${path.replace(/^\/+/, "")}`, this._options.documentId))
        .catch((error: unknown) => this._showIntakeError(error));
    };
    const shown = noteDisplayName(path);
    const open = { label: t("canvas.extract.open"), hint: t("canvas.extract.open_hint", { name: shown }), run: opened };
    const current = this._doc?.nodes.find((one) => one.id === id);
    if (this._destroyed || this._readOnly || !this._doc || current?.type !== "text" || (current.text ?? "") !== text) {
      // La nota c'è, la scheda no (o è cambiata): la scheda resta com'è, e la notifica lo dice.
      if (!this._destroyed) notify(t("canvas.extract.stale", { name: shown }), "info", open);
      return;
    }
    // La nota c'è: la scheda diventa sua con `convert` (id, posto, fili e
    // inchiostro restano). Se il nucleo la rifiuta l'avviso è uno solo,
    // `canvas.extract.stale`: dice che la nota c'è e la apre.
    if (!this._writeOps([{ op: "convert", id, file: path }], null)) {
      notify(t("canvas.extract.stale", { name: shown }), "info", open);
      return;
    }
    this._statusSettle();
    notify(t("canvas.extract.done", { name: shown }), "info", open);
  },

  /**
   * Il nome della nota da estrarre (T70), con `proposed` già scritto: `null`
   * se si rinuncia. Il nome che si conferma è pulito come quello di una nota
   * nuova (`searchedName`); un nome fatto solo di caratteri vietati non chiude
   * il dialogo.
   */
  _askNoteName(this: CanvasEngine, proposed: string, folder: string): Promise<string | null> {
    const own = openLifetime();
    this._life.add(() => own.close());
    const field = textField({
      label: t("canvas.extract.field"),
      value: proposed,
      lifetime: own,
    });
    const handle = openDialog<"extract" | "cancel">({
      title: t("canvas.extract.title"),
      description: folder === ""
        ? t("canvas.extract.description_root")
        : t("canvas.extract.description", { folder }),
      body: field.element,
      actions: [
        { id: "cancel", label: t("app.cancel"), value: "cancel" },
        { id: "extract", label: t("canvas.extract.action"), kind: "primary", value: "extract" },
      ],
      dismissValue: "cancel",
      lifetime: own,
      submit: "extract",
      confirm: (value) => value === "cancel" || searchedName(field.value()) !== null,
    });
    return handle.result.then((value) => {
      own.close();
      return value === "extract" ? searchedName(field.value()) : null;
    });
  },

  /**
   * «Copia il testo qui» (T70): una scheda di testo col testo della nota (di
   * un estratto, le sole sezioni mostrate: T99), accanto alla sua scheda, al
   * primo posto libero; la nota non cambia. Larga
   * come la scheda della nota, alta come lei ma non più della vista: una
   * nota lunga scorre dentro la scheda. Un commit, un annulla.
   */
  async _copyNoteText(this: CanvasEngine, id: string): Promise<void> {
    const notes = this._options.notes;
    if (!notes || this._readOnly || this._destroyed || !this._doc) return;
    const node = this._doc.nodes.find((one) => one.id === id);
    if (!node || cardKindOf(node) !== "note") return;
    const path = cardTarget(node).path;
    const epoch = this._epoch;
    // Di un estratto serve anche il sommario del provider (i titoli col loro
    // byte), chiesto insieme al testo; senza, si copia la nota intera.
    const parts = this._options.parts;
    const outline: Promise<readonly PartsHeading[] | null> = noteExcerptOf(node) && parts
      ? parts.outline(path).catch(() => null)
      : Promise.resolve(null);
    const [whole, headings] = await Promise.all([notes.read(path), outline]);
    if (this._destroyed || this._readOnly || !this._doc || this._epoch !== epoch) return;
    const source = this._doc.nodes.find((one) => one.id === id);
    if (!source || cardKindOf(source) !== "note" || cardTarget(source).path !== path) return;
    // Una scheda-estratto (T75) copia solo le sezioni che mostra (T99), nel
    // suo ordine; una sezione sparita dalla nota non si copia. Se non ne resta
    // nessuna non nasce niente, e la lavagna dice quali mancano. Se il
    // sommario non arriva, o non combacia col testo, la nota intera.
    let text = whole;
    const excerpt = noteExcerptOf(source);
    const shown = excerpt && headings ? noteSectionsText(whole, headings, excerpt.sections) : null;
    if (excerpt && shown) {
      if (shown.missing.length === excerpt.sections.length) {
        const names = shown.missing.map((key) => sectionHeading(key) ?? key);
        this._showNotice(names.length === 1
          ? t("canvas.excerpt.section_missing", { name: names[0]! })
          : t("canvas.excerpt.sections_missing", { names: names.join(", ") }));
        return;
      }
      text = shown.text;
    }
    if (utf8.encode(text).length > MAX_CARD_TEXT_BYTES) {
      this._showNotice(t("canvas.card_too_long"));
      return;
    }
    const card = this._writeOps(this._copyNoteTextOps(source, text))?.[0];
    if (card === undefined) return;
    this._selection = [card];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    this._displaySelection();
    this._statusSettle();
  },

  /**
   * L'`add_card` di «Copia il testo qui»: il testo `text` accanto alla scheda
   * della nota `source`, al primo posto libero di `freeSpot` (a
   * `NEXT_CARD_GAP` e scendendo sotto una scheda che c'è già, come la scheda
   * dopo, T44); larga come lei, alta come lei ma non più della vista. Il posto
   * è scritto: `near` del nucleo lascia 48 a destra e scivola con la misura di
   * nascita (rapporto di T23).
   */
  _copyNoteTextOps(this: CanvasEngine, source: CanvasNode, text: string): CanvasIntentOp[] | null {
    const doc = this._doc;
    if (!doc) return null;
    const { view } = this._viewRect();
    const height = Math.max(TEXT_CARD_HEIGHT, Math.min(source.height, Math.floor(view.height)));
    const spot = freeSpot(doc.nodes, { x: source.x + source.width + NEXT_CARD_GAP, y: source.y, width: source.width, height });
    return [{ op: "add_card", text, ...spot }];
  },

  /**
   * «Sostituisci il file…» (T70): il selettore dei file di sempre, e la
   * scheda punta al file scelto. Tiene id, posto, misura, colore, fili e
   * inchiostro; perde ciò che era del file di prima (la sezione o la pagina,
   * le parti). Con un file di un'altra specie la scheda cambia specie;
   * l'inchiostro (`fub:ink` della scheda) resta com'era e si disegna con la
   * regola della specie nuova (`inkFitMode`). Un commit, un annulla.
   */
  async _replaceFile(this: CanvasEngine, id: string): Promise<void> {
    const pick = this._options.onPickFile;
    if (!pick || this._readOnly || this._destroyed || !this._doc) return;
    const node = this._doc.nodes.find((one) => one.id === id);
    if (node?.type !== "file") return;
    const chosen = await pick();
    if (!isVaultPath(chosen) || this._destroyed || this._readOnly || !this._doc) return;
    const current = this._doc.nodes.find((one) => one.id === id);
    if (current?.type !== "file" || current.file === chosen) return;
    if (this._writeOps(this._replaceFileOps(current, chosen))) this._statusSettle();
  },

  /** La `set` che punta la scheda di file `node` a `file`, togliendo la sezione o la pagina e le parti di prima. */
  _replaceFileOps(this: CanvasEngine, node: CanvasNode, file: string): CanvasIntentOp[] | null {
    const next: CanvasNode = { ...node, file };
    delete next.subpath;
    delete next[PARTS_KEY];
    const op = setOp(node, next);
    return op ? [op] : null;
  },

  async _addFileNode(this: CanvasEngine, at?: { x: number; y: number }): Promise<void> {
    const pick = this._options.onPickFile;
    if (!pick || this._readOnly || this._destroyed || !this._doc) return;
    const source = this._source;
    const epoch = this._epoch;
    const path = await pick();
    if (!isVaultPath(path) || this._destroyed || this._readOnly || source !== this._source
      || this._epoch !== epoch) return;
    this._addNode("file", path, at);
  },

  /** Una card nuova al centro della vista, o in `at` (coordinate del mondo);
   *  una card file vuole il suo `file`. Torna la card messa, o `null`. */
  _addNode(this: CanvasEngine, type: CanvasNode["type"], file?: string, at?: { x: number; y: number }, link?: CardLink): CanvasNode | null {
    if (!this._doc || this._readOnly || (type === "file" && !file)) return null;
    if (!link) {
      // Dal menu, dalla barra o dallo strumento Testo: la sua `add_card` (T23).
      const id = this._writeOps(this._addOps(type, file, at))?.[0];
      const node = id === undefined ? undefined : this._doc?.nodes.find((one) => one.id === id);
      if (!node) return null;
      this._selection = [node.id];
      this._edgeSelection = [];
      this._options.onSelectionChange();
      return node;
    }
    // Collegata (T67): la scheda nasce col filo dal gesto di Collega (T24).
    const rect = this._viewport.getBoundingClientRect();
    const width = type === "group" ? 480 : 320;
    const height = type === "group" ? 320 : type === "link" ? 120 : 160;
    // Collegata (T67): il lato verso l'altro capo cade sotto il puntatore.
    const source = link ? this._doc.nodes.find((one) => one.id === link.from) : undefined;
    const anchor = source && (link?.fromSide
      ? sidePoint(source, link.fromSide)
      : { x: source.x + source.width / 2, y: source.y + source.height / 2 });
    const facing = anchor && at ? linkedCardPlacement(anchor, at, width, height) : null;
    const center = facing
      ? { x: facing.x + 160, y: facing.y + 80 }
      : at
      ? { x: at.x + 160, y: at.y + 80 }
      : this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const born: CanvasNode = {
      id: this._newId(),
      type,
      x: snap(center.x - 160),
      y: snap(center.y - 80),
      width,
      height,
      ...(type === "text" ? { text: "" } : {}),
      ...(type === "file" ? { file } : {}),
      ...(type === "link" ? { url: "https://" } : {}),
      ...(type === "group" ? { label: "" } : {}),
    };
    // Una scheda dello strumento Testo nasce con la misura e l'allineamento
    // scelti nella sua riga (T92).
    const node = (type === "text" && this._tool === "text" ? withTextStyle(born, this._textNext) : null) ?? born;
    // La scheda con il suo `id`, poi il filo verso di lei, in una lista sola
    // (T24): un passo d'annulla.
    const ops: CanvasIntentOp[] = [{ op: "add_card", node: { ...node } }];
    if (source && facing) {
      const fromSide = link?.fromSide ?? nearestSides(node, source, facing.side).toSide;
      const edge = this._connectOps(source.id, node.id, { from: fromSide, to: facing.side }, node.id);
      if (edge) ops.push(...edge);
    }
    const id = this._writeOps(ops)?.[0];
    const placed = id === undefined ? undefined : this._doc?.nodes.find((one) => one.id === id);
    if (!placed) return null;
    this._selection = [placed.id];
    this._edgeSelection = [];
    this._options.onSelectionChange();
    return placed;
  },

  /**
   * L'id di una scheda che un gesto fa nascere e che le operazioni della
   * stessa lista nominano (il filo verso di lei, la griglia del rilascio):
   * quello di `newId` delle opzioni, o uno a caso (T24).
   */
  _newId(this: CanvasEngine): string {
    return this._options.newId?.() ?? newNodeId("n");
  },

  /**
   * La `add_card` di una scheda nuova dal menu, dalla barra o dallo strumento
   * Testo: al centro della vista, o in `at` (coordinate del mondo), con la
   * misura di sempre della GUI per il tipo (scritta, così non cambia con la
   * specie del file). Una scheda dello strumento Testo nasce con la misura e
   * l'allineamento scelti nella sua riga (T92): allora la forma intera, che
   * porta `fub:text`. `null` senza una lavagna, o un file senza percorso.
   */
  _addOps(this: CanvasEngine, type: CanvasNode["type"], file?: string, at?: { x: number; y: number }): CanvasIntentOp[] | null {
    if (!this._doc || (type === "file" && !file)) return null;
    const rect = this._viewport.getBoundingClientRect();
    const width = type === "group" ? 480 : 320;
    const height = type === "group" ? 320 : type === "link" ? 120 : 160;
    const center = at
      ? { x: at.x + 160, y: at.y + 80 }
      : this._screenToWorld(rect.left + (rect.width || 800) / 2, rect.top + (rect.height || 600) / 2);
    const place = { x: snap(center.x - 160), y: snap(center.y - 80), width, height };
    if (type === "text" && this._tool === "text") {
      const styled = withTextStyle({ id: "", type, ...place, text: "" }, this._textNext);
      if (styled) {
        const { id: _id, ...node } = styled;
        return [{ op: "add_card", node }];
      }
    }
    switch (type) {
      case "text": return [{ op: "add_card", text: "", ...place }];
      case "file": return [{ op: "add_card", file, ...place }];
      case "link": return [{ op: "add_card", url: "https://", ...place }];
      case "group": return [{ op: "add_card", label: "", ...place }];
    }
  },

  _duplicateSelection(this: CanvasEngine): void {
    if (!this._doc || this._readOnly) return;
    const nodes = this._selectedNodes();
    const created = this._writeOps(this._duplicateOps());
    if (!created) return;
    // Le schede copiate vengono prima dei fili fra loro (`created`).
    const copies = created.slice(0, nodes.length);
    this._lastDuplicate = { sources: nodes.map((node) => node.id), copies };
    this._selection = copies;
    this._edgeSelection = [];
    this._options.onSelectionChange();
  },

  /**
   * `duplicate` delle schede scelte, con i fili fra loro (D1). Le copie
   * dell'ultimo Ctrl+D ripetono il suo spostamento (T68); se no lo
   * spostamento di serie del nucleo, 32 e 32 agganciato a 8.
   */
  _duplicateOps(this: CanvasEngine): CanvasIntentOp[] | null {
    const nodes = this._selectedNodes();
    if (nodes.length === 0) return null;
    const ids = nodes.map((node) => node.id);
    const repeat = this._repeatedOffset(nodes);
    return [repeat ? { op: "duplicate", ids, dx: repeat.x, dy: repeat.y } : { op: "duplicate", ids }];
  },
};
export type ConvertMethods = typeof convertMethods;
