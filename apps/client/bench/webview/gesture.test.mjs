// Il gesto di S3 e S9 dalla misura vera della pagina: sotto Xvfb la finestra
// è quella chiesta e il gesto resta ±400 px; con un gestore a tessere la
// finestra può essere 800 × 1896, e il gesto deve restare dentro e dirlo.
// In `.mjs` come `display.test.mjs`: il modulo gira in Node nel banco.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PAN_DX, PAN_MARGIN, panGesture, panNote, requestedWindow, windowNote } from "./gesture.mjs";

/// Ogni punto del trascinamento di `drag` in `run.mjs`: `x + dx · sin`, arrotondato.
function points({ x, dx }) {
  return Array.from({ length: 188 }, (_, i) => Math.round(x + dx * Math.sin(((i + 1) / 188) * Math.PI * 2)));
}

describe("il gesto di spostamento dalla misura vera", () => {
  it("nella finestra chiesta (1280 × 840, come sotto Xvfb) ha l'ampiezza piena", () => {
    const page = { width: 1280, height: 840 };
    const gesture = panGesture({ view: { left: 52, top: 80, right: 1280, bottom: 818 }, page });
    expect(gesture).toEqual({ x: 666, y: 449, dx: PAN_DX, want: PAN_DX, reduced: false });
    expect(panNote(gesture, page)).toBeNull();
  });

  it("nella finestra di niri (800 × 1896) si restringe, resta dentro e lo dice", () => {
    // Il caso di «move target out of bounds»: il centro a 451 e ±400 px.
    const page = { width: 800, height: 1896 };
    const view = { left: 52, top: 80, right: 800, bottom: 1874 };
    const gesture = panGesture({ view, page });
    expect(gesture.reduced).toBe(true);
    expect(gesture.dx).toBeLessThan(PAN_DX);
    for (const x of points(gesture)) {
      expect(x).toBeGreaterThanOrEqual(view.left + PAN_MARGIN);
      expect(x).toBeLessThanOrEqual(page.width - 1 - PAN_MARGIN);
    }
    expect(panNote(gesture, page)).toContain(`±${gesture.dx} px invece di ±${PAN_DX}`);
    expect(panNote(gesture, page)).toContain("800 × 1896");
  });

  it("una vista che sborda dalla pagina conta solo la parte visibile", () => {
    const page = { width: 900, height: 700 };
    const gesture = panGesture({ view: { left: -200, top: -50, right: 1400, bottom: 900 }, page });
    expect(gesture.x).toBe(450);
    expect(gesture.y).toBe(350);
    expect(gesture.x + gesture.dx).toBeLessThanOrEqual(page.width - 1);
    expect(gesture.x - gesture.dx).toBeGreaterThanOrEqual(0);
  });

  it("una vista troppo stretta o fuori dalla pagina fa fallire lo scenario con il motivo", () => {
    const page = { width: 800, height: 600 };
    expect(() => panGesture({ view: { left: 600, top: 0, right: 790, bottom: 600 }, page })).toThrow(/troppo stretta/);
    expect(() => panGesture({ view: { left: 900, top: 0, right: 1200, bottom: 600 }, page })).toThrow(/non si vede/);
  });
});

describe("la misura della finestra", () => {
  it("legge quella chiesta dalla configurazione vera dell'app", () => {
    const conf = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../crates/fub-app/tauri.conf.json", import.meta.url)), "utf8"));
    expect(requestedWindow(conf)).toEqual({ width: 1280, height: 840 });
    expect(requestedWindow({})).toBeNull();
  });

  it("tace con la misura chiesta e parla con quella del gestore a tessere", () => {
    const requested = { width: 1280, height: 840 };
    expect(windowNote({ width: 1280, height: 839 }, requested)).toBeNull();
    expect(windowNote({ width: 800, height: 1896 }, requested)).toContain("800 × 1896 invece dei 1280 × 840");
    expect(windowNote({ width: 800, height: 1896 }, null)).toBeNull();
  });
});
