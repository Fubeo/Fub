// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { createRow, markGlideHost, markLit, markPressed } from "./row";

const classesOf = (row: HTMLElement): string[] => [...row.children].map((part) => part.className);

afterEach(() => {
  document.body.replaceChildren();
});

describe("createRow", () => {
  it("è un pulsante di una riga: la figura, il nome, la scorciatoia a destra", () => {
    const { element, icon, label, keys } = createRow({ label: "Apri", icon: "notes", keys: "Ctrl+Invio", role: "menuitem" });
    document.body.append(element);
    expect(element.tagName).toBe("BUTTON");
    expect((element as HTMLButtonElement).type).toBe("button");
    expect(element.className).toBe("kit-row");
    expect(element.getAttribute("role")).toBe("menuitem");
    expect(classesOf(element)).toEqual(["kit-row-icon", "kit-row-label", "kit-row-keys"]);
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    expect(icon!.querySelector("svg")).not.toBeNull();
    expect(label.textContent).toBe("Apri");
    expect(keys!.tagName).toBe("KBD");
    expect(element.getAttribute("aria-keyshortcuts")).toBe("Ctrl+Invio");
    // La figura non parla: il nome accessibile comincia dal nome.
    expect(accessibleName(element).startsWith("Apri")).toBe(true);
  });

  it("senza icona non disegna la figura; ne tiene il posto se glielo si chiede", () => {
    expect(createRow({ label: "Senza" }).icon).toBeNull();
    const held = createRow({ label: "Allineata", holdIcon: true });
    expect(held.icon).not.toBeNull();
    expect(held.icon!.childElementCount).toBe(0);
    // Un nome che non esiste: niente figura, ma il posto resta, come per chi la chiede.
    const unknown = createRow({ label: "Mistero", icon: "non-esiste" });
    expect(unknown.icon!.childElementCount).toBe(0);
    expect(createRow({ label: "Mistero", icon: "non-esiste", holdIcon: false }).icon).toBeNull();
  });

  it("spenta resta al suo posto col perché a destra, che si vede", () => {
    const { element, note } = createRow({ label: "Cronologia", note: "Solo per le note salvate", disabled: true });
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(note!.textContent).toBe("Solo per le note salvate");
    expect(note!.className).toBe("kit-row-note");
  });

  it("la freccia del sottomenu chiude la riga e dice che si apre un menu", () => {
    const { element, more } = createRow({ label: "Sposta in", more: true });
    expect(element.lastElementChild).toBe(more);
    expect(more!.textContent).toBe("›");
    expect(more!.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("un nome lunghissimo resta su una riga sola, nella sua parte", () => {
    const long = "Un nome lunghissimo che non sta nella riga e si taglia coi puntini, anche in inglese";
    const { element, label } = createRow({ label: long, note: "Diario" });
    expect(label.textContent).toBe(long);
    expect(element.querySelectorAll("br")).toHaveLength(0);
    expect(classesOf(element)).toEqual(["kit-row-label", "kit-row-note"]);
  });

  it("chi monta dà i suoi nomi alle parti, accanto a quelli del kit", () => {
    const { element } = createRow({
      label: "Copia",
      icon: "copy",
      note: "spiegazione",
      keys: "Ctrl+C",
      more: true,
      className: "danger",
      parts: { icon: "menu-icon", label: "menu-label", note: "menu-description", keys: "menu-hint", more: "menu-hint menu-more" },
    });
    expect(element.className).toBe("kit-row danger");
    expect(classesOf(element)).toEqual([
      "kit-row-icon menu-icon",
      "kit-row-label menu-label",
      "kit-row-note menu-description",
      "kit-row-keys menu-hint",
      "kit-row-more menu-hint menu-more",
    ]);
  });

  it("da 38 nello spazio comandi; un div per una riga che porta altri pulsanti", () => {
    expect(createRow({ label: "Nota", size: "large" }).element.dataset.size).toBe("large");
    expect(createRow({ label: "Nota" }).element.hasAttribute("data-size")).toBe(false);
    const holder = createRow({ label: "Copia come", tag: "div", role: "group" }).element;
    expect(holder.tagName).toBe("DIV");
    expect(holder.getAttribute("role")).toBe("group");
  });

  it("accesa e premuta sono stati che si tolgono senza lasciare niente", () => {
    const { element } = createRow({ label: "Apri" });
    markLit(element, true);
    markPressed(element, true);
    expect(element.hasAttribute("data-lit")).toBe(true);
    expect(element.hasAttribute("data-pressed")).toBe(true);
    markLit(element, false);
    markPressed(element, false);
    expect(element.hasAttribute("data-lit")).toBe(false);
    expect(element.hasAttribute("data-pressed")).toBe(false);
  });

  it("chi fa scivolare la sua pastiglia lo dichiara sul contenitore", () => {
    const menu = document.createElement("div");
    markGlideHost(menu);
    expect(menu.hasAttribute("data-kit-glide")).toBe(true);
  });
});
