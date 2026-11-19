// @vitest-environment happy-dom
// I margini e le guide dello spazio «Esporta in PDF» (T72): i margini restano
// dentro la pagina anche più larghi del foglio, lo specchio scambia i lati
// sulle pagine pari, e la guida trascinata cambia il margine dal bordo della
// pagina al puntatore, col cartellino accanto.

import { afterEach, describe, expect, it, vi } from "vitest";
import { attachGuides, clampMargins, marginAt, marginPreset, marginsOfPage, MARGIN_PRESETS, sideOfGuide } from "./guides";
import { defaultProfile, geometryOf, MM, paperSize, type ExportProfile } from "./profile";

const A4: readonly [number, number] = [210, 297];

describe("i margini", () => {
  it("stanno fra 5 e 70 mm; un valore che non è un numero torna a quello normale", () => {
    expect(clampMargins({ sopra: 2, destra: 90, sotto: 25, sinistra: 22 }, A4)).toEqual({ sopra: 5, destra: 70, sotto: 25, sinistra: 22 });
    expect(clampMargins({ sopra: Number.NaN, destra: 22, sotto: 25, sinistra: 22 }, A4).sopra).toBe(25);
  });

  it("più larghi della pagina lasciano al testo 30 mm, e cede il lato che si sta cambiando", () => {
    // A5 è largo 148 mm: 70 + 70 lascerebbero 8 mm.
    const a5: readonly [number, number] = [148, 210];
    expect(clampMargins({ sopra: 25, destra: 70, sotto: 25, sinistra: 70 }, a5, "sinistra")).toEqual({ sopra: 25, destra: 70, sotto: 25, sinistra: 48 });
    expect(clampMargins({ sopra: 25, destra: 70, sotto: 25, sinistra: 70 }, a5, "destra")).toEqual({ sopra: 25, destra: 48, sotto: 25, sinistra: 70 });
    // Un foglio piccolissimo: i margini più stretti, e il testo ha il resto.
    const tiny: readonly [number, number] = [50, 50];
    const margins = clampMargins({ sopra: 70, destra: 70, sotto: 70, sinistra: 70 }, tiny);
    expect(margins.sinistra + margins.destra).toBeLessThanOrEqual(50 - 30);
    expect(Math.min(...Object.values(margins))).toBeGreaterThanOrEqual(5);
  });

  it("la pagina non resta mai senza posto per il testo, neanche con un profilo scritto a mano", () => {
    const page = { ...defaultProfile().pagina, formato: "A5", margini: { sopra: 70, destra: 70, sotto: 70, sinistra: 70 } };
    const geometry = geometryOf(page);
    expect(geometry.width - geometry.margin.left - geometry.margin.right).toBeCloseTo(30 * MM, 0);
    expect(geometry.height - geometry.margin.top - geometry.margin.bottom).toBeGreaterThan(0);
  });

  it("riconosce i tre pronti, e i tuoi non sono nessuno", () => {
    expect(marginPreset(MARGIN_PRESETS.stretti)).toBe("stretti");
    expect(marginPreset(defaultProfile().pagina.margini)).toBe("normali");
    expect(marginPreset({ sopra: 25, destra: 22, sotto: 25, sinistra: 23 })).toBeNull();
  });

  it("a specchio, sulle pagine pari destra e sinistra si scambiano, e la guida di sinistra cambia il margine destro", () => {
    const m = { sopra: 20, destra: 15, sotto: 20, sinistra: 35 };
    expect(marginsOfPage(m, 0, true)).toEqual(m);
    expect(marginsOfPage(m, 1, true)).toEqual({ sopra: 20, destra: 35, sotto: 20, sinistra: 15 });
    expect(marginsOfPage(m, 1, false)).toEqual(m);
    expect(sideOfGuide("sinistra", 1, true)).toBe("destra");
    expect(sideOfGuide("sinistra", 2, true)).toBe("sinistra");
    expect(sideOfGuide("sopra", 1, true)).toBe("sopra");
  });

  it("il margine sotto il puntatore, dal bordo della pagina, in millimetri allo zoom", () => {
    const rect = { left: 100, top: 50, right: 100 + 210 * MM * 0.5, bottom: 50 + 297 * MM * 0.5 };
    const px = MM * 0.5;
    expect(marginAt("sopra", rect, 0, 50 + 30 * px, px)).toBe(30);
    expect(marginAt("sinistra", rect, 100 + 18 * px, 0, px)).toBe(18);
    expect(marginAt("destra", rect, rect.right - 40 * px, 0, px)).toBe(40);
    expect(marginAt("sotto", rect, 0, rect.bottom - 12 * px, px)).toBe(12);
  });
});

