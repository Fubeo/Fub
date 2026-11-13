// D12 = B: densità, contrasto e accento cambiano davvero il simulatore.
// Questo script li calcola dalla ricetta del tema (theme/scrittoio/recipe.ts
// e series.ts del client), con le stesse funzioni che la shell chiama in
// theme.ts (preferenceTokens), e li scrive in un JSON che costruisci-sim.mjs
// mette in sim-dati.js. Nessuna porta: Vite in middlewareMode carica i
// moduli senza ascoltare.
//
// node temi-sim.mjs <client> <uscita.json> <cacheDir>
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [client, out, cacheDir] = process.argv.slice(2);
if (!client || !out) throw new Error("uso: node temi-sim.mjs <client> <uscita.json> <cacheDir>");
const vite = await import(pathToFileURL(join(client, "node_modules/vite/dist/node/index.js")).href);
const server = await vite.createServer({
  root: client,
  cacheDir,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
try {
  const recipe = await server.ssrLoadModule("/src/theme/scrittoio/recipe.ts");
  const series = await server.ssrLoadModule("/src/theme/scrittoio/series.ts");
  const measures = await server.ssrLoadModule("/src/theme/scrittoio/measures.ts");
  const S = series.SCRITTOIO_SERIES;
  const luci = ["light", "dark"];
  const contrasti = ["normal", "high"];
  const dati = {
    fonte: "apps/client/src/theme/scrittoio/{recipe,series}.ts (anteprima/tutto + Scrittoio 2)",
    predefiniti: S.defaults,
    densita: { compact: series.densityTokens("compact"), comfortable: {}, relaxed: series.densityTokens("relaxed") },
    // «Spazio dell'interfaccia» (chrome.compactness), i cinque passi.
    compattezza: [0, 1, 2, 3, 4].map((s) => measures.compactnessTokens(s)),
    // Il foglio intero per contrasto alto: il simulatore lo mette al posto di
    // quello di serie, come fa theme.ts quando la variante cambia.
    fogli: Object.fromEntries(luci.map((l) => [l, { high: S.sheet(l, "high") }])),
    campioni: recipe.ACCENT_SWATCHES.map((c) => ({ ...c })),
    // La tavolozza per ogni tinta a passi di 5°, per luce e contrasto: i
    // campioni cadono tutti su un passo, la tinta libera sul più vicino.
    accenti: {},
  };
  for (const l of luci)
    for (const c of contrasti)
      for (let h = 0; h < 360; h += 5) dati.accenti[`${l}:${c}:${h}`] = recipe.accentPalette(l, c, h);
  for (const c of dati.campioni) if (c.hue % 5) throw new Error(`campione fuori dai passi: ${c.id}`);
  await writeFile(out, JSON.stringify(dati));
  console.log("ok", Object.keys(dati.accenti).length, "tavolozze", Math.round(JSON.stringify(dati).length / 1024), "KB");
} finally {
  await server.close();
}
