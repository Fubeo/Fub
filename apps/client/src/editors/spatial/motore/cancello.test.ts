// Il cancello del disegno (piano K5, T20), il lato del client: applica col
// motore della scena le operazioni che il motore del disegno ha scritto, e
// scrive i testi dopo. Lo lancia in fila `node tools/disegno-cancello/cancello.mjs`
// con la cartella in `FUB_DISEGNO_CANCELLO`; senza la variabile salta.
//
// Per ogni file di `elenco.json` (scritto da `crates/fub-disegno/tests/cancello.rs`):
//
// - `<file>.prima.svg` è il testo del file come lo modifica la superficie:
//   quello del file, o, per un SVG estraneo, quello dopo «Modifica»
//   (l'operazione `adopt`, come la superficie);
// - per ogni `<file>.<gesto>.json` con le operazioni e senza il suo dopo, le
//   operazioni passano da `parseWireOp` (`opsDellEsito`, come un esito del
//   motore) e si applicano in un passo solo (`gesture`, come `ctx.commit`)
//   sul testo di `base`; il testo dopo va in `<file>.<gesto>.svg`, un rifiuto
//   in `<file>.<gesto>.rifiuto.json`.
//
// Ogni passo fa solo ciò che manca: il giro si chiude ripetendolo dopo il
// motore.

import { describe, expect, it } from "vitest";
import { SceneEngine } from "../scene/engine";
import { readScene } from "../scene/read";
import { gesture } from "../tools/edit";
import { opsDellEsito } from "./gesti";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, text: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
}

/// Il modulo di Node, importato col nome calcolato: il client non ha i tipi
/// di Node (`tsconfig.json`), e non ne ha bisogno altrove.
async function nodeFs(): Promise<NodeFs> {
  const prefix = "node:";
  return (await import(/* @vite-ignore */ `${prefix}fs`)) as NodeFs;
}

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const FOLDER = environment.FUB_DISEGNO_CANCELLO ?? "";

interface Voce {
  readonly file: string;
  readonly sorgente: string;
}

interface Gesto {
  readonly base: string;
  readonly esito: "ops" | "rifiutato" | "saltato";
  readonly ops?: unknown;
}

describe.skipIf(FOLDER === "")("il cancello del disegno, lato client", () => {
  it("applica le operazioni del motore e scrive i testi dopo", async () => {
    const fs = await nodeFs();
    const dir = FOLDER.endsWith("/") ? FOLDER : `${FOLDER}/`;
    const elenco = JSON.parse(fs.readFileSync(`${dir}elenco.json`, "utf8")) as Voce[];
    expect(elenco.length).toBeGreaterThan(0);
    const nomi = new Set(elenco.map((voce) => voce.file));
    let applicati = 0;
    for (const voce of elenco) {
      const prima = `${dir}${voce.file}.prima.svg`;
      if (!fs.existsSync(prima)) {
        const testo = fs.readFileSync(voce.sorgente, "utf8");
        let dopo = testo;
        // Un SVG estraneo si modifica dopo «Modifica», come nella superficie.
        if (readScene(testo).status === "foreign") {
          const engine = SceneEngine.open(testo);
          const esito = engine.apply({ op: "adopt" });
          if (esito.outcome === "applied") dopo = engine.text;
        }
        fs.writeFileSync(prima, dopo);
      }
    }
    for (const nome of fs.readdirSync(dir).sort()) {
      const trovato = /^(.*)\.([a-z0-9]+)\.json$/.exec(nome);
      if (trovato === null || !nomi.has(trovato[1]!)) continue;
      const radice = `${dir}${trovato[1]}.${trovato[2]}`;
      if (fs.existsSync(`${radice}.svg`) || fs.existsSync(`${radice}.rifiuto.json`)) continue;
      const g = JSON.parse(fs.readFileSync(`${dir}${nome}`, "utf8")) as Gesto;
      if (g.esito !== "ops") continue;
      const letto = opsDellEsito(JSON.stringify(g.ops ?? []));
      if ("reason" in letto) {
        fs.writeFileSync(`${radice}.rifiuto.json`, `${JSON.stringify({ reason: letto.reason, detail: letto.detail })}\n`);
        continue;
      }
      const engine = SceneEngine.open(fs.readFileSync(`${dir}${g.base}`, "utf8"));
      const op = gesture(letto.ops);
      if (op === null) {
        fs.writeFileSync(`${radice}.rifiuto.json`, `${JSON.stringify({ reason: "empty", detail: "nessuna operazione" })}\n`);
        continue;
      }
      const esito = engine.apply(op);
      if (esito.outcome === "rejected") {
        fs.writeFileSync(`${radice}.rifiuto.json`, `${JSON.stringify({ reason: esito.reason, detail: esito.detail })}\n`);
        continue;
      }
      fs.writeFileSync(`${radice}.svg`, engine.text);
      applicati += 1;
    }
    // Quanti ne ha applicati, per chi lancia il passo a mano.
    console.info(`cancello: ${applicati} gesti applicati`);
  });
});
