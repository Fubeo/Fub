// L'accento, come controllo: sette campioni e una tinta su misura.
//
// Il valore (`appearance.accent`) è una tinta da 0 a 360, e nel form generico è
// un numero: chi non sa che 265 è un blu deve provare. Qui i sette accenti che
// la serie ha già misurato (`ACCENT_SWATCHES`) sono campioni da premere, e la
// tinta libera resta dietro l'ottavo. Il contratto non cambia: si scrive lo
// stesso numero nella stessa chiave.
//
// Ogni campione ha il colore che l'accento avrebbe davvero in questa luce e a
// questo contrasto: lo calcola la ricetta, non un `hsl()` a occhio.
import "./preferences.css";
import { t, type Key } from "../../../i18n/strings";
import { ACCENT_SWATCHES, palette } from "../../../theme/scrittoio/recipe";
import { ACCENT_KEY, currentContrast, currentTheme, themeSeries } from "../../../theme/theme";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { follow } from "../frame/dom";
import { radioGroup } from "./radios";
import { numberField, setAttr, setDisabled, setText, writeThrough, type Dress } from "./rows";

type SwatchId = (typeof ACCENT_SWATCHES)[number]["id"];

const CUSTOM = "custom";

const NAMES: Readonly<Record<SwatchId, Key>> = {
  "matita-blu": "prefs.accent.matita-blu",
  viola: "prefs.accent.viola",
  prugna: "prefs.accent.prugna",
  terracotta: "prefs.accent.terracotta",
  ocra: "prefs.accent.ocra",
  salvia: "prefs.accent.salvia",
  petrolio: "prefs.accent.petrolio",
};

/// La tinta come la conta la ricetta: intera, e 360 è 0.
export function normalizedHue(hue: number): number {
  return Math.round(((hue % 360) + 360) % 360);
}

/// Il campione di serie che ha questa tinta, se c'è.
export function swatchFor(hue: number): SwatchId | null {
  const wanted = normalizedHue(hue);
  return ACCENT_SWATCHES.find((swatch) => swatch.hue === wanted)?.id ?? null;
}

/// La tinta in vigore, letta dal campo. Un campo vuoto o illeggibile vale il
/// predefinito della serie, che è anche quello dell'host.
export function hueOf(field: HTMLInputElement): number {
  const written = field.value.trim() === "" ? Number.NaN : Number(field.value);
  return normalizedHue(Number.isFinite(written) ? written : themeSeries().defaults.accent);
}

function hueName(hue: number): string {
  const swatch = swatchFor(hue);
  return swatch ? t(NAMES[swatch]) : t("prefs.accent.hue.value", { hue: normalizedHue(hue) });
}

