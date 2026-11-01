// @vitest-environment happy-dom
//
// La pagina «Componenti» contro lo scenario registrato dell'host finto: ogni
// gesto è una scelta che l'host ha davvero risposto, e la pagina dice solo ciò
// che la risposta dice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { ConfirmOptions } from "../platform/confirm";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  confirm: true,
  asked: [] as Array<{ message: string; opts: ConfirmOptions }>,
  notify: vi.fn(),
  tooltips: new Map<HTMLElement, string>(),
  maps: 0,
}));

vi.mock("../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("host finto non montato");
        if (name === "componentsMap") box.maps++;
        const method = box.host.module.api[name as keyof typeof box.host.module.api] as (
          ...values: unknown[]
        ) => unknown;
        return method(...args);
      },
    },
  ),
  onKernelEvent: (handler: never) => box.host!.module.onKernelEvent(handler),
}));
vi.mock("../platform/confirm", () => ({
  confirm: (message: string, opts: ConfirmOptions) => {
    box.asked.push({ message, opts });
    return Promise.resolve(box.confirm);
  },
}));
vi.mock("../ui/notify", () => ({ notify: box.notify }));
vi.mock("../ui/tooltip", () => ({
  setTooltip: (target: HTMLElement, text: string) => {
    box.tooltips.set(target, text);
  },
}));

const { createFakeHost } = await import("../host/fake");
const { startKernelRouter } = await import("../state/kernel");
const { openLifetime } = await import("../ui/lifetime");
const { mountComponentsPage, COMPONENT_ICONS, componentIcon } = await import("./components-page");
const { mountComponents } = await import("../state/components");
const { setCommandSpecs, state } = await import("../state/store");
const { drawingCreateSpec } = await import("../host/fake");
const { icon } = await import("../ui/icons");
const scenario = (await import("../__fixtures__/components-scenario.json")).default as unknown as {
  mappe: Array<{ righe: Array<{ id: string }> }>;
};

let stopRouter: (() => void) | null = null;
let lifetime = openLifetime();
let visible = true;
const reloadProvider = vi.fn(async () => {});

async function mount(start?: string) {
  box.host = createFakeHost(start ? { componentsStart: start } : {});
  stopRouter = await startKernelRouter();
  lifetime = openLifetime();
  // La mappa è quella di tutta l'app: la pagina la legge da lì.
  state.vaultRoot = "/vault";
  mountComponents(lifetime);
  const page = mountComponentsPage(lifetime, { visible: () => visible, reloadProvider });
  document.body.replaceChildren(page.element);
  await page.show();
  return page;
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const row = (id: string) => $(`[data-component="${id}"]`)!;
const toggle = (id: string) => $<HTMLInputElement>(`#component-${CSS.escape(id)}`)!;
const profile = (name: string) => $<HTMLButtonElement>(`[data-profile="${name}"]`)!;
const noticeText = () => $(".components-notice")!.textContent ?? "";

/// Aspetta che il gesto finisca e che la mappa riletta sia a schermo.
async function settled(): Promise<void> {
  await vi.waitFor(() => expect($("[aria-busy]")).toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 60));
}

beforeEach(() => {
  box.confirm = true;
  box.asked = [];
  box.maps = 0;
  box.tooltips.clear();
  box.notify.mockClear();
  reloadProvider.mockClear();
  visible = true;
});

afterEach(() => {
  lifetime.close();
  state.vaultRoot = "";
  setCommandSpecs([]);
  stopRouter?.();
  stopRouter = null;
  document.body.replaceChildren();
});

