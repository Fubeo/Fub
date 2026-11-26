// Il motore della lavagna: i fili (disegno, ispettore, verso). Metodi della
// classe `CanvasEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { edgeEnd, type CanvasEdge, type CanvasNode } from "./model";
import {
  EDGE_SIDES,
  edgeAt,
  edgePathData,
  insideBox,
  nearestSides,
  sidePoint,
  type EdgePoint,
  type EdgeSide,
  type PlacedEdge,
} from "./edges";
import { type CanvasIntentOp } from "./wasm/core";
import { ConnectGesture } from "./engine-parts";
import { paintColor } from "./engine-geometry";
import { setOp, nodeTitle } from "./engine-names";
import type { CanvasEngine } from "./engine";

export const edgesMethods = {
  _drawEdgeInspector(this: CanvasEngine, bar: HTMLElement): void {
    const id = this._edgeSelection[0];
    const edge = this._doc?.edges.find((entry) => entry.id === id);
    if (!edge) return;
    // Un campo del filo scrive la sua `set` (T23); un valore che il nucleo
    // rifiuta non scrive, e la barra torna al valore del modello.
    const change = (values: Partial<CanvasEdge>): void => {
      const current = this._doc?.edges.find((entry) => entry.id === id);
      if (!current || !this._doc) return;
      const next = { ...current, ...values };
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[key];
      }
      const op = setOp(current, next);
      if (op) this._writeOps([op]);
    };
    const label = document.createElement("input");
    label.type = "text";
    label.value = edge.label ?? "";
    label.maxLength = 65_536;
    label.disabled = this._readOnly;
    label.dataset.canvasField = "edge-label";
    label.setAttribute("aria-label", t("canvas.edge_label"));
    label.addEventListener("change", () => change({ label: label.value }));
    bar.append(label);
    for (const field of ["fromNode", "toNode"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      select.setAttribute("aria-label", t(field === "fromNode" ? "canvas.edge_from_node" : "canvas.edge_to_node"));
      select.disabled = this._readOnly;
      for (const node of this._doc!.nodes) {
        const option = document.createElement("option");
        option.value = node.id;
        option.textContent = nodeTitle(node);
        select.append(option);
      }
      select.value = edge[field];
      select.addEventListener("change", () => change({ [field]: select.value } as Partial<CanvasEdge>));
      bar.append(select);
    }
    for (const field of ["fromSide", "toSide", "fromEnd", "toEnd"] as const) {
      const select = document.createElement("select");
      select.dataset.canvasField = `edge-${field}`;
      const fieldLabels = {
        fromSide: "canvas.edge_from_side",
        toSide: "canvas.edge_to_side",
        fromEnd: "canvas.edge_from_end",
        toEnd: "canvas.edge_to_end",
      } as const;
      select.setAttribute("aria-label", t(fieldLabels[field]));
      select.disabled = this._readOnly;
      const values = field.endsWith("Side") ? ["", "top", "right", "bottom", "left"] : ["", "none", "arrow"];
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || t("canvas.default");
        select.append(option);
      }
      select.value = edge[field] ?? "";
      select.addEventListener("change", () => change({ [field]: select.value || undefined } as Partial<CanvasEdge>));
      bar.append(select);
    }
  },

  /** Il filo `edge` va nell'altro verso: estremi, lati e punte si scambiano. */
  _reverseEdge(this: CanvasEngine, edge: string | undefined): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._reverseOps(edge));
  },

  // --- i fili (T67) --------------------------------------------------------------

  /**
   * Comincia a tirare un filo (`gesture`): dai punti, da →, con Alt dal
   * corpo, con lo strumento Collega o riattaccando un'estremità. Mai in sola
   * lettura e mai con la penna, che scrive (D3 è v2). Il fuoco va sulla vista,
   * così Esc arriva e annulla.
   */
  _beginConnect(
    this: CanvasEngine,
    event: PointerEvent,
    gesture: Omit<ConnectGesture, "pointerId" | "startX" | "startY" | "moved">,
  ): boolean {
    if (this._readOnly || !this._doc || event.pointerType === "pen" || this._isSceneOversized()) return false;
    if (!this._doc.nodes.some((node) => node.id === gesture.from)) return false;
    this._endConnect();
    this._connect = { ...gesture, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    this._viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (!this._viewport.contains(document.activeElement)) this._viewport.focus({ preventScroll: true });
    const draft = document.createElementNS("http://www.w3.org/2000/svg", "path");
    draft.classList.add("canvas-edge-draft");
    this._connectDraft = draft;
    this._edgeLayer.append(draft);
    this._viewport.toggleAttribute("data-connecting", true);
    this._setEdgeHover(null);
    return true;
  },

  /** Il filo in corso segue il puntatore; sopra una scheda arriva al lato che sceglierà. */
  _moveConnect(this: CanvasEngine, clientX: number, clientY: number): void {
    const connect = this._connect;
    if (!connect || !this._doc) return;
    if (!connect.moved && Math.abs(clientX - connect.startX) + Math.abs(clientY - connect.startY) > 3) {
      connect.moved = true;
    }
    const target = this._connectTargetAt(connect, clientX, clientY);
    this._markConnectTarget(target);
    const ends = this._connectEnds(connect, target, this._screenToWorld(clientX, clientY));
    if (ends && this._connectDraft) this._connectDraft.setAttribute("d", edgePathData(ends.start, ends.end));
  },

  /**
   * La scheda dove il filo arriverebbe sotto `clientX`, `clientY`: la più in
   * alto, perché `elementFromPoint` dà quella sopra. Un filo nuovo non torna
   * sulla scheda da cui parte.
   */
  _connectTargetAt(this: CanvasEngine, connect: ConnectGesture, clientX: number, clientY: number): CanvasNode | null {
    const id = this._nodeAt(this._elementAt(clientX, clientY));
    if (id === null || (!connect.edgeId && id === connect.from)) return null;
    return this._doc?.nodes.find((node) => node.id === id) ?? null;
  },

  /** I due capi del filo in corso: il capo fermo e quello che segue il puntatore. */
  _connectEnds(
    this: CanvasEngine,
    connect: ConnectGesture,
    target: CanvasNode | null,
    pointer: EdgePoint,
  ): { start: EdgePoint; end: EdgePoint } | null {
    const doc = this._doc;
    if (!doc) return null;
    const byId = new Map(doc.nodes.map((node) => [node.id, node]));
    let anchor: CanvasNode | undefined;
    let anchorSide: EdgeSide | undefined;
    if (connect.edgeId) {
      const edge = doc.edges.find((one) => one.id === connect.edgeId);
      if (!edge) return null;
      anchor = byId.get(connect.endpoint === "from" ? edge.toNode : edge.fromNode);
      anchorSide = connect.endpoint === "from" ? edge.toSide ?? "left" : edge.fromSide ?? "right";
    } else {
      anchor = byId.get(connect.from);
      anchorSide = connect.fromSide;
    }
    if (!anchor) return null;
    if (target) {
      const sides = nearestSides(anchor, target, anchorSide, target.id === anchor.id);
      return { start: sidePoint(anchor, sides.fromSide), end: sidePoint(target, sides.toSide) };
    }
    const side = anchorSide ?? nearestSides(anchor, { x: pointer.x, y: pointer.y, width: 0, height: 0 }).fromSide;
    return { start: sidePoint(anchor, side), end: pointer };
  },

  /** La scheda su cui il filo arriverebbe porta `data-connect-target`. */
  _markConnectTarget(this: CanvasEngine, target: CanvasNode | null): void {
    const id = target?.id ?? null;
    if (id === this._connectTarget) return;
    if (this._connectTarget !== null) this._cards.get(this._connectTarget)?.article.removeAttribute("data-connect-target");
    this._connectTarget = id;
    if (id !== null) this._cards.get(id)?.article.toggleAttribute("data-connect-target", true);
  },

  /** Il filo in corso finisce: niente tratto, niente bersaglio, niente gesto. */
  _endConnect(this: CanvasEngine): void {
    this._connect = null;
    this._connectDraft?.remove();
    this._connectDraft = null;
    this._markConnectTarget(null);
    this._viewport.removeAttribute("data-connecting");
  },

  /** Esc mentre si tira un filo: non resta niente, come se non fosse cominciato. */
  _cancelConnect(this: CanvasEngine): void {
    const connect = this._connect;
    if (!connect) return;
    this._endConnect();
    try {
      this._viewport.releasePointerCapture?.(connect.pointerId);
    } catch {
      // Il puntatore era già libero.
    }
    if (connect.back) this._pickTool("select");
  },

  /**
   * Il rilascio del filo `connect` in `clientX`, `clientY`. Su una scheda: il
   * filo, coi lati scelti da `edges.ts`; un'estremità riattaccata cambia
   * scheda. Nel vuoto: un filo nuovo fa nascere lì una scheda di testo
   * collegata, in un commit solo (`true`: la scheda è in scrittura);
   * un'estremità torna dov'era. Sulla scheda di partenza non succede niente.
   */
  _finishConnect(this: CanvasEngine, connect: ConnectGesture, clientX: number, clientY: number): boolean {
    const doc = this._doc;
    if (!doc || this._readOnly) return false;
    const hit = this._elementAt(clientX, clientY);
    const target = this._connectTargetAt(connect, clientX, clientY);
    if (connect.edgeId) {
      const existing = doc.edges.find((edge) => edge.id === connect.edgeId);
      if (!existing || !target) return false;
      const movesFrom = connect.endpoint === "from";
      const other = doc.nodes.find((node) => node.id === (movesFrom ? existing.toNode : existing.fromNode));
      if (!other) return false;
      const otherSide = movesFrom ? existing.toSide ?? "left" : existing.fromSide ?? "right";
      const side = nearestSides(other, target, otherSide, other.id === target.id).toSide;
      // L'estremità riattaccata è una `set` dell'arco (T24): la scheda e il lato.
      const fields = movesFrom ? { fromNode: target.id, fromSide: side } : { toNode: target.id, toSide: side };
      this._writeOps([{ op: "set", id: existing.id, fields }]);
      return false;
    }
    const source = doc.nodes.find((node) => node.id === connect.from);
    if (!source) return false;
    if (target) {
      // Il filo lasciato sul corpo di una scheda va ai lati più vicini
      // (`sides: "auto"`); partito da un lato (un punto della scheda, T67),
      // tiene quello, e l'arrivo è il lato più vicino a lui (T24).
      const sides = connect.fromSide === undefined
        ? "auto"
        : { from: connect.fromSide, to: nearestSides(source, target, connect.fromSide).toSide };
      this._writeOps(this._connectOps(source.id, target.id, sides));
      return false;
    }
    // Nel vuoto, solo dopo un vero tiro e dentro la vista (non sulla
    // scheda di partenza, né fuori dalla lavagna).
    if (!connect.moved || !hit || !this._viewport.contains(hit) || this._nodeAt(hit) !== null) return false;
    this._placeText(clientX, clientY, { from: source.id, fromSide: connect.fromSide });
    return true;
  },

  /** C con due schede scelte (D-19 (a)): un filo dalla prima alla seconda, coi lati di `edges.ts`. */
  _connectPair(this: CanvasEngine, from: CanvasNode, to: CanvasNode): void {
    if (!this._doc || this._readOnly) return;
    this._writeOps(this._connectOps(from.id, to.id));
  },

  /**
   * La `connect` delle due schede scelte («Collega…», e C senza fili scelti);
   * `null` se non sono due.
   */
  _connectPairOps(this: CanvasEngine): CanvasIntentOp[] | null {
    const chosen = this._selectedNodes();
    return chosen.length === 2 ? this._connectOps(chosen[0]!.id, chosen[1]!.id) : null;
  },

  /**
   * La `connect` da `from` a `to`, coi lati più vicini (`sides: "auto"`, la
   * regola di `nearestSides` di `edges.ts`) o coi lati dati, e le punte scelte
   * nella riga di Collega (T50): `arrow` di serie, `none`, o la sola punta
   * all'inizio, che la forma breve non ha (allora l'arco intero, coi lati di
   * `nearestSides`). `born` è l'id di una scheda che nasce nella stessa lista
   * (Collega nel vuoto, Ctrl+Maiusc+Invio): allora può non esserci ancora.
   * `null` se una delle due non c'è.
   */
  _connectOps(
    this: CanvasEngine,
    from: string,
    to: string,
    sides: "auto" | { readonly from: EdgeSide; readonly to: EdgeSide } = "auto",
    born?: string,
  ): CanvasIntentOp[] | null {
    const a = this._doc?.nodes.find((node) => node.id === from);
    const b = this._doc?.nodes.find((node) => node.id === to);
    if (!a && from !== born) return null;
    if (!b && to !== born) return null;
    if (this._tips === "start") {
      const pair = sides === "auto" && a && b ? nearestSides(a, b) : null;
      const fromSide = pair ? pair.fromSide : sides === "auto" ? undefined : sides.from;
      const toSide = pair ? pair.toSide : sides === "auto" ? undefined : sides.to;
      return [{ op: "connect", edge: { fromNode: from, toNode: to, fromSide, toSide, ...this._tipEnds() } }];
    }
    const short = { op: "connect", from, to, sides: sides === "auto" ? sides : { ...sides } };
    return [this._tips === "none" ? { ...short, ends: "none" } : short];
  },

  /** I fili con i loro capi sulla lavagna, per cercare quello sotto il puntatore. */
  _placedEdges(this: CanvasEngine): PlacedEdge[] {
    const doc = this._doc;
    if (!doc) return [];
    const byId = new Map(doc.nodes.map((node) => [node.id, node]));
    const placed: PlacedEdge[] = [];
    for (const edge of doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (from && to) placed.push({ id: edge.id, a: sidePoint(from, edge.fromSide ?? "right"), b: sidePoint(to, edge.toSide ?? "left") });
    }
    return placed;
  },

  /**
   * Il filo entro 8 px dello schermo da `clientX`, `clientY`, fra quelli in
   * vista. Sopra la scheda `over` il filo vince solo dove si vede, fuori da
   * lei: altrove la scheda (D8).
   */
  _edgeUnder(this: CanvasEngine, clientX: number, clientY: number, over: string | null): string | null {
    const doc = this._doc;
    if (!doc || doc.edges.length === 0 || this._isSceneOversized()) return null;
    const rect = this._viewport.getBoundingClientRect();
    const corner = this._screenToWorld(rect.left, rect.top);
    const zoom = this._camera.zoom;
    const view = { x: corner.x, y: corner.y, width: (rect.width || 800) / zoom, height: (rect.height || 600) / zoom };
    const hit = edgeAt(this._screenToWorld(clientX, clientY), this._placedEdges(), zoom, view);
    if (!hit) return null;
    const card = over === null ? undefined : doc.nodes.find((node) => node.id === over);
    return card && insideBox(hit.point, card) ? null : hit.id;
  },

  /**
   * Il filo che un clic o il passaggio su `target` prende: mai dentro la
   * scheda attiva né sopra un controllo (un punto, una maniglia, un pulsante,
   * un link, un campo), che restano loro.
   */
  _wireAt(this: CanvasEngine, target: EventTarget | null, clientX: number, clientY: number): string | null {
    if (this._insideActive(target, false)) return null;
    if (target instanceof Element && target.closest(".canvas-port, [data-resize], button, a, input, textarea, select")) return null;
    return this._edgeUnder(clientX, clientY, this._nodeAt(target));
  },

  /** Il passaggio del mouse: il filo sotto si scurisce (`data-hover`). */
  _hoverEdge(this: CanvasEngine, clientX: number, clientY: number, target: EventTarget | null): void {
    this._setEdgeHover(this._wireAt(target, clientX, clientY));
  },

  _setEdgeHover(this: CanvasEngine, id: string | null): void {
    if (id === this._edgeHover) return;
    if (this._edgeHover !== null) this._edgeGroup(this._edgeHover)?.removeAttribute("data-hover");
    this._edgeHover = id;
    if (id !== null) this._edgeGroup(id)?.toggleAttribute("data-hover", true);
    this._viewport.toggleAttribute("data-edge-hover", id !== null);
  },

  /** Il gruppo SVG del filo `id` sulla scena. */
  _edgeGroup(this: CanvasEngine, id: string): SVGGElement | null {
    for (const hit of this._edgeLayer.querySelectorAll<SVGPathElement>(".canvas-edge-hit")) {
      if (hit.dataset.edge === id) return hit.parentElement as SVGGElement | null;
    }
    return null;
  },

  /** I quattro punti sui lati della scheda `el` (T67): ci sono solo se si può scrivere. */
  _syncPorts(this: CanvasEngine, el: HTMLElement): void {
    const ports = el.querySelectorAll<HTMLElement>(":scope > .canvas-port");
    if (this._readOnly) {
      for (const port of ports) port.remove();
      return;
    }
    if (ports.length === EDGE_SIDES.length) return;
    for (const port of ports) port.remove();
    for (const side of EDGE_SIDES) {
      const port = document.createElement("div");
      port.className = "canvas-port";
      port.dataset.side = side;
      port.setAttribute("aria-hidden", "true");
      el.append(port);
    }
  },

  _drawEdges(this: CanvasEngine): void {
    if (!this._doc) return;
    const byId = new Map(this._doc.nodes.map((n) => [n.id, n]));
    this._edgeLayer.replaceChildren();
    this._handleLayer.replaceChildren();
    const worldW = this._worldSize();
    // Le prese stanno nelle stesse coordinate dei fili (T91).
    for (const layer of [this._edgeLayer, this._handleLayer]) {
      layer.setAttribute("viewBox", `0 0 ${worldW.w} ${worldW.h}`);
      layer.style.width = `${worldW.w}px`;
      layer.style.height = `${worldW.h}px`;
    }
    for (const edge of this._doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      const a = sidePoint(from, edge.fromSide ?? "right");
      const b = sidePoint(to, edge.toSide ?? "left");
      const selected = this._edgeSelection.includes(edge.id);
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("canvas-edge");
      // Il filo sotto il puntatore si scurisce (T67).
      if (this._edgeHover === edge.id) group.toggleAttribute("data-hover", true);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.classList.add("canvas-edge-hit");
      hit.dataset.edge = edge.id;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.classList.add("canvas-edge-line");
      line.dataset.edge = edge.id;
      if (selected) line.classList.add("selected");
      const d = edgePathData(a, b);
      hit.setAttribute("d", d);
      line.setAttribute("d", d);
      // Il colore del filo, per la pelle: il tratto e le punte (T47).
      paintColor(group, edge.color);
      group.append(hit, line);
      for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
        if (edgeEnd(edge, endpoint) !== "arrow") continue;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) + (endpoint === "from" ? Math.PI : 0);
        const dx = Math.cos(angle) * 10;
        const dy = Math.sin(angle) * 10;
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
        marker.setAttribute("d", `M ${point.x} ${point.y} L ${point.x - dx - dy / 2} ${point.y - dy + dx / 2} L ${point.x - dx + dy / 2} ${point.y - dy - dx / 2} Z`);
        marker.classList.add("canvas-edge-arrow");
        group.append(marker);
      }
      if (edge.label) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String((a.x + b.x) / 2));
        label.setAttribute("y", String((a.y + b.y) / 2 - 6));
        label.classList.add("canvas-edge-label");
        label.textContent = edge.label;
        group.append(label);
      }
      if (selected && !this._readOnly) {
        for (const [endpoint, point] of [["from", a], ["to", b]] as const) {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.classList.add("canvas-edge-reconnect");
          handle.dataset.reconnect = edge.id;
          handle.dataset.endpoint = endpoint;
          handle.setAttribute("cx", String(point.x));
          handle.setAttribute("cy", String(point.y));
          handle.setAttribute("r", "8");
          // Sopra lo stage, non nel filo: un punto della scheda non la copre (T91, rotta 5).
          this._handleLayer.append(handle);
        }
      }
      this._edgeLayer.append(group);
    }
    // Il filo che si sta tirando resta sopra gli altri.
    if (this._connectDraft) this._edgeLayer.append(this._connectDraft);
  },
};
export type EdgesMethods = typeof edgesMethods;
