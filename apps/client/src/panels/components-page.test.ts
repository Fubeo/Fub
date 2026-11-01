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
const { mountComponentsPage } = await import("./components-page");

let stopRouter: (() => void) | null = null;
let lifetime = openLifetime();
let visible = true;
const reloadProvider = vi.fn(async () => {});

async function mount(start?: string) {
  box.host = createFakeHost(start ? { componentsStart: start } : {});
  stopRouter = await startKernelRouter();
  lifetime = openLifetime();
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
    // «note» è lo stesso insieme di «Solo note»: un pulsante solo.
    expect($('[data-profile="note"]')).toBeNull();
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

  it("una pagina nascosta non legge, e rilegge quando torna", async () => {
    const page = await mount();
    visible = false;
    box.maps = 0;
    box.host!.componentsFromOutside({ azione: "spegni", id: "fub.graph" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(box.maps).toBe(0);
    visible = true;
    await page.show();
    expect(box.maps).toBe(1);
    expect(toggle("fub.graph").checked).toBe(false);
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

  it("smontata, la pagina non legge più e non lascia ascoltatori", async () => {
    await mount();
    lifetime.close();
    box.maps = 0;
    box.host!.componentsFromOutside({ azione: "spegni", id: "fub.graph" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(box.maps).toBe(0);
  });
});
