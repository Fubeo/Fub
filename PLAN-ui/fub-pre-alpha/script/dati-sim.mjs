// solo simulatore: legge i dati impacchettati del simulatore (sim-dati-N.js,
// gzip in base64 a pezzi) e li restituisce come oggetto
// { fonts, texts, caps, fileStato, cartelle, temi }.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export async function datiDi(dir) {
  const parti = (await readdir(dir)).filter((f) => /^sim-dati-\d+\.js$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!parti.length) throw new Error(`DATI: nessun sim-dati-N.js in ${dir}`);
  let b64 = "";
  for (const f of parti) b64 += /\.push\("([^"]*)"\)/.exec(await readFile(join(dir, f), "utf8"))[1];
  return JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
}