describe("le guide", () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.replaceChildren();
  });

  /// Una pagina A4 allo zoom 1 a (0, 0), con le sue guide.
  function stage(start: ExportProfile, index = 0) {
    const root = document.createElement("div");
    const pages = document.createElement("div");
    const slot = document.createElement("div");
    slot.className = "export-slot";
    slot.dataset["page"] = String(index);
    const [w, h] = paperSize(start.pagina);
    slot.getBoundingClientRect = () => ({ left: 0, top: 0, right: w * MM, bottom: h * MM, width: w * MM, height: h * MM, x: 0, y: 0, toJSON: () => ({}) });
    const guides = Object.fromEntries(
      (["sopra", "destra", "sotto", "sinistra"] as const).map((side) => {
        const guide = document.createElement("i");
        guide.className = "export-guide";
        guide.dataset["guide"] = side;
        slot.append(guide);
        return [side, guide];
      }),
    );
    pages.append(slot);
    root.append(pages);
    document.body.append(root);
    let profile = start;
    const changes: { margini: ExportProfile["pagina"]["margini"]; live: boolean }[] = [];
    const done = vi.fn();
    dispose = attachGuides({
      pages,
      root,
      pxPerMm: () => MM,
      profile: () => profile,
      paper: (of) => paperSize(of.pagina),
      change: (next, live) => {
        profile = next;
        changes.push({ margini: next.pagina.margini, live });
      },
      done,
    });
    const tip = () => root.querySelector<HTMLElement>(".export-guide-tip")!;
    return { root, guides, changes, done, tip, profile: () => profile };
  }

  const at = (type: string, x: number, y: number, target: EventTarget = window) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    target.dispatchEvent(event);
  };

  it("trascinata, cambia il margine dal vivo, dice la misura accanto al puntatore e a gesto finito apre la Pagina", () => {
    const s = stage(defaultProfile());
    at("pointerdown", 300, 25 * MM, s.guides.sopra);
    expect(s.root.classList.contains("is-dragging")).toBe(true);
    at("pointermove", 300, 40 * MM);
    expect(s.tip().hidden).toBe(false);
    expect(s.tip().textContent).toBe("Sopra 40 mm");
    expect(s.tip().style.left).toBe("314px");
    expect(s.changes[s.changes.length - 1]).toEqual({ margini: { sopra: 40, destra: 22, sotto: 25, sinistra: 22 }, live: true });
    // Oltre il massimo il margine si ferma a 70 mm.
    at("pointermove", 300, 120 * MM);
    expect(s.profile().pagina.margini.sopra).toBe(70);
    expect(s.tip().textContent).toBe("Sopra 70 mm");
    at("pointerup", 300, 120 * MM);
    expect(s.changes[s.changes.length - 1]?.live).toBe(false);
    expect(s.done).toHaveBeenCalledOnce();
    expect(s.tip().hidden).toBe(true);
    expect(s.root.classList.contains("is-dragging")).toBe(false);
  });

  it("con lo specchio, la guida di sinistra di una pagina pari cambia il margine destro", () => {
    const start = { ...defaultProfile(), pagina: { ...defaultProfile().pagina, specchio: true } };
    const s = stage(start, 1);
    at("pointerdown", 30 * MM, 300, s.guides.sinistra);
    at("pointerup", 30 * MM, 300);
    expect(s.profile().pagina.margini).toEqual({ sopra: 25, destra: 30, sotto: 25, sinistra: 22 });
  });

  it("Esc a metà gesto rimette i margini di prima", () => {
    const s = stage(defaultProfile());
    at("pointerdown", 30 * MM, 300, s.guides.sinistra);
    at("pointermove", 50 * MM, 300);
    expect(s.profile().pagina.margini.sinistra).toBe(50);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.profile().pagina.margini.sinistra).toBe(22);
    expect(s.done).not.toHaveBeenCalled();
    // Il gesto è finito: muovere il puntatore non cambia più niente.
    const count = s.changes.length;
    at("pointermove", 60 * MM, 300);
    expect(s.changes.length).toBe(count);
  });
});
