// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportPreview } from "../host/ipc";
import { t } from "../i18n/strings";

const fake = vi.hoisted(() => ({
  demoRoot: vi.fn(), openDemo: vi.fn(), closeDemo: vi.fn(), resetDemo: vi.fn(),
  supportPreview: vi.fn(), supportExport: vi.fn(), startupDiagnostics: vi.fn(),
  configHealth: vi.fn(), recoverConfig: vi.fn(),
  confirm: vi.fn(), pickSupportDestination: vi.fn(), notify: vi.fn(),
}));
vi.mock("../host/ipc", () => ({ api: fake }));
vi.mock("../host/dialog", () => ({ confirm: fake.confirm, pickSupportDestination: fake.pickSupportDestination }));
vi.mock("./notify", () => ({ notify: fake.notify }));

import { mountOnboarding, type OnboardingShell } from "./onboarding";
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
