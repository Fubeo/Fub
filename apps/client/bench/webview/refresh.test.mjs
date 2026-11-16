// Le soglie del banco WebView legate alla frequenza dello schermo
// (`refresh.mjs`): da dove viene il periodo, il tetto dei 60 Hz di WebKitGTK
// e il formato di `budgets.json`. In `.mjs` perché usa Node, come
// `display.test.mjs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SIXTY_HZ_MS, displayRate, engineCap, hasPeriodLimits, parseGdk, parseHyprland, parseNiri, parseSway, resolveLimit } from "./refresh.mjs";

const budgets = JSON.parse(readFileSync(new URL("./budgets.json", import.meta.url), "utf8"));

/// Un `run` finto: risponde per comando, lancia per gli altri.
const fake = (answers) => (command) => {
  if (command in answers) return answers[command];
  throw new Error(`${command}: non trovato`);
};

describe("la frequenza dello schermo", () => {
  it("--hz vince su tutto", () => {
    const read = displayRate({ args: { hz: "144" }, env: { WAYLAND_DISPLAY: "w", NIRI_SOCKET: "s" }, run: fake({}) });
    expect(read).toMatchObject({ hz: 144, periodMs: 6.94, source: "--hz" });
    expect(() => displayRate({ args: { hz: "0" } })).toThrow(/--hz/);
  });

  it("su niri legge l'uscita a fuoco, in mHz", () => {
    const niri = JSON.stringify({ name: "DP-2", current_mode: 1, modes: [{ refresh_rate: 59951 }, { refresh_rate: 179960 }] });
    const read = displayRate({ env: { WAYLAND_DISPLAY: "w", NIRI_SOCKET: "s" }, platform: "linux", run: fake({ niri }) });
    expect(read).toMatchObject({ hz: 179.96, periodMs: 5.56, source: "niri: DP-2" });
  });

  it("sway e Hyprland: l'uscita a fuoco", () => {
    expect(parseSway(JSON.stringify([{ name: "A", focused: false, current_mode: { refresh: 60000 } }, { name: "B", focused: true, current_mode: { refresh: 143973 } }]))).toEqual({ hz: 143.973, name: "B" });
    expect(parseHyprland(JSON.stringify([{ name: "A", focused: true, refreshRate: 165.0 }]))).toEqual({ hz: 165, name: "A" });
    expect(parseNiri(JSON.stringify({ name: "X", current_mode: null, modes: [] }))).toBeNull();
  });

  it("GDK: uno schermo, o la stessa frequenza, o il primario; altrimenti nessuna scelta", () => {
    expect(parseGdk("179960 0 LG\n")).toEqual({ hz: 179.96, name: "LG" });
    expect(parseGdk("60000 0 A\n60000 0 B\n")).toEqual({ hz: 60, name: "A, B" });
    expect(parseGdk("179960 0 LG\n60000 1 ZOWIE XL\n")).toEqual({ hz: 60, name: "ZOWIE XL" });
    expect(parseGdk("179960 0 LG\n60000 0 ZOWIE\n")).toMatchObject({ hz: null, ambiguous: ["LG 179.96 Hz", "ZOWIE 60 Hz"] });
  });

  it("sotto Xvfb GDK dà 0 Hz: P resta 16,67 ms, e il referto dice perché", () => {
    const read = displayRate({ env: { DISPLAY: ":99" }, platform: "linux", run: fake({ python3: "0 0 screen\n" }) });
    expect(read).toMatchObject({ hz: 60, periodMs: 16.67, source: "predefinita" });
    expect(read.notes.join(" ")).toMatch(/gdk: nessuna frequenza valida/);
  });

  it("senza compositor noto, senza display e fuori da Linux: 60 Hz", () => {
    expect(displayRate({ env: {}, platform: "linux", run: fake({}) }).source).toBe("predefinita");
    expect(displayRate({ env: { DISPLAY: ":0" }, platform: "win32", run: fake({ python3: "144000 1 X\n" }) }).hz).toBe(60);
  });

  it("un compositor che non risponde lascia provare GDK", () => {
    const read = displayRate({ env: { WAYLAND_DISPLAY: "w", NIRI_SOCKET: "s" }, platform: "linux", run: fake({ python3: "143973 0 DP-1\n" }) });
    expect(read).toMatchObject({ hz: 143.97, source: "gdk: DP-1" });
    expect(read.notes[0]).toMatch(/^niri:/);
  });
});

