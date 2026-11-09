// @vitest-environment happy-dom
//
// Le preferenze della lavagna contro l'host finto: le due impostazioni della
// macchina che il bundle `fub.lavagna` dichiara, e lo stato di vista che
// ricorda «Scrivi col mouse». Ogni caso riparte da moduli nuovi, perché
// `preferences.ts` ricorda l'ultima lettura.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import type { FakeHost } from "../../host/fake";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
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
  };
});

const { createFakeHost } = await import("../../host/fake");

const REMEMBER = "canvas.ink_mouse_remember";
const FINGER = "canvas.finger_moves_card";
const INK_MOUSE = "canvas.ink_mouse";

/// Una riga di `fub.lavagna`: un interruttore della macchina, spento di serie,
/// col valore `value` (anche uno sbagliato, come da un file scritto a mano).
function lavagnaEntry(key: string, value: unknown): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Lavagna",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value,
    source: value === false ? "default" : "machine",
  } as SettingEntry;
}

/// Un'altra impostazione, che la lavagna non guarda.
const OTHER: SettingEntry = {
  spec: {
    key: "editor.line_numbers",
    label: "Numeri di riga",
    description: "",
    group: "Editor",
    scope: "machine",
    kind: { kind: "toggle", default: true },
    program_writable: false,
  },
  value: true,
  source: "default",
};

/// Lascia finire ciò che è in coda.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/// Moduli nuovi sull'host `host`, col router del kernel acceso.
async function boot(host: FakeHost) {
  box.host = host;
  vi.resetModules();
  const preferences = await import("./preferences");
  const kernel = await import("../../state/kernel");
  await kernel.startKernelRouter();
  return preferences;
}

/// Le domande delle impostazioni arrivate al finto.
function settingsReads(host: FakeHost): unknown[] {
  return host
    .atGate("queryIndex")
    .map((call) => call.args[0])
    .filter((query) => (query as { kind: string }).kind === "settings");
}

beforeEach(() => {
  box.host = null;
});

describe("le impostazioni della lavagna", () => {
  it("prima di leggere e senza le chiavi sono spente", async () => {
    const host = createFakeHost({ settings: [OTHER] });
    const { DEFAULT_PREFERENCES, currentPreferences, watchPreferences } = await boot(host);
    expect(DEFAULT_PREFERENCES).toEqual({ inkMouseRemember: false, fingerMovesCard: false });
    expect(currentPreferences()).toEqual(DEFAULT_PREFERENCES);
    const applied: unknown[] = [];
    const stop = watchPreferences((preferences) => applied.push(preferences));
    await settle();
    expect(applied).toEqual([{ inkMouseRemember: false, fingerMovesCard: false }]);
    stop();
  });

  it("si leggono dal bundle, e un valore che non è un interruttore vale spento", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, true), OTHER] });
    const { currentPreferences, preferencesOf, watchPreferences } = await boot(host);
    const applied: unknown[] = [];
    const stop = watchPreferences((preferences) => applied.push(preferences));
    await settle();
    expect(applied).toEqual([{ inkMouseRemember: true, fingerMovesCard: true }]);
    expect(currentPreferences()).toEqual({ inkMouseRemember: true, fingerMovesCard: true });
    expect(settingsReads(host)).toEqual([{ kind: "settings", plugin: "fub.lavagna" }]);
    stop();

    for (const wrong of ["sì", "true", 1, null, { on: true }, [true]]) {
      expect(preferencesOf([lavagnaEntry(REMEMBER, wrong), lavagnaEntry(FINGER, true)]), JSON.stringify(wrong)).toEqual({
        inkMouseRemember: false,
        fingerMovesCard: true,
      });
    }
  });

  it("seguono il cambio da setting_changed, anche da un'altra finestra, e smettono quando si chiude", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, false), lavagnaEntry(FINGER, false), OTHER] });
    const { currentPreferences, watchPreferences } = await boot(host);
    const applied: unknown[] = [];
    const stop = watchPreferences((preferences) => applied.push(preferences));
    await settle();
    expect(applied).toEqual([{ inkMouseRemember: false, fingerMovesCard: false }]);

    await host.module.api.setSetting("editor.line_numbers", false);
    await settle();
    expect(settingsReads(host), "un'altra impostazione non fa rileggere").toHaveLength(1);

    // La scrittura dell'host è la stessa da qualunque finestra arrivi: il
    // backend emette `setting_changed` a tutte.
    await host.module.api.setSetting(FINGER, true);
    await settle();
    expect(applied[applied.length - 1]).toEqual({ inkMouseRemember: false, fingerMovesCard: true });
    await host.module.api.setSetting(REMEMBER, true);
    await settle();
    expect(applied[applied.length - 1]).toEqual({ inkMouseRemember: true, fingerMovesCard: true });
    expect(currentPreferences()).toEqual({ inkMouseRemember: true, fingerMovesCard: true });

    stop();
    const count = applied.length;
    await host.module.api.setSetting(FINGER, false);
    await settle();
    expect(applied, "dopo stop").toHaveLength(count);
    expect(settingsReads(host), "dopo stop nessuno rilegge").toHaveLength(3);
  });

  it("una lettura che non riesce lascia le ultime, e una superata non arriva", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, false)] });
    const { currentPreferences, watchPreferences } = await boot(host);
    const applied: unknown[] = [];
    const stop = watchPreferences((preferences) => applied.push(preferences));
    await settle();

    const broken = host.fault("queryIndex");
    await host.module.api.setSetting(FINGER, true);
    await settle();
    expect(applied[applied.length - 1], "le ultime lette").toEqual({ inkMouseRemember: true, fingerMovesCard: false });
    broken();

    const slow = host.throttle("queryIndex");
    await host.module.api.setSetting(FINGER, true);
    await host.module.api.setSetting(REMEMBER, false);
    slow();
    await settle();
    expect(applied[applied.length - 1]).toEqual({ inkMouseRemember: false, fingerMovesCard: true });
    expect(currentPreferences()).toEqual({ inkMouseRemember: false, fingerMovesCard: true });
    stop();
  });
});

