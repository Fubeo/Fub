// I colori del logo e i loro contrasti, per la pagina «Il logo» (PA T49, D26):
// per ogni campione della tinta, nelle due luci e nei due contrasti, i cinque
// colori della cartella e dei fogli e il contrasto della cartella e del retro
// coi due fondi dove sta il logo (`--bg`: la barra e l'avvio; `--bg-elev`: le
// Informazioni). Più i tre temi d'esempio, dai blocchi `93-tema-*-logo.css`.
// Usa la ricetta del client delle catture (quella di `finto/verde.patch`).
//
// node logo-misure.mjs <client> <cartella dei blocchi> <cacheDir> <uscita.json>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [client, blocchi, cacheDir, uscita] = process.argv.slice(2);
if (!uscita) throw new Error("uso: node logo-misure.mjs <client> <blocchi> <cacheDir> <uscita.json>");
const vite = await import(pathToFileURL(join(client, "node_modules/vite/dist/node/index.js")).href);
const server = await vite.createServer({
  root: client,
  cacheDir,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});

const LUCI = ["light", "dark"];
const CONTRASTI = ["normal", "high"];

/// Le dichiarazioni di ogni regola `:root…` di un foglio, in ordine.
function regole(css) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\n)(:root[^{]*)\{([^}]*)\}/g)) {
    const sel = m[2].trim();
    if (!/^:root(\[[^\]]+\])*$/.test(sel)) continue;
    const decl = {};
    for (const d of m[3].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
    out.push({
      luce: /data-theme="dark"/.test(sel) ? "dark" : "light",
      contrasto: /data-contrast="high"/.test(sel) ? "high" : "normal",
      decl,
    });
  }
  return out;
}

try {
  const recipe = await server.ssrLoadModule("/src/theme/scrittoio/recipe.ts");
  const { contrast } = await server.ssrLoadModule("/src/theme/contrast.ts");
  const ruoli = recipe.LOGO_ROLES;
  const misura = (colori, fondi, soglia) => {
    const minimo = (ink) => Math.min(...fondi.map((f) => contrast(ink, f)));
    const cartella = minimo(colori["logo-cartella"]);
    const retro = minimo(colori["logo-cartella-retro"]);
    return {
      colori: Object.fromEntries(ruoli.map((r) => [r.replace(/^logo-/, ""), colori[r]])),
      fondi,
      cartella: Number(cartella.toFixed(2)),
      retro: Number(retro.toFixed(2)),
      soglia,
      regge: cartella >= soglia - 0.005 && retro >= soglia - 0.005,
    };
  };
  const tinte = [];
  for (const { id, hue } of recipe.ACCENT_SWATCHES) {
    const varianti = {};
    for (const luce of LUCI)
      for (const livello of CONTRASTI) {
        const p = recipe.palette(luce, livello, hue);
        varianti[`${luce}-${livello}`] = misura(p, [p.bg, p["bg-elev"]], livello === "high" ? 4.5 : 3);
      }
    tinte.push({ id, tinta: hue, varianti });
  }
  const temi = [];
  for (const f of (await readdir(blocchi)).filter((x) => /^93-tema-[a-z]+\.css$/.test(x)).sort()) {
    const nome = f.replace(/^93-tema-|\.css$/g, "");
    const tema = regole(await readFile(join(blocchi, f), "utf8"));
    const logo = regole(await readFile(join(blocchi, `93-tema-${nome}-logo.css`), "utf8"));
    const varianti = {};
    for (const luce of LUCI)
      for (const livello of CONTRASTI) {
        const t = {};
        const l = {};
        for (const r of tema) if (r.luce === luce && (r.contrasto === "normal" || r.contrasto === livello)) Object.assign(t, r.decl);
        for (const r of logo) if (r.luce === luce && (r.contrasto === "normal" || r.contrasto === livello)) Object.assign(l, r.decl);
        if (!t.accent || !l["logo-cartella"]) continue;
        varianti[`${luce}-${livello}`] = { accento: t.accent, ...misura(l, [t.bg, t["bg-elev"]], livello === "high" ? 4.5 : 3) };
      }
    temi.push({ id: nome, varianti });
  }
  await writeFile(uscita, JSON.stringify({ tinte, temi }, null, 1) + "\n");
  const tutte = [...tinte, ...temi].flatMap((x) => Object.entries(x.varianti).map(([k, v]) => ({ id: x.id, k, ...v })));
  const sotto = tutte.filter((v) => !v.regge);
  console.log(uscita, tutte.length, "varianti,", sotto.length, "sotto la soglia");
  for (const v of sotto) console.log("  sotto:", v.id, v.k, v.cartella, v.retro, v.soglia);
  const peggio = tutte.reduce((a, v) => (v.cartella / v.soglia < a.cartella / a.soglia ? v : a));
  console.log("la più vicina alla soglia:", peggio.id, peggio.k, peggio.cartella, "su", peggio.soglia);
} finally {
  await server.close();
}
