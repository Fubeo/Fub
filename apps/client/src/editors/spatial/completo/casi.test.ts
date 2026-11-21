// Il banco di prova delle righe, il lato del client (piano K6, T5;
// `crates/fub-disegno/tests/famiglie.rs` è il lato del motore).
//
// Per ogni caso con le operazioni attese (`tests/famiglie/<famiglia>.json` e
// i casi che provano il banco, `tests/casi-prova/prova.json`), le
// operazioni passano da `parseWireOp` (`opsDellEsito`, come un esito del
// motore) e si applicano in un passo solo (`gesture`, come `ctx.commit`) sul
// disegno di partenza: il testo dopo è il `.svg` di `dopo`, byte per byte; e
// l'annullamento torna al disegno di partenza, byte per byte. Con
// `FUB_CASI_SCRIVI=1` il test scrive i `dopo` invece di confrontarli.

import { describe, expect, it } from "vitest";
import { SceneEngine } from "../scene/engine";
import { gesture } from "../tools/edit";
import { opsDellEsito } from "../motore/gesti";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, text: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}

/// Il modulo di Node, importato col nome calcolato: il client non ha i tipi
/// di Node (`tsconfig.json`).
async function nodeFs(): Promise<NodeFs> {
  const prefix = "node:";
  return (await import(/* @vite-ignore */ `${prefix}fs`)) as NodeFs;
}

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const SCRIVI = environment.FUB_CASI_SCRIVI === "1";

/// La cartella dei test del crate, da qui.
const TESTS = decodeURIComponent(new URL("../../../../../../crates/fub-disegno/tests/", import.meta.url).pathname);

interface CasoSuDisco {
  readonly id: string;
  readonly disegno: string;
  readonly atteso: { readonly ops?: unknown };
  readonly dopo?: string;
}

interface CasoDaApplicare {
  readonly nome: string;
  /// La cartella dei `.svg` del caso.
  readonly cartella: string;
  readonly caso: CasoSuDisco;
}

/// I casi di un file, con la cartella accanto (`<file>/`).
function casiDi(fs: NodeFs, file: string): CasoDaApplicare[] {
  const { casi } = JSON.parse(fs.readFileSync(file, "utf8")) as { casi: CasoSuDisco[] };
  const cartella = `${file.replace(/\.json$/, "")}/`;
  const gruppo = file.split("/").pop()!.replace(/\.json$/, "");
  return casi.map((caso) => ({ nome: `${gruppo}: ${caso.id}`, cartella, caso }));
}

async function tuttiICasi(): Promise<{ fs: NodeFs; casi: CasoDaApplicare[] }> {
  const fs = await nodeFs();
  const famiglie = `${TESTS}famiglie/`;
  const file = [
    ...fs.readdirSync(famiglie).filter((nome) => nome.endsWith(".json")).sort().map((nome) => `${famiglie}${nome}`),
    `${TESTS}casi-prova/prova.json`,
  ];
  return { fs, casi: file.flatMap((each) => casiDi(fs, each)) };
}

describe("il banco delle righe, lato client", () => {
  it("applica le operazioni di ogni caso in un passo, e le annulla", async () => {
    const { fs, casi } = await tuttiICasi();
    const conOps = casi.filter(({ caso }) => Array.isArray(caso.atteso.ops));
    // I casi di prova hanno almeno un comando e uno strumento con operazioni.
    expect(conOps.filter(({ nome }) => nome.startsWith("prova:")).length).toBeGreaterThanOrEqual(3);
    const errori: string[] = [];
    for (const { nome, cartella, caso } of conOps) {
      const prima = caso.disegno.startsWith("<") ? caso.disegno : fs.readFileSync(`${cartella}${caso.disegno}`, "utf8");
      if (caso.dopo === undefined) {
        errori.push(`${nome}: le operazioni senza il disegno dopo`);
        continue;
      }
      const letto = opsDellEsito(JSON.stringify(caso.atteso.ops));
      if ("reason" in letto) {
        errori.push(`${nome}: le operazioni non si leggono (${letto.reason}: ${letto.detail})`);
        continue;
      }
      const op = gesture(letto.ops);
      if (op === null) {
        errori.push(`${nome}: nessuna operazione`);
        continue;
      }
      const engine = SceneEngine.open(prima);
      const esito = engine.apply(op);
      if (esito.outcome !== "applied") {
        errori.push(`${nome}: la scena rifiuta le operazioni (${esito.reason}: ${esito.detail})`);
        continue;
      }
      const fileDopo = `${cartella}${caso.dopo}`;
      if (SCRIVI) fs.writeFileSync(fileDopo, engine.text);
      else if (engine.text !== fs.readFileSync(fileDopo, "utf8")) errori.push(`${nome}: il testo dopo non è ${caso.dopo}`);
      const indietro = engine.undo(esito.undo);
      if (indietro.outcome !== "applied" || engine.text !== prima) errori.push(`${nome}: l'annullamento non torna al disegno di partenza`);
    }
    expect(errori).toEqual([]);
  });
});
