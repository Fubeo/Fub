// La tabella delle entità nominate di HTML per il Markdown, generata dalla
// copia della specifica in `vendor/whatwg-entities/`.
//
//     node apps/client/scripts/html-entities.mjs           riscrive la tabella
//     node apps/client/scripts/html-entities.mjs --verify  dice se è quella che la copia produce
//
// Da `apps/client`: `npm run entities:generate` e `npm run entities:verify`.
// Prima di generare controlla che `entities.json` abbia ancora lo sha256
// scritto in `UPSTREAM.md`: la copia non si ritocca a mano, si riscarica.
//
// Tiene soltanto i nomi con il `;` finale: in CommonMark un riferimento
// nominato è valido solo così, e le forme storiche senza `;` (`&amp`, `&copy`)
// restano testo. Lo stesso test di `src/` rigenera la tabella e la confronta
// byte per byte con quella scritta, così la verifica gira anche con `npm test`.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = new URL("../../../vendor/whatwg-entities/entities.json", import.meta.url);
const UPSTREAM = new URL("../../../vendor/whatwg-entities/UPSTREAM.md", import.meta.url);
const TARGET = new URL("../src/editors/text/profiles/markdown/html-entities.generated.ts", import.meta.url);

/// Il modulo TypeScript della tabella, dal testo di `entities.json`. Puro:
/// lo usano lo script e il test che lo verifica.
export function renderEntitiesModule(jsonText) {
  const table = JSON.parse(jsonText);
  const rows = [];
  for (const [reference, entry] of Object.entries(table)) {
    if (!reference.endsWith(";")) continue;
    const name = reference.slice(1, -1);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`nome di entità inatteso: ${reference}`);
    const characters = String.fromCodePoint(...entry.codepoints);
    if (characters !== entry.characters) throw new Error(`${reference}: codepoints e characters non coincidono`);
    rows.push([name, characters]);
  }
  rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = rows.map(([name, characters]) => `  ${name}: "${escape(characters)}",`).join("\n");
  return [
    "// Generato da apps/client/scripts/html-entities.mjs da",
    "// vendor/whatwg-entities/entities.json: non modificare a mano.",
    "// Rigenera con `npm run entities:generate`, verifica con `npm run entities:verify`.",
    "//",
    "// Le entità nominate di HTML con il `;` finale, dalla specifica HTML di",
    "// WHATWG (https://html.spec.whatwg.org/, CC BY 4.0; attribuzione in",
    "// vendor/whatwg-entities/UPSTREAM.md). È un oggetto senza prototipo: un",
    "// nome come `constructor` non trova nulla.",
    "",
    `/// ${rows.length} nomi, senza \`&\` né \`;\`, e i caratteri che nominano.`,
    "export const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {",
    body,
    "}));",
    "",
  ].join("\n");
}

// Solo ASCII stampabile resta com'è: il resto diventa `\uXXXX`, così nel
// sorgente non c'è un carattere invisibile o che cambia direzione.
function escape(text) {
  let out = "";
  for (const unit of text.split("")) {
    const code = unit.charCodeAt(0);
    if (unit === '"' || unit === "\\") out += `\\${unit}`;
    else if (code >= 0x20 && code < 0x7f) out += unit;
    else out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/// Lo sha256 dichiarato in `UPSTREAM.md`, alla riga `- sha256: <hex>`.
export function declaredSha256(upstreamText) {
  const match = /^(?:- )?sha256:\s*`?([0-9a-f]{64})`?\s*$/m.exec(upstreamText);
  if (!match) throw new Error("UPSTREAM.md non dichiara lo sha256 di entities.json");
  return match[1];
}

async function main() {
  const verify = process.argv.includes("--verify");
  const bytes = await readFile(SOURCE);
  const actual = createHash("sha256").update(bytes).digest("hex");
  const expected = declaredSha256(await readFile(UPSTREAM, "utf8"));
  if (actual !== expected) {
    console.error(`entities.json ha sha256 ${actual}, UPSTREAM.md dichiara ${expected}: la copia non si modifica a mano`);
    process.exitCode = 1;
    return;
  }
  const next = renderEntitiesModule(bytes.toString("utf8"));
  const target = fileURLToPath(TARGET);
  if (verify) {
    const current = await readFile(TARGET, "utf8").catch(() => null);
    if (current !== next) {
      console.error(`${target} non è quella che entities.json produce: npm run entities:generate`);
      process.exitCode = 1;
      return;
    }
    console.log(`${target}: uguale byte per byte`);
    return;
  }
  await writeFile(TARGET, next);
  console.log(`${target}: scritta`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
