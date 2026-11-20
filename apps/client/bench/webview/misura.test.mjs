// `misura.sh` dice di misurare «tutti gli scenari» (e così la pagina
// `docs/development/webview-measurements.md`), ma passava a `run.mjs` un
// `--only` scritto a mano, rimasto indietro di sei scenari (F4, S8, S9, S10,
// L1, C1: audit del 20/11, P-67). Qui la condizione che lo tiene vero: lo
// script non sceglie gli scenari, e l'elenco di serie di `run.mjs` è quello
// dei suoi scenari. In `.mjs` perché legge file con Node, come
// `refresh.test.mjs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const run = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
const misura = readFileSync(new URL("./misura.sh", import.meta.url), "utf8");

/** Gli scenari che `run.mjs` sa girare, dalle chiavi di `SCENARIOS`. */
function scenarios() {
  const body = run.slice(run.indexOf("const SCENARIOS = {"));
  return [...body.matchAll(/^ {2}async ([A-Z]\d+)\(session\)/gm)].map((match) => match[1]).sort();
}

describe("misura.sh e gli scenari del banco WebView", () => {
  it("l'elenco di serie di run.mjs è quello dei suoi scenari", () => {
    const fallback = run.match(/const only = new Set\(\(args\.only \?\? "([^"]+)"\)/);
    expect(fallback, "l'elenco di serie in run.mjs").not.toBeNull();
    expect(fallback[1].split(",").sort()).toEqual(scenarios());
    expect(scenarios().length).toBeGreaterThan(10);
  });

  it("l'ordine di giro di run.mjs contiene ogni scenario, una volta", () => {
    // `order` filtra l'elenco scelto: uno scenario che manca qui non gira
    // mai, nemmeno chiesto con `--only`, e nessuno lo dice.
    const order = run.match(/const order = \[([^\]]+)\]\.filter\(/);
    expect(order, "l'ordine di giro in run.mjs").not.toBeNull();
    const ids = [...order[1].matchAll(/"([A-Z]\d+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(scenarios());
  });

  it("misura.sh non sceglie gli scenari: li sceglie run.mjs, o chi lo lancia", () => {
    const commands = misura
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(commands).toContain("bench/webview/run.mjs");
    expect(commands).toContain('"$@"');
    expect(commands).not.toMatch(/--only=/);
  });
});
