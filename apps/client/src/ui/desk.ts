// La riga di comandi di un riquadro della Scrivania (`fub:desk-tile`).
//
// La Scrivania è una view dichiarata (`dashboard/desk.rs` in fub-features):
// ogni riquadro è uno stack con la chiave `desk:<id>`, con in testa il titolo
// e un nodo `Custom` di questo ns. Una shell che non lo conosce disegna il
// ripiego, tre bottoni; questa ci disegna la maniglia da trascinare, i tasti
// Ctrl Maiusc ↑↓ e «Togli».
//
// # Che cosa il payload porta, e che cosa no
//
// Il payload porta **un'azione già pronta per ogni posto** (`moves`): spostare
// il riquadro al posto `n` è premere `moves[n]`, e la shell non scrive niente
// in un payload — è il contratto di `ActionRef`. Porta anche la chiave del
// riquadro (`frame`), che è l'elemento su cui si lascia un riquadro
// trascinato e dove valgono i tasti, e l'esemplare della view (`desk`), perché
// due Scrivanie aperte in due riquadri non si scambino i riquadri.
//
// Il titolo no: è un testo tradotto dal kernel, e nel payload non passa di
// lì. Le etichette lo leggono dal titolo disegnato accanto, quando il nodo è
// nella pagina.
//
// # Quando
//
// Il disegno di un nodo avviene staccato dalla pagina: il riquadro attorno si
// trova un microtask dopo, quando `mountTree` ha finito il suo giro. Il nodo
// si rifà quando il suo posto cambia (`at` è nel payload); il riquadro resta,
// e i suoi ascoltatori li toglie lo smontaggio del nodo che li ha messi.
import type { ActionRef } from "../host/contract";
import { registerCustomRenderer, type OnAction } from "./custom";
import { iconEl } from "./icons";
import { setTooltip } from "./tooltip";
import { t } from "../i18n/strings";

export const DESK_TILE_NS = "fub:desk-tile";

/// Il tipo di dato che un riquadro trascinato porta: solo dentro Fub.
const DRAG_TYPE = "application/x-fub-desk-tile";

interface TilePayload {
  desk: string;
  frame: string;
  tile: string;
  at: number;
  moves: ActionRef[];
  hide: ActionRef;
}

function isAction(value: unknown): value is ActionRef {
  return typeof value === "object" && value !== null && typeof (value as ActionRef).action === "string";
}

/// Un payload che questa shell sa disegnare; gli altri ricevono il ripiego.
export function acceptsDeskTile(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Partial<TilePayload>;
  return typeof p.desk === "string"
    && typeof p.frame === "string"
    && typeof p.tile === "string"
    && typeof p.at === "number"
    && Number.isInteger(p.at)
    && Array.isArray(p.moves)
    && p.moves.every(isAction)
    && p.at >= 0
    && p.at < p.moves.length
    && isAction(p.hide);
}

/// Il riquadro in mano, finché il trascinamento dura.
let dragging: { desk: string; tile: string; moves: ActionRef[] } | null = null;

/// Il fuoco da rimettere dopo uno spostamento da tastiera: lo spostamento
/// ridisegna la riga di comandi, e un elemento spostato nella pagina perde il
/// fuoco.
let refocus: { desk: string; tile: string; target: HTMLElement | null; role: Role } | null = null;

/// Quale comando aveva il fuoco: rifatta la riga, lo ha il suo gemello.
type Role = "grip" | "up" | "down" | null;

function button(className: string, icon: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  const svg = iconEl(icon);
  if (svg) el.appendChild(svg);
  return el;
}

/// I sei occhi della maniglia: non c'è una figura del repertorio per questo.
function gripEyes(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("desk-grip-eyes");
  for (const x of [9, 15]) {
    for (const y of [6, 12, 18]) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "1.5");
      svg.appendChild(dot);
    }
  }
  return svg;
}

function clearDropMarks(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-desk-drop]")) delete el.dataset.deskDrop;
}

