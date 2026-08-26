// @vitest-environment happy-dom
//
// Il presidio della coreografia di shell: prova i due rami del browser e il
// caso che la sola animazione CSS non sa chiudere, cioè riaprire mentre l'uscita
// è ancora in corso. I timer sono finti perché qui il tempo è soltanto il bound
// di sicurezza, non ciò che dimostra il comportamento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function media(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: reduced,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function transitionSupport(
  start?: (update: () => void) => { finished: Promise<void> },
): void {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: start,
  });
}

async function motion() {
  vi.resetModules();
  return import("./motion");
}

describe("la coreografia delle superfici", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    media(false);
    transitionSupport(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    transitionSupport(undefined);
  });

  it("senza View Transitions percorre per intero il fallback a stati", async () => {
    const { enterSurface, exitSurface, supportsViewTransitions } = await motion();
    const surface = document.createElement("div");
    document.body.append(surface);

    expect(supportsViewTransitions()).toBe(false);
    enterSurface(surface);
    expect(surface.dataset.shellMotion).toBe("enter");
    surface.dispatchEvent(new Event("animationend"));
    expect(surface.dataset.shellMotion).toBe("rest");

    let concealed = 0;
    exitSurface(surface, () => concealed++);
    expect(surface.dataset.shellMotion).toBe("exit");
    expect(surface.style.pointerEvents).toBe("none");
    expect(concealed).toBe(0);
    surface.dispatchEvent(new Event("animationend"));
    expect(concealed).toBe(1);
  });

  it("con supporto usa il ramo progressivo per la stessa mutazione", async () => {
    const start = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    transitionSupport(start);
    const { enterSurface, supportsViewTransitions } = await motion();
    const surface = document.createElement("div");
    surface.id = "settings-panel";
    document.body.append(surface);

    enterSurface(surface);

    expect(supportsViewTransitions()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(surface.dataset.shellMotion).toBe("enter");
    expect(surface.style.getPropertyValue("view-transition-name")).toBe(
      "fub-surface-settings-panel",
    );
  });

  it("riaprire durante l'uscita riannoda il nodo senza classi residue", async () => {
    const { enterSurface, exitSurface } = await motion();
    const surface = document.createElement("div");
    surface.className = "modale";
    document.body.append(surface);
    let concealed = 0;

    enterSurface(surface);
    exitSurface(surface, () => concealed++);
    expect(surface.dataset.shellMotion).toBe("exit");
    enterSurface(surface);
    expect(surface.dataset.shellMotion).toBe("enter");
    expect(surface.style.pointerEvents).toBe("");

    vi.runAllTimers();
    expect(concealed).toBe(0);
    expect(surface.dataset.shellMotion).toBe("rest");
    expect(surface.className).toBe("modale");
  });

  it("il bound conclude un'uscita anche se animationend si perde", async () => {
    const { exitSurface } = await motion();
    const surface = document.createElement("div");
    let concealed = false;

    exitSurface(surface, () => {
      concealed = true;
    });
    vi.advanceTimersByTime(599);
    expect(concealed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(concealed).toBe(true);
  });

  it("col moto ridotto non anima e non avvia View Transitions", async () => {
    media(true);
    const start = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    transitionSupport(start);
    const { enterSurface, exitSurface } = await motion();
    const surface = document.createElement("div");
    let concealed = 0;

    enterSurface(surface);
    expect(surface.dataset.shellMotion).toBe("rest");
    exitSurface(surface, () => concealed++);

    expect(concealed).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
