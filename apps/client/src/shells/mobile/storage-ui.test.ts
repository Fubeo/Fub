// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../host/dialog", () => ({ pickFolder: vi.fn(async () => "/picked") }));

import { t } from "../../i18n/strings";
import { pickVaultLocation } from "../../platform/vault-picker";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { MobileBridge, MobileMountMode, MobilePermissionState, MobileStorageInfo, MobileStoragePreference, MobileTreeGrant } from "./bridge";
import { copyReport, mountMobileStorageStatus, nativeStoragePorts, privateStoragePorts } from "./storage-ui";
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

const iosGrant: MobileTreeGrant = {
  platform: "ios",
  uri: "file:///private/var/mobile/Appunti/",
  display_name: "Appunti",
  persisted: true,
  read_write: true,
  bookmark_b64: "Ym9va21hcms=",
};
const androidGrant: MobileTreeGrant = {
  platform: "android",
  uri: "content://com.android.externalstorage.documents/tree/primary%3AAppunti",
  display_name: "Appunti",
  persisted: true,
  read_write: true,
};

/// Il ponte con il sistema finto: `permission` lo dà il sistema, `mode` il
/// backend dopo averlo verificato (qui lo si simula con la regola della
/// piattaforma: in loco su iOS, copia su Android).
function nativeBridge(grant: MobileTreeGrant, permission: MobilePermissionState = "granted") {
  const base = fakeBridge();
  const calls: string[] = [];
  const bridge = Object.assign(base.bridge, {
    pickTree: vi.fn(async (): Promise<MobileTreeGrant | null> => grant),
    verifyTree: vi.fn(async () => permission),
    sharedMountMode: vi.fn(async (_g: unknown, _cas: boolean, copyAccepted: boolean): Promise<MobileMountMode> => {
      if (permission !== "granted") return "need_grant";
      if (grant.platform === "ios") return "read_write";
      return copyAccepted ? "copy_import" : "read_only";
    }),
    openSharedTree: vi.fn(async () => { calls.push("open-shared"); return "/private/var/mobile/Appunti"; }),
    closeSharedTree: vi.fn(async () => { calls.push("close-shared"); return []; }),
    copyTree: vi.fn(async () => {
      calls.push("copy");
      return { vault: "/data/vaults/Vault", folder: "/data/vaults/Vault/Appunti", files: 3, bytes: 10, truncated: false, skipped: [] };
    }),
  });
  return { ...base, bridge, calls };
}

describe("mobile storage with the native bridge", () => {
  let lifetime: Lifetime;
  let open: ReturnType<typeof vi.fn<(dir: string) => Promise<void>>>;

  beforeEach(() => {
    lifetime = openLifetime();
    open = vi.fn(async () => {});
  });

  afterEach(() => {
    lifetime.close();
  });

  it("on iOS picks the folder, keeps the grant and mounts it where it is", async () => {
    const { bridge, saved } = nativeBridge(iosGrant);
    mountMobileStorageStatus(lifetime, bridge, nativeStoragePorts(bridge, open));
    panel().sharedButton.click();

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("/private/var/mobile/Appunti"));
    expect(bridge.pickTree).toHaveBeenCalledTimes(1);
    expect(saved.some((p) => p.grant?.uri === iosGrant.uri)).toBe(true);
    await vi.waitFor(() => expect(saved[saved.length - 1]?.choice).toBe("shared"));
  });

  it("on Android opens the shared folder only as a copy, on the explicit gesture", async () => {
    const { bridge, saved, calls } = nativeBridge(androidGrant);
    mountMobileStorageStatus(lifetime, bridge, nativeStoragePorts(bridge, open));
    const { region } = panel();
    panel().sharedButton.click();

    // Sola lettura: niente montaggio, e il pulsante della copia compare.
    const copyButton = region.querySelectorAll("button")[2] as HTMLButtonElement;
    await vi.waitFor(() => expect(copyButton.hidden).toBe(false));
    expect(open).not.toHaveBeenCalled();
    expect(calls).toEqual([]);

    copyButton.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("/data/vaults/Vault"));
    expect(calls).toEqual(["copy"]);
    await vi.waitFor(() => expect(saved[saved.length - 1]?.choice).toBe("private"));
  });

  it("a revoked permission asks again and mounts nothing", async () => {
    const { bridge } = nativeBridge(iosGrant, "revoked");
    bridge.pickTree.mockResolvedValue(null);
    mountMobileStorageStatus(lifetime, bridge, nativeStoragePorts(bridge, open));
    const { region, sharedButton, status } = panel();
    await bridge.setStoragePreference({ version: 1, revision: "", choice: "shared", grant: iosGrant });

    sharedButton.click();
    await vi.waitFor(() => expect(status.textContent).toContain("revoked"));
    expect(region.open).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(bridge.openSharedTree).not.toHaveBeenCalled();
  });

  it("a read-only decision is refused with the reason, never mounted", async () => {
    const { bridge } = nativeBridge(androidGrant);
    const ports = nativeStoragePorts(bridge, open);
    const readOnly = { ...decideStorage(roots, "shared"), grant: androidGrant, mount: "read_only" as const, needsGrant: false };
    await expect(ports.mount(readOnly)).rejects.toThrow(t("mobile.storage.copy_only"));
    expect(open).not.toHaveBeenCalled();
  });

  it("a copy report says what was left behind", () => {
    const base = { vault: "/v", folder: "/v/Appunti 2", files: 4, bytes: 1, truncated: false, skipped: [] as string[] };
    expect(copyReport(base)).toEqual({ text: t("mobile.storage.copied", { files: "4", folder: "Appunti 2" }), tone: "info" });
    expect(copyReport({ ...base, skipped: ["a/b.md"] }).tone).toBe("guasto");
    expect(copyReport({ ...base, skipped: ["a/b.md"] }).text).toContain("a/b.md");
    expect(copyReport({ ...base, truncated: true }).text).toBe(t("mobile.storage.copied_truncated", { files: "4", folder: "Appunti 2" }));
  });
});
