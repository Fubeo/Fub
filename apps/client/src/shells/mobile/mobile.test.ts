import { describe, expect, it, vi } from "vitest";

import { createLifecycleFlush } from "./lifecycle";
import { decideStorage, inspectSharedStorage, inspectStorageHealth } from "./storage";
import { validateCaptureLocal } from "./capture";
import type { MobileBridge, MobileStorageInfo, MobileTreeGrant } from "./bridge";

describe("lifecycle mobile", () => {
  it("coalesces overlapping pauses into one follow-up flush, returning its final dirty state", async () => {
    let release!: () => void;
    let calls = 0;
    const suspend = createLifecycleFlush({
      flushPendingSave: () => {
        calls += 1;
        if (calls === 1) return new Promise<string[]>((resolve) => { release = () => resolve(["note.md"]); });
        return Promise.resolve([]);
      },
      dirtyIds: () => ["note.md"],
      countDrafts: async () => 0,
    });
    const first = suspend();
    const second = suspend();
    const third = suspend();
    release();
    expect(await Promise.all([first, second, third])).toEqual([
      expect.objectContaining({ remaining: [] }),
      expect.objectContaining({ remaining: [] }),
      expect.objectContaining({ remaining: [] }),
    ]);
    expect(calls).toBe(2);
  });
});

const grant: MobileTreeGrant = {
  platform: "android",
  uri: "content://com.android.externalstorage.documents/tree/primary%3AFub",
  persisted: true,
  read_write: true,
};
const roots: MobileStorageInfo = {
  private_dir: "/priv",
  shared_grant: null,
  shared_permission: "unknown",
  offline_reliable_private: true,
  offline_reliable_shared: false,
  shared_mount: "need_grant",
};

describe("storage mobile", () => {
  it("a persisted grant revoked by the OS cannot mount, copy or silently become private", async () => {
    const sharedMountMode = vi.fn(async () => "read_write" as const);
    const decision = await inspectSharedStorage(
      { storageRoots: async () => roots, sharedMountMode } as unknown as MobileBridge,
      { read: async () => ({ version: 1 as const, revision: "", choice: "shared" as const, grant }), update: async () => {} },
      { verifyGrant: async () => "revoked", backendCas: async () => true },
      true,
    );
    expect(decision).toMatchObject({ choice: "shared", mount: "need_grant", dir: null, needsGrant: true, warning: "revoked" });
    expect(sharedMountMode).not.toHaveBeenCalled();
    expect(decideStorage({ ...roots, shared_grant: grant, shared_mount: "read_write" }, "shared").needsGrant).toBe(true);
  });

  it("copy-import requires an explicit accepted gesture, never a fallback to private", async () => {
    const bridge = {
      storageRoots: async () => roots,
      sharedMountMode: async (_: MobileTreeGrant, __: boolean, accepted: boolean) => accepted ? "copy_import" : "read_only",
    } as MobileBridge;
    const store = { read: async () => ({ version: 1 as const, revision: "", choice: "shared" as const, grant }), update: async () => {} };
    const ports = { verifyGrant: async () => "granted" as const, backendCas: async () => false };
    expect((await inspectSharedStorage(bridge, store, ports)).mount).toBe("read_only");
    expect((await inspectSharedStorage(bridge, store, ports, true)).copyImport).toBe(true);
    const health = await inspectStorageHealth(decideStorage(roots, "shared"), false);
    expect(health).toMatchObject({ quota: "unknown", offlineAccess: "unavailable", online: false });
  });
});

describe("capture mobile", () => {
  it("rejects empty content, oversized UTF-8 content and append without target", () => {
    expect(validateCaptureLocal({ title: " ", markdown: "x", mode: "create" }).ok).toBe(false);
    expect(validateCaptureLocal({ title: "t", markdown: "é".repeat(524289), mode: "create" }).ok).toBe(false);
    expect(validateCaptureLocal({ title: "t", markdown: "x", mode: "append" }).ok).toBe(false);
    expect(validateCaptureLocal({ title: "t", markdown: "x", mode: "append", note: "N.md" }).ok).toBe(true);
  });
});