describe("il tetto del motore", () => {
  it("a 180 Hz con il rAF a vuoto a 16 ms: tetto, le soglie valgono a 60 Hz", () => {
    const cap = engineCap(16, 5.56);
    expect(cap.capped).toBe(true);
    expect(cap.effectiveMs).toBeCloseTo(SIXTY_HZ_MS, 1);
    expect(cap.label).toMatch(/^tetto del motore: .*valgono a 60 Hz finché il tetto c'è$/);
  });

  it("su uno schermo a 60 Hz non c'è tetto da dichiarare", () => {
    expect(engineCap(16, 16.67)).toMatchObject({ capped: false, effectiveMs: 16.67 });
  });

  it("il rAF che segue lo schermo: P resta quello dello schermo", () => {
    expect(engineCap(5.6, 5.56)).toMatchObject({ capped: false, effectiveMs: 5.56 });
  });

  it("una mediana lontana dai 60 Hz non è il tetto: P resta, e F1 diventa rosso", () => {
    const cap = engineCap(25, 5.56);
    expect(cap).toMatchObject({ capped: false, effectiveMs: 5.56 });
    expect(resolveLimit(budgets.targets["F1.raf.mediana"], cap.effectiveMs)).toBeLessThan(25);
  });

  it("senza F1 le soglie valgono con P dello schermo", () => {
    expect(engineCap(null, 6.94)).toMatchObject({ capped: false, effectiveMs: 6.94, rafMedianMs: null });
  });
});

describe("budgets.json in periodi", () => {
  it("è la versione 2, e ogni voce è un numero o { periodi }", () => {
    expect(budgets.version).toBe(2);
    for (const section of ["targets", "ci"]) {
      for (const [key, entry] of Object.entries(budgets[section])) {
        expect(typeof resolveLimit(entry, 16.67), `${section}.${key}`).toBe("number");
      }
    }
    expect(() => resolveLimit({ ms: 3 }, 16.67)).toThrow(/soglia non valida/);
  });

  it("le soglie dei fotogrammi sono in periodi: p95 1 P, massimo 2 P, tasto 2 P", () => {
    const t = budgets.targets;
    for (const key of ["S3.frameGap.p95", "S9.frameGap.p95"]) expect(t[key], key).toEqual({ periodi: 1 });
    for (const key of ["S3.frameGap.max", "S5.penFrameGap.max", "S7.frameGap.max", "S8.penFrameGap.max", "S9.frameGap.max"]) expect(t[key], key).toEqual({ periodi: 2 });
    for (const key of ["S1.keyToPaint.p95", "S9.keyToPaint.p95"]) expect(t[key], key).toEqual({ periodi: 2 });
    // A 180 Hz il tasto a schermo deve stare in 11,1 ms; a 60 in 33,3.
    expect(resolveLimit(t["S1.keyToPaint.p95"], 5.56)).toBe(11.1);
    expect(resolveLimit(t["S1.keyToPaint.p95"], 16.67)).toBe(33.3);
  });

  it("le soglie della CI restano in ms, quelle di prima", () => {
    expect(hasPeriodLimits(budgets.ci)).toBe(false);
    expect(hasPeriodLimits(budgets.targets)).toBe(true);
    expect(budgets.ci).toMatchObject({ "S1.keyToPaint.p95": 330, "S2.noteSwitch.p95": 780, "S3.frameGap.p95": 360, "S3.frameGap.max": 1600, "S7.frameGap.p95": 340, "S7.frameGap.max": 1150 });
  });
});
