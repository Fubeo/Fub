// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../host/dialog", () => ({ pickFolder: vi.fn(async () => "/picked") }));

import { t } from "../../i18n/strings";
import { pickVaultLocation } from "../../platform/vault-picker";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { MobileBridge, MobileStorageInfo, MobileStoragePreference } from "./bridge";
import { mountMobileStorageStatus, privateStoragePorts } from "./storage-ui";
import { decideStorage } from "./storage";

const roots: MobileStorageInfo = {
  private_dir: "/data/vaults/Vault",
  shared_grant: null,
  shared_permission: "unknown",
  offline_reliable_private: true,
  offline_reliable_shared: false,
  shared_mount: "need_grant",
};

function fakeBridge(): { bridge: MobileBridge; saved: MobileStoragePreference[] } {
  let preference: MobileStoragePreference = { version: 1, revision: "", choice: null, grant: null };
  const saved: MobileStoragePreference[] = [];
  const bridge = {
    storageRoots: async () => roots,
    storagePreference: async () => preference,
    setStoragePreference: async (next: MobileStoragePreference) => {
      preference = next;
      saved.push(next);
      return next;
    },
    sharedMountMode: async () => "need_grant" as const,
    registerTreeGrant: async (grant: unknown) => grant,
    onResumed: async () => () => {},
  } as unknown as MobileBridge;
  return { bridge, saved };
}

function panel(): { region: HTMLDetailsElement; privateButton: HTMLButtonElement; sharedButton: HTMLButtonElement; status: HTMLElement } {
  const region = document.querySelector<HTMLDetailsElement>(".mobile-storage")!;
  const [privateButton, sharedButton] = [...region.querySelectorAll("button")];
  return { region, privateButton: privateButton!, sharedButton: sharedButton!, status: region.querySelector("[role=status]")! };
}

describe("mobile storage panel", () => {
  let lifetime: Lifetime;
  let open: ReturnType<typeof vi.fn<(dir: string) => Promise<void>>>;

  beforeEach(() => {
    lifetime = openLifetime();
    open = vi.fn(async () => {});
  });

  afterEach(() => {
    lifetime.close();
  });

  it("opens the private space through the shell and remembers the choice", async () => {
    const { bridge, saved } = fakeBridge();
    mountMobileStorageStatus(lifetime, bridge, privateStoragePorts(bridge, open));
    const { privateButton } = panel();
    expect(privateButton.disabled).toBe(false);

    privateButton.click();
    await vi.waitFor(() => expect(saved[saved.length - 1]?.choice).toBe("private"));
    expect(open).toHaveBeenCalledWith("/data/vaults/Vault");
  });

  it("never mounts a shared folder, nor falls back to the private space", async () => {
    const { bridge, saved } = fakeBridge();
    const ports = privateStoragePorts(bridge, open);
    mountMobileStorageStatus(lifetime, bridge, ports);
    const { region, sharedButton, status } = panel();

    sharedButton.click();
    await vi.waitFor(() => expect(status.textContent).toContain("need_grant"));
    expect(region.open).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(saved).toEqual([]);

    // Even a copy decision carrying the private folder is refused, and said.
    const copy = { ...decideStorage(roots, "shared"), mount: "copy_import" as const, dir: roots.private_dir };
    await expect(ports.mount(copy)).rejects.toThrow(t("mobile.storage.shared_unavailable"));
    expect(open).not.toHaveBeenCalled();
  });

  it("answers “Open vault…” by showing the choice, not by making it", async () => {
    const { bridge } = fakeBridge();
    mountMobileStorageStatus(lifetime, bridge, privateStoragePorts(bridge, open));
    const { region, privateButton } = panel();
    region.open = false;

    await expect(pickVaultLocation()).resolves.toBeNull();
    expect(region.open).toBe(true);
    expect(document.activeElement).toBe(privateButton);
    expect(open).not.toHaveBeenCalled();

    lifetime.close();
    await expect(pickVaultLocation()).resolves.toBe("/picked");
  });

  it("without ports keeps both choices disabled and says so", () => {
    const { bridge } = fakeBridge();
    mountMobileStorageStatus(lifetime, bridge);
    const { privateButton, sharedButton, status } = panel();
    expect([privateButton.disabled, sharedButton.disabled]).toEqual([true, true]);
    expect(status.textContent).toBe(t("mobile.storage.not_connected"));
  });
});