describe("«Scrivi col mouse» ricordato", () => {
  it("con «Ricorda» spento la lavagna parte spenta, anche se lo stato dice acceso", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, false), lavagnaEntry(FINGER, false)] });
    const { readInkMouse } = await boot(host);
    await host.module.api.setViewState(INK_MOUSE, { on: true });
    expect(await readInkMouse()).toBe(false);
  });

  it("con «Ricorda» acceso riprende l'ultimo, e uno stato che manca o è rotto vale spento", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, false)] });
    const { inkMouseOf, readInkMouse } = await boot(host);
    expect(await readInkMouse(), "nessuno stato").toBe(false);
    await host.module.api.setViewState(INK_MOUSE, { on: true });
    expect(await readInkMouse()).toBe(true);
    for (const broken of [null, "on", true, [], { on: "true" }, { on: 1 }, { acceso: true }]) {
      expect(inkMouseOf(broken), JSON.stringify(broken)).toBe(false);
      await host.module.api.setViewState(INK_MOUSE, broken);
      expect(await readInkMouse(), JSON.stringify(broken)).toBe(false);
    }
  });

  it("si scrive a ogni cambio, in fila, e la lettura aspetta le scritture", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, false)] });
    const { readInkMouse, saveInkMouse } = await boot(host);
    const release = host.throttle("setViewState");
    saveInkMouse(true);
    saveInkMouse(false);
    saveInkMouse(true);
    const reading = readInkMouse();
    await settle();
    expect(host.atGate("viewState"), "la lettura aspetta le scritture").toHaveLength(0);
    release();
    expect(await reading).toBe(true);
    expect(host.atGate("setViewState").map((call) => call.args)).toEqual([
      [INK_MOUSE, { on: true }],
      [INK_MOUSE, { on: false }],
      [INK_MOUSE, { on: true }],
    ]);
    expect(await host.module.api.viewState(INK_MOUSE)).toEqual({ on: true });
  });

  it("si scrive anche con «Ricorda» spento, così quando si accende vale l'ultima scelta", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, false), lavagnaEntry(FINGER, false)] });
    const { readInkMouse, saveInkMouse } = await boot(host);
    saveInkMouse(true);
    expect(await readInkMouse()).toBe(false);
    await host.module.api.setSetting(REMEMBER, true);
    expect(await readInkMouse()).toBe(true);
  });

  it("una scelta fatta mentre si legge vale più di ciò che si è letto; uno stato che non si legge lascia l'ultimo", async () => {
    const host = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, false)] });
    const { readInkMouse, saveInkMouse } = await boot(host);
    await host.module.api.setViewState(INK_MOUSE, { on: false });
    const slow = host.throttle("viewState");
    const reading = readInkMouse();
    await settle();
    saveInkMouse(true);
    slow();
    expect(await reading).toBe(true);

    const broken = host.fault("viewState");
    expect(await readInkMouse(), "l'ultimo").toBe(true);
    broken();

    // Una scrittura che non riesce non dice niente e non ferma la fila.
    const failing = host.fault("setViewState");
    saveInkMouse(false);
    await settle();
    failing();
    saveInkMouse(true);
    await settle();
    expect(await host.module.api.viewState(INK_MOUSE)).toEqual({ on: true });

    // Un host senza stato di vista leggibile, la prima volta: spento.
    const fresh = createFakeHost({ settings: [lavagnaEntry(REMEMBER, true), lavagnaEntry(FINGER, false)] });
    const bare = await boot(fresh);
    const gone = fresh.fault("viewState");
    expect(await bare.readInkMouse()).toBe(false);
    gone();
  });
});

