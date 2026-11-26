// @vitest-environment happy-dom
// «Ruota vista» (`view.rotate`, K6 T11): l'angolo si legge dal campo (la virgola per i decimali, 360 è 0,
// il testo sbagliato resta con la sua frase), Applica gira la vista, Esc o Annulla non cambiano niente,
// e una vista girata fa cadere i gesti dove punta il mouse.
import { describe, expect, it } from "vitest";
import { turnTo, toScene } from "../../../view";
import { angoloDaTesto, chiediAngoloVista } from "./vista-ruota";

/// Il dialogo aperto, e il suo campo.
function dialogo() {
  const finestra = document.querySelector<HTMLElement>('[role="dialog"]');
  const campo = finestra?.querySelector<HTMLInputElement>("input") ?? null;
  return { finestra, campo };
}

describe("view.rotate: l'angolo scritto", () => {
  it("accetta gradi con segno e decimali con la virgola o il punto, e normalizza nella vista", () => {
    expect(angoloDaTesto("45")).toEqual({ ok: true, gradi: 45 });
    expect(angoloDaTesto("45,5")).toEqual({ ok: true, gradi: 45.5 });
    expect(angoloDaTesto("45.5")).toEqual({ ok: true, gradi: 45.5 });
    expect(angoloDaTesto("-90")).toEqual({ ok: true, gradi: -90 });
    expect(angoloDaTesto("360")).toEqual({ ok: true, gradi: 0 });
    expect(angoloDaTesto("720")).toEqual({ ok: true, gradi: 0 });
    expect(angoloDaTesto("270")).toEqual({ ok: true, gradi: -90 });
  });

  it("rifiuta il vuoto, il testo e i numeri con lettere", () => {
    expect(angoloDaTesto("")).toEqual({ ok: false });
    expect(angoloDaTesto("abc")).toEqual({ ok: false });
    expect(angoloDaTesto("12a")).toEqual({ ok: false });
  });
});

describe("view.rotate: il dialogo", () => {
  it("un testo che non è un angolo resta nel campo con la sua frase, e la finestra non si chiude", async () => {
    const attesa = chiediAngoloVista(0);
    const { campo } = dialogo();
    campo!.value = "abc";
    dialogo().finestra!.querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    expect(dialogo().finestra).not.toBeNull();
    expect(dialogo().campo!.getAttribute("aria-invalid")).toBe("true");
    dialogo().finestra!.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(await attesa).toBeNull();
  });

  it("Applica con 45,5 dà 45,5 gradi", async () => {
    const attesa = chiediAngoloVista(0);
    dialogo().campo!.value = "45,5";
    dialogo().finestra!.querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    expect(await attesa).toBe(45.5);
  });

  it("Esc non cambia la vista: la risposta è niente", async () => {
    const attesa = chiediAngoloVista(30);
    dialogo().campo!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await attesa).toBeNull();
  });
});

describe("view.rotate: i gesti dopo la rotazione", () => {
  it("con la vista a 90° un punto a destra del centro è, nella scena, sopra o sotto il centro: la distanza resta", () => {
    const vista = turnTo({ scale: 1, angle: 0, tx: 0, ty: 0 }, 90, [200, 150]);
    const centro = toScene(vista, [200, 150]);
    const su = toScene(vista, [250, 150]);
    expect(su[0]).toBeCloseTo(centro[0], 6);
    expect(Math.abs(su[1] - centro[1])).toBeCloseTo(50, 6);
  });
});
