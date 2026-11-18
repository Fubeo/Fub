// @vitest-environment happy-dom
// La riga di comandi di un riquadro della Scrivania: Ctrl Maiusc ↑↓ e il
// trascinamento premono l'azione già pronta del posto giusto, e la shell non
// scrive niente nel payload.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionRef } from "../host/contract";
import { acceptsDeskTile, renderDeskTile } from "./desk";

const move = (tile: string, to: number): ActionRef => ({ action: "desk.move", payload: { tile, to } });

function board(tiles: string[]) {
  const onAction = vi.fn(async () => {});
  const boardEl = document.createElement("div");
  document.body.appendChild(boardEl);
  const disposers: (() => void)[] = [];
  tiles.forEach((tile, at) => {
    const frame = document.createElement("div");
    frame.dataset.key = `desk:${tile}`;
    const heading = document.createElement("h3");
    heading.className = "ui-heading";
    heading.textContent = tile.toUpperCase();
    const host = document.createElement("div");
    frame.append(heading, host);
    boardEl.appendChild(frame);
    const payload = {
      desk: "pane-1",
      frame: `desk:${tile}`,
      tile,
      at,
      moves: tiles.map((_, to) => move(tile, to)),
      hide: { action: "desk.hide", payload: { tile } },
    };
    expect(acceptsDeskTile(payload)).toBe(true);
    disposers.push(renderDeskTile(host, payload, onAction));
  });
  const frame = (tile: string) => boardEl.querySelector<HTMLElement>(`[data-key="desk:${tile}"]`)!;
  return { onAction, frame, dispose: () => disposers.forEach((d) => d()) };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("i riquadri della Scrivania", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Ctrl Maiusc ↑ preme lo spostamento al posto di sopra", async () => {
    const { onAction, frame } = board(["pinned", "recent", "tasks"]);
    await tick();
    const grip = frame("recent").querySelector<HTMLButtonElement>(".desk-grip")!;
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(onAction).toHaveBeenCalledWith(move("recent", 0), []);
  });

  it("il primo riquadro non sale e l'ultimo non scende", async () => {
    const { onAction, frame } = board(["pinned", "recent"]);
    await tick();
    expect(frame("pinned").querySelector<HTMLButtonElement>(".desk-up")!.disabled).toBe(true);
    expect(frame("recent").querySelector<HTMLButtonElement>(".desk-down")!.disabled).toBe(true);
    frame("pinned").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Ctrl Maiusc ↑↓ in un campo resta al campo", async () => {
    const { onAction, frame } = board(["pinned", "recent"]);
    await tick();
    const input = document.createElement("input");
    frame("recent").appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("un riquadro lasciato su un altro prende il suo posto", async () => {
    const { onAction, frame } = board(["pinned", "recent", "tasks"]);
    await tick();
    frame("tasks").querySelector(".desk-grip")!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    frame("pinned").dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(frame("pinned").dataset.deskDrop).toBe("");
    frame("pinned").dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(onAction).toHaveBeenCalledWith(move("tasks", 0), []);
    expect(frame("pinned").dataset.deskDrop).toBeUndefined();
  });

  it("le etichette dicono il titolo del riquadro, e «Togli» toglie", async () => {
    const { onAction, frame } = board(["pinned"]);
    await tick();
    const hide = frame("pinned").querySelector<HTMLButtonElement>(".desk-hide")!;
    expect(hide.getAttribute("aria-label")).toContain("PINNED");
    hide.click();
    expect(onAction).toHaveBeenCalledWith({ action: "desk.hide", payload: { tile: "pinned" } }, []);
  });

  it("smontata, la riga non ascolta più il riquadro", async () => {
    const { onAction, frame, dispose } = board(["pinned", "recent"]);
    await tick();
    dispose();
    frame("recent").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("un payload senza le azioni non si disegna", () => {
    expect(acceptsDeskTile({ desk: "a", frame: "b", tile: "c", at: 2, moves: [], hide: { action: "x" } })).toBe(false);
    expect(acceptsDeskTile(null)).toBe(false);
  });
});
