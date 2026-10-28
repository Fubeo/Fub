// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accessibleName } from "../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { listenerLedger, pointer, press } from "../testing";
import { createColorPicker, type ColorPickerOptions, type ColorPickerText } from "./picker";
import { colorWell } from "./well";

const TEXT: ColorPickerText = {
  area: "Saturazione e luminosità",
  areaValue: (s, v) => `saturazione ${s}%, luminosità ${v}%`,
  hue: "Tinta",
  alpha: "Opacità",
  format: "Formato",
  formats: { hex: "Esadecimale", rgb: "RGB", hsl: "HSL", oklch: "OKLCH" },
  code: "Codice del colore",
  invalid: "Questo colore non si legge",
  eyedropper: "Prendi un colore dallo schermo",
  recommended: "Consigliati",
  documentColors: "Del documento",
  recent: "Recenti",
  theme: "Del tema",
  none: "Nessuno",
};

const RECOMMENDED = [
  { color: "#000000", name: "Nero" },
  { color: "#0072B2", name: "Blu" },
  { color: "#d55e00", name: "Vermiglio" },
];

let life: Lifetime;
let changes: string[];
let inputs: string[];

function picker(extra: Partial<ColorPickerOptions> = {}) {
  const made = createColorPicker({
    value: "#0072b2",
    text: TEXT,
    recommended: RECOMMENDED,
    recent: [{ color: "#123456", name: "#123456" }],
    onChange: (color) => changes.push(color),
    onInput: (color) => inputs.push(color),
    lifetime: life,
    ...extra,
  });
  document.body.append(made.element);
  return made;
}

beforeEach(() => {
  life = openLifetime();
  changes = [];
  inputs = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
  delete (globalThis as { EyeDropper?: unknown }).EyeDropper;
});

