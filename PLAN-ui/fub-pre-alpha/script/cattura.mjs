// Sonda usa-e-getta: porta una scena del banco nello stato voluto e ne salva
// il DOM e il CSS, per il prototipo di Scrittoio 2.
// node cattura.mjs <client> <cartella uscita> <cacheDir> <stati.json> [solo=id,id]
// Ogni voce di stati.json: { id, scena, larghezza?, altezza?, mods?: [nomi], luci?: ["light","dark"] }
// I mods sono funzioni in mods.mjs (DOM nuovo che il codice costruirà) eseguite
// dopo la preparazione della scena; il CSS nuovo (blocchi/*.css) è montato
// prima dei mods e NON finisce nel CSS copiato.
import { mkdir, readFile, writeFile, readdir, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [client, out, cacheDir, statiPath, soloArg] = process.argv.slice(2);
const solo = soloArg ? new Set(soloArg.replace(/^solo=/, "").split(",")) : null;
const load = (rel) => import(pathToFileURL(join(client, rel)).href);
const stage = await load("bench/stage.mjs");
const scenes = await load("bench/scene.mjs");
const vite = await import(pathToFileURL(join(client, "node_modules/vite/dist/node/index.js")).href);
const mods = await import(pathToFileURL(join(here, "mods.mjs")).href);
const stati = JSON.parse(await readFile(statiPath, "utf8"));

async function nuovoCss() {
  const dir = join(here, "..", "blocchi");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".css")).sort();
  const parts = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), "utf8");
    // solo le scelte consigliate: ogni blocco `variante x … fine variante x` si toglie
    parts.push(text.replace(/\/\*\s*variante ([\w-]+)\s*\*\/[\s\S]*?\/\*\s*fine variante \1\s*\*\//g, ""));
  }
  return parts.join("\n");
}

function serialize(inserimenti = []) {
  return (async () => {
    const root = document.documentElement;
    // Le immagini da un lease o dal server: dati in linea.
    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:")) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const data = await new Promise((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
        img.setAttribute("src", data);
        img.removeAttribute("srcset");
      } catch {}
    }
    for (const c of document.querySelectorAll("canvas")) {
      try {
        c.setAttribute("data-proto-src", c.toDataURL());
      } catch {}
      c.setAttribute("width", String(c.width));
      c.setAttribute("height", String(c.height));
    }
    for (const el of document.querySelectorAll("input")) {
      if (el.type === "checkbox" || el.type === "radio") el.toggleAttribute("checked", el.checked);
      else if (el.type !== "file") el.setAttribute("value", el.value);
    }
    for (const el of document.querySelectorAll("textarea")) el.textContent = el.value;
    for (const el of document.querySelectorAll("option")) el.toggleAttribute("selected", el.selected);
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollTop || el.scrollLeft) el.setAttribute("data-proto-scroll", `${el.scrollLeft},${el.scrollTop}`);
    }
    const active = document.activeElement;
    if (active && active !== document.body) active.setAttribute("data-proto-focus", "");
    for (const el of [root, ...document.querySelectorAll("[style]")]) {
      const s = el.getAttribute("style");
      if (s != null) {
        el.setAttribute("data-proto-style", s);
        el.removeAttribute("style");
      }
    }
    const body = document.body.cloneNode(true);
    // DOM che il codice costruirà dentro una superficie che si ridisegna da sé
    // (CodeMirror): entra solo nella copia, mai nella pagina viva.
    for (const { sel, where, html } of inserimenti) {
      const at = body.querySelector(sel);
      if (at) at.insertAdjacentHTML(where, html);
      else console.warn("inserimento senza bersaglio", sel);
    }
    // T3: il bottone della modalità esce dalla testata e diventa figlio del
    // foglio, dopo la barra di formato. Solo nella copia.
    for (const el of body.querySelectorAll("[data-proto-sposta]")) {
      el.removeAttribute("data-proto-sposta");
      const pane = el.closest(".pane");
      const after = pane?.querySelector(":scope > .format-bar") ?? pane?.querySelector(":scope > .pane-toolbar");
      if (after) after.after(el);
    }
    for (const el of body.querySelectorAll("script, style, link, noscript, #proto-nuovo")) el.remove();
    const attrs = [...root.attributes].map((a) => [a.name, a.value]);
    const bodyAttrs = [...document.body.attributes].map((a) => [a.name, a.value]);
    const css = [];
    for (const sheet of document.styleSheets) {
      const node = sheet.ownerNode;
      if (node?.id === "proto-nuovo") continue;
      if (sheet.disabled) continue;
      let text = "";
      if (node instanceof HTMLStyleElement) text = node.textContent ?? "";
      else if (node instanceof HTMLLinkElement) {
        try {
          text = await (await fetch(node.href)).text();
        } catch {}
      }
      const label = node?.dataset?.fub ? `fub:${node.dataset.fub}` : node?.dataset?.viteDevId?.replace(/^.*\/src\//, "src/") ?? node?.id ?? "stile";
      css.push({ label, media: node?.media || "", text });
    }
    for (const sheet of document.adoptedStyleSheets ?? []) {
      css.push({ label: "adottato", media: "", text: [...sheet.cssRules].map((r) => r.cssText).join("\n") });
    }
    return {
      attrs,
      bodyAttrs,
      body: body.innerHTML,
      css,
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight },
    };
  })();
}