function span(className: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function swatch(id: string): HTMLButtonElement {
  const radio = document.createElement("button");
  radio.type = "button";
  radio.className = id === CUSTOM ? "prefs-swatch prefs-swatch--custom" : "prefs-swatch";
  radio.id = `prefs-accent-${id}`;
  radio.dataset.accent = id;
  radio.setAttribute("role", "radio");
  radio.setAttribute("aria-checked", "false");
  radio.tabIndex = -1;
  // Il segno della scelta: chi non distingue i colori lo vede comunque.
  const mark = span("prefs-swatch-mark");
  mark.innerHTML = icon("check");
  radio.append(mark);
  return radio;
}

export function accentControl(lifetime: Lifetime, panel: HTMLElement): Dress {
  const element = document.createElement("div");
  element.className = "prefs-accent";

  const swatches = document.createElement("div");
  swatches.className = "prefs-accent-swatches";
  swatches.setAttribute("role", "radiogroup");
  const radios = [...ACCENT_SWATCHES.map((entry) => swatch(entry.id)), swatch(CUSTOM)];
  swatches.append(...radios);

  // La tinta libera: compare sotto i campioni quando è lei la scelta.
  const custom = document.createElement("div");
  custom.className = "prefs-accent-custom";
  custom.hidden = true;
  const hueLabel = document.createElement("label");
  hueLabel.className = "sr-only";
  hueLabel.htmlFor = "prefs-accent-hue";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "prefs-hue";
  slider.id = "prefs-accent-hue";
  slider.min = "0";
  slider.max = "360";
  slider.step = "1";
  const readout = document.createElement("output");
  readout.className = "prefs-hue-value";
  readout.setAttribute("for", slider.id);
  custom.append(hueLabel, slider, readout);
  element.append(swatches, custom);

  // «Su misura» è una scelta della persona e non una proprietà del numero: una
  // tinta libera può cadere su quella di un campione e restare libera. Si
  // dimentica quando le preferenze si chiudono.
  let customOpen = false;
  follow(lifetime, panel, () => {
    if (panel.hidden) customOpen = false;
  }, { attributes: ["hidden"] });

  // Il cursore segue la riga solo quando la riga è un'altra (la vista l'ha
  // riscritta: c'è un valore riletto) o la luce è cambiata. Fra una riscrittura
  // e l'altra è della mano che lo trascina: ogni passo cambia il testo accanto,
  // il corpo se ne accorge, e riallinearlo lì lo riporterebbe indietro.
  let shownRow: HTMLElement | null = null;

  // I colori dei campioni cambiano con la luce e col contrasto, non con la riga.
  let painted = "";
  const paint = (): void => {
    const light = currentTheme();
    const level = currentContrast();
    if (painted === `${light}:${level}`) return;
    painted = `${light}:${level}`;
    shownRow = null;
    radios.forEach((radio, index) => {
      const entry = ACCENT_SWATCHES[index];
      if (!entry) return;
      const colours = palette(light, level, entry.hue);
      radio.style.setProperty("--prefs-swatch", colours["accent"] ?? "");
      radio.style.setProperty("--prefs-swatch-ink", colours["accent-contrast"] ?? "");
    });
  };

  /// La tinta sotto il pollice, mentre lo si trascina e quando la riga cambia.
  const showHue = (hue: number): void => {
    if (slider.value !== String(hue)) slider.value = String(hue);
    setText(readout, t("prefs.accent.hue.value", { hue }));
    const colour = palette(currentTheme(), currentContrast(), hue)["accent"] ?? "";
    if (slider.style.getPropertyValue("--prefs-swatch") !== colour) slider.style.setProperty("--prefs-swatch", colour);
  };

  const fieldOf = (): { row: HTMLElement; field: HTMLInputElement } | null => {
    const row = element.closest<HTMLElement>(".setting-row");
    const field = row ? numberField(row) : null;
    return row && field ? { row, field } : null;
  };

  const group = radioGroup(lifetime, swatches, (radio) => {
    const here = fieldOf();
    if (!here) return;
    const entry = ACCENT_SWATCHES.find((candidate) => candidate.id === radio.dataset.accent);
    customOpen = entry === undefined;
    // «Su misura» da sola non scrive niente: apre il cursore sulla tinta che c'è.
    if (entry === undefined || entry.hue === hueOf(here.field)) dress.update(here.row, here.field);
    else writeThrough(here.field, entry.hue);
  });

  lifetime.listen(slider, "input", () => showHue(normalizedHue(Number(slider.value))));
  // Al rilascio, come il cursore della vista: trascinare non è scrivere.
  lifetime.listen(slider, "change", () => {
    const here = fieldOf();
    if (here) writeThrough(here.field, Number(slider.value));
  });

  const dress: Dress = {
    key: ACCENT_KEY,
    element,
    update(row, field) {
      paint();
      const hue = hueOf(field);
      const match = swatchFor(hue);
      if (match === null) customOpen = true;
      const checked = customOpen ? CUSTOM : match;
      for (const radio of radios) {
        const id = radio.dataset.accent as SwatchId | typeof CUSTOM;
        setAttr(radio, "aria-checked", String(id === checked));
        const name = id === CUSTOM ? t("prefs.accent.custom") : t(NAMES[id]);
        if (radio.getAttribute("aria-label") === name) continue;
        radio.setAttribute("aria-label", name);
        setTooltip(radio, name);
      }
      setDisabled([...radios, slider], field.disabled);
      group.settle();
      setAttr(swatches, "aria-label", row.querySelector(".setting-text > label")?.textContent ?? "");
      setAttr(swatches, "aria-describedby", field.getAttribute("aria-describedby"));
      setAttr(swatches, "aria-disabled", field.disabled ? "true" : null);
      setText(hueLabel, t("prefs.accent.hue"));
      if (custom.hidden === customOpen) custom.hidden = !customOpen;
      if (shownRow !== row) {
        shownRow = row;
        showHue(hue);
      }
      // Il predefinito, detto col nome del suo campione e non col numero.
      const fallback = row.querySelector(".setting-default");
      if (fallback) setText(fallback, t("settings.default", { value: hueName(themeSeries().defaults.accent) }));
    },
  };
  return dress;
}
