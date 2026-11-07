// I colori del logo per i temi d'esempio (PA T49, D26). Un tema fatto a mano
// non dichiara `--logo-*`: nel prodotto li aggiunge la serie quando il tema si
// monta (theme/theme.ts, scrittoio/series.ts) con `logoColors` della ricetta,
// dalla tinta e dalla croma del suo `--accent` e dai fondi dove sta il logo
// (`--bg`: la barra e l'avvio; `--bg-elev`: le Informazioni). Qui si fa
// lo stesso calcolo, con la ricetta del client delle catture (quella di
// `finto/verde.patch`), e si scrive un blocco `93-tema-<nome>-logo.css` per
// tema, montato dal simulatore insieme al tema. Generati: non si modificano a
// mano. Senza cambi, una seconda corsa riscrive gli stessi byte.
//
// node logo-temi.mjs <client> <cartella dei blocchi> <cacheDir>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [client, blocchi, cacheDir] = process.argv.slice(2);
if (!client || !blocchi) throw new Error("uso: node logo-temi.mjs <client> <blocchi> <cacheDir>");
const vite = await import(pathToFileURL(join(client, "node_modules/vite/dist/node/index.js")).href);
const server = await vite.createServer({
  root: client,
  cacheDir,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});

/// Le regole `:root…` di un foglio di tema, con le dichiarazioni che servono.
function regole(css) {
  const out = [];
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of senzaCommenti.matchAll(/(^|\n)(:root[^{]*)\{([^}]*)\}/g)) {
    const sel = m[2].trim();
    // Solo i fogli: `:root` con i suoi attributi, non le regole della pelle.
    if (!/^:root(\[[^\]]+\])*$/.test(sel)) continue;
    const decl = {};
    for (const d of m[3].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
    const luce = /data-theme="dark"/.test(sel) ? "dark" : "light";
    const contrasto = /data-contrast="high"/.test(sel) ? "high" : "normal";
    out.push({ sel, luce, contrasto, decl });
  }
  return out;
}

try {
  const recipe = await server.ssrLoadModule("/src/theme/scrittoio/recipe.ts");
  const oklch = await server.ssrLoadModule("/src/theme/oklch.ts");
  const files = (await readdir(blocchi)).filter((f) => /^93-tema-[a-z]+\.css$/.test(f)).sort();
  for (const f of files) {
    const nome = f.replace(/^93-tema-|\.css$/g, "");
    const titolo = nome[0].toUpperCase() + nome.slice(1);
    const tutte = regole(await readFile(join(blocchi, f), "utf8"));
    // Il contrasto alto eredita dal normale della stessa luce ciò che non ridice.
    const base = {};
    for (const r of tutte) if (r.contrasto === "normal") base[r.luce] = { ...(base[r.luce] ?? {}), ...r.decl };
    // Una luce senza la sua regola del contrasto alto la riceve lo stesso: il
    // logo regge la soglia alta anche dove il tema non ridice niente.
    for (const luce of Object.keys(base)) {
      if (tutte.some((r) => r.luce === luce && r.contrasto === "high")) continue;
      const normale = tutte.find((r) => r.luce === luce && r.contrasto === "normal");
      tutte.push({ sel: `${normale.sel}[data-contrast="high"]`, luce, contrasto: "high", decl: {} });
    }
    const righe = [];
    for (const r of tutte) {
      const v = r.contrasto === "high" ? { ...base[r.luce], ...r.decl } : base[r.luce];
      // Il normale si scrive dove il tema dichiara l'accento: una regola
      // `:root` di sole forme non è un foglio di colori.
      if (!v?.accent || (r.contrasto === "normal" && !r.decl.accent)) continue;
      const a = oklch.fromHex(v.accent);
      const fondi = [v.bg, v["bg-elev"]].filter(Boolean);
      const croma = Math.min(1, a.c / 0.08);
      const colori = recipe.logoColors(r.luce, r.contrasto, a.h, fondi, croma);
      righe.push({ sel: r.sel, colori, nota: `accento ${v.accent} (tinta ${a.h.toFixed(1)}, croma ${a.c.toFixed(3)}), fondi ${fondi.join(" ")}` });
    }
    const css = [
      "/* → nessun file: la serie li calcola al montaggio del tema (theme/theme.ts, scrittoio/series.ts; PA T49, D26) */",
      `/* I colori del logo per il tema «${titolo}», che non li dichiara. GENERATO da`,
      "   script/logo-temi.mjs con `logoColors` della ricetta: non si modifica a",
      "   mano. Nel prodotto li calcola il caricatore dall'accento e dai fondi del",
      "   tema; il simulatore li monta insieme al tema. */",
      ...righe.flatMap(({ sel, colori, nota }) => [
        `/* ${nota} */`,
        `${sel} {`,
        ...Object.entries(colori).map(([k, x]) => `  --${k}: ${x};`),
        "}",
      ]),
      "",
    ].join("\n");
    await writeFile(join(blocchi, `93-tema-${nome}-logo.css`), css);
    console.log("ok", nome, righe.length, "varianti");
  }
} finally {
  await server.close();
}
