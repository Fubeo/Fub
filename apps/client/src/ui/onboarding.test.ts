// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportPreview } from "../host/ipc";
import { t } from "../i18n/strings";

const fake = vi.hoisted(() => ({
  demoRoot: vi.fn(), openDemo: vi.fn(), closeDemo: vi.fn(), resetDemo: vi.fn(),
  supportPreview: vi.fn(), supportExport: vi.fn(), startupDiagnostics: vi.fn(),
  configHealth: vi.fn(), recoverConfig: vi.fn(),
  confirm: vi.fn(), pickSupportDestination: vi.fn(), notify: vi.fn(),
  componentsMap: vi.fn(), componentsApply: vi.fn(),
}));
const query = vi.hoisted(() => ({ vaultEntries: vi.fn(), settings: vi.fn() }));
/// I fatti del kernel, consegnati a mano: chi si iscrive e che cosa riceve.
const events = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: { type: string; root: string }) => void>>();
  return {
    handlers,
    on(type: string, handler: (event: { type: string; root: string }) => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => set.delete(handler);
    },
    emit(event: { type: string; root: string }) {
      for (const handler of [...(handlers.get(event.type) ?? [])]) handler(event);
    },
  };
});
vi.mock("../host/ipc", () => ({ api: fake }));
vi.mock("../host/query", () => query);
vi.mock("../state/kernel", () => ({ onEvent: events.on }));
vi.mock("../host/dialog", () => ({ confirm: fake.confirm, pickSupportDestination: fake.pickSupportDestination }));
vi.mock("./notify", () => ({ notify: fake.notify }));

import type { ComponentsApplied } from "../host/contract";
import type { ComponentScenario } from "../host/fake";
import scenarioFixture from "../__fixtures__/components-scenario.json";
import { emit as storeEmit, state as vaultState } from "../state/store";
import { askVaultProfile, isNewVault, mountOnboarding, PROFILE_REMOUNT_WAIT_MS, type OnboardingShell } from "./onboarding";
import { openLifetime } from "./lifetime";

const preview: SupportPreview = {
  v: 1, at: 42, fub: "1.0", vault: null,
  machine: { settings_keys: ["locale.language"], known_vaults: 2, log_path: null },
  log_tail: [], note: "redacted",
};
let current = "";
const shell: OnboardingShell = {
  openPath: vi.fn(async (path: string) => { current = path; }),
  prepareSwitch: vi.fn(async () => true),
  isOpening: () => false,
  currentVault: () => current,
  returnTo: vi.fn(async (path: string | null) => { current = path ?? ""; }),
};
let dispose: () => void;

function button(key: Parameters<typeof t>[0], within = "#onboarding-extra"): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll<HTMLButtonElement>(`${within} button`))
    .find(candidate => candidate.textContent === t(key));
  if (!el) throw new Error(`missing button ${key}`);
  return el;
}

function click(key: Parameters<typeof t>[0], within = "#onboarding-extra"): void {
  button(key, within).click();
}

