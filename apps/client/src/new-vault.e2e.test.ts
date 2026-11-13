// @vitest-environment happy-dom
//
// **Il profilo di un vault nuovo** (K2, T5), sulla shell vera.
//
// «Crea un vault nuovo…» su una cartella vuota apre il vault dietro il
// benvenuto e chiede il profilo: i sei della riga condivisa, «Studio» già
// scelto, «Continua». Esc vale «Studio». Una cartella con dei file, o «Apri
// vault…», non chiede niente. Il cablaggio è quello di `components.e2e.test.ts`
// — `main.ts` sulla scocca vera, contro l'host finto — con l'host che parte
// dallo stato «nuovo» dello scenario registrato dall'host vero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

/// Un host senza vault all'avvio: la cartella che si sceglie è `/vault`, con
/// questi file e nello stato dei componenti di `start`.
function host(file: Record<string, string> = {}, componentsStart = "nuovo", initialVault: string | null = null): FakeHost {
  return createFakeHost({ file, componentsStart, initialVault });
}

async function start(fake: FakeHost): Promise<FakeHost> {
  vi.resetModules();
  box.host = fake;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return fake;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 15_000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

const onboarding = () => document.getElementById("onboarding")!;
const screen = () => document.getElementById("onboarding-profile");
const profile = (name: string) => screen()!.querySelector<HTMLButtonElement>(`[data-profile="${name}"]`)!;
const continueButton = () => document.getElementById("onboarding-profile-continue") as HTMLButtonElement;
const focused = () => document.activeElement as HTMLElement;
const vaultShown = () => onboarding().hidden && screen() === null;

/// Un tasto come lo batte chi usa la tastiera: la trappola e le guardie lo
/// vedono per primi; se nessuno lo ferma, fa ciò che farebbe il browser (Tab
/// sposta il fuoco nell'ordine del documento, Invio e Spazio premono un
/// bottone).
function press(key: string, shift = false): void {
  const target = focused();
  const init = { key, shiftKey: shift, bubbles: true, cancelable: true };
  const down = new KeyboardEvent("keydown", init);
  target.dispatchEvent(down);
  if (!down.defaultPrevented) {
    if (key === "Tab") {
      const order = [...document.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => !(el as HTMLButtonElement).disabled && el.closest("[hidden]") === null);
      const at = order.indexOf(target);
      order[at + (shift ? -1 : 1)]?.focus();
    } else if ((key === "Enter" || key === " ") && target instanceof HTMLButtonElement) {
      target.click();
    }
  }
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function create(): Promise<void> {
  document.getElementById("onboarding-create")!.click();
}

async function components(fake: FakeHost) {
  return fake.module.api.componentsMap("/vault");
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("il profilo di un vault nuovo", () => {
  it("crea, sceglie «Solo note» solo con la tastiera e «Continua»: il vault ha «Solo note»", async () => {
    const fake = await start(host());
    expect(onboarding().hidden).toBe(false);
    await create();
    await waitFor("la schermata del profilo", () => screen() !== null);

    // Dietro la schermata il vault c'è, ma non si vede: il benvenuto resta.
    expect(onboarding().hidden).toBe(false);
    expect(onboarding().dataset.step).toBe("profile");
    expect(document.getElementById("app")!.dataset.welcome).toBe("");
    // I sei profili, tre «più avanti», «Studio» già scelto e col fuoco.
    const names = [...screen()!.querySelectorAll<HTMLElement>("[data-profile]")].map((el) => el.dataset.profile);
    expect(names).toEqual(["solo-note", "solo-pdf", "studio", "grafica", "fotografia", "tutto"]);
    expect(screen()!.querySelectorAll('[aria-disabled="true"]')).toHaveLength(3);
    expect(profile("studio").getAttribute("aria-pressed")).toBe("true");
    expect(focused()).toBe(profile("studio"));
    expect(screen()!.textContent).toContain("Si cambia quando vuoi, da Impostazioni › Componenti");
    expect(continueButton().classList.contains("primary")).toBe(true);

    // Un profilo «più avanti» dice perché, e non si sceglie.
    press("Tab", true);
    expect(focused()).toBe(profile("solo-pdf"));
    press("Enter");
    expect(screen()!.querySelector("[role='status']")!.textContent).toContain("arriva più avanti");
    expect(profile("studio").getAttribute("aria-pressed")).toBe("true");

    press("Tab", true);
    expect(focused()).toBe(profile("solo-note"));
    press(" ");
    expect(profile("solo-note").getAttribute("aria-pressed")).toBe("true");
    expect(profile("studio").getAttribute("aria-pressed")).toBe("false");
    // Scegliere non applica niente.
    expect(fake.atGate("componentsApply")).toHaveLength(0);

    // Tab gira fra i profili e «Continua», e dall'ultimo torna al primo.
    for (let i = 0; i < 6; i += 1) press("Tab");
    expect(focused()).toBe(continueButton());
    press("Tab");
    expect(focused()).toBe(profile("solo-note"));
    press("Tab", true);
    expect(focused()).toBe(continueButton());

    press("Enter");
    // «Solo note» spegne la lavagna e il vault si rimonta: la schermata
    // aspetta che torni, poi il vault si mostra.
    await waitFor("il vault si mostra", vaultShown);
    expect(fake.atGate("componentsApply").map((call) => call.args)).toEqual([[{ azione: "profilo", nome: "solo-note" }, true, "/vault"]]);
    expect((await components(fake)).profilo).toBe("solo-note");
    expect(document.getElementById("app")!.dataset.welcome).toBeUndefined();
    expect(onboarding().dataset.step).toBeUndefined();
  });

  it("crea ed Esc: il vault ha «Studio»", async () => {
    const fake = await start(host());
    await create();
    await waitFor("la schermata del profilo", () => screen() !== null);
    // Anche dopo aver scelto un altro profilo, Esc vale «Studio».
    profile("tutto").click();
    press("Escape");
    await waitFor("il vault si mostra", vaultShown);
    expect(fake.atGate("componentsApply").map((call) => call.args)).toEqual([[{ azione: "profilo", nome: "studio" }, true, "/vault"]]);
    expect((await components(fake)).profilo).toBe("studio");
  });

  it("«Apri vault…» su una cartella vuota non chiede niente", async () => {
    const fake = await start(host());
    document.getElementById("onboarding-open")!.click();
    await waitFor("il vault si mostra", () => onboarding().hidden);
    await settle();
    expect(screen()).toBeNull();
    expect(fake.atGate("componentsApply")).toHaveLength(0);
  });

  it("un vault esistente all'avvio non chiede niente", async () => {
    const fake = await start(host({ "Nota.md": "# Nota\n" }, "studio", "/vault"));
    await waitFor("il vault si mostra", () => onboarding().hidden);
    await settle();
    expect(screen()).toBeNull();
    expect(fake.atGate("componentsApply")).toHaveLength(0);
  });

  it("«Crea» su una cartella che ha già dei file non chiede niente", async () => {
    const fake = await start(host({ "Nota.md": "# Nota\n" }));
    await create();
    await waitFor("il vault si mostra", () => onboarding().hidden);
    await settle();
    expect(screen()).toBeNull();
    expect(fake.atGate("componentsApply")).toHaveLength(0);
  });

  it("un errore nell'applicare: il vault si apre come prima e l'errore si vede", async () => {
    const fake = await start(host());
    fake.componentsFail({ kind: "io", message: "disco pieno" });
    await create();
    await waitFor("la schermata del profilo", () => screen() !== null);
    continueButton().click();
    await waitFor("il vault si mostra", vaultShown);
    expect(document.body.textContent).toContain("Il profilo non si è applicato");
    expect(document.body.textContent).toContain("disco pieno");
    // Nessun profilo: il vault resta com'era appena creato.
    expect((await components(fake)).profilo).toBeNull();
  });

  it("un profilo rifiutato dall'host si dice come un errore", async () => {
    const fake = await start(host());
    await create();
    await waitFor("la schermata del profilo", () => screen() !== null);
    // L'host vero rifiuta «Grafica» (più avanti): la schermata non lo fa
    // scegliere, ma se una risposta di rifiuto arriva lo stesso, si dice.
    fake.module.api.componentsApply = ((original) => (_azione, apply, vault) =>
      original({ azione: "profilo", nome: "grafica" }, apply, vault))(fake.module.api.componentsApply);
    continueButton().click();
    await waitFor("il vault si mostra", vaultShown);
    expect(document.body.textContent).toContain("Il profilo non si è applicato");
    expect(document.body.textContent).toContain("arriva più avanti");
  });
});