describe("il selettore del colore del kit", () => {
  it("i consigliati sono in cima, col nome, e quello scelto ha la spunta", () => {
    const { element } = picker();
    const groups = [...element.querySelectorAll(".kit-color-group-title")].map((title) => title.textContent);
    expect(groups).toEqual(["Consigliati", "Recenti"]);
    const swatches = [...element.querySelectorAll<HTMLButtonElement>(".kit-color-swatch")];
    expect(swatches.map((swatch) => accessibleName(swatch))).toEqual(["Nero", "Blu", "Vermiglio", "#123456"]);
    expect(swatches.map((swatch) => swatch.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    expect(swatches[1]!.title).toBe("Blu");
    swatches[2]!.click();
    expect(changes).toEqual(["#d55e00"]);
    expect(swatches[2]!.classList.contains("selected")).toBe(true);
  });

  it("il quadrato e la tinta sono cursori: le frecce cambiano e confermano", () => {
    const { element, value } = picker({ value: "#ff0000" });
    const area = element.querySelector<HTMLElement>(".kit-color-area")!;
    const hue = element.querySelector<HTMLElement>(".kit-color-hue")!;
    expect(area.getAttribute("role")).toBe("slider");
    expect(accessibleName(area)).toBe("Saturazione e luminosità");
    expect(area.getAttribute("aria-valuetext")).toBe("saturazione 100%, luminosità 100%");
    press(area, "ArrowDown", { shiftKey: true });
    expect(area.getAttribute("aria-valuetext")).toBe("saturazione 100%, luminosità 90%");
    expect(changes).toEqual(["#e60000"]);
    press(hue, "ArrowRight", { shiftKey: true });
    press(hue, "ArrowRight", { shiftKey: true });
    expect(hue.getAttribute("aria-valuenow")).toBe("20");
    expect(value()).toBe(changes[changes.length - 1]);
    press(area, "Home");
    expect(value()).toBe("#000000");
  });

  it("trascinare mostra i colori e ne conferma uno al rilascio", () => {
    const { element } = picker({ value: "#ff0000" });
    const area = element.querySelector<HTMLElement>(".kit-color-area")!;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    area.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 0 }));
    area.dispatchEvent(pointer("pointermove", { clientX: 0, clientY: 0 }));
    area.dispatchEvent(pointer("pointermove", { clientX: 100, clientY: 50 }));
    expect(inputs).toEqual(["#ff0000", "#ffffff", "#800000"]);
    expect(changes).toEqual([]);
    area.dispatchEvent(pointer("pointerup", { clientX: 100, clientY: 50 }));
    expect(changes).toEqual(["#800000"]);
  });

  it("il codice si scrive nei quattro modi, e uno che non si legge si dice", () => {
    const { element } = picker();
    const input = element.querySelector<HTMLInputElement>(".kit-color-input")!;
    const select = element.querySelector<HTMLSelectElement>(".kit-color-format")!;
    expect(accessibleName(input)).toBe("Codice del colore");
    expect(accessibleName(select)).toBe("Formato");
    expect(input.value).toBe("#0072b2");
    select.value = "rgb";
    select.dispatchEvent(new Event("change"));
    expect(input.value).toBe("rgb(0 114 178)");
    input.value = "hsl(0 100% 50%)";
    press(input, "Enter");
    expect(changes).toEqual(["#ff0000"]);
    input.value = "giallo";
    press(input, "Enter");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(changes).toEqual(["#ff0000"]);
  });

  it("l'alfa c'è solo se si chiede, e il colore esce con le otto cifre", () => {
    expect(picker().element.querySelector(".kit-color-alpha")).toBeNull();
    const { element } = picker({ alpha: true, value: "#000000" });
    const alpha = element.querySelector<HTMLElement>(".kit-color-alpha")!;
    expect(accessibleName(alpha)).toBe("Opacità");
    press(alpha, "ArrowLeft", { shiftKey: true });
    expect(changes).toEqual(["#000000e6"]);
  });

  it("«Nessuno» e il misto", () => {
    const { element, setValue } = picker({ allowNone: true, value: "none" });
    const none = element.querySelector<HTMLButtonElement>(".kit-color-swatch.none")!;
    expect(accessibleName(none)).toBe("Nessuno");
    expect(none.getAttribute("aria-pressed")).toBe("true");
    setValue(null);
    expect([...element.querySelectorAll(".kit-color-swatch.selected")]).toHaveLength(0);
    expect(element.querySelector<HTMLInputElement>(".kit-color-input")!.value).toBe("");
  });

  it("il contagocce del browser, o quello di chi chiama, o nessuno", async () => {
    expect(picker().element.querySelector(".kit-color-dropper")).toBeNull();
    const offered = picker({ eyedropper: async () => "#56b4e9" });
    offered.element.querySelector<HTMLButtonElement>(".kit-color-dropper")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual(["#56b4e9"]);
    (globalThis as { EyeDropper?: unknown }).EyeDropper = class {
      open = async () => ({ sRGBHex: "#009e73" });
    };
    const browser = picker({ eyedropper: async () => "#ffffff" });
    browser.element.querySelector<HTMLButtonElement>(".kit-color-dropper")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toEqual(["#56b4e9", "#009e73"]);
  });

  it("il pozzo dice il nome, apre il selettore e scrive la scelta", () => {
    const ledger = listenerLedger(document, window);
    const picked: string[] = [];
    const well = colorWell({
      label: "Colore",
      value: "#0072b2",
      text: TEXT,
      mixedText: "Misto",
      recommended: RECOMMENDED,
      onChange: (color) => picked.push(color),
      lifetime: life,
    });
    document.body.append(well.element);
    expect(accessibleName(well.button)).toBe("Colore: Blu");
    expect(well.element.querySelector(".kit-color-well-name")?.textContent).toBe("Blu");
    well.button.click();
    expect(well.button.getAttribute("aria-expanded")).toBe("true");
    const popover = document.querySelector<HTMLElement>(".kit-color-popover")!;
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Blu");
    popover.querySelector<HTMLButtonElement>('.kit-color-swatch[data-color="#d55e00"]')!.click();
    expect(picked).toEqual(["#d55e00"]);
    expect(accessibleName(well.button)).toBe("Colore: Vermiglio");
    well.setValue("#abcdef");
    expect(accessibleName(well.button)).toBe("Colore: #abcdef");
    well.setValue(null);
    expect(accessibleName(well.button)).toBe("Colore: Misto");
    well.close();
    expect(well.button.getAttribute("aria-expanded")).toBe("false");
    life.close();
    expect(ledger()).toBe(0);
  });
});