beforeEach(async () => {
  vi.resetAllMocks();
  current = "";
  vi.mocked(shell.openPath).mockImplementation(async (path) => { current = path; });
  vi.mocked(shell.prepareSwitch).mockResolvedValue(true);
  vi.mocked(shell.returnTo).mockImplementation(async (path) => { current = path ?? ""; });
  document.body.innerHTML = '<div id="titlebar-right"></div><div id="onboarding"></div>';
  fake.demoRoot.mockResolvedValue("/config/demo-vault");
  fake.openDemo.mockResolvedValue({ root: "/config/demo-vault", previous: "/vault" });
  fake.closeDemo.mockResolvedValue({ errors: [], current: "/vault" });
  fake.resetDemo.mockResolvedValue("/config/demo-vault");
  fake.supportPreview.mockResolvedValue(preview);
  fake.startupDiagnostics.mockResolvedValue([{ kind: "cancelled", message: "limited startup" }]);
  fake.supportExport.mockResolvedValue("/outside/support.json");
  fake.configHealth.mockResolvedValue([]);
  fake.confirm.mockResolvedValue(true);
  fake.pickSupportDestination.mockResolvedValue("/outside/support.json");
  dispose = mountOnboarding(shell);
  await vi.waitFor(() => {
    expect(fake.demoRoot).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLButtonElement>("#onboarding-extra button")?.disabled).toBe(false);
  });
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

describe("onboarding machine actions", () => {
  it("opens the isolated demo and exposes reset/close while the vault surface is shown", async () => {
    click("demo.open");
    await vi.waitFor(() => {
      expect(current).toBe("/config/demo-vault");
      expect(document.querySelector<HTMLElement>('#titlebar-right [role="group"]')?.hidden).toBe(false);
      expect(button("demo.reset", "#titlebar-right").disabled).toBe(false);
    });
    expect(fake.openDemo).toHaveBeenCalledOnce();
    click("demo.reset", "#titlebar-right");
    await vi.waitFor(() => {
      expect(fake.resetDemo).toHaveBeenCalledOnce();
      expect(button("demo.close", "#titlebar-right").disabled).toBe(false);
    });
    expect(fake.confirm).toHaveBeenCalledWith(t("demo.reset_confirm"), expect.objectContaining({ danger: true }));
    click("support.diagnostics", "#titlebar-right");
    await vi.waitFor(() => expect(fake.notify).toHaveBeenCalledWith("limited startup", "guasto"));
    expect(fake.startupDiagnostics).toHaveBeenCalledWith("/config/demo-vault");
    await vi.waitFor(() => expect(button("demo.close", "#titlebar-right").disabled).toBe(false));
    click("demo.close", "#titlebar-right");
    await vi.waitFor(() => expect(current).toBe("/vault"));
    expect(fake.closeDemo).toHaveBeenCalledWith("/vault");
    expect(document.querySelector<HTMLElement>('#titlebar-right [role="group"]')?.hidden).toBe(true);
  });

  it("returns to the empty workspace instead of reopening a previous vault already closed elsewhere", async () => {
    fake.closeDemo.mockResolvedValue({ errors: [], current: null });
    click("demo.open");
    await vi.waitFor(() => expect(button("demo.close", "#titlebar-right").disabled).toBe(false));
    click("demo.close", "#titlebar-right");
    await vi.waitFor(() => {
      expect(shell.returnTo).toHaveBeenCalledWith(null);
      expect(current).toBe("");
      expect(document.activeElement).toBe(button("demo.open"));
    });
    expect(fake.closeDemo).toHaveBeenCalledWith("/vault");
  });

  it("never exports without shown preview, chosen file, and affirmative consent", async () => {
    click("support.export");
    expect(fake.supportExport).not.toHaveBeenCalled();
    click("support.preview");
    await vi.waitFor(() => {
      expect(document.querySelector("#onboarding-extra pre")?.textContent).toContain("locale.language");
      expect(button("support.export").disabled).toBe(false);
    });
    expect(fake.supportPreview).toHaveBeenCalledWith(null, 0);
    fake.pickSupportDestination.mockResolvedValueOnce(null);
    click("support.export");
    await vi.waitFor(() => {
      expect(fake.pickSupportDestination).toHaveBeenCalledOnce();
      expect(button("support.export").disabled).toBe(false);
    });
    expect(fake.supportExport).not.toHaveBeenCalled();
    fake.confirm.mockResolvedValueOnce(false);
    click("support.export");
    await vi.waitFor(() => {
      expect(fake.confirm).toHaveBeenCalledOnce();
      expect(button("support.export").disabled).toBe(false);
    });
    expect(fake.supportExport).not.toHaveBeenCalled();
    click("support.export");
    await vi.waitFor(() => expect(fake.supportExport).toHaveBeenCalledOnce());
    expect(fake.supportExport).toHaveBeenCalledWith(preview, {
      acknowledged_preview: true, include_log: false, destination: "/outside/support.json",
    });
  });

  it("keeps export disabled and reports a failed diagnostic preview", async () => {
    fake.supportPreview.mockRejectedValue({ kind: "permission_denied", message: "Cannot read config" });
    click("support.preview");
    await vi.waitFor(() => expect(fake.notify).toHaveBeenCalledWith(
      expect.stringContaining("Cannot read config"), "guasto",
    ));
    expect(button("support.export").disabled).toBe(true);
    expect(fake.pickSupportDestination).not.toHaveBeenCalled();
  });

  it("offers no reset for future schema, but requires explicit confirmation for unreadable files", async () => {
    fake.configHealth.mockResolvedValue([
      { kind: "machine_settings", path: "/config/settings.json", status: { kind: "future_version", found: "9", supported: 1 } },
      { kind: "view_state", path: "/config/view-state.json", status: { kind: "unreadable", reason: "invalid JSON" } },
    ]);
    fake.confirm.mockResolvedValueOnce(false);
    fake.recoverConfig.mockResolvedValue({ backup: "/config/view-state.json.bak", detail: "saved", restart_required: true });
    click("recovery.check");
    await vi.waitFor(() => {
      expect(document.querySelector("#onboarding-extra")?.textContent).toContain("/config/view-state.json");
      expect(button("recovery.check").disabled).toBe(false);
    });
    expect(document.querySelector("#onboarding-extra")?.textContent).toContain(t("recovery.future", { found: "9", supported: 1 }));
    expect(document.querySelectorAll('#onboarding-extra [data-action="reset_empty"]')).toHaveLength(1);
    click("recovery.reset");
    await vi.waitFor(() => {
      expect(fake.confirm).toHaveBeenCalledOnce();
      expect(button("recovery.check").disabled).toBe(false);
    });
    expect(fake.recoverConfig).not.toHaveBeenCalled();
    click("recovery.reset");
    await vi.waitFor(() => expect(fake.recoverConfig).toHaveBeenCalledWith("/config/view-state.json", "reset_empty"));
    expect(fake.recoverConfig).not.toHaveBeenCalledWith("/config/settings.json", expect.anything());
  });

  it("remounts without retaining stale chrome actions or event handlers", async () => {
    dispose = mountOnboarding(shell);
    expect(document.querySelectorAll('#titlebar-right [role="group"]')).toHaveLength(1);
    await vi.waitFor(() => expect(button("demo.open").disabled).toBe(false));
    click("demo.open");
    await vi.waitFor(() => expect(fake.openDemo).toHaveBeenCalledOnce());
    dispose();
    expect(document.querySelectorAll('#titlebar-right [role="group"]')).toHaveLength(0);
  });

  it("disposes a child when its page owner closes, including detached button handlers", () => {
    const parent = openLifetime();
    dispose = mountOnboarding(shell, parent);
    const oldOpen = button("demo.open");
    parent.close();
    oldOpen.click();
    expect(fake.openDemo).not.toHaveBeenCalled();
    expect(document.getElementById("onboarding-extra")).toBeNull();
    expect(document.querySelector('#titlebar-right [role="group"]')).toBeNull();
  });
});

// --- il profilo di un vault nuovo ---------------------------------------------

describe("the profile of a new vault", () => {
  const scenario = scenarioFixture as unknown as ComponentScenario;
  const fresh = scenario.mappe[scenario.partenze.nuovo!]!;
  const answer = (name: string): ComponentsApplied =>
    structuredClone(scenario.scelte.find((choice) =>
      choice.prima === scenario.partenze.nuovo && choice.apply
      && choice.azione.azione === "profilo" && choice.azione.nome === name)!.risposta);
  const reloadProvider = vi.fn(async () => {});
  const screen = () => document.getElementById("onboarding-profile");
  const profile = (name: string) => screen()!.querySelector<HTMLButtonElement>(`[data-profile="${name}"]`)!;
  const go = () => document.getElementById("onboarding-profile-continue") as HTMLButtonElement;
  const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

  beforeEach(() => {
    events.handlers.clear();
    vaultState.vaultRoot = "/nuovo";
    fake.componentsMap.mockResolvedValue(structuredClone(fresh));
    fake.componentsApply.mockImplementation(async (action: { nome: string }) => answer(action.nome));
    query.vaultEntries.mockResolvedValue({ items: [], offset: 0, total: 0 });
    query.settings.mockResolvedValue([]);
  });

  /// La schermata aperta, e la promessa di quando si chiude (in una scatola:
  /// una funzione `async` che rende una promessa la aspetterebbe).
  async function opened(): Promise<{ done: Promise<void> }> {
    const done = askVaultProfile("/nuovo", { reloadProvider });
    await vi.waitFor(() => expect(screen()).not.toBeNull());
    return { done };
  }

  it("is new only without visible entries and without components.* written in the vault", async () => {
    expect(await isNewVault()).toBe(true);
    query.settings.mockResolvedValue([{ spec: { key: "components.off" }, value: [], source: "default" }]);
    expect(await isNewVault()).toBe(true);
    query.settings.mockResolvedValue([{ spec: { key: "components.profile" }, value: "", source: "vault" }]);
    expect(await isNewVault()).toBe(false);
    query.settings.mockResolvedValue([]);
    query.vaultEntries.mockResolvedValue({ items: [], offset: 0, total: 1 });
    expect(await isNewVault()).toBe(false);
    query.vaultEntries.mockRejectedValue(new Error("no"));
    expect(await isNewVault()).toBe(false);
  });

  it("shows the six profiles with Studio chosen and applies nothing before Continue", async () => {
    const { done } = await opened();
    expect(document.getElementById("onboarding")!.dataset.step).toBe("profile");
    expect(screen()!.getAttribute("role")).toBe("dialog");
    expect(screen()!.getAttribute("aria-modal")).toBe("true");
    expect(screen()!.querySelectorAll("[data-profile]")).toHaveLength(6);
    expect(screen()!.querySelectorAll(".components-profile--later")).toHaveLength(3);
    expect(profile("studio").getAttribute("aria-pressed")).toBe("true");
    expect(profile("studio").querySelector(".components-profile-rec")).not.toBeNull();
    expect(document.activeElement).toBe(profile("studio"));
    profile("tutto").click();
    profile("grafica").click();
    expect(profile("tutto").getAttribute("aria-pressed")).toBe("true");
    expect(screen()!.querySelector("[role='status']")!.textContent).toContain("Grafica");
    expect(fake.componentsApply).not.toHaveBeenCalled();
    go().click();
    await done;
    expect(fake.componentsApply).toHaveBeenCalledWith({ azione: "profilo", nome: "tutto" }, true, "/nuovo");
    expect(screen()).toBeNull();
    expect(document.getElementById("onboarding")!.dataset.step).toBeUndefined();
  });

  it("Escape is Studio", async () => {
    const { done } = await opened();
    profile("solo-note").click();
    escape();
    await done;
    expect(fake.componentsApply).toHaveBeenCalledOnce();
    expect(fake.componentsApply).toHaveBeenCalledWith({ azione: "profilo", nome: "studio" }, true, "/nuovo");
  });

  it("waits for the remount a lavagna write brings, then reloads the providers", async () => {
    const { done } = await opened();
    profile("solo-note").click();
    let over = false;
    void done.then(() => { over = true; });
    go().click();
    await vi.waitFor(() => expect(fake.componentsApply).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(over).toBe(false);
    events.emit({ type: "vault_closed", root: "/nuovo" });
    await Promise.resolve();
    expect(over).toBe(false);
    events.emit({ type: "vault_opened", root: "/nuovo" });
    await done;
    expect(reloadProvider).toHaveBeenCalledOnce();
  });

  it("does not hang when the remount never comes", async () => {
    vi.useFakeTimers();
    try {
      const done = askVaultProfile("/nuovo", { reloadProvider });
      await vi.waitFor(() => expect(screen()).not.toBeNull());
      profile("solo-note").click();
      go().click();
      await vi.advanceTimersByTimeAsync(PROFILE_REMOUNT_WAIT_MS);
      await done;
      expect(screen()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a failure and a refusal as errors, and lets the vault open", async () => {
    fake.componentsApply.mockRejectedValueOnce({ kind: "io", message: "disco pieno" });
    let { done } = await opened();
    go().click();
    await done;
    expect(fake.notify).toHaveBeenCalledWith(expect.stringContaining("disco pieno"), "guasto");
    expect(screen()).toBeNull();

    fake.notify.mockClear();
    fake.componentsApply.mockResolvedValueOnce(answer("grafica"));
    ({ done } = await opened());
    go().click();
    await done;
    expect(fake.notify).toHaveBeenCalledWith(expect.stringContaining("arriva più avanti"), "guasto");
  });

  it("without a map there is nothing to ask: the error is said and the vault opens", async () => {
    fake.componentsMap.mockRejectedValueOnce({ kind: "io", message: "illeggibile" });
    await askVaultProfile("/nuovo", { reloadProvider });
    expect(screen()).toBeNull();
    expect(fake.notify).toHaveBeenCalledWith(expect.stringContaining("illeggibile"), "guasto");
  });

  it("leaves without applying when another vault takes its place", async () => {
    const { done } = await opened();
    vaultState.vaultRoot = "/altro";
    storeEmit("vault", "/altro");
    await done;
    expect(screen()).toBeNull();
    expect(fake.componentsApply).not.toHaveBeenCalled();
  });
});
