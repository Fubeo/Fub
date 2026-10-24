// Lo zoom dell'interfaccia, in percento.
//
// Il valore (`appearance.zoom`) è una scala, da 0,5 a 2, e nel form generico
// si legge «1»: un numero che non dice niente a chi non sa che è un fattore.
// Qui lo stesso valore si mostra come lo dice il resto dell'app — la striscia
// di stato, il comando che lo riporta indietro —, cioè «100 %», e si regola
// a passi di dieci. Si scrive attraverso il campo della riga, come ogni veste.
import { t } from "../../../i18n/strings";
import { ZOOM_KEY } from "../../../theme/theme";
import type { Lifetime } from "../../../ui/lifetime";
import { numberField, setAttr, setDisabled, setText, writeThrough, type Dress } from "./rows";

const MIN = 50;
const MAX = 200;
const STEP = 10;

/// Il fattore della riga in percento intero; un campo vuoto vale 100.
export function zoomPercent(value: string): number {
  const factor = value.trim() === "" ? 1 : Number(value);
  return Number.isFinite(factor) ? Math.round(factor * 100) : 100;
}

export function zoomControl(lifetime: Lifetime): Dress {
  const element = document.createElement("div");
  element.className = "prefs-zoom";
  const name = document.createElement("label");
  name.className = "sr-only";
  name.htmlFor = "prefs-zoom-range";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "setting-slider";
  slider.id = "prefs-zoom-range";
  slider.min = String(MIN);
  slider.max = String(MAX);
  slider.step = String(STEP);
  const readout = document.createElement("output");
  readout.className = "prefs-zoom-value";
  readout.setAttribute("for", slider.id);
  element.append(name, slider, readout);

  const show = (percent: number): void => {
    const text = t("prefs.zoom.value", { percent });
    setText(readout, text);
    setAttr(slider, "aria-valuetext", text);
  };

  // Il cursore segue la riga solo quando la riga è un'altra: fra una
  // riscrittura e l'altra è della mano che lo trascina.
  let shownRow: HTMLElement | null = null;
  lifetime.listen(slider, "input", () => show(Number(slider.value)));
  // Al rilascio, come il cursore della vista: trascinare non è scrivere.
  lifetime.listen(slider, "change", () => {
    const row = element.closest<HTMLElement>(".setting-row");
    const field = row ? numberField(row) : null;
    if (field) writeThrough(field, Number(slider.value) / 100);
  });

  return {
    key: ZOOM_KEY,
    element,
    update(row, field) {
      setText(name, row.querySelector(".setting-text > label")?.textContent ?? "");
      setAttr(slider, "aria-describedby", field.getAttribute("aria-describedby"));
      setDisabled([slider], field.disabled);
      if (shownRow !== row) {
        shownRow = row;
        const percent = zoomPercent(field.value);
        slider.value = String(percent);
        show(percent);
      }
      // Il predefinito, in percento come il valore.
      const fallback = row.querySelector(".setting-default");
      if (fallback) setText(fallback, t("settings.default", { value: t("prefs.zoom.value", { percent: 100 }) }));
    },
  };
}
