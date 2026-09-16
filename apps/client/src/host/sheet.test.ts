import { describe, expect, it, vi } from "vitest";
import sample from "../__fixtures__/sheet-query.json";
import { createFakeHost } from "./fake";
import { evaluateSheet } from "./sheet";
import type { IndexResult, PluginError } from "./contract";

describe("sheet evaluation through the data registry", () => {
  it("consumes the result emitted by the real Rust host", async () => {
    const handler = vi.fn(() => sample.result.value);
    const fake = createFakeHost({ customQueries: { "fub.sheet": handler } });
    const result = await evaluateSheet(fake.module.api.queryIndex, sample.query.query.source);
    expect(result).toEqual(sample.result.value);
    expect(handler).toHaveBeenCalledWith(sample.query.query);
    expect(fake.atGate("queryIndex")).toEqual([{ gate: "queryIndex", args: [sample.query] }]);
    expect(fake.atGate("evaluateSheet")).toHaveLength(0);
  });

  it("preserves typed unserved when the provider is absent, without inventing a result", async () => {
    const fake = createFakeHost();
    await expect(evaluateSheet(fake.module.api.queryIndex, "{}")).rejects.toMatchObject({ kind: "unserved" });
    expect(fake.atGate("queryIndex")).toHaveLength(1);
  });

  it("does not resolve inherited object properties as namespace handlers", async () => {
    const fake = createFakeHost({ customQueries: {} });
    await expect(fake.module.api.queryIndex({ kind: "custom", ns: "toString", query: {} }))
      .rejects.toMatchObject({ kind: "unserved" });
  });

  it("propagates the original operational error without string matching", async () => {
    const error: PluginError = { kind: "bad_args", message: "over budget" };
    const fake = createFakeHost({ customQueries: { "fub.sheet": () => { throw error; } } });
    await expect(evaluateSheet(fake.module.api.queryIndex, "{}")).rejects.toBe(error);
  });

  it.each([
    { kind: "jobs", value: [] },
    { kind: "custom", value: null },
    { kind: "custom", value: { cells: [], dependencies: {} } },
    { kind: "custom", value: { cells: [{ sheet: "s", row: "r", column: "c", value: { kind: "number", value: NaN } }], dependencies: [] } },
    { kind: "custom", value: { cells: [{ sheet: "s", row: "r", column: "c", value: { kind: "error", value: "future" } }], dependencies: [] } },
    { kind: "custom", value: { cells: [], dependencies: [{ cell: {}, depends_on: [] }] } },
  ])("rejects a malformed response %# before it reaches the grid", async (result) => {
    await expect(evaluateSheet(async () => result as IndexResult, "{}"))
      .rejects.toMatchObject({ kind: "internal" });
  });
});
