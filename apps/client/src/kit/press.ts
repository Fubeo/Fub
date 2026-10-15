// La pressione: ciò che si preme cede un poco, e al rilascio torna.
//
// Si muove `scale`, la proprietà singola, e non `transform`: così si compone
// con le corse di `moto`, che usano `transform`, e con una trasformazione che
// l'elemento avesse a riposo. A riposo non resta niente sull'elemento.
import { PRESS_SCALE, motionLevel, springValue } from "../moto";
import type { Lifetime } from "../ui/lifetime";

/// Vero se l'elemento non risponde: non deve nemmeno cedere.
function inert(el: HTMLElement): boolean {
  return el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";
}

/// Rende `el` sensibile alla pressione, col puntatore e con Invio o Spazio.
/// Scende subito a `PRESS_SCALE` e risale con la molla `snap`. Nel livello
/// «ridotto» non fa niente.
export function pressable(el: HTMLElement, lifetime: Lifetime): void {
  let pressed = false;
  const value = springValue({
    spring: "snap",
    initial: 1,
    onUpdate(scale) {
      if (scale === 1) el.style.removeProperty("scale");
      else el.style.setProperty("scale", String(scale));
    },
    lifetime,
  });
  const press = (): void => {
    if (pressed || inert(el) || motionLevel() === "reduced") return;
    pressed = true;
    // Lo stato cambia subito: è il ritorno ad avere una durata.
    value.jump(PRESS_SCALE);
  };
  const release = (): void => {
    if (!pressed) return;
    pressed = false;
    value.set(1);
  };

  lifetime.listen(el, "pointerdown", (event) => {
    if (event.button === 0) press();
  });
  lifetime.listen(el, "pointerup", release);
  lifetime.listen(el, "pointercancel", release);
  lifetime.listen(el, "pointerleave", release);
  lifetime.listen(el, "keydown", (event) => {
    if (event.repeat || event.target !== el) return;
    if (event.key === "Enter" || event.key === " ") press();
  });
  lifetime.listen(el, "keyup", release);
  lifetime.listen(el, "blur", release);
  // Dopo il valore: alla chiusura la molla si è già fermata e non riscrive.
  lifetime.add(() => el.style.removeProperty("scale"));
}
