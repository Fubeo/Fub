// La finestra «Penna e dita»: come le dita e la penna parlano al foglio su
// questo dispositivo. Due interruttori per i gesti delle dita, la rotazione
// e i tocchi che annullano e ripetono; la curva della pressione della penna e
// lo stabilizzatore del tratto, gli stessi gruppi del pannello «Mano»
// (`hand-controls.ts`); il tasto laterale della penna. Si scrive tutto alla
// conferma.

import { actions, openFrame } from "../../../ui/dialogs";
import { t as appT } from "../../../i18n/strings";
import type { PenCurve } from "../../../ink/input/pressure";
import { t, type DrawKey } from "../strings";
import type { BarrelAction, Steady } from "./grid";
import { check, group, pressureGroup, steadyGroup } from "./hand-controls";

export { samplePath } from "./hand-controls";

/// Ciò che la finestra sceglie.
export interface TouchChoice {
  readonly twist: boolean;
  readonly taps: boolean;
  readonly pen: PenCurve;
  /// Lo stabilizzatore; assente, spento.
  readonly steady?: Steady;
  /// Il tasto laterale della penna; assente, il menu radiale.
  readonly barrel?: BarrelAction;
}

/// Le azioni del tasto laterale, nell'ordine in cui si offrono.
const BARREL_ACTIONS: ReadonlyArray<{ readonly action: BarrelAction; readonly label: DrawKey }> = [
  { action: "radial", label: "draw.touch.barrel.radial" },
  { action: "eraser", label: "draw.touch.barrel.eraser" },
  { action: "none", label: "draw.touch.barrel.none" },
];

/// Apre «Penna e dita» su `choice`. Torna la scelta, o `null` se chi sceglie
/// rinuncia.
export function touchDialog(choice: TouchChoice): Promise<TouchChoice | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: TouchChoice | null): void => {
      if (settled) return;
      settled = true;
      frame.close();
      resolve(value);
    };
    const frame = openFrame(t("draw.touch.title"), () => settle(null));
    const form = document.createElement("form");
    form.className = "palette-form";

    // --- Le dita ---------------------------------------------------------------

    const fingers = group(t("draw.touch.fingers"));
    const twist = check(fingers, t("draw.touch.twist"), choice.twist);
    const taps = check(fingers, t("draw.touch.taps"), choice.taps);

    // --- La penna e lo stabilizzatore -------------------------------------------

    const pressure = pressureGroup(choice.pen);
    const steady = steadyGroup(choice.steady);

    // --- I tasti della penna ---------------------------------------------------

    const buttons = group(t("draw.touch.buttons"));
    const buttonsHint = document.createElement("p");
    buttonsHint.className = "draw-touch-hint";
    buttonsHint.textContent = t("draw.touch.buttons.hint");
    const barrelField = document.createElement("label");
    const barrelName = document.createElement("span");
    barrelName.textContent = t("draw.touch.barrel");
    const barrel = document.createElement("select");
    for (const { action, label } of BARREL_ACTIONS) {
      const option = document.createElement("option");
      option.value = action;
      option.textContent = t(label);
      barrel.append(option);
    }
    barrel.value = choice.barrel ?? "radial";
    barrelField.append(barrelName, barrel);
    buttons.append(buttonsHint, barrelField);

    const row = actions(appT("app.ok"), () => settle(null));
    form.append(fingers, pressure.element, steady.element, buttons, row);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const picked = BARREL_ACTIONS.find(({ action }) => action === barrel.value)?.action ?? "radial";
      settle({ twist: twist.checked, taps: taps.checked, pen: pressure.value(), steady: steady.value(), barrel: picked });
    });
    frame.box.append(form);
    twist.focus();
  });
}