describe("la pagina «Componenti»", () => {
  it("disegna profili, gruppi con titolo, il supporto chiuso e il nucleo senza interruttore", async () => {
    await mount();
    expect($("#components-page-title")!.textContent).toBe("Componenti");
    expect(profile("studio").getAttribute("aria-pressed")).toBe("true");
    expect(profile("studio").textContent).toContain("consigliato");
    // I sei profili, nell'ordine in cui l'host li elenca.
    expect([...document.querySelectorAll<HTMLElement>("[data-profile]")].map((b) => b.dataset.profile)).toEqual([
      "solo-note",
      "solo-pdf",
      "studio",
      "grafica",
      "fotografia",
      "tutto",
    ]);
    expect(profile("solo-note").getAttribute("aria-pressed")).toBe("false");
    const titles = [...document.querySelectorAll(".components-group-title")].map((h) => h.textContent);
    expect(titles).toContain("Di supporto");
    const support = $('[data-group="supporto"]')!;
    expect(support.querySelector<HTMLElement>(".components-rows")!.hidden).toBe(true);
    const show = support.querySelector<HTMLButtonElement>(".components-group-toggle")!;
    expect(show.textContent).toBe("Mostra");
    expect(show.getAttribute("aria-expanded")).toBe("false");
    show.click();
    expect($('[data-group="supporto"] .components-rows')!.hidden).toBe(false);
    expect($('[data-group="supporto"] .components-group-toggle')!.textContent).toBe("Nascondi");
    expect(row("fub.penna").textContent).toContain("Serve a Lavagna e PDF");
    expect(row("fub.core").textContent).toContain("sempre acceso");
    expect(row("fub.core").querySelector("input")).toBeNull();
    // Ogni interruttore ha un nome dalla sua etichetta, e una descrizione.
    const search = toggle("fub.search");
    expect($(`label[for="${search.id}"]`)!.textContent).toBe("Ricerca");
    expect(search.getAttribute("role")).toBe("switch");
    expect(search.getAttribute("aria-describedby")).toBe("components-desc-fub.search");
  });

  it("un profilo più avanti non si applica e dice perché, al passaggio e al clic", async () => {
    await mount();
    const later = profile("solo-pdf");
    expect(later.getAttribute("aria-disabled")).toBe("true");
    expect(later.textContent).toContain("più avanti");
    expect(box.tooltips.get(later)).toBe("«Solo PDF» arriva più avanti: serve un componente che Fub non ha ancora.");
    later.click();
    await settled();
    expect(noticeText()).toContain("«Solo PDF» arriva più avanti");
    expect(profile("studio").getAttribute("aria-pressed")).toBe("true");
  });

  it("Invio e Spazio su un profilo più avanti non lo attivano, ma ne dicono il perché", async () => {
    await mount();
    let clicks = 0;
    const count = (event: Event) => {
      if ((event.target as HTMLElement).closest?.('[data-profile="solo-pdf"]')) clicks++;
    };
    document.addEventListener("click", count, true);
    for (const key of ["Enter", " "]) {
      const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      profile("solo-pdf").dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      await settled();
      // L'avviso ridisegna la fila dei profili: il tasto si rialza sul nuovo.
      const up = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true });
      profile("solo-pdf").dispatchEvent(up);
      expect(up.defaultPrevented).toBe(true);
    }
    await settled();
    document.removeEventListener("click", count, true);
    expect(clicks).toBe(0);
    expect(noticeText()).toContain("«Solo PDF» arriva più avanti");
  });

  it("accendere aggiunge da sé ciò che serve, e lo dice coi nomi", async () => {
    await mount("solo-note");
    expect(profile("solo-note").getAttribute("aria-pressed")).toBe("true");
    toggle("fub.pdf").click();
    await settled();
    expect(toggle("fub.pdf").checked).toBe(true);
    expect(noticeText()).toContain("Attivato anche «Penna»: «PDF» non funziona senza.");
    // La penna è di supporto: il gruppo si apre per farla vedere.
    expect($('[data-group="supporto"] .components-rows')!.hidden).toBe(false);
    expect(row("fub.penna").textContent).toContain("Serve a PDF");
    $<HTMLButtonElement>('[data-focus-key="notice:ok"]')!.click();
    expect(noticeText()).toBe("");
  });

  it("spegnere ciò che serve ad altri chiede prima, e «Annulla» non spegne niente", async () => {
    await mount();
    $<HTMLButtonElement>('[data-group="supporto"] .components-group-toggle')!.click();
    box.confirm = false;
    toggle("fub.penna").click();
    await settled();
    expect(box.asked).toHaveLength(1);
    expect(box.asked[0]!.opts.title).toBe("Spegnere «Penna»?");
    expect(box.asked[0]!.message).toContain("Serve a «Lavagna» e «PDF».");
    expect(box.asked[0]!.opts.okLabel).toBe("Spegni 3 componenti");
    expect(toggle("fub.penna").checked).toBe(true);
    expect(toggle("fub.lavagna").checked).toBe(true);
  });

  it("confermare spegne anche chi ne ha bisogno, e il profilo diventa personalizzato", async () => {
    await mount();
    $<HTMLButtonElement>('[data-group="supporto"] .components-group-toggle')!.click();
    toggle("fub.penna").click();
    await settled();
    expect(box.asked).toHaveLength(1);
    await vi.waitFor(() => expect(toggle("fub.penna").checked).toBe(false));
    expect(toggle("fub.lavagna").checked).toBe(false);
    expect(toggle("fub.pdf").checked).toBe(false);
  });

  it("il nucleo rifiutato e un errore del comando rimettono l'interruttore e lo dicono", async () => {
    await mount();
    const restore = box.host!.componentsFail({ kind: "io", message: "disco pieno" } as never);
    toggle("fub.graph").click();
    await settled();
    expect(toggle("fub.graph").checked).toBe(true);
    expect($(".components-notice [role=alert]")!.textContent).toContain("Scelta non applicata");
    expect(noticeText()).toContain("disco pieno");
    restore();
  });

  it("un profilo che spegne qualcosa lo dice prima, coi nomi", async () => {
    await mount();
    profile("solo-note").click();
    await settled();
    expect(box.asked).toHaveLength(1);
    expect(box.asked[0]!.opts.title).toBe("Passare a «Solo note»?");
    expect(box.asked[0]!.message).toContain("«Lavagna»");
    expect(box.asked[0]!.message).not.toContain("fub.");
    await vi.waitFor(() => expect(profile("solo-note").getAttribute("aria-pressed")).toBe("true"));
    expect(toggle("fub.lavagna").checked).toBe(false);
  });

  it("un profilo che non spegne niente si applica con un clic", async () => {
    await mount();
    profile("tutto").click();
    await settled();
    expect(box.asked).toHaveLength(0);
    await vi.waitFor(() => expect(profile("tutto").getAttribute("aria-pressed")).toBe("true"));
  });

  it("spegnere a mano lascia il profilo «personalizzato»", async () => {
    await mount();
    toggle("fub.graph").click();
    await settled();
    expect(toggle("fub.graph").checked).toBe(false);
    expect($(".components-custom")!.textContent).toBe("personalizzato");
    expect($('[aria-pressed="true"]')).toBeNull();
    // Spegnere un bundle ricarica ciò che i bundle registrano.
    expect(reloadProvider).toHaveBeenCalledTimes(1);
  });

  it("chi non serve più resta in avviso finché non si risponde, anche riaprendo", async () => {
    let page = await mount("solo-note");
    for (const id of ["fub.pdf", "fub.lavagna", "fub.pdf", "fub.lavagna"]) {
      toggle(id).click();
      await settled();
    }
    expect(noticeText()).toContain("Non serve più a nessun componente: «Penna».");
    expect(row("fub.penna").textContent).toContain("Non serve più");
    expect(row("fub.penna").classList.contains("components-row--orphan")).toBe(true);
    // Chiudere e riaprire: l'avviso viene dallo stato dell'host, non da qui.
    page.reset();
    lifetime.close();
    lifetime = openLifetime();
    page = mountComponentsPage(lifetime, { visible: () => visible, reloadProvider });
    document.body.replaceChildren(page.element);
    await page.show();
    expect(noticeText()).toContain("«Penna»");
    $<HTMLButtonElement>('[data-focus-key="notice:keep"]')!.click();
    await settled();
    expect(noticeText()).toBe("");
    expect(toggle("fub.penna").checked).toBe(true);
  });

  it("«Togli» spegne chi non serve più", async () => {
    await mount("solo-note");
    for (const id of ["fub.pdf", "fub.lavagna", "fub.pdf", "fub.lavagna"]) {
      toggle(id).click();
      await settled();
    }
    $<HTMLButtonElement>('[data-focus-key="notice:drop"]')!.click();
    await settled();
    expect(noticeText()).toBe("");
    expect(toggle("fub.penna").checked).toBe(false);
  });

  it("la ricerca filtra sul posto, apre il supporto e dice quando non trova niente", async () => {
    await mount();
    const find = $<HTMLInputElement>("#components-find")!;
    find.value = "penna";
    find.dispatchEvent(new Event("input"));
    expect(row("fub.penna").hidden).toBe(false);
    expect($('[data-group="supporto"] .components-rows')!.hidden).toBe(false);
    expect(row("fub.search").hidden).toBe(true);
    expect($<HTMLElement>('[data-group="scrivere"]')!.hidden).toBe(true);
    find.value = "zzz niente";
    find.dispatchEvent(new Event("input"));
    expect($(".components-empty")!.hidden).toBe(false);
    expect($(".components-empty")!.textContent).toBe("Nessun componente con queste parole.");
    expect($(".components-empty")).toBe(document.querySelector(".components-empty"));
  });

  it("una scelta arrivata da fuori si rilegge con una lettura sola", async () => {
    await mount();
    box.maps = 0;
    box.host!.componentsFromOutside({ azione: "spegni", id: "fub.graph" });
    await vi.waitFor(() => expect(toggle("fub.graph").checked).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(box.maps).toBe(1);
    expect($(".components-custom")).not.toBeNull();
  });

  it("il rimontaggio del vault durante una scelta non rompe la pagina", async () => {
    await mount("solo-note");
    toggle("fub.pdf").click();
    await settled();
    toggle("fub.lavagna").click();
    await settled();
    expect(toggle("fub.lavagna").checked).toBe(true);
    expect($("#components-page-title")!.isConnected).toBe(true);
  });

  it("smontata, la pagina non ridisegna più e non lascia ascoltatori", async () => {
    box.host = createFakeHost({});
    stopRouter = await startKernelRouter();
    lifetime = openLifetime();
    state.vaultRoot = "/vault";
    mountComponents(lifetime);
    const own = openLifetime();
    const page = mountComponentsPage(own, { visible: () => visible, reloadProvider });
    document.body.replaceChildren(page.element);
    await page.show();
    own.close();
    box.maps = 0;
    box.host.componentsFromOutside({ azione: "spegni", id: "fub.graph" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Lo stato dell'app rilegge (una volta); la pagina smontata no.
    expect(box.maps).toBe(1);
    expect(toggle("fub.graph").checked).toBe(true);
  });

  it("dopo una scelta da fuori, la pagina nascosta non ridisegna e torna aggiornata", async () => {
    const page = await mount();
    visible = false;
    box.maps = 0;
    box.host!.componentsFromOutside({ azione: "spegni", id: "fub.graph" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    // La mappa si rilegge una volta per tutta l'app; la pagina non la ridisegna.
    expect(box.maps).toBe(1);
    expect(toggle("fub.graph").checked).toBe(true);
    visible = true;
    await page.show();
    expect(box.maps).toBe(1);
    expect(toggle("fub.graph").checked).toBe(false);
  });

  it("una mappa che non si legge lo dice, e il riquadro non c'è", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    box.host = createFakeHost({});
    stopRouter = await startKernelRouter();
    lifetime = openLifetime();
    // Un vault che il finto non conosce: `components_map` rifiuta.
    state.vaultRoot = "/nessuno";
    const original = box.host.module.api.componentsMap;
    box.host.module.api.componentsMap = () => Promise.reject(new Error("giù"));
    mountComponents(lifetime);
    const page = mountComponentsPage(lifetime, { visible: () => visible, reloadProvider });
    document.body.replaceChildren(page.element);
    await page.show();
    expect($(".components-list")!.textContent).toBe("I componenti di questo vault non si leggono, per ora.");
    expect($<HTMLElement>(".components-preview")!.hidden).toBe(true);
    box.host.module.api.componentsMap = original;
    error.mockRestore();
  });
});

describe("il riquadro «Fub con questi componenti»", () => {
  const preview = () => $<HTMLElement>(".components-preview")!;
  const newItems = () => [...preview().querySelectorAll(".components-new-item")].map((item) => item.textContent);
  const opens = () =>
    Object.fromEntries(
      [...preview().querySelectorAll<HTMLElement>(".components-opens-item")].map((item) => [
        item.querySelector("code")!.textContent,
        item.querySelector("span")!.textContent,
      ]),
    );
  const weight = () => [...preview().querySelectorAll(".components-weight")].map((line) => line.textContent);

  it("con «Studio»: un aside col suo nome, le voci di «Nuovo», tutto si apre dentro Fub", async () => {
    await mount("studio");
    const aside = preview();
    expect(aside.tagName).toBe("ASIDE");
    expect(aside.hidden).toBe(false);
    expect(aside.getAttribute("aria-live")).toBeNull();
    expect(document.getElementById(aside.getAttribute("aria-labelledby")!)!.textContent).toBe("Fub con questi componenti");
    // Senza `drawing.create` il kernel non fa disegni: il menu dice solo «Nota».
    expect(newItems()).toEqual(["Nota"]);
    expect(opens()).toEqual({
      ".md": "in «Note»",
      ".canvas": "in «Lavagna»",
      ".pdf": "in «PDF»",
      ".docx .odt .rtf .doc .dot": "in «Documenti»",
      ".xlsx .xlsm .xltx .xltm": "in «Fogli»",
    });
    expect(weight()).toEqual([
      "35componenti attivi, 4 di supporto",
      "0spenti: Fub non li avvia e non ne carica il codice",
    ]);
    // I comandi arrivano anche dopo la mappa: il riquadro segue.
    setCommandSpecs([drawingCreateSpec()]);
    expect(newItems()).toEqual(["Nota", "Disegno"]);
  });

  it("con «Solo note»: PDF, lavagna, documenti e fogli restano file", async () => {
    await mount("solo-note");
    expect(newItems()).toEqual(["Nota"]);
    expect(opens()).toEqual({
      ".md": "in «Note»",
      ".canvas": "solo come file",
      ".pdf": "solo come file",
      ".docx .odt .rtf .doc .dot": "solo come file",
      ".xlsx .xlsm .xltx .xltm": "solo come file",
    });
    expect(weight()).toEqual([
      "25componenti attivi, 0 di supporto",
      "10spenti: Fub non li avvia e non ne carica il codice",
    ]);
  });

  it("scelto «Tutto», il riquadro dice tutto acceso", async () => {
    await mount("studio");
    profile("tutto").click();
    await settled();
    expect(profile("tutto").getAttribute("aria-pressed")).toBe("true");
    expect(Object.values(opens()).every((where) => where.startsWith("in «"))).toBe(true);
    expect(weight()).toEqual([
      "35componenti attivi, 4 di supporto",
      "0spenti: Fub non li avvia e non ne carica il codice",
    ]);
  });

  it("dopo un interruttore il riquadro segue", async () => {
    await mount("solo-note");
    toggle("fub.pdf").click();
    await settled();
    expect(toggle("fub.pdf").checked).toBe(true);
    expect(opens()[".pdf"]).toBe("in «PDF»");
    expect(opens()[".canvas"]).toBe("solo come file");
    // Il PDF porta con sé la penna, che è di supporto.
    expect(weight()).toEqual([
      "27componenti attivi, 1 di supporto",
      "8spenti: Fub non li avvia e non ne carica il codice",
    ]);
  });
});

describe("le icone dei componenti", () => {
  it("ogni componente dello scenario ha la sua icona in tabella, non quella di ripiego", () => {
    const ids = new Set(scenario.mappe.flatMap((map) => map.righe.map((row) => row.id)));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      const name = COMPONENT_ICONS[id];
      expect({ id, name: name ?? null }).toEqual({ id, name: expect.any(String) });
      expect({ id, drawn: icon(name!) !== "" }).toEqual({ id, drawn: true });
    }
    expect(componentIcon("fub.proof")).toBe(icon("footnote"));
    expect(componentIcon("fub.rich")).toBe(icon("format-word"));
  });
});