await mkdir(out, { recursive: true });
const css = await nuovoCss();
const modulesDir = await realpath(join(client, "node_modules"));
const opened = await stage.openStage({
  createServer: (config) =>
    vite.createServer({
      ...config,
      cacheDir,
      root: client,
      // Porta del pianificatore di pre-alpha: mai la 1431 del banco né le porte vive.
      server: { port: 1468, strictPort: true, fs: { allow: [client, join(client, "../.."), modulesDir, join(client, "../../crates/fub-features/templates")] } },
    }),
});
try {
  for (const stato of stati) {
    if (solo && !solo.has(stato.id)) continue;
    const scene = scenes.SCENE.find((s) => s.id === stato.scena);
    if (!scene) {
      console.log("ERRORE", stato.id, "scena mancante", stato.scena);
      continue;
    }
    for (const light of stato.luci ?? scenes.LIGHTS) {
      const page = await stage.openPage(opened.browser, light);
      try {
        const viewport = {
          width: stato.larghezza ?? scene.viewport?.width ?? 1280,
          height: stato.altezza ?? scene.viewport?.height ?? 800,
        };
        await page.setViewportSize(viewport);
        await stage.prepareScene(page, scene, light, opened.base, scenes.sceneUrl);
        if (!stato.vecchio) await page.addStyleTag({ content: css }).then((h) => h.evaluate((n) => (n.id = "proto-nuovo")));
        const inserimenti = [];
        for (const name of stato.mods ?? []) {
          if (!mods[name]) throw new Error(`mod mancante: ${name}`);
          await mods[name](page, { light, stato, inserisci: (x) => inserimenti.push(x) });
        }
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        // Una finestra che si stringe dopo: la scena si prepara larga (i
        // cassetti si vedono) e poi va alla larghezza voluta, come chi tira
        // il bordo della finestra.
        if (stato.dopo) {
          await page.setViewportSize({ width: stato.dopo, height: stato.dopoAltezza ?? viewport.height });
          for (let i = 0; i < 3; i += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          for (const name of stato.modsDopo ?? []) await mods[name](page, { light, stato, inserisci: (x) => inserimenti.push(x) });
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        }
        const shot = await page.screenshot();
        await writeFile(join(out, `${stato.id}-${light}.png`), shot);
        const snap = await page.evaluate(serialize, inserimenti);
        await writeFile(join(out, `${stato.id}-${light}.json`), JSON.stringify(snap));
        console.log("ok", stato.id, light, `${Math.round(snap.body.length / 1024)} KB dom`, `${Math.round(snap.css.reduce((n, c) => n + c.text.length, 0) / 1024)} KB css`);
        // L'ordine del Tab si legge dopo la foto: il Tab chiude i menu aperti.
        if (stato.tab) {
          const order = [];
          await page.mouse.click(2, viewport.height - 2).catch(() => {});
          for (let i = 0; i < stato.tab; i += 1) {
            await page.keyboard.press("Tab");
            order.push(
              await page.evaluate(() => {
                const a = document.activeElement;
                if (!a) return "-";
                const name = a.getAttribute("aria-label") || a.textContent?.trim().slice(0, 30) || "";
                return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}.${[...a.classList].slice(0, 2).join(".")} «${name}»`;
              }),
            );
          }
          await writeFile(join(out, `${stato.id}-${light}.tab.txt`), order.join("\n") + "\n");
        }
      } catch (error) {
        console.log("ERRORE", stato.id, light, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
      } finally {
        await page.context().close();
      }
    }
  }
} finally {
  await opened.close();
}