describe("la penna ricordata (canvas.pen)", () => {
  const PEN = "canvas.pen";
  const STATE = {
    version: 1,
    tool: "highlighter",
    pen: "fountain",
    penColor: "#D55E00",
    penWidth: 7.5,
    highlighterColor: "#56b4e9",
    highlighterWidth: 24,
    eraser: "piece",
  };

  it("legge la forma della versione 1; ogni campo rotto vale il suo di serie; un'altra versione vale la penna di serie", async () => {
    const host = createFakeHost({ settings: [] });
    const { penChoiceOf, penStateOf } = await boot(host);
    const { DEFAULT_INK_CHOICE } = await import("./ink-record");
    const choice = penChoiceOf(STATE);
    expect(choice).toEqual({
      tool: "highlighter",
      pen: "fountain",
      color: { pen: "#d55e00", highlighter: "#56b4e9" },
      width: { pen: 7.5, highlighter: 24 },
      eraser: "piece",
    });
    expect(penStateOf(choice)).toEqual({ ...STATE, penColor: "#d55e00" });
    for (const other of [null, "penna", [], 3, { ...STATE, version: 2 }, { ...STATE, version: "1" }, { tool: "pen" }]) {
      expect(penChoiceOf(other), JSON.stringify(other)).toEqual(DEFAULT_INK_CHOICE);
    }
    expect(
      penChoiceOf({ version: 1, tool: "matita", pen: "highlighter", penColor: "blu", penWidth: "4", highlighterColor: "#fff", highlighterWidth: null, eraser: "tutto" }),
    ).toEqual(DEFAULT_INK_CHOICE);
    // Gli spessori fuori misura vanno al bordo e al passo del cursore.
    expect(penChoiceOf({ ...STATE, penWidth: 0.1, highlighterWidth: 99 }).width).toEqual({ pen: 0.5, highlighter: 48 });
    expect(penChoiceOf({ ...STATE, penWidth: 3.3, highlighterWidth: 9.6 }).width).toEqual({ pen: 3.5, highlighter: 10 });
  });

  it("si scrive in fila e la lettura aspetta le scritture; uno stato che non si legge lascia l'ultimo", async () => {
    const host = createFakeHost({ settings: [] });
    const { readPen, savePen, penChoiceOf } = await boot(host);
    const { DEFAULT_INK_CHOICE } = await import("./ink-record");
    expect(await readPen(), "nessuno stato").toEqual(DEFAULT_INK_CHOICE);
    const release = host.throttle("setViewState");
    const first = { ...DEFAULT_INK_CHOICE, tool: "eraser" as const };
    const second = penChoiceOf(STATE);
    savePen(first);
    savePen(second);
    const reading = readPen();
    await settle();
    expect(host.atGate("viewState").filter((call) => call.args[0] === PEN), "la lettura aspetta").toHaveLength(1);
    release();
    expect(await reading).toEqual(second);
    expect(host.atGate("setViewState").map((call) => (call.args[1] as { tool: string }).tool)).toEqual(["eraser", "highlighter"]);

    const broken = host.fault("viewState");
    expect(await readPen(), "l'ultimo").toEqual(second);
    broken();

    // Una scrittura che non riesce non dice niente e non ferma la fila.
    const failing = host.fault("setViewState");
    savePen(first);
    await settle();
    failing();
    savePen(DEFAULT_INK_CHOICE);
    await settle();
    expect(await host.module.api.viewState(PEN)).toMatchObject({ version: 1, tool: "pen" });
  });
});
