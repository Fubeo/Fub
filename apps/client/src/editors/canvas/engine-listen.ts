// Il motore della lavagna: gli ascoltatori, registrati dal costruttore. Metodi
// della classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { isBareKey } from "./chrome/workspace";
import { READER_TAP_MS } from "./reader";
import { onReducedMotionChange } from "../../theme/reduced-motion";
import { isInkKey } from "./engine-parts";
import type { CanvasEngine } from "./engine";

export const listenMethods = {
  /**
   * Gli ascoltatori della lavagna: il costruttore li registra qui, nel punto e
   * nell'ordine di prima (le dita prima dello strato della penna, i quattro
   * `pointerdown` della vista, alcuni in cattura).
   */
  _listen(this: CanvasEngine): void {
    // I tasti degli strumenti valgono anche col fuoco sulla colonna (dopo un
    // clic su una casella); gli altri tasti lì sono della colonna.
    this._life.listen(this._rail.element, "keydown", (event) => this._railKeydown(event));
    // Ctrl+. nasconde e riporta l'interfaccia (T65) da ogni punto della
    // lavagna: la vista, la colonna, la riga, la barra, il navigatore. Dentro
    // una scheda che scrive il tasto è prima dell'editor: arriva qui solo se
    // l'editor non lo usa. Sulla vista il comando `canvas.bare` lo prende già.
    this._life.listen(this._root, "keydown", (event) => {
      if (event.defaultPrevented || !isBareKey(event)) return;
      event.preventDefault();
      this._workspace.setBare(!this._workspace.bare);
    });
    // I tasti dello zoom valgono anche fuori dalla vista (la riga, la colonna, il
    // navigatore), come Ctrl+.: col fuoco su un pulsante dello zoom «+» zooma (IMP-040).
    this._life.listen(this._root, "keydown", (event) => this._zoomKeydown(event));
    // Ctrl+Z e Ctrl+Y anche dopo un clic su un pulsante della colonna, della riga
    // o della barra della scelta (IMP-6300); in un campo vero restano del campo.
    this._life.listen(this._root, "keydown", (event) => this._historyKeydown(event));
    const signal = this._abort.signal;
    // Le dita giù, prima dello strato della penna (T64): in cattura e prima di
    // lui, che si monta dopo. Un dito che lo strato prende per scrivere non
    // arriva qui sotto, e resta `swallowed`.
    this._viewport.addEventListener("pointerdown", (event) => {
      // Ogni puntatore giù si ricorda, anche quello che lo strato della penna
      // prende per sé: il suo rilascio perso lo chiude dal punto dov'era (T20a).
      this._pressed.set(event.pointerId, { last: event, held: event.buttons !== 0 });
      if (event.pointerType !== "touch") return;
      const { clientX: x, clientY: y } = event;
      this._touches.set(event.pointerId, { startX: x, startY: y, at: event.timeStamp, x, y, swallowed: true });
    }, { capture: true, signal });
    this._viewport.addEventListener("pointermove", (event) => {
      this._pointerMoved(event);
      const touch = event.pointerType === "touch" ? this._touches.get(event.pointerId) : undefined;
      if (touch) {
        touch.x = event.clientX;
        touch.y = event.clientY;
      }
    }, { capture: true, signal });
    // Un gesto che comincia toglie la barra della selezione: torna a fine gesto.
    this._viewport.addEventListener("pointerdown", (event) => {
      const touch = event.pointerType === "touch" ? this._touches.get(event.pointerId) : undefined;
      if (touch) touch.swallowed = false;
      // Un tasto premuto con Spazio giù è uno spostamento, non un tocco (T76).
      if (this._spaceTap) this._spaceTap.spoiled = true;
      this._selectionBar.hide();
      this._downByTouch = event.pointerType === "touch";
      this._pointerDown(event);
      // I gesti del dito (T63) guardano ciò che il dito ha appena cominciato.
      if (event.pointerType === "touch") this._gestureDown(event);
    }, { signal });
    this._viewport.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") this._gestureMove(event);
      this._pointerMove(event);
    }, { signal });
    // Il rilascio vero: la fine del gesto è quella di `_gestureEnd`, che passa
    // anche dalle chiusure senza rilascio (T20a).
    this._viewport.addEventListener("pointerup", (event) => this._gestureEnd(event, false), { signal });
    // La cattura persa è un rilascio che non arriva più: il gesto si chiude come
    // se il puntatore si fosse alzato, una volta sola (T20a). Un dito no: la
    // cattura gliela tolgono lo strato della penna e il browser quando il dito
    // passa a scrivere o a far da navigazione (T64), e il suo gesto lo chiudono
    // il rilascio, il `pointercancel` o la finestra.
    this._viewport.addEventListener("lostpointercapture", (event) => {
      if (event.pointerType !== "touch") this._gestureLost(event);
    }, { signal });
    // La vista che cambia misura, o che torna in vista da un'altra linguetta
    // (da zero alla sua misura), rifà la scelta delle schede vive. La vista
    // cambia misura anche quando cambia quella della superficie: allora la
    // colonna va sotto la lavagna, o torna di lato (`_syncNarrow`).
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        this._syncNarrow();
        this._refreshLive();
        // La lavagna può stare tutta nella vista nuova, o non più (T55).
        this._statusSettle();
      });
      observer.observe(this._viewport);
      this._life.add(() => observer.disconnect());
    }
    this._viewport.addEventListener("pointercancel", (event) => {
      if (event.pointerType === "touch") this._fingers.delete(event.pointerId);
      this._cancelGestures();
      if (event.pointerType === "touch") this._gestureUp(event, true);
    }, { signal });
    // Il tasto laterale lasciato, o un dito alzato fuori dalla vista (T63):
    // sul documento, perché il rilascio può cadere sul menu radiale.
    this._life.listen(document, "pointerup", (event) => this._pointerEnded(event), { capture: true });
    this._life.listen(document, "pointercancel", (event) => this._pointerEnded(event), { capture: true });
    // Il menu del sistema dietro al tasto laterale o al tocco lungo non apre
    // quello della lavagna (T63); quello che la lavagna manda da sé sì.
    this._viewport.addEventListener("contextmenu", (event) => {
      if (event === this._ownMenu) return;
      if (this._longPress !== null || this._menuHeld !== null || this._radial !== null || performance.now() < this._menuEchoUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { signal, capture: true });
    this._life.add(() => {
      this._cancelLongPress();
      this._radial?.close();
    });
    this._viewport.addEventListener("wheel", (event) => this._wheel(event), { signal, passive: false });
    // La vista si muove solo con la camera: uno scorrimento del browser (un
    // editor in una scheda che porta il cursore in vista, T43) si annulla.
    this._viewport.addEventListener("scroll", () => {
      if (this._viewport.scrollTop !== 0) this._viewport.scrollTop = 0;
      if (this._viewport.scrollLeft !== 0) this._viewport.scrollLeft = 0;
    }, { signal });
    this._viewport.addEventListener("keydown", (event) => {
      this._keydown(event);
      this._statusSettle();
    }, { signal });
    // Prima delle schede che scrivono: Ctrl+Z subito dopo un tratto fatto
    // sopra un campo aperto annulla il tratto, non il testo.
    this._viewport.addEventListener("keydown", (event) => this._inkUndoKey(event), { signal, capture: true });
    // D lasciato ovunque, la finestra che perde il fuoco o si nasconde: il
    // mouse torna a selezionare.
    this._life.listen(window, "keyup", (event) => {
      if (isInkKey(event)) this._releaseInkKey();
    });
    this._life.listen(window, "blur", () => this._releaseInkKey());
    this._life.listen(document, "visibilitychange", () => this._releaseInkKey());
    // La finestra che perde il fuoco: i rilasci dei puntatori giù non
    // arriveranno, e ogni gesto aperto si chiude come un rilascio (T20a).
    this._life.listen(window, "blur", () => this._gesturesLost());
    // Muoversi (T53). Spazio lasciato ovunque, o la finestra che perde il
    // fuoco: il tasto principale torna allo strumento. Con la finestra che
    // perde il fuoco l'inerzia e lo scorrimento al bordo si fermano, e un
    // volo arriva dove andava.
    // Spazio lasciato dopo un tocco breve, col puntatore fermo e una nota
    // scelta: il lettore (T76). Lo spostamento non aspetta il tocco.
    this._life.listen(window, "keyup", (event) => {
      if (event.key !== " ") return;
      const tap = this._spaceTap;
      const tapped = tap !== null && !tap.spoiled && event.timeStamp - tap.at >= 0 && event.timeStamp - tap.at < READER_TAP_MS;
      this._releaseSpace();
      if (tapped) this._openReaderOnChoice();
    });
    this._life.listen(window, "blur", () => this._stillCamera());
    this._life.listen(document, "visibilitychange", () => {
      if (document.hidden) this._stillCamera();
    });
    this._life.add(onReducedMotionChange((reduced) => {
      this._reducedMotion = reduced;
      // Cambiato a lavagna aperta: un volo arriva subito, l'inerzia si ferma.
      if (reduced) this._stopMotion(true);
    }));
    this._life.add(() => {
      this._stopMotion(false);
      this._stopEdgeScroll();
    });
    // Prima dello strato della penna, che ferma i suoi eventi: ogni
    // appoggio, anche della penna, ferma la vista che scorre da sola.
    this._viewport.addEventListener("pointerdown", () => this._stopMotion(false), { signal, capture: true });
    this._viewport.addEventListener("dblclick", (event) => this._dblclick(event), { signal });
    // Prima del contenuto delle schede: fuori da una scheda attiva il clic
    // sceglie, entra, o segue un link con Ctrl, e non arriva al contenuto.
    this._viewport.addEventListener("click", (event) => this._cardClick(event), { signal, capture: true });
    // Dove si incolla: l'ultimo punto visto sulla vista, finché il puntatore
    // non ne esce.
    this._viewport.addEventListener("pointermove", (event) => {
      this._pointerSeen = { x: event.clientX, y: event.clientY };
      this._spaceTapMoved(event.clientX, event.clientY);
    }, { signal });
    // A chi appartiene il tratto (T69). L'appoggio si legge in cattura, prima
    // dello strato della penna che lo ferma: è solo un punto. I movimenti si
    // leggono dopo, quando la scia è già disegnata; Alt si legge ovunque.
    this._viewport.addEventListener("pointerdown", (event) => this._inkSeen(event), { signal, capture: true });
    this._viewport.addEventListener("pointermove", (event) => this._inkTargetMove(event), { signal });
    // Il velo della croce (T20d): c'è col mouse e con la penna sospesa sopra
    // la vista; un dito che si appoggia, o la penna che esce dal raggio, lo
    // toglie. Il mouse che esce no: fuori dalla vista il velo non conta, e
    // ogni volta che compare sotto il puntatore la scheda sotto perde il suo
    // `:hover` e si ridipinge.
    const veilOver = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") this._setVeilPointer(true);
    };
    this._viewport.addEventListener("pointerover", veilOver, { signal, capture: true });
    this._viewport.addEventListener("pointermove", veilOver, { signal, capture: true });
    this._viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") this._setVeilPointer(false);
    }, { signal, capture: true });
    this._viewport.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "pen") this._setVeilPointer(false);
    }, { signal });
    // «Torna a N px» dell'avviso dei tratti sul testo (`ink-reflow.ts`).
    this._viewport.addEventListener("click", (event) => {
      const back = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ink-reflow]") : null;
      const id = back?.closest<HTMLElement>(".canvas-node")?.dataset.node;
      if (!back || id === undefined) return;
      event.stopPropagation();
      this._restoreInkWidth(id, Number(back.dataset.inkReflow));
    }, { signal });
    // «×N» illumina le gemelle al passaggio e col fuoco (C14, T22); si
    // spengono quando li perde tutti e due.
    const twinsButton = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(".canvas-node-twins") : null;
    this._viewport.addEventListener("pointerover", (event) => {
      const button = twinsButton(event.target);
      if (!button) return;
      this._twinsHover = button;
      this._lightTwinsFrom(button);
    }, { signal });
    this._viewport.addEventListener("pointerout", (event) => {
      const button = twinsButton(event.target);
      if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
      if (this._twinsHover === button) this._twinsHover = null;
      if (!button.contains(document.activeElement)) this._lightTwins(null);
    }, { signal });
    this._viewport.addEventListener("focusin", (event) => {
      const button = twinsButton(event.target);
      if (button) this._lightTwinsFrom(button);
    }, { signal });
    this._viewport.addEventListener("focusout", (event) => {
      const button = twinsButton(event.target);
      if (button && this._twinsHover !== button) this._lightTwins(null);
    }, { signal });
    // La scheda sotto il puntatore tiene l'aspetto del passaggio quando il
    // velo o la cattura del tratto le tolgono `:hover` (T20f).
    this._viewport.addEventListener("pointerover", (event) => this._pointerOver(event), { signal, capture: true });
    this._viewport.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      this._hoverCard = null;
      this._holdHover(null);
    }, { signal });
    this._life.listen(window, "keydown", (event) => {
      if (event.key === "Alt") this._setAltHeld(true);
    });
    this._life.listen(window, "keyup", (event) => {
      if (event.key === "Alt") this._setAltHeld(false);
    });
    this._life.listen(window, "blur", () => this._setAltHeld(false));
    // Maiusc (T87): il tratto dritto e la forma regolare, letti ovunque; un
    // movimento della penna lo rilegge, se la finestra non l'ha saputo.
    this._life.listen(window, "keydown", (event) => {
      if (event.key === "Shift") this._setShiftHeld(true);
    });
    this._life.listen(window, "keyup", (event) => {
      if (event.key === "Shift") this._setShiftHeld(false);
    });
    this._life.listen(window, "blur", () => this._setShiftHeld(false));
    this._viewport.addEventListener("pointermove", (event) => {
      if (this._inkGuides.size > 0 && event.shiftKey !== this._shiftHeld) this._setShiftHeld(event.shiftKey);
    }, { signal });
    this._life.add(() => {
      clearTimeout(this._shapeTimer);
      this._inkGuides.clear();
    });
    this._viewport.addEventListener("pointerleave", () => {
      this._pointerSeen = null;
      // Il puntatore fuori dalla lavagna: nessun filo si scurisce (T67).
      this._setEdgeHover(null);
    }, { signal });
    this._viewport.addEventListener("dragover", (event) => {
      if (!this._readOnly && !this._isSceneOversized() && event.dataTransfer
        && (this._options.attachments || event.dataTransfer.types.includes("text/plain"))) {
        event.preventDefault();
        this._showDropGhosts(event);
      }
    }, { signal });
    this._viewport.addEventListener("dragleave", (event) => {
      // Passare da un figlio all'altro della vista non è uscire.
      const next = event.relatedTarget;
      if (next instanceof Node && this._viewport.contains(next)) return;
      this._hideDropGhosts();
    }, { signal });
    this._viewport.addEventListener("drop", (event) => {
      this._hideDropGhosts();
      void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
    }, { signal });
    this._viewport.addEventListener("paste", (event) => {
      void this._intake(event).catch((error: unknown) => this._showIntakeError(error));
    }, { signal });
    // Copia, taglia e incolla delle schede (T68). Il browser manda l'evento a
    // chi ha il fuoco o alla selezione di testo, che può stare altrove (il
    // corpo della pagina): si ascolta il documento e si guarda il fuoco.
    this._life.listen(document, "copy", (event) => this._copyEvent(event, false));
    this._life.listen(document, "cut", (event) => this._copyEvent(event, true));
    this._life.listen(document, "paste", (event) => this._pasteFromOutside(event));
  },
};
export type ListenMethods = typeof listenMethods;
