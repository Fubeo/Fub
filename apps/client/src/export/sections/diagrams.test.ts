// @vitest-environment happy-dom
// La sezione Diagrammi (T75): i sei stili, l'anteprima al passaggio, i
// quattro colori dati a mano, il fondo, gli stili dati a un diagramma solo.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile, type ExportProfile } from "../profile";
import { diagramsBody, diagramsSummary, DIAGRAMS_SECTION } from "./diagrams";
import type { SectionContext } from "./index";

interface Mounted {
  readonly body: HTMLElement;
  readonly changes: { profile: ExportProfile; live: boolean }[];
  readonly profile: () => ExportProfile;
  readonly clearOwn: ReturnType<typeof vi.fn>;
}

/// La sezione come la monta lo spazio: a gesto finito (e quando una riga si
/// apre) il pannello rifà il corpo, dal vivo no.
function mount(start: ExportProfile = defaultProfile(), own = 0): Mounted {
  let profile = start;
  const changes: Mounted["changes"] = [];
  const clearOwn = vi.fn();
  const host = document.createElement("div");
  const redraw = () => host.replaceChildren(diagramsBody(context));
  const context: SectionContext = {
    get profile() {
      return profile;
    },
    change(next, options) {
      profile = next;
      changes.push({ profile: next, live: options?.live === true });
      if (!options?.live) redraw();
    },
    open: () => undefined,
    preview: () => undefined,
    highlight: () => undefined,
    redraw,
    memory: new Map(),
    diagrams: { own, clearOwn },
  };
  redraw();
  document.body.append(host);
  return { body: host, changes, profile: () => profile, clearOwn };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("la sezione Diagrammi", () => {
  it("chiusa dice lo stile per nome, mai il suo id", () => {
    const base = defaultProfile();
    expect(diagramsSummary(base)).toBe("Come nella nota");
    expect(diagramsSummary({ ...base, diagrammi: { stile: "tema", fondo: true } })).toBe("Seguono il tema");
    expect(diagramsSummary({ ...base, diagrammi: { stile: "blueprint", fondo: true } })).toBe("Blueprint");
    expect(diagramsSummary({ ...base, diagrammi: { stile: "sconosciuto", fondo: true } })).toBe("Come nella nota");
    expect(DIAGRAMS_SECTION.id).toBe("diagrammi");
  });

  it("offre i sei stili, quello scelto premuto", () => {
    const { body } = mount();
    const styles = [...body.querySelectorAll<HTMLButtonElement>(".export-dg-style")];
    expect(styles.map((button) => button.textContent)).toEqual(["Come nella nota", "Segue il tema", "Acquerello", "Aurora", "Blueprint", "Inchiostro"]);
    expect(styles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  it("un clic sceglie lo stile, e il corpo si ridisegna", () => {
    const { body, changes, profile } = mount();
    body.querySelector<HTMLButtonElement>("[data-dg=aurora]")!.click();
    expect(changes[changes.length - 1]).toMatchObject({ live: false });
    expect(profile().diagrammi.stile).toBe("aurora");
    expect(body.querySelector("[data-dg=aurora]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("passando su uno stile le pagine lo mostrano, uscendo tornano a quello scelto", () => {
    const { body, changes, profile } = mount();
    body.querySelector("[data-dg=inchiostro]")!.dispatchEvent(new Event("pointerenter"));
    expect(changes[changes.length - 1]).toMatchObject({ live: true });
    expect(profile().diagrammi.stile).toBe("inchiostro");
    body.querySelector(".export-dg-styles")!.dispatchEvent(new Event("pointerleave"));
    expect(changes[changes.length - 1]).toMatchObject({ live: true });
    expect(profile().diagrammi.stile).toBe("nota");
  });

  it("un colore della tavolozza vince sullo stile, «tuo», e torna a quello dello stile", () => {
    const { body, profile } = mount();
    const head = () => body.querySelector<HTMLButtonElement>("#export-dg-color-diagramma-nodi")!;
    expect(head().textContent).toContain("dello stile");
    head().click();
    expect(head().getAttribute("aria-expanded")).toBe("true");
    body.querySelector<HTMLButtonElement>("#export-dg-ink-diagramma-nodi-1f4f8f")!.click();
    expect(profile().colori["diagramma-nodi"]).toBe("#1f4f8f");
    expect(head().textContent).toContain("tuo");
    expect(head().textContent).toContain("#1f4f8f");
    body.querySelector<HTMLButtonElement>("#export-dg-reset-diagramma-nodi")!.click();
    expect(profile().colori["diagramma-nodi"]).toBeUndefined();
  });

  it("il codice del colore vale solo scritto bene", () => {
    const { body, profile } = mount();
    body.querySelector<HTMLButtonElement>("#export-dg-color-diagramma-linee")!.click();
    const hex = body.querySelector<HTMLInputElement>(".export-dg-hex")!;
    hex.value = "#12";
    hex.dispatchEvent(new Event("input"));
    hex.dispatchEvent(new Event("change"));
    expect(profile().colori["diagramma-linee"]).toBeUndefined();
    hex.value = "#AA5500";
    hex.dispatchEvent(new Event("change"));
    expect(profile().colori["diagramma-linee"]).toBe("#aa5500");
  });

  it("il fondo del diagramma è un interruttore", () => {
    const { body, profile } = mount();
    const toggle = () => body.querySelector<HTMLButtonElement>("#export-dg-paper")!;
    expect(toggle().getAttribute("role")).toBe("switch");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    toggle().click();
    expect(profile().diagrammi.fondo).toBe(false);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("dice quanti diagrammi hanno uno stile loro, e li toglie", () => {
    expect(mount().body.querySelector("#export-dg-clear-own")).toBeNull();
    document.body.replaceChildren();
    const { body, clearOwn } = mount(defaultProfile(), 2);
    const clear = body.querySelector<HTMLButtonElement>("#export-dg-clear-own")!;
    expect(clear.textContent).toBe("Togli lo stile dato a 2");
    clear.click();
    expect(clearOwn).toHaveBeenCalledOnce();
  });
});
