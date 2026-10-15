// Lo spazio dell'interfaccia, come controllo: cinque passi in fila, ognuno con
// la sua figura.
//
// Il valore (`chrome.compactness`, da 0 a 4) nel form generico è un numero con
// un cursore, e un numero non dice che cosa si stringe. Qui ogni passo mostra
// una finestra in piccolo: barre, binario e cassetto si assottigliano da
// sinistra a destra, e il foglio — la linguetta, le righe di testo — resta
// disegnato uguale in tutte e cinque. Le misure vere le decide la serie
// (`theme/scrittoio/measures.ts`); la figura le racconta, non le riporta.
import { t, type Key } from "../../../i18n/strings";
import { COMPACTNESS_STEPS, DEFAULT_COMPACTNESS, normalizedCompactness } from "../../../theme/scrittoio/measures";
import { COMPACTNESS_KEY } from "../../../theme/theme";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { radioGroup } from "./radios";
import { numberField, setAttr, setDisabled, setText, writeThrough, type Dress } from "./rows";

const STEP_NAMES: readonly Key[] = [
  "prefs.space.step.0",
  "prefs.space.step.1",
  "prefs.space.step.2",
  "prefs.space.step.3",
  "prefs.space.step.4",
];

function span(className: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  return node;
}

/// La finestra in piccolo di un passo. Quanto sono spesse le parti lo dice la
/// pelle, leggendo `data-step` dal bottone.
function figure(): HTMLElement {
  const frame = span("prefs-space-figure");
  frame.setAttribute("aria-hidden", "true");
  frame.append(span("prefs-space-bar"), span("prefs-space-side"), span("prefs-space-sheet"), span("prefs-space-foot"));
  return frame;
}

export function spaceControl(lifetime: Lifetime): Dress {
  const element = document.createElement("div");
  element.className = "prefs-space";

  const steps = document.createElement("div");
  steps.className = "prefs-space-steps";
  steps.setAttribute("role", "radiogroup");

  const radios: HTMLButtonElement[] = [];
  const named: string[] = [];
  for (let step = 0; step < COMPACTNESS_STEPS; step += 1) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.className = "prefs-space-step";
    radio.id = `prefs-space-step-${step}`;
    radio.dataset.step = String(step);
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-checked", "false");
    radio.tabIndex = -1;
    const stop = span("prefs-space-stop");
    stop.setAttribute("aria-hidden", "true");
    radio.append(figure(), stop);
    radios.push(radio);
    named.push("");
  }
  steps.append(...radios);

  // I due estremi, sotto la fila: chi guarda legge il verso senza provare.
  // Chi ascolta lo sente dal nome di ogni passo.
  const ends = document.createElement("div");
  ends.className = "prefs-space-ends";
  ends.setAttribute("aria-hidden", "true");
  const loose = span("prefs-space-end");
  const tight = span("prefs-space-end");
  ends.append(loose, tight);
  element.append(steps, ends);

  const group = radioGroup(lifetime, steps, (radio) => {
    const row = element.closest<HTMLElement>(".setting-row");
    const field = row ? numberField(row) : null;
    if (field) writeThrough(field, Number(radio.dataset.step));
  });

  return {
    key: COMPACTNESS_KEY,
    element,
    update(row, field) {
      const current = normalizedCompactness(field.value.trim() === "" ? DEFAULT_COMPACTNESS : Number(field.value));
      radios.forEach((radio, step) => {
        setAttr(radio, "aria-checked", String(step === current));
        const name = t(STEP_NAMES[step]!);
        if (named[step] === name) return;
        named[step] = name;
        radio.setAttribute("aria-label", t("prefs.space.step", { name, step: step + 1, steps: COMPACTNESS_STEPS }));
        setTooltip(radio, name);
      });
      setDisabled(radios, field.disabled);
      group.settle();
      setAttr(steps, "aria-label", row.querySelector(".setting-text > label")?.textContent ?? "");
      setAttr(steps, "aria-describedby", field.getAttribute("aria-describedby"));
      setAttr(steps, "aria-disabled", field.disabled ? "true" : null);
      setText(loose, t("prefs.space.more_frame"));
      setText(tight, t("prefs.space.more_sheet"));
      // Il predefinito, detto col nome del passo e non col suo numero.
      const fallback = row.querySelector(".setting-default");
      if (fallback) setText(fallback, t("settings.default", { value: t(STEP_NAMES[DEFAULT_COMPACTNESS]!) }));
    },
  };
}
