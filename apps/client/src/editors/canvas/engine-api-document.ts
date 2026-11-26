// Il motore della lavagna: i metodi pubblici del documento (aprire, seguire,
// leggere, scrivere, annullare). Metodi della classe `CanvasEngine`, montati
// sul suo prototipo da `engine.ts` (`editors/core/mix-methods.ts`).
import type { Theme } from "../../theme/theme";
import type { SyntaxForm } from "../../host/contract";
import { type TextOperation } from "../core/text-operation";
import { type CanvasPatch } from "./operation";
import { type CanvasDocument } from "./model";
import { lostCore } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const documentApi = {
  /**
   * Apre il testo `source` nel nucleo, da capo: la storia dell'annulla
   * ricomincia. Un testo che il nucleo non apre lancia, e la tela resta com'era.
   */
  setDoc(this: CanvasEngine, source: string): void {
    if (this._destroyed) return;
    // Il testo in sospeso è del documento di prima: si registra lì.
    this._closeField(true);
    const document = this._open(source);
    // La vista di prima si scrive adesso, poi si legge quella ricordata
    // (T36): arriva dopo, e prende ciò che nessuno ha toccato.
    const remembered = this._viewMemo?.begin();
    const viewRound = ++this._viewRound;
    this._openView = null;
    this._heldView = null;
    if (remembered) void remembered.then((view) => this._restoreView(viewRound, view));
    // Un documento nuovo: la risposta di prima era dell'altro testo.
    if (this._unwritable) {
      this._unwritable = false;
      this._root.dataset.readOnly = String(this._readOnly);
    }
    this._epoch++;
    this._cancelGestures();
    // Un documento nuovo: il menu radiale era dell'altro (T63).
    this._radial?.close();
    this._lastTap = null;
    // Un documento nuovo: il tratto in corso era dell'altro.
    this._inkLayer?.cancel();
    this._inkChain = null;
    this._source = source;
    this._version = ++this._versions;
    this._doc = document;
    this._intakeError = "";
    this._removal = null;
    this._connectFrom = null;
    // Un documento nuovo: si esce dalla scheda dell'altro.
    this._leaveCard(false, false);
    this._selection = [];
    this._edgeSelection = [];
    this._undo = [];
    this._redo = [];
    this._inkOverField = [];
    this._inkOverFieldRedo = [];
    this._statusSettle();
    this._syncEmpty();
    if (!document) {
      void this._revive();
      return;
    }
    this._checkWritable();
    this._fitCamera(false);
    this._render();
    this._markOpenView();
  },

  /**
   * Il testo cambiato da un'altra parte (un'altra superficie, un altro
   * programma). Il campo aperto resta aperto, e il suo testo in sospeso si
   * registra subito dopo, sulla scheda com'è nel testo nuovo.
   */
  syncDoc(this: CanvasEngine, update: { readonly text: string; readonly operation: TextOperation | null } | string): void {
    if (this._destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    const document = this._open(source);
    this._cancelGestures();
    this._epoch++;
    this._intakeError = "";
    // Lo stesso testo (l'eco di un commit di qui) lascia valida la via del tratto.
    const changed = source !== this._source;
    if (changed) this._version = ++this._versions;
    // Un testo cambiato altrove è una modifica dopo il togliere (T17).
    if (changed) this._removal = null;
    this._source = source;
    if (!document) {
      void this._revive();
      return;
    }
    this._doc = document;
    // Lo stesso testo si riscrive come prima: la domanda serve solo a un testo nuovo.
    if (changed) this._checkWritable();
    this._pruneSelection();
    // Modello e sorgente sono già quelli nuovi; il ridisegno, con una penna
    // giù, aspetta che si alzi (A9). Il tratto in corso non si perde: la
    // scheda si sceglie sul documento del momento in cui la penna si alza.
    this._quiet.defer("render", () => {
      if (!this._destroyed) this._render();
    });
    // Fuori dalla consegna che ci ha portato il testo: la sessione la sta
    // ancora facendo agli altri riquadri.
    if (this._pending) queueMicrotask(() => this._deferPending());
  },

  getDoc(this: CanvasEngine): string {
    return this._source;
  },

  /**
   * La scelta adesso, per l'ispettore (T59): le id delle schede e dei fili.
   * Sono copie: chi le legge non cambia la scelta.
   */
  selection(this: CanvasEngine): { readonly nodes: readonly string[]; readonly edges: readonly string[] } {
    return { nodes: [...this._selection], edges: [...this._edgeSelection] };
  },

  /** Il modello della lavagna adesso, per l'ispettore (T59); `null` senza lavagna. */
  doc(this: CanvasEngine): CanvasDocument | null {
    return this._doc;
  },

  /**
   * Un gesto dell'ispettore (T59): le toppe fanno un commit solo, col suo
   * annulla, come un gesto della tela. Senza lavagna o in sola lettura non
   * cambia niente, come gli altri gesti.
   */
  commitPatches(this: CanvasEngine, patches: readonly CanvasPatch[]): void {
    if (patches.length === 0) return;
    this._commit(patches, "input");
  },

  /**
   * Brings into view the card whose source holds `byteOffset` (UTF-8 bytes,
   * the currency of the model's spans): selects it and frames it. `false`
   * when the offset is outside every card, or the scene is too large to draw.
   *
   * Con `"jump"` (l'ispettore, «Schede» e «Fonti», T99) la vista ci va come
   * ogni salto (`_jumpCamera`): vola, e Indietro torna da dove si era. Con
   * `"frame"` (la shell, l'apertura a un punto) la camera si mette lì e basta.
   */
  revealSource(this: CanvasEngine, byteOffset: number, how: "frame" | "jump" = "frame"): boolean {
    if (this._destroyed || !this._doc || !this._core || this._isSceneOversized()) return false;
    let index: number | null;
    try {
      index = this._core.nodeAt(byteOffset);
    } catch (error) {
      if (lostCore(error)) this._lose();
      return false;
    }
    const node = index === null ? undefined : this._doc.nodes[index];
    if (!node) return false;
    this._closeField(false);
    this._cancelGestures();
    this._selection = [node.id];
    this._edgeSelection = [];
    if (how === "jump") this._jumpCamera(this._fitTarget([node]));
    else this._fitCamera(false, [node]);
    this._render();
    this._viewport.focus();
    this._options.onSelectionChange();
    return true;
  },

  setReadOnly(this: CanvasEngine, readOnly: boolean): void {
    // In sola lettura il campo si chiude comunque: ciò che non si registra
    // l'avviso l'ha già detto.
    this._closeField(readOnly);
    this._cancelGestures();
    this._panelReadOnly = readOnly;
    this._root.dataset.readOnly = String(this._readOnly);
    this._render();
    this._statusSettle();
  },

  setTheme(this: CanvasEngine, theme: Theme): void {
    this._root.dataset.theme = theme;
    // I campioni che si leggono poco lo dicono per il tema di adesso (A23).
    this._penMenu.sync();
  },

  /**
   * Le sintassi del Markdown delle card, com'è montato in questo vault. Una
   * card in modifica tiene il suo editor: la resa nuova arriva col disegno
   * successivo.
   */
  setSyntaxForms(this: CanvasEngine, forms: readonly SyntaxForm[]): void {
    this._forms = forms;
    this._formsRound++;
    if (!this._editor) this._render();
  },

  /**
   * Annulla l'ultimo passo: il testo di prima byte per byte se nessuno l'ha
   * cambiato nel frattempo, se no le toppe inverse che il nucleo ha dato al
   * suo commit.
   */
  undo(this: CanvasEngine): boolean {
    // Con una penna giù annulla e ripeti non fanno niente (A5).
    if (this._penDown) return false;
    const editing = this._editor !== null;
    const born = this._editor?.born ? this._editor.id : null;
    if (!this._closeField(false)) return false;
    if (editing) this._render();
    // La scheda nuova lasciata vuota se n'è andata chiudendo: era lei da annullare (T44).
    if (born !== null && !this._doc?.nodes.some((node) => node.id === born)) return true;
    const step = this._undo.pop();
    if (!step || !this._doc) return false;
    if (this._replay(step, "undo", (again) => this._redo.push(again)) !== true) {
      this._undo.push(step);
      return false;
    }
    return true;
  },

  /** Rifà il passo annullato, con le stesse due vie dell'annulla. */
  redo(this: CanvasEngine): boolean {
    if (this._penDown) return false;
    const editing = this._editor !== null;
    if (!this._closeField(false)) return false;
    if (editing) this._render();
    const step = this._redo.pop();
    if (!step || !this._doc) return false;
    if (this._replay(step, "redo", (again) => this._pushUndo(again, false)) !== true) {
      this._redo.push(step);
      return false;
    }
    return true;
  },
};
export type DocumentApi = typeof documentApi;
