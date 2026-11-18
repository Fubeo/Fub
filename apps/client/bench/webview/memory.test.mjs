import { describe, expect, it } from "vitest";

import { COLLECT_SCRIPT, buildCollector, collect } from "./memory.mjs";

describe("la raccolta forzata della WebView per R1 (#284)", () => {
  it("con il gancio spento non raccoglie niente e lo dice", async () => {
    const scripts = [];
    const session = { execute: async (script) => (scripts.push(script), null) };
    const result = await collect(session);
    expect(result.on).toBe(false);
    expect(result.did).toBeUndefined();
    expect(scripts).toEqual([COLLECT_SCRIPT]);
  });

  it("con il gancio acceso aspetta la risposta della pagina e dice che cosa ha fatto", async () => {
    const session = { execute: async () => 7 };
    const result = await collect(session);
    expect(result).toMatchObject({ on: true, did: 7 });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("chiede la funzione della pagina solo se c'è", () => {
    expect(COLLECT_SCRIPT).toContain("typeof window.__fubBenchGc === 'function'");
    expect(COLLECT_SCRIPT).toContain(": null");
  });

  it("fuori da Linux non costruisce l'estensione", () => {
    const calls = [];
    const result = buildCollector("/non/usata", { platform: "win32", run: (...args) => calls.push(args) });
    expect(result.skipped).toMatch(/soltanto/);
    expect(calls).toEqual([]);
  });

  it("su Linux la costruisce con rustc come libreria condivisa", () => {
    const calls = [];
    const dir = "/cartella/finta";
    const result = buildCollector(dir, { platform: "linux", rustc: "rustc-finto", run: (...args) => calls.push(args) });
    expect(result).toEqual({ dir });
    const [[command, args]] = calls;
    expect(command).toBe("rustc-finto");
    expect(args).toEqual(expect.arrayContaining(["--crate-type", "cdylib", "-o", `${dir}/libfub-banco-raccolta.so`]));
    expect(args.at(-1)).toMatch(/raccolta\.rs$/);
  });

  it("se rustc fallisce lo dice invece di fermare il banco", () => {
    const dir = "/cartella/finta";
    const run = () => {
      const error = new Error("uscito con 1");
      error.stderr = Buffer.from("error[E0425]: qualcosa\nerror: aborting due to 1 previous error\n");
      throw error;
    };
    const result = buildCollector(dir, { platform: "linux", run });
    expect(result.skipped).toMatch(/non si costruisce: .*aborting/);
  });
});
