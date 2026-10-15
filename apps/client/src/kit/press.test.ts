// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PRESS_SCALE,
  activeMotions,
  createManualDriver,
  setMotionDriver,
  setMotionPreference,
  type ManualDriver,
} from "../moto";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { pressable } from "./press";
import { pointer, press } from "./testing";

let driver: ManualDriver;
let life: Lifetime;
let button: HTMLButtonElement;

const scale = (): string => button.style.getPropertyValue("scale");

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  life = openLifetime();
  button = document.createElement("button");
  document.body.append(button);
});

afterEach(() => {
  life.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.replaceChildren();
});

describe("pressable", () => {
  it("premuto scende subito, rilasciato risale con la molla e non lascia niente", () => {
    pressable(button, life);
    expect(scale()).toBe("");
    button.dispatchEvent(pointer("pointerdown"));
    // Lo stato cambia subito: nessuna corsa per scendere.
    expect(scale()).toBe(String(PRESS_SCALE));
    expect(activeMotions()).toBe(0);

    button.dispatchEvent(pointer("pointerup"));
    driver.advance(32);
    const during = Number(scale());
    expect(during).toBeGreaterThan(PRESS_SCALE);
    expect(during).toBeLessThan(1.01);
    expect(during).not.toBe(1);
    expect(activeMotions()).toBe(1);
    driver.advance(2000);
    expect(scale()).toBe("");
    expect(activeMotions()).toBe(0);
  });

  it("muove `scale` e non `transform`: si compone con le corse di moto", () => {
    pressable(button, life);
    button.dispatchEvent(pointer("pointerdown"));
    expect(button.style.transform).toBe("");
    expect(driver.plays.length).toBe(0);
  });

  it("risale anche se il puntatore esce, il gesto è annullato o il fuoco se ne va", () => {
    pressable(button, life);
    for (const type of ["pointerleave", "pointercancel", "blur"]) {
      button.dispatchEvent(pointer("pointerdown"));
      expect(scale()).toBe(String(PRESS_SCALE));
      button.dispatchEvent(type === "blur" ? new FocusEvent("blur") : pointer(type));
      driver.advance(2000);
      expect(scale()).toBe("");
    }
  });

  it("cede anche a Invio e Spazio, una volta sola per pressione", () => {
    pressable(button, life);
    press(button, "Enter");
    expect(scale()).toBe(String(PRESS_SCALE));
    button.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    driver.advance(2000);
    expect(scale()).toBe("");

    press(button, " ");
    expect(scale()).toBe(String(PRESS_SCALE));
    button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    driver.advance(2000);

    // Un tasto tenuto giù si ripete: non è una pressione nuova.
    press(button, "Enter", { repeat: true });
    press(button, "a");
    expect(scale()).toBe("");
  });

  it("non cede al tasto destro, né a un tasto premuto su un figlio", () => {
    const inner = document.createElement("input");
    const box = document.createElement("div");
    box.append(inner);
    document.body.append(box);
    pressable(box, life);
    box.dispatchEvent(pointer("pointerdown", { button: 2 }));
    press(inner, " ");
    expect(box.style.getPropertyValue("scale")).toBe("");
  });

  it("un pulsante spento non cede", () => {
    pressable(button, life);
    button.disabled = true;
    button.dispatchEvent(pointer("pointerdown"));
    expect(scale()).toBe("");
    button.disabled = false;
    button.setAttribute("aria-disabled", "true");
    button.dispatchEvent(pointer("pointerdown"));
    expect(scale()).toBe("");
  });

  it("nel livello ridotto non fa niente", () => {
    setMotionPreference("reduced");
    pressable(button, life);
    button.dispatchEvent(pointer("pointerdown"));
    expect(scale()).toBe("");
    button.dispatchEvent(pointer("pointerup"));
    expect(scale()).toBe("");
    expect(activeMotions()).toBe(0);
  });

  it("smontato a metà pressione o a metà ritorno torna al riposo e smette di ascoltare", () => {
    pressable(button, life);
    button.dispatchEvent(pointer("pointerdown"));
    life.close();
    expect(scale()).toBe("");

    life = openLifetime();
    pressable(button, life);
    button.dispatchEvent(pointer("pointerdown"));
    button.dispatchEvent(pointer("pointerup"));
    driver.advance(16);
    expect(activeMotions()).toBe(1);
    life.close();
    expect(activeMotions()).toBe(0);
    expect(scale()).toBe("");
    driver.advance(1000);
    expect(scale()).toBe("");

    button.dispatchEvent(pointer("pointerdown"));
    expect(scale()).toBe("");
  });
});
