// Il motore della griglia: gli oggetti di un foglio (grafici, immagini,\n// forme). Metodi della\n// classe `GridEngine`, montati sul suo prototipo da `engine.ts`\n// (`editors/core/mix-methods.ts`).
import type { GridObject } from "../../host/contract";
import { t } from "../../i18n/strings";
import { composingKey } from "../../kit";
import { cellA1, mergeAt } from "./merges";
import { wholeRect, type Zone } from "./marks";
import { drawObject, objectLabel } from "./objects";
import { namedKey } from "./shortcuts";
import { objectKey, WORKBOOK_SCALE } from "./workbook";
import { gestureRect, indexAt, type AxisLayout, type ObjectGesture, type ObjectRect } from "./engine-geometry";
import { sameObjectPlace } from "./engine-host";
import { MOVABLE, HANDLES, DRAG_SLOP, SUMMARY_OBJECTS, zoneOf, Drawing } from "./engine-parts";
import type { GridEngine } from "./engine";

export const objectsMethods = {
  /// Gli oggetti letti del foglio mostrato, nell'ordine in cui si disegnano.
  _objects(this: GridEngine): readonly GridObject[] {
    return this._view?.sheets[this._sheetIndex]?.objects ?? [];
  },

  _objectByKey(this: GridEngine, key: string | null): GridObject | undefined {
    return key === null ? undefined : this._objects().find((object) => objectKey(object) === key);
  },

  /// La zona dell'oggetto: quella della cella dove è ancorato, o di dove lo
  /// si è appena messo. Ci sta intero, nel livello «lift» di quella zona.
  _objectZone(this: GridEngine, object: GridObject): Zone {
    const placed = this._placed;
    if (placed && placed.key === objectKey(object) && sameObjectPlace(placed.before, object)) return placed.zone;
    return zoneOf(object.column < this._frame.frozenColumns, object.row < this._frame.frozenRows);
  },

  /// Dove l'oggetto sta nel piano: la sua cella e lo scarto da lei, nei
  /// pixel del file portati a quelli dello schermo. Un grafico sparkline e
  /// un'immagine nella cella prendono la misura della cella di Fub.
  _objectRect(this: GridEngine, object: GridObject): ObjectRect | null {
    const rows = this._rows;
    const columns = this._columns;
    if (object.row >= rows.sizes.length || object.column >= columns.sizes.length) return null;
    const placed = this._placed;
    if (placed && placed.key === objectKey(object)) {
      if (sameObjectPlace(placed.before, object)) return placed.rect;
      this._placed = null;
    }
    const frame = this._frame;
    const scale = WORKBOOK_SCALE * frame.zoom;
    const left = this._columnLeft(object.column);
    const top = frame.columnHeader + rows.offsets[object.row];
    if (object.kind === "sparkline" || object.kind === "cell_picture") {
      const merge = mergeAt(this._merges(), { row: object.row, column: object.column });
      const lastRow = merge ? merge.row + merge.rows - 1 : object.row;
      const lastColumn = merge ? merge.column + merge.columns - 1 : object.column;
      return {
        left,
        top,
        width: columns.offsets[lastColumn + 1] - columns.offsets[object.column],
        height: rows.offsets[lastRow + 1] - rows.offsets[object.row],
      };
    }
    return { left: left + object.dx * scale, top: top + object.dy * scale, width: object.width * scale, height: object.height * scale };
  },

  /// Gli oggetti che si vedono, sopra le celle: ognuno intero nel livello
  /// «lift» della sua zona, che scorre con le celle dove è ancorato.
  _objectElements(this: GridEngine, drawing: Drawing): void {
    const objects = this._objects();
    this._showObjectsSummary(objects);
    if (this._selectedObject !== null && !this._objectByKey(this._selectedObject)) {
      this._selectedObject = null;
      this._finishObjectText(false);
    }
    for (const object of objects) {
      const key = objectKey(object);
      const zone = this._objectZone(object);
      const rect = this._objectGesture?.key === key ? this._objectGesture.to : this._objectRect(object);
      if (!rect) continue;
      const scroll = this._zoneScroll(zone === "left" || zone === "corner", zone === "top" || zone === "corner");
      const right = scroll.left + this._viewport.clientWidth;
      const bottom = scroll.top + this._viewport.clientHeight;
      if (rect.left > right || rect.left + rect.width < scroll.left || rect.top > bottom || rect.top + rect.height < scroll.top) continue;
      const element = document.createElement("div");
      element.className = MOVABLE[object.kind] ? "grid-object movable" : "grid-object in-cell";
      element.dataset.object = key;
      element.setAttribute("aria-hidden", "true");
      element.title = objectLabel(object);
      if (key === this._selectedObject) element.classList.add("selected");
      if (zone !== "body") element.classList.add("frozen");
      this._placeObjectElement(element, zone, rect);
      this._drawObjectInto(element, object, rect);
      this._draw(drawing, this._lifts[zone], element);
    }
  },

  /// L'oggetto `rect` (nel piano) nelle coordinate del livello di `zone`.
  _placeObjectElement(this: GridEngine, element: HTMLElement, zone: Zone, rect: ObjectRect): void {
    const at = wholeRect(zone, { x: rect.left, y: rect.top, w: Math.max(rect.width, 1), h: Math.max(rect.height, 1) }, this._bands());
    this._place(element, at.x, at.y, at.w, at.h);
  },

  /// Il contenuto dell'oggetto a misura di `rect`, con le maniglie se è
  /// selezionato e si può cambiare, e il campo del suo testo se si scrive.
  _drawObjectInto(this: GridEngine, element: HTMLElement, object: GridObject, rect: ObjectRect): void {
    const key = objectKey(object);
    element.replaceChildren(drawObject(object, rect.width, rect.height, WORKBOOK_SCALE * this._frame.zoom, this._media, this._gridFont()));
    if (key !== this._selectedObject) return;
    if (this._objectText?.key === key) {
      element.append(this._objectText.field);
      return;
    }
    if (!this.commandable()) return;
    for (const handle of HANDLES) {
      const grip = document.createElement("div");
      grip.className = `grid-object-handle ${handle.id}`;
      grip.dataset.handle = handle.id;
      grip.style.left = `${handle.x * 100}%`;
      grip.style.top = `${handle.y * 100}%`;
      element.append(grip);
    }
  },

  /// L'elenco degli oggetti, che la griglia nomina come sua descrizione.
  _showObjectsSummary(this: GridEngine, objects: readonly GridObject[]): void {
    const names = objects.filter((object) => MOVABLE[object.kind]).slice(0, SUMMARY_OBJECTS).map(objectLabel);
    const text = names.length ? t("grid.objects.summary", { list: names.join(", ") }) : "";
    if (this._objectsSummary.textContent !== text) this._objectsSummary.textContent = text;
    if (text) this._viewport.setAttribute("aria-describedby", this._objectsSummary.id);
    else this._viewport.removeAttribute("aria-describedby");
  },

  /// Seleziona l'oggetto `key`, o torna alle celle con `null`.
  _selectObject(this: GridEngine, key: string | null): void {
    if (this._selectedObject === key) return;
    this._finishObjectText(true);
    this._selectedObject = key;
    const object = this._objectByKey(key);
    this._objectsAnnounce.textContent = object ? t("grid.object.selected", { name: objectLabel(object) }) : "";
    if (object) {
      const rect = this._objectRect(object);
      if (rect) this._revealRect(rect, this._objectZone(object));
    }
    this._render();
    this._options.onSelectionChange();
  },

  /// Scorre perché l'angolo dell'oggetto si veda. In una fascia ferma si vede
  /// già, nel verso in cui la fascia non scorre.
  _revealRect(this: GridEngine, rect: ObjectRect, zone: Zone): void {
    const frame = this._frame;
    const viewport = this._viewport;
    const before = { x: frame.rowHeader + frame.frozenWidth, y: frame.columnHeader + frame.frozenHeight };
    const still = { x: zone === "left" || zone === "corner", y: zone === "top" || zone === "corner" };
    if (!still.x && (rect.left < viewport.scrollLeft + before.x || rect.left > viewport.scrollLeft + viewport.clientWidth)) {
      viewport.scrollLeft = Math.max(0, rect.left - before.x);
    }
    if (!still.y && (rect.top < viewport.scrollTop + before.y || rect.top > viewport.scrollTop + viewport.clientHeight)) {
      viewport.scrollTop = Math.max(0, rect.top - before.y);
    }
  },

  /// Il passo di Tab fra gli oggetti che si spostano.
  _stepObject(this: GridEngine, step: 1 | -1): void {
    const keys = this._objects().filter((object) => MOVABLE[object.kind]).map(objectKey);
    if (!keys.length) return;
    const at = this._selectedObject === null ? -1 : keys.indexOf(this._selectedObject);
    const next = at < 0 ? (step > 0 ? 0 : keys.length - 1) : (at + step + keys.length) % keys.length;
    this._selectObject(keys[next] ?? null);
  },

  /// I tasti di un oggetto selezionato. Vero se il tasto è suo.
  _objectKeydown(this: GridEngine, event: KeyboardEvent): boolean {
    const object = this._objectByKey(this._selectedObject);
    if (!object) return false;
    const kind = MOVABLE[object.kind];
    switch (namedKey(event)) {
      case "Escape":
        this._selectObject(null);
        return true;
      case "Tab":
        this._stepObject(event.shiftKey ? -1 : 1);
        return true;
      case "Delete":
      case "Backspace":
        if (kind && this.commandable()) {
          this._selectObject(null);
          this.command("object.delete", JSON.stringify({ kind, id: object.id }));
        }
        return true;
      case "Enter":
      case "F2":
        this._beginObjectText(objectKey(object));
        return true;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        const rect = this._objectRect(object);
        if (!kind || !rect || !this.commandable()) return true;
        const step = (event.shiftKey ? 10 : 1) * WORKBOOK_SCALE * this._frame.zoom;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        this._placeObject(objectKey(object), gestureRect(rect, null, dx, dy, false));
        return true;
      }
      default:
        // Le altre battute non aprono la cella sotto l'oggetto.
        return !(event.ctrlKey || event.metaKey || event.altKey);
    }
  },

  /// Prende l'oggetto sotto il puntatore: lo seleziona e comincia a
  /// spostarlo, o a misurarlo se ha preso una maniglia. Falso se l'oggetto
  /// non si prende, e il clic va alla cella.
  _objectPointerDown(this: GridEngine, event: PointerEvent, element: HTMLElement): boolean {
    const key = element.dataset.object ?? null;
    const object = this._objectByKey(key);
    if (!key || !object || !MOVABLE[object.kind]) return false;
    if (event.target instanceof Element && event.target.closest(".grid-object-text-editor")) return true;
    event.preventDefault();
    this._finishEditing(true, "input", false);
    this._viewport.focus();
    this._selectObject(key);
    const rect = this._objectRect(object);
    if (!rect || !this.commandable() || event.button !== 0) return true;
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>(".grid-object-handle")?.dataset.handle ?? null : null;
    this._objectGesture = { key, handle, pointer: event.pointerId, x: event.clientX, y: event.clientY, from: rect, to: rect, moved: false };
    this._viewport.setPointerCapture?.(event.pointerId);
    return true;
  },

  _objectPointerMove(this: GridEngine, event: PointerEvent, gesture: ObjectGesture): void {
    if (event.pointerId !== gesture.pointer) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    gesture.moved = true;
    gesture.to = gestureRect(gesture.from, gesture.handle, dx, dy, event.shiftKey);
    const object = this._objectByKey(gesture.key);
    const element = [...this._viewport.querySelectorAll<HTMLElement>(".grid-object")].find((candidate) => candidate.dataset.object === gesture.key);
    if (!object || !element) return;
    const rect = gesture.to;
    this._placeObjectElement(element, this._objectZone(object), rect);
    this._drawObjectInto(element, object, rect);
  },

  _endObjectGesture(this: GridEngine, event: PointerEvent, commit: boolean): void {
    const gesture = this._objectGesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    this._objectGesture = null;
    if (commit && gesture.moved) this._placeObject(gesture.key, gesture.to);
    else this._render();
  },

  /// Ancora l'oggetto a `rect`: la cella sotto il suo angolo in alto a
  /// sinistra e lo scarto da lei, con la misura, nei pixel del file. Si
  /// mostra lì subito; se il comando non entra, torna dov'era.
  _placeObject(this: GridEngine, key: string, rect: ObjectRect): void {
    const object = this._objectByKey(key);
    const kind = object ? MOVABLE[object.kind] : undefined;
    if (!object || !kind) return;
    const frame = this._frame;
    const scale = WORKBOOK_SCALE * frame.zoom;
    // `rect` sta nel piano della zona da cui l'oggetto è partito: nel
    // riquadro una fascia ferma non è scorsa. Dove l'angolo cade sopra le
    // righe o le colonne bloccate l'ancora è loro, e lì un punto sta fermo
    // con lo scorrimento; altrove è del corpo.
    const from = this._objectZone(object);
    const scroll = this._zoneScroll(from === "left" || from === "corner", from === "top" || from === "corner");
    const screenX = rect.left - scroll.left - frame.rowHeader;
    const screenY = rect.top - scroll.top - frame.columnHeader;
    const frozenX = frame.frozenColumns > 0 && screenX < frame.frozenWidth;
    const frozenY = frame.frozenRows > 0 && screenY < frame.frozenHeight;
    const x = Math.max(0, frozenX ? screenX : screenX + this._viewport.scrollLeft);
    const y = Math.max(0, frozenY ? screenY : screenY + this._viewport.scrollTop);
    // Sulla stessa linea di una riga o di una colonna nascosta l'ancora resta
    // quella del file.
    const near = (sizes: AxisLayout, at: number, own: number) => {
      const index = indexAt(sizes, at);
      return own < sizes.sizes.length && sizes.offsets[own] === sizes.offsets[index] ? own : index;
    };
    const column = near(this._columns, x, object.column);
    const row = near(this._rows, y, object.row);
    if (column < 0 || row < 0) return;
    const round = (value: number) => Math.round(value * 100) / 100;
    const params = {
      kind,
      id: object.id,
      at: cellA1({ row, column }),
      dx: round((x - this._columns.offsets[column]) / scale),
      dy: round((y - this._rows.offsets[row]) / scale),
      width: round(rect.width / scale),
      height: round(rect.height / scale),
    };
    const placed = { key, before: object, rect: { ...rect, left: frame.rowHeader + x, top: frame.columnHeader + y }, zone: zoneOf(frozenX, frozenY) };
    this._placed = placed;
    this._render();
    void this.run("object.move", JSON.stringify(params)).then((run) => {
      if (run.ok || this._placed !== placed) return;
      this._placed = null;
      if (run.error) this._refuse(t("grid.workbook.command_failed", { error: run.error }));
      this._render();
    });
  },

  /// Apre il testo di una forma sul posto: Invio con Ctrl, o uscire, lo
  /// scrive; Esc lo lascia com'era.
  _beginObjectText(this: GridEngine, key: string): void {
    const object = this._objectByKey(key);
    if (!object?.shape || object.shape.kind !== "text_box" || !this.commandable()) return;
    if (this._objectText?.key === key) {
      this._objectText.field.focus();
      return;
    }
    this._finishObjectText(true);
    this._selectedObject = key;
    const field = document.createElement("textarea");
    field.className = "grid-object-text-editor";
    field.value = object.shape.text;
    field.setAttribute("aria-label", objectLabel(object));
    field.style.fontSize = `${(object.shape.font_size * (96 / 72) * WORKBOOK_SCALE * this._frame.zoom).toFixed(2)}px`;
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // Esc e Ctrl+Invio a metà di una composizione sono del metodo
      // d'immissione: scartano o confermano il candidato, non il testo.
      if (composingKey(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this._finishObjectText(false);
        this._viewport.focus();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this._finishObjectText(true);
        this._viewport.focus();
      }
    }, { signal: this._abort.signal });
    field.addEventListener("blur", () => queueMicrotask(() => {
      if (this._objectText?.field === field) this._finishObjectText(true);
    }), { signal: this._abort.signal });
    for (const type of ["pointerdown", "copy", "cut", "paste"] as const) {
      field.addEventListener(type, (event) => event.stopPropagation(), { signal: this._abort.signal });
    }
    this._objectText = { key, field, original: object.shape.text };
    this._render();
    field.focus();
  },

  _finishObjectText(this: GridEngine, commit: boolean): void {
    const editing = this._objectText;
    if (!editing) return;
    this._objectText = null;
    editing.field.remove();
    const object = this._objectByKey(editing.key);
    if (commit && object && editing.field.value !== editing.original) {
      this.command("shape.setText", JSON.stringify({ id: object.id, text: editing.field.value }));
    }
    this._render();
  },
};
export type ObjectsMethods = typeof objectsMethods;
