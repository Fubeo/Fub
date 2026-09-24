// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { getCM } from "@replit/codemirror-vim";
import { EditorView } from "@codemirror/view";
import type { SettingEntry } from "../../host/contract";
import { settings } from "../../host/query";
import { forwardNotice } from "../../state/kernel";
import { createTextEngine, EDITOR_SPELLCHECK_KEY, EDITOR_VIM_KEY } from "./engine";

vi.mock("../../host/query", () => ({ settings: vi.fn() }));

function entry(key: string, value: boolean): SettingEntry {
  return {
    spec: {
      key, label: key, description: "", group: "Editor", scope: "machine",
      kind: { kind: "toggle", default: key === EDITOR_SPELLCHECK_KEY },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

describe("text input settings", () => {
  it("applies setting changes on the same view and stops listening after destroy", async () => {
    const read = vi.mocked(settings);
    read.mockResolvedValueOnce([entry(EDITOR_SPELLCHECK_KEY, true), entry(EDITOR_VIM_KEY, false)]);
    const host = document.createElement("div");
    document.body.append(host);
    const engine = createTextEngine(host, { onChange: () => {}, onSelectionChange: () => {} });
    const view = EditorView.findFromDOM(host)!;
    engine.setDoc("שלום");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    read.mockResolvedValue([entry(EDITOR_SPELLCHECK_KEY, false), entry(EDITOR_VIM_KEY, true)]);
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_VIM_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    await vi.waitFor(() => expect(getCM(view)).not.toBeNull());
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    expect(engine.getDoc()).toBe("שלום");
    engine.destroy();
    const calls = read.mock.calls.length;
    forwardNotice({
      event: { type: "setting_changed", key: EDITOR_SPELLCHECK_KEY, scope: "machine" },
      origin: { actor: { kind: "user" }, batch: null },
    });
    expect(read).toHaveBeenCalledTimes(calls);
    host.remove();
  });
});
