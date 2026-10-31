// Le scelte sul menu «/» dalle impostazioni, e la voce tolta subito.
import { afterEach, describe, expect, it } from "vitest";
import type { SettingEntry } from "../../host/contract";
import { applySlashSettings, hideSlashEntry, SLASH_HIDDEN_SETTING, SLASH_SECTIONS_SETTING, slashPrefs } from "./prefs";

function entry(key: string, value: unknown): SettingEntry {
  return { spec: { key }, value, source: "default" } as unknown as SettingEntry;
}

afterEach(() => applySlashSettings([]));

describe("le scelte sul menu «/»", () => {
  it("si leggono dalle impostazioni; ciò che non è una lista di testi vale vuoto", () => {
    applySlashSettings([entry(SLASH_HIDDEN_SETTING, ["markdown.rule", "markdown.rule"]), entry(SLASH_SECTIONS_SETTING, "lists")]);
    expect(slashPrefs()).toEqual({ hidden: ["markdown.rule"], sections: [] });
  });

  it("una voce nascosta sparisce subito, e torna se la scrittura fallisce", async () => {
    const written: unknown[] = [];
    await hideSlashEntry("markdown.rule", async (key, value) => void written.push([key, value]));
    expect(written).toEqual([[SLASH_HIDDEN_SETTING, ["markdown.rule"]]]);
    expect(slashPrefs().hidden).toEqual(["markdown.rule"]);
    const failing = hideSlashEntry("markdown.table", () => Promise.reject(new Error("no")));
    expect(slashPrefs().hidden).toEqual(["markdown.rule", "markdown.table"]);
    await expect(failing).rejects.toThrow("no");
    expect(slashPrefs().hidden).toEqual(["markdown.rule"]);
  });

  it("una scelta arrivata nel frattempo non si annulla", async () => {
    let reject!: (error: Error) => void;
    const pending = hideSlashEntry("markdown.rule", () => new Promise<void>((_, no) => (reject = no)));
    applySlashSettings([entry(SLASH_HIDDEN_SETTING, ["markdown.quote"])]);
    reject(new Error("no"));
    await expect(pending).rejects.toThrow();
    expect(slashPrefs().hidden).toEqual(["markdown.quote"]);
  });
});
