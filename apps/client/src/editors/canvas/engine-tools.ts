// Il motore della lavagna: gli strumenti, il mouse che scrive, il velo, il\n// menu della penna, la barra dei comandi. Metodi della\n// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import { commandForKey, isCommandSearchKey, toolOfCommand, type CanvasToolId } from "./chrome/commands";
import { CANVAS_INK_TOOLS, CANVAS_WRITING_TOOLS } from "./chrome/rail";
import { rememberRecent } from "./chrome/radial";
import { mountInkLayer } from "./ink-layer";
import { inkLook, inkStrokeTool, type InkPenChoice } from "./ink-record";
import {
  MAX_INTERACTIVE_EDGES,
  CanvasInkMouseMemory,
  SHARED_INK_MOUSE,
  CanvasPenMemory,
  SHARED_PEN,
} from "./engine-options";
import type { CanvasEngine } from "./engine";

export const toolsMethods = {
  /**
   * Monta lo strato della penna quando la lavagna si può cambiare e smontarlo
   * quando no (sola lettura del pannello o della tela, scena troppo grande,
   * lavagna chiusa: A8). Smontarlo annulla il tratto in corso: la scia sparisce.
   */
  _syncInkLayer(this: CanvasEngine): void {
    const wanted = !this._destroyed && this._doc !== null && !this._readOnly && !this._isSceneOversized();
    if (wanted === (this._inkLayer !== null)) return;
    if (!wanted) {
      const life = this._inkLife;
      this._inkGuides.clear();
      clearTimeout(this._shapeTimer);
      this._inkLayer = null;
      this._inkLife = null;
      this._inkChain = null;
      life?.close();
      this._inkTargetClose();
      this._eraseDrop();
      this._applyInkMouse();
      return;
    }
    const life = openLifetime();
    this._inkLife = life;
    this._inkLayer = mountInkLayer({
      viewport: this._viewport,
      toWorld: (clientX, clientY) => this._screenToWorld(clientX, clientY),
      // La penna scelta (A11 prima di ogni scelta) allo zoom di quando il
      // tratto comincia: una scelta a metà tratto vale dal tratto dopo.
      look: (input) => {
        const look = inkLook(this._penChoice, this._camera.zoom, input.pressure);
        this._inkTargetStarting(look.brush.size);
        return look;
      },
      // Lo strumento Gomma: la punta e il mouse che scrive cancellano (A21).
      tipErases: () => this._penChoice.tool === "eraser",
      // «Il dito scrive» (T64): letto a ogni appoggio.
      fingerWrites: () => this._fingerWritesSetting,
      quiet: this._quiet,
      mouse: this._inkMouseOn ? "ink" : "ignore",
      // Il righello, Maiusc e la penna ferma (T87).
      guide: (start) => this._inkGuideStart(start),
      onStroke: (stroke) => this._inkStroke(stroke),
      onCancel: (id) => {
        this._inkGuideDrop(id);
        this._inkTargetClose();
        this._eraseCancel(id);
      },
      onEraseStart: (id, pointerType) => this._eraseStart(id, pointerType),
      onErase: (id, points) => this._eraseAlong(id, points),
      onEraseEnd: (id) => this._eraseEnd(id),
      // Il tasto laterale (T63): la gomma, o ciò che dicono le Impostazioni.
      barrelErases: () => this._penButtonSetting === "eraser",
      onBarrel: (event) => this._barrelDown(event),
    }, life);
    this._inkLayer.setCamera(this._camera.x, this._camera.y, this._camera.zoom);
    this._applyInkMouse();
  },

  /**
   * Sceglie lo strumento (il comando `canvas.tool.<id>`, la colonna, il suo
   * tasto). In sola lettura gli strumenti che scrivono non si scelgono. Penna,
   * Evidenziatore e Gomma chiamano la penna del menu di N4 (la scelta si
   * ricorda come una scelta del menu) e fanno scrivere il mouse.
   */
  _pickTool(this: CanvasEngine, tool: CanvasToolId): void {
    if (this._destroyed) return;
    if (CANVAS_WRITING_TOOLS.has(tool) && (this._readOnly || this._isSceneOversized())) return;
    // Uno strumento scelto: l'interruttore ricordato non arriva più a cambiarlo.
    this._inkMouseTurns += 1;
    if (CANVAS_INK_TOOLS.has(tool) && this._penChoice.tool !== tool) {
      this._choosePen({ ...this._penChoice, tool: tool as InkPenChoice["tool"] }, true);
    }
    this._setTool(tool);
  },

  /**
   * «Collega…» (T17): il filo parte dalla scheda `id`, come dal pulsante →
   * della sua testata; il prossimo clic su un'altra scheda lo chiude. La
   * colonna mostra Collega finché il filo non c'è.
   */
  _beginConnectFrom(this: CanvasEngine, id: string): void {
    if (this._destroyed || this._readOnly || this._isSceneOversized()) return;
    if (!this._doc?.nodes.some((node) => node.id === id)) return;
    this._pickTool("connect");
    this._connectFrom = id;
  },

  /** Il pulsante «Mostra l'anteprima» della scheda di pagina web `id`, se c'è adesso. */
  _webPreviewButton(this: CanvasEngine, id: string): HTMLButtonElement | null {
    return this._cards.get(id)?.article.querySelector<HTMLButtonElement>(".canvas-card-web-preview") ?? null;
  },

  /** Lo strumento di adesso, mostrato nella colonna, sull'interruttore e sul viewport. */
  _setTool(this: CanvasEngine, tool: CanvasToolId): void {
    // Uno strumento scelto rinuncia al filo cominciato da «Collega…».
    this._connectFrom = null;
    // Lasciando il Lazo i tratti scelti non lo sono più: solo lui li sposta (T86).
    if (tool !== "lasso" && this._strokeSelection.size > 0) {
      this._strokeSelection = new Set();
      this._paintLasso();
      this._syncSelectionBar();
    }
    // Lo strumento di prima va fra i recenti del menu radiale (T63).
    if (tool !== this._tool) this._recentTools = rememberRecent(this._recentTools, tool, this._tool);
    this._tool = tool;
    this._inkMouseButton.setAttribute("aria-pressed", String(this._inkMouse));
    this._viewport.dataset.tool = tool;
    this._rail.sync();
    this._canvasOptions.sync();
    this._applyInkMouse();
  },

  /**
   * L'interruttore con cui la lavagna si apre: lo stato ricordato (spento con
   * «Ricorda se scrivi col mouse» spento), letto una volta sola, così un
   * cambio dell'impostazione a lavagna aperta vale dalla prossima apertura.
   * Arriva solo se nel frattempo nessuno ha toccato l'interruttore; una
   * lettura che non riesce lo lascia spento.
   */
  _restoreInkMouse(this: CanvasEngine, memory: CanvasInkMouseMemory): void {
    const turns = this._inkMouseTurns;
    void memory.read().then((on) => {
      if (on && !this._destroyed && turns === this._inkMouseTurns) this.setInkMouse(true);
    }, () => undefined);
  },

  /** Il clic sul pulsante: cambia l'interruttore e lo ricorda. */
  _toggleInkMouse(this: CanvasEngine): void {
    this.setInkMouse(!this._inkMouse);
    (this._options.inkMouseMemory ?? SHARED_INK_MOUSE).save(this._inkMouse);
  },

  /** D lasciato, la finestra senza fuoco o nascosta: il mouse torna com'era. */
  _releaseInkKey(this: CanvasEngine): void {
    if (!this._inkKeyDown) return;
    this._inkKeyDown = false;
    this._applyInkMouse();
  },

  /**
   * Dice allo strato che cosa fa il mouse, e lo mostra solo quando scrive
   * davvero (lo strato c'è): `data-ink="pen"`, o `"eraser"` con lo strumento
   * Gomma del menu, sul viewport; la croce (o la cella) la porta il velo
   * (T20d), mostrato solo con un mouse o una penna sospesa sopra la vista.
   * Ogni attributo si scrive solo se cambia.
   */
  _applyInkMouse(this: CanvasEngine): void {
    // Con Spazio tenuto il mouse sposta la vista (T53).
    const on = this._inkMouseOn && !this._spaceHeld;
    const layer = this._inkLayer;
    layer?.setMouse(on ? "ink" : "ignore");
    const ink = on && layer ? (this._penChoice.tool === "eraser" ? "eraser" : "pen") : null;
    if (ink === null) {
      if (this._viewport.dataset.ink !== undefined) delete this._viewport.dataset.ink;
    } else if (this._viewport.dataset.ink !== ink) {
      this._viewport.dataset.ink = ink;
    }
    const veil = this._penVeil;
    const shown = ink !== null && this._veilPointer;
    if (shown && veil.dataset.tool !== ink) veil.dataset.tool = ink;
    if (shown === veil.hasAttribute("data-idle")) veil.toggleAttribute("data-idle", !shown);
  },

  /**
   * Un mouse o una penna sospesa entra nella vista o ci si muove (`true`), la
   * penna esce dal raggio o un dito si appoggia (`false`): il velo della croce c'è solo per i
   * primi. Il dito non ha cursore, e sotto il velo non toccherebbe il
   * contenuto delle schede.
   */
  _setVeilPointer(this: CanvasEngine, over: boolean): void {
    if (this._veilPointer === over) return;
    this._veilPointer = over;
    this._applyInkMouse();
  },

  /**
   * Il puntatore passa su un altro elemento della vista (T20f). Sul velo della
   * croce la scheda di prima tiene l'aspetto del passaggio: il velo gliel'ha
   * tolto, ma il puntatore non se n'è andato. Durante un tratto il passaggio
   * va alla vista per la cattura, e non conta. Altrove il passaggio è quello
   * vero: la scheda sotto (o nessuna) e niente più da tenere, nello stesso
   * fotogramma in cui `:hover` torna, così la scheda non cambia aspetto.
   * Solo ai confini, mai a ogni movimento, e senza ricerche per punto.
   */
  _pointerOver(this: CanvasEngine, event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const target = event.target;
    if (target === this._penVeil) {
      this._holdHover(this._hoverCard);
      return;
    }
    if (this._penDown) return;
    this._hoverCard = target instanceof Element && this._stage.contains(target)
      ? target.closest<HTMLElement>(".canvas-node")
      : null;
    this._holdHover(null);
  },

  /** La scheda `card` tiene l'aspetto del passaggio (`data-hover-held`); `null` lo lascia. */
  _holdHover(this: CanvasEngine, card: HTMLElement | null): void {
    if (card === this._heldCard) return;
    this._heldCard?.removeAttribute("data-hover-held");
    this._heldCard = card;
    card?.setAttribute("data-hover-held", "");
  },

  /**
   * L'elemento in cima nel punto `clientX`, `clientY` della finestra come se
   * il velo della croce non ci fosse: le ricerche per punto della lavagna
   * (il menu, il filo, il deposito) guardano le schede, non il velo.
   */
  _elementAt(this: CanvasEngine, clientX: number, clientY: number): Element | null {
    const top = document.elementFromPoint?.(clientX, clientY) ?? null;
    if (top !== this._penVeil) return top;
    const stack = document.elementsFromPoint?.(clientX, clientY) ?? [];
    const at = stack.indexOf(this._penVeil);
    return at < 0 ? null : stack[at + 1] ?? null;
  },

  /**
   * Il bersaglio di un evento del puntatore come se il velo della croce non
   * ci fosse: ciò che c'è sotto il punto, cercato una volta per evento (la
   * vista se sotto non c'è niente). Un evento che non ha preso il velo dà il
   * suo bersaglio, senza ricerche.
   */
  _targetOf(this: CanvasEngine, event: MouseEvent): EventTarget | null {
    if (event.target !== this._penVeil) return event.target;
    let under = this._underVeil.get(event);
    if (under === undefined) {
      const found = this._elementAt(event.clientX, event.clientY);
      under = found !== null && this._viewport.contains(found) ? found : this._viewport;
      this._underVeil.set(event, under);
    }
    return under;
  },

  // --- il menu della penna (T21) -------------------------------------------

  /**
   * Una scelta del menu della penna: vale dal prossimo tratto o dalla
   * prossima passata (quelli in corso finiscono come sono cominciati). Una
   * scelta fatta (`settled`) si ricorda per le lavagne che si aprono dopo;
   * quelle aperte tengono la loro.
   */
  _choosePen(this: CanvasEngine, next: InkPenChoice, settled: boolean): void {
    if (this._destroyed) return;
    this._penTurns += 1;
    // Un colore nuovo va fra i recenti del menu radiale (T63), col colore di prima.
    const before = this._penColor;
    const after = next.color[inkStrokeTool(next)];
    if (after !== before) this._recentColors = rememberRecent(this._recentColors, after, before);
    this._penChoice = next;
    this._followPen();
    this._penMenu.sync();
    if (settled) (this._options.penMemory ?? SHARED_PEN).save(next);
  },

  /**
   * La penna cambiata: se il mouse scrive con la colonna, la colonna passa
   * allo strumento della penna (la Gomma del menu è la Gomma della colonna).
   */
  _followPen(this: CanvasEngine): void {
    if (this._inkMouse && this._tool !== this._penChoice.tool) this._setTool(this._penChoice.tool);
    else this._applyInkMouse();
  },

  /**
   * La penna con cui la lavagna si apre: quella ricordata, letta una volta.
   * Arriva solo se nel frattempo nessuno ha scelto; una lettura che non
   * riesce lascia quella di serie.
   */
  _restorePen(this: CanvasEngine, memory: CanvasPenMemory): void {
    const turns = this._penTurns;
    void memory.read().then((choice) => {
      if (this._destroyed || turns !== this._penTurns) return;
      this._penChoice = choice;
      this._followPen();
      this._penMenu.sync();
    }, () => undefined);
  },

  // --- toolbar ----------------------------------------------------------------

  _drawToolbar(this: CanvasEngine): void {
    // La barra di N4 si rifà da capo, salvo l'interruttore «Scrivi col
    // mouse», che resta lo stesso elemento in testa: il fuoco non si perde.
    // Ciò che è passato nella riga delle opzioni (T50: il menu della penna,
    // davanti e dietro, allinea e distribuisci, la Vista) non c'è più; il
    // resto aspetta i suoi task (la barra della selezione T51, i fili e il
    // colore esatto T47 e T59, la lavagna vuota T62). I controlli nascono in
    // `bar`, staccata, e passano alla barra del kit (`_toolbarBar`), che
    // lascia al suo posto chi c'è già e manda in «…» ciò che non ci sta.
    const bar = document.createElement("div");
    const inkMouse = this._inkMouseButton;
    this._penMenu.sync();
    // La colonna e la riga delle opzioni: lo strumento, la scelta e la sola
    // lettura di adesso.
    this._rail.sync();
    this._canvasOptions.sync();
    // «Scrivi col mouse», in testa.
    inkMouse.textContent = t("canvas.ink.mouse");
    inkMouse.title = t("canvas.ink.mouse_hint");
    inkMouse.setAttribute("aria-pressed", String(this._inkMouse));
    inkMouse.disabled = this._readOnly || this._isSceneOversized();
    const mk = (
      action: string,
      label: string,
      run: () => void,
      disabled = false,
      mutates = true,
      focusViewport = true,
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.canvasAction = action;
      button.textContent = label;
      button.disabled = disabled || (mutates && (this._readOnly || this._isSceneOversized()));
      button.addEventListener("click", (e) => {
        e.preventDefault();
        this._recordPending();
        run();
        if (focusViewport) this._viewport.focus();
      });
      bar.append(button);
      return button;
    };
    // La scheda nasce in scrittura (IMP-042): il fuoco va nel suo testo, non sulla vista.
    mk("add-text", t("canvas.add_text"), () => this._placeText(), false, true, false);
    if (this._options.onPickFile) {
      mk("add-file", t("canvas.add_file"), () => {
        void this._addFileNode().catch((error: unknown) => this._showIntakeError(error));
      });
    }
    mk("add-link", t("canvas.add_link"), () => this._addNode("link"));
    mk("add-group", t("canvas.add_group"), () => this._addNode("group"));
    const hasSelection = this._selection.length > 0 || this._edgeSelection.length > 0;
    mk("duplicate", t("canvas.duplicate"), () => this._duplicateSelection(), !hasSelection);
    mk("delete", t("canvas.delete"), () => this._deleteSelection(), !hasSelection);
    mk("fit-selection", t("canvas.fit_selection"), () => this._fitCamera(true, this._selectedNodes()), this._selection.length === 0, false);
    if (!this._isSceneOversized() && this._doc?.edges.length && this._doc.edges.length <= MAX_INTERACTIVE_EDGES) {
      const picker = document.createElement("select");
      picker.dataset.canvasField = "select-edge";
      picker.setAttribute("aria-label", t("canvas.select_edge"));
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = t("canvas.select_edge");
      picker.append(empty);
      for (const edge of this._doc.edges) {
        const option = document.createElement("option");
        option.value = edge.id;
        option.textContent = edge.label || edge.id;
        picker.append(option);
      }
      picker.value = this._edgeSelection[0] ?? "";
      picker.addEventListener("change", () => {
        this._edgeSelection = picker.value ? [picker.value] : [];
        this._selection = [];
        this._options.onSelectionChange();
        this._displaySelection();
        // Il campo del nome, se si vede; se è finito in «…», il fuoco va lì.
        const label = this._toolbar.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]');
        if (label && !label.closest("[hidden]")) label.focus();
        else this._toolbar.querySelector<HTMLElement>(".kit-options-more:not([hidden])")?.focus();
      });
      bar.append(picker);
    }
    // Il colore delle schede e dei fili non sta più qui: è nel menu «Colore»
    // del tasto destro e nel pozzo della riga delle opzioni (T47).
    if (!this._isSceneOversized() && this._edgeSelection.length === 1) this._drawEdgeInspector(bar);
    // Un avviso solo, nel suo posto all'inizio della barra, dove si legge
    // senza scorrere: quello dell'ultimo gesto, o la sola lettura della tela.
    // Una scena oltre il limite ha già il suo, nella tela.
    const head: HTMLElement[] = [];
    const notice = this._intakeError
      || (this._unwritable && !this._isSceneOversized() ? t("canvas.unwritable") : "");
    if (notice) {
      const error = document.createElement("output");
      error.setAttribute("role", "alert");
      error.className = "canvas-intake-error";
      error.textContent = notice;
      head.push(error);
    }
    // L'avviso di «Togli dalla lavagna» (T17), dopo quello dell'ultimo gesto
    // e dopo «Scrivi col mouse»: una notizia e non un guasto, con «Annulla»
    // accanto.
    const told: HTMLElement[] = [];
    const removal = this._removal;
    if (removal) {
      const said = document.createElement("output");
      said.setAttribute("role", "status");
      said.className = "canvas-removal";
      said.textContent = removal.text;
      told.push(said);
      if (removal.undo && removal.step !== undefined) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.dataset.canvasAction = "undo-removal";
        undo.textContent = t("app.undo");
        undo.title = t(removal.free ? "canvas.ink.moved_undo" : "canvas.card.removed_undo");
        // Il pulsante si rifà con la barra: l'ascolto se ne va con lui.
        undo.addEventListener("click", () => this._undoRemoval());
        told.push(undo);
        // I tratti passati a una scheda col Lazo (T86): «Rendilo libero».
        if (removal.free) {
          const free = document.createElement("button");
          free.type = "button";
          free.dataset.canvasAction = "free-ink";
          free.textContent = t("canvas.ink.make_free");
          free.title = t("canvas.ink.make_free_hint");
          free.addEventListener("click", () => this._freeMovedInk());
          told.push(free);
        }
      }
    }
    // Gli avvisi e i loro pulsanti restano nella riga più a lungo dei comandi
    // (priorità 1): si leggono senza aprire «…».
    const notices = new Set<HTMLElement>([...head, ...told]);
    const controls: HTMLElement[] = [...head, inkMouse, ...told, ...(bar.children as HTMLCollectionOf<HTMLElement>)];
    this._toolbarBar.setItems(controls.map((element, index) => {
      element.classList.add("canvas-toolbar-item");
      return {
        id: element.dataset.canvasAction ?? element.dataset.canvasField ?? `${element.className}-${index}`,
        element,
        priority: notices.has(element) ? 1 : 0,
      };
    }));
    this._toolbarKeys.refresh();
  },

  /**
   * Un tasto col fuoco sulla colonna: gli strumenti e la ricerca dei comandi
   * valgono anche qui; frecce, Invio e Spazio restano della colonna (il kit).
   */
  _railKeydown(this: CanvasEngine, event: KeyboardEvent): void {
    if (event.defaultPrevented || !this._doc || this._isSceneOversized()) return;
    if (isCommandSearchKey(event)) {
      event.preventDefault();
      this._openCommandSearch();
      return;
    }
    const tools = this.commands().filter((command) => toolOfCommand(command.id) !== null);
    const command = commandForKey(tools, event, { writing: false, onBoard: false });
    if (command) this._runKey(event, command);
  },
};
export type ToolsMethods = typeof toolsMethods;
