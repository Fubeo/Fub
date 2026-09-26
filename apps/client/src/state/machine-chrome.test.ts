// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SettingSource, SettingValue } from "../host/contract";

const fake = vi.hoisted(() => ({
  setSetting: vi.fn(async (_key: string, _value: unknown): Promise<void> => {}),
}));
vi.mock("../host/ipc", () => ({ api: { setSetting: fake.setSetting } }));

import { adoptLegacyChrome, writeChrome } from "./machine-chrome";

function entry(key: string, value: SettingValue, source: SettingSource): SettingEntry {
  return {
    spec: { key, label: key, kind: { kind: "list", default: [] }, scope: "machine" },
    value,
    source,
  } as unknown as SettingEntry;
}

const hiddenList = (raw: string): string[] | null => {
  const hidden = (JSON.parse(raw) as { hidden?: string[] }).hidden ?? [];
  return hidden.length ? hidden : null;
};

afterEach(() => {
  localStorage.clear();
  fake.setSetting.mockReset();
  fake.setSetting.mockImplementation(async () => {});
});

describe("le preferenze della cornice che stavano in localStorage", () => {
  it("diventano l'impostazione se è ancora al default, e la chiave vecchia se ne va", async () => {
    localStorage.setItem("vecchia", JSON.stringify({ hidden: ["search"] }));
    const value = await adoptLegacyChrome("vecchia", entry("chrome.rail.hidden", [], "default"), hiddenList);
    expect(value).toEqual(["search"]);
    expect(fake.setSetting).toHaveBeenCalledWith("chrome.rail.hidden", ["search"]);
    expect(localStorage.getItem("vecchia")).toBeNull();
  });

  it("un'impostazione già scelta vince, e la chiave vecchia se ne va senza scrivere", async () => {
    localStorage.setItem("vecchia", JSON.stringify({ hidden: ["search"] }));
    const value = await adoptLegacyChrome("vecchia", entry("chrome.rail.hidden", ["files"], "machine"), hiddenList);
    expect(value).toBeNull();
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(localStorage.getItem("vecchia")).toBeNull();
  });

  it("se la scrittura fallisce valgono per la sessione e la chiave vecchia resta", async () => {
    localStorage.setItem("vecchia", JSON.stringify({ hidden: ["search"] }));
    fake.setSetting.mockRejectedValueOnce(new Error("disco pieno"));
    const value = await adoptLegacyChrome("vecchia", entry("chrome.rail.hidden", [], "default"), hiddenList);
    expect(value).toEqual(["search"]);
    expect(localStorage.getItem("vecchia")).not.toBeNull();
  });

  it("un host che non dichiara l'impostazione non tocca la chiave vecchia", async () => {
    localStorage.setItem("vecchia", "0");
    expect(await adoptLegacyChrome("vecchia", undefined, () => false)).toBeNull();
    expect(localStorage.getItem("vecchia")).toBe("0");
  });

  it("una chiave illeggibile si dimentica senza scrivere", async () => {
    localStorage.setItem("vecchia", "{rotto");
    expect(await adoptLegacyChrome("vecchia", entry("chrome.rail.hidden", [], "default"), hiddenList)).toBeNull();
    expect(fake.setSetting).not.toHaveBeenCalled();
    expect(localStorage.getItem("vecchia")).toBeNull();
  });

  it("scrivere non lancia mai in modo sincrono", async () => {
    fake.setSetting.mockImplementationOnce(() => { throw new Error("nessuno la dichiara"); });
    await expect(writeChrome("chrome.sidebar.visible", false)).rejects.toThrow("nessuno la dichiara");
  });
});