/// Disegna la riga di comandi di un riquadro.
export function renderDeskTile(host: HTMLElement, raw: unknown, onAction: OnAction): () => void {
  const payload = raw as TilePayload;
  const { at, moves } = payload;
  const last = moves.length - 1;
  host.classList.add("desk-commands");

  const grip = button("desk-grip", "");
  grip.appendChild(gripEyes());
  grip.draggable = true;
  grip.setAttribute("aria-keyshortcuts", "Control+Shift+ArrowUp Control+Shift+ArrowDown");
  const up = button("desk-step desk-up", "chevron-up");
  up.disabled = at === 0;
  const down = button("desk-step desk-down", "chevron-up");
  down.disabled = at === last;
  const hide = button("desk-hide", "close");
  host.append(grip, up, down, hide);

  const press = (action: ActionRef | undefined): void => {
    if (action) void onAction(action, []);
  };
  const step = (by: -1 | 1, target: HTMLElement | null): void => {
    const to = at + by;
    if (to < 0 || to > last) return;
    const role: Role = target === grip ? "grip" : target === up ? "up" : target === down ? "down" : null;
    refocus = { desk: payload.desk, tile: payload.tile, target, role };
    press(moves[to]);
  };
  up.addEventListener("click", () => step(-1, up));
  down.addEventListener("click", () => step(1, down));
  hide.addEventListener("click", () => press(payload.hide));

  grip.addEventListener("dragstart", (event) => {
    dragging = { desk: payload.desk, tile: payload.tile, moves };
    event.dataTransfer?.setData(DRAG_TYPE, payload.tile);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    const frame = frameOf();
    if (frame && event.dataTransfer) event.dataTransfer.setDragImage(frame, 24, 16);
    frame?.setAttribute("data-desk-held", "");
  });
  grip.addEventListener("dragend", () => {
    dragging = null;
    frameOf()?.removeAttribute("data-desk-held");
    clearDropMarks();
  });

  // Il riquadro attorno: si trova quando il nodo è nella pagina.
  let frame: HTMLElement | null = null;
  const frameOf = (): HTMLElement | null => frame;
  const accepts = (): boolean =>
    dragging !== null && dragging.desk === payload.desk && dragging.tile !== payload.tile;
  const onDragOver = (event: DragEvent): void => {
    if (!accepts()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (frame && frame.dataset.deskDrop === undefined) {
      clearDropMarks();
      frame.dataset.deskDrop = "";
    }
  };
  const onDragLeave = (event: DragEvent): void => {
    if (!frame || (event.relatedTarget instanceof Node && frame.contains(event.relatedTarget))) return;
    delete frame.dataset.deskDrop;
  };
  const onDrop = (event: DragEvent): void => {
    if (!accepts()) return;
    event.preventDefault();
    const moving = dragging!;
    dragging = null;
    clearDropMarks();
    // L'azione del riquadro in mano, al posto di questo.
    press(moving.moves[at]);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    // Un campo ha i suoi Ctrl Maiusc ↑↓ (selezionare fino in cima).
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    step(event.key === "ArrowUp" ? -1 : 1, target);
  };

  let disposed = false;
  queueMicrotask(() => {
    if (disposed || !host.isConnected) return;
    frame = host.closest<HTMLElement>(`[data-key="${CSS.escape(payload.frame)}"]`);
    if (!frame) return;
    frame.addEventListener("dragover", onDragOver);
    frame.addEventListener("dragleave", onDragLeave);
    frame.addEventListener("drop", onDrop);
    frame.addEventListener("keydown", onKey);
    const title = frame.querySelector(".ui-heading")?.textContent?.trim() || payload.tile;
    grip.setAttribute("aria-label", t("desk.grip", { title }));
    setTooltip(grip, t("desk.grip.hint"));
    up.setAttribute("aria-label", t("desk.up", { title }));
    down.setAttribute("aria-label", t("desk.down", { title }));
    hide.setAttribute("aria-label", t("desk.hide", { title }));
    setTooltip(hide, t("desk.hide", { title }));
    if (refocus && refocus.desk === payload.desk && refocus.tile === payload.tile) {
      const { target, role } = refocus;
      refocus = null;
      // Il fuoco era dentro il riquadro: ci torna, su ciò che lo aveva se c'è
      // ancora, se no sul gemello del comando premuto (la maniglia, se il
      // gemello non si preme più perché il riquadro è arrivato in fondo).
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        const twin = role === "up" ? up : role === "down" ? down : grip;
        const next = target?.isConnected && frame.contains(target) ? target : twin.disabled ? grip : twin;
        next.focus();
      }
    }
  });

  return () => {
    disposed = true;
    if (!frame) return;
    frame.removeEventListener("dragover", onDragOver);
    frame.removeEventListener("dragleave", onDragLeave);
    frame.removeEventListener("drop", onDrop);
    frame.removeEventListener("keydown", onKey);
  };
}

/// La shell sa disegnare la riga di comandi dei riquadri.
export function registerDeskRenderer(): void {
  registerCustomRenderer(DESK_TILE_NS, (host, payload, onAction) => renderDeskTile(host, payload, onAction), acceptsDeskTile);
}
