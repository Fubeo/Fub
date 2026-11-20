// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../ui/menu";
import { defaultProfile, type ProfileShelf } from "./profile";
import { createToolbar, profileMenuItems } from "./toolbar";

function actions() {
  return { back: vi.fn(), zoom: vi.fn(), view: vi.fn(), profile: vi.fn(), print: vi.fn(), exportPdf: vi.fn() };
}

describe("la barra dello spazio", () => {
  it("ogni controllo ha un nome", () => {
    const toolbar = createToolbar("Relazione", actions());
    toolbar.setProfile("Di serie", false);
    for (const control of toolbar.element.querySelectorAll("button")) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim(), control.className).not.toBe("");
    }
    expect(toolbar.element.querySelector(".export-title-note")?.textContent).toBe("Relazione");
    expect(toolbar.element.querySelector(".export-profile")?.getAttribute("aria-label")).toBe("Profilo di esportazione: Di serie");
  });

  it("le viste dicono quale è premuta e passano il gesto", () => {
    const handlers = actions();
    const toolbar = createToolbar("Nota", handlers);
    const views = [...toolbar.element.querySelectorAll<HTMLButtonElement>(".export-segment")];
    expect(views.map((view) => view.textContent)).toEqual(["Una", "Due", "Tutte"]);
    expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    views[2]!.click();
    expect(handlers.view).toHaveBeenCalledWith("tutte");
    toolbar.setView("tutte");
    expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    toolbar.setView("libera");
    expect(views.every((view) => view.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("zoom, indietro, stampa ed esporta arrivano a chi monta", () => {
    const handlers = actions();
    const toolbar = createToolbar("Nota", handlers);
    const [out, inn] = toolbar.element.querySelectorAll<HTMLButtonElement>(".export-zoom-button");
    out!.click();
    inn!.click();
    expect(handlers.zoom.mock.calls).toEqual([[-1], [1]]);
    toolbar.setZoom(0.734);
    expect(toolbar.element.querySelector(".export-zoom-value")?.textContent).toBe("73%");
    toolbar.element.querySelector<HTMLButtonElement>(".export-back")!.click();
    toolbar.element.querySelector<HTMLButtonElement>(".export-print")!.click();
    toolbar.element.querySelector<HTMLButtonElement>(".export-go")!.click();
    expect(handlers.back).toHaveBeenCalledOnce();
    expect(handlers.print).toHaveBeenCalledOnce();
    expect(handlers.exportPdf).toHaveBeenCalledOnce();
  });
});

describe("il menu del profilo", () => {
  const relazione = { ...defaultProfile(), nome: "Relazione", tema: "relazione", frontespizio: { ...defaultProfile().frontespizio, frontespizio: true, indice: true } };
  const shelf = (extra: Partial<ProfileShelf> = {}): ProfileShelf => ({
    profiles: [
      { id: "relazione", name: "Relazione", profile: relazione, future: false },
      { id: "futuro", name: "Futuro", profile: { ...defaultProfile(), nome: "Futuro" }, future: true },
      { id: "rotto", name: "rotto", profile: null, future: false },
    ],
    vaultDefault: null,
    typeDefault: null,
    noteType: null,
    effective: "",
    ...extra,
  });
  function menuActions() {
    return { choose: vi.fn(), saveNew: vi.fn(), saveOver: vi.fn(), copy: vi.fn(), rename: vi.fn(), toggleDefault: vi.fn(), revert: vi.fn() };
  }
  const labels = (items: readonly MenuItem[]) => items.map((item) => item.label);

  it("come nel prototipo: i profili con la loro riga, poi salva come nuovo e torna com'era", () => {
    const items = profileMenuItems({ shelf: shelf(), currentId: "", base: defaultProfile(), modified: false }, menuActions());
    expect(labels(items)).toEqual(["Di serie", "Futuro", "Relazione", "rotto", "Salva come profilo nuovo…", "Predefinito per il vault", "Torna al profilo com'era"]);
    expect(items[0]).toMatchObject({ checked: true, description: "il tema Fub, A4, tutta la nota" });
    expect(items[2]?.description).toBe("il tema Relazione, A4");
    expect(items[1]?.description).toBe("di un Fub più nuovo: non si cambia");
    expect(items[3]).toMatchObject({ disabled: true, description: "il suo file non si legge" });
    expect(items[4]).toMatchObject({ icon: "plus", separator: true });
    // «Di serie» è già il predefinito: niente da accendere.
    expect(items[5]).toMatchObject({ checked: true, disabled: true });
    expect(items[items.length - 1]).toMatchObject({ icon: "history", disabled: true });
  });

  it("le regolazioni uscite dal profilo tolgono la spunta e accendono salva e torna", () => {
    const acts = menuActions();
    const items = profileMenuItems({ shelf: shelf({ vaultDefault: "relazione" }), currentId: "relazione", base: relazione, modified: true }, acts);
    expect(items.find((item) => item.label === "Relazione")?.checked).toBe(false);
    const save = items.find((item) => item.label === "Salva in «Relazione»");
    expect(save?.disabled).toBe(false);
    save?.run?.();
    expect(acts.saveOver).toHaveBeenCalled();
    expect(items.find((item) => item.label === "Predefinito per il vault")?.checked).toBe(true);
    items.find((item) => item.label === "Torna al profilo com'era")?.run?.();
    expect(acts.revert).toHaveBeenCalled();
    items.find((item) => item.label === "Copia il profilo…")?.run?.();
    expect(acts.copy).toHaveBeenCalled();
  });

  it("un profilo futuro si usa ma non si salva né si rinomina", () => {
    const items = profileMenuItems({ shelf: shelf(), currentId: "futuro", base: defaultProfile(), modified: true }, menuActions());
    expect(items.find((item) => item.label === "Salva in «Futuro»")?.disabled).toBe(true);
    expect(items.find((item) => item.label === "Rinomina il profilo…")?.disabled).toBe(true);
  });

  it("con una nota di un tipo c'è il predefinito per il tipo", () => {
    const acts = menuActions();
    const items = profileMenuItems({ shelf: shelf({ noteType: { doc: "Tipi/Libro.md", name: "Libro" }, typeDefault: "relazione" }), currentId: "relazione", base: relazione, modified: false }, acts);
    const forType = items.find((item) => item.label === "Predefinito per le note «Libro»");
    expect(forType).toMatchObject({ checked: true, disabled: false });
    forType?.run?.();
    expect(acts.toggleDefault).toHaveBeenCalledWith("type");
    // Da «Di serie» il predefinito per tipo non si accende: si sceglie un profilo.
    const plain = profileMenuItems({ shelf: shelf({ noteType: { doc: "Tipi/Libro.md", name: "Libro" } }), currentId: "", base: defaultProfile(), modified: false }, acts);
    expect(plain.find((item) => item.label === "Predefinito per le note «Libro»")?.disabled).toBe(true);
  });
});
