// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { CONTENT_LOOK_CHOICES, contentLookChoiceOf, lookClass, markLook, resolveLook } from "./content-look";
import { CONTENT_LOOK_KEY } from "./theme";

describe("l'aspetto che si vede", () => {
  const both = ["file", "adattato"] as const;

  test("la scelta del riquadro vale se la modalità la offre", () => {
    expect(resolveLook(both, "adattato", "auto", false)).toBe("adattato");
    expect(resolveLook(["file"], "adattato", "auto", false)).toBe("file");
  });

  test("senza scelta decide l'impostazione, poi il predefinito della modalità", () => {
    expect(resolveLook(both, undefined, "adattato", false)).toBe("adattato");
    expect(resolveLook(both, undefined, "file", false)).toBe("file");
    expect(resolveLook(["tema"], undefined, "file", false)).toBe("tema");
  });

  test("auto è il predefinito, o l'adattato con il contrasto alto", () => {
    expect(resolveLook(both, undefined, "auto", false)).toBe("file");
    expect(resolveLook(both, undefined, "auto", true)).toBe("adattato");
    expect(resolveLook(["file"], undefined, "auto", true)).toBe("file");
  });

  test("una modalità che non dichiara niente è vestita dal tema", () => {
    expect(resolveLook(undefined, "file", "file", true)).toBe("tema");
    expect(resolveLook([], undefined, "auto", false)).toBe("tema");
  });

  test("una scelta o un valore sconosciuto non contano", () => {
    expect(resolveLook(both, "pastello", "auto", false)).toBe("file");
    expect(contentLookChoiceOf("pastello")).toBe("auto");
    expect(contentLookChoiceOf(3)).toBe("auto");
    expect(CONTENT_LOOK_CHOICES[0]).toBe("auto");
    expect(CONTENT_LOOK_KEY).toBe("appearance.content-look");
  });

  test("la radice ha una classe sola", () => {
    const root = document.createElement("div");
    markLook(root, "file");
    markLook(root, "adattato");
    expect([...root.classList]).toEqual([lookClass("adattato")]);
    markLook(root, null);
    expect(root.classList.length).toBe(0);
  });
});
