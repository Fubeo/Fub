// **La guardia del lampo**: che cosa si vede prima che l'app esista.
//
//     npm run bench:lampo                         # la porta del banco (1431)
//     npm run bench:lampo -- --port 1448 --strictPort
//
// # Perché un banco a parte
//
// Le foto del banco (`photos.mjs`) si scattano ad avvio finito: il lampo — la
// pagina bianca, l'HTML nudo coi bottoni nativi fra il primo disegno e il tema
// montato dal JS — non lo vedono mai. Lo toglie lo strato d'avvio (lo stile in
// linea `#avvio-stile` e `.avvio` nelle pagine, `public/avvio/luce.js`), e senza
// una prova automatica torna al primo `index.html` che cambia.
//
// # Come guarda
//
// Trattiene il modulo d'ingresso della pagina (`/src/main.ts`,
// `/src/entrypoints/mobile-main.ts`) con `page.route`: finché non arriva,
// della pagina c'è solo ciò che c'è prima di ogni modulo, cioè esattamente ciò
// che si vede durante il lampo. Lì verifica:
//
// - il fondo di `<html>` è pieno e della luce attesa;
// - `.avvio` copre tutta la finestra, e nove punti cadono dentro di lui;
// - `#app` è `inert`;
// - nessun bottone di `#app` si vede con l'aspetto nativo.
//
// Poi lascia arrivare il modulo, aspetta l'avvio (`data-bench="ready"`) e
// verifica che lo strato se ne sia andato del tutto: niente `.avvio`, niente
// `#avvio-stile`, niente `data-avvio-*` né `--avvio-*` su `<html>`, `#app` vivo.
//
// I casi sono tre per pagina: il sistema scuro e quello chiaro senza cache, e
// una cache `fub.avvio` chiara su un sistema scuro (la scelta salvata vince).
// Le pagine sono `index.html` e `mobile.html`.
//
// Esce diverso da zero, con una riga per ogni controllo caduto che dice pagina,
// caso e controllo. Togliere lo stile in linea da una pagina lo fa cadere.
import { openStage, openPage, WINDOW } from "./stage.mjs";

/// La finestra del telefono, come le scene di `mobile.html` (`scene.mjs`).
const PHONE = { width: 390, height: 844 };

/// Le pagine con lo strato e il modulo che le avvia.
const PAGES = [
  { name: "index.html", path: "/index.html", entry: "/src/main.ts", viewport: WINDOW },
  { name: "mobile.html", path: "/mobile.html", entry: "/src/entrypoints/mobile-main.ts", viewport: PHONE },
];

/// I casi: la luce del sistema, la cache dello strato, la luce attesa.
const CASES = [
  { name: "sistema scuro, senza cache", system: "dark", expected: "dark" },
  { name: "sistema chiaro, senza cache", system: "light", expected: "light" },
  {
    name: "fub.avvio chiaro su un sistema scuro",
    system: "dark",
    expected: "light",
    cache: { v: 1, luce: "light", contrasto: "normal", moto: "", colori: {}, testi: {}, lingua: "it" },
  },
];

/// Quanto si aspetta l'avvio una volta rilasciato il modulo (ms).
const STARTUP_TIMEOUT = 60_000;

const args = process.argv.slice(2);
const port = portArgument(args);
const strictPort = args.includes("--strictPort");

const failures = [];
let checked = 0;

const stage = await openStage({ port, strictPort });
try {
  for (const page of PAGES) {
    for (const scenario of CASES) {
      checked += 1;
      const label = `${page.name} · ${scenario.name}`;
      const fallen = await aCase(stage, page, scenario);
      for (const f of fallen) failures.push(`${label}: ${f}`);
      console.log(`${fallen.length === 0 ? "✓" : "✗"} ${label}`);
    }
  }
} finally {
  await stage.close();
}

if (failures.length > 0) {
  console.error(`\nIl lampo è tornato: ${failures.length} controlli caduti.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n${checked}/${checked} avvii senza lampo`);

/// Un avvio: trattenuto, guardato, rilasciato, guardato di nuovo.
async function aCase(stage, target, scenario) {
  const fallen = [];
  const page = await openPage(stage.browser, scenario.system);
  try {
    await page.setViewportSize(target.viewport);
    if (scenario.cache) {
      await page.addInitScript((cache) => {
        window.localStorage.setItem("fub.avvio", JSON.stringify(cache));
      }, scenario.cache);
    }
    let release;
    let held;
    const reached = new Promise((resolve) => {
      held = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname === target.entry,
      async (route) => {
        held();
        await gate;
        await route.continue().catch(() => {});
      },
    );
    const light = scenario.expected;
    // `commit`: `load` e `DOMContentLoaded` aspettano il modulo trattenuto.
    await page.goto(`${stage.base}${target.path}?light=${light}`, { waitUntil: "commit" });
    await withTimeout(reached, 30_000, `il modulo ${target.entry} non è mai stato chiesto`);
    // La pagina letta: gli script classici del <head> e `stati.js` (defer,
    // prima dei moduli) hanno girato, il modulo no. Due fotogrammi, perché ciò
    // che si guarda sia dipinto.
    await page.waitForFunction(() => document.readyState !== "loading", null, { timeout: 30_000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    fallen.push(...(await page.evaluate(lookBeforeModules, light)));

    release();
    try {
      await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, {
        timeout: STARTUP_TIMEOUT,
      });
      fallen.push(...(await page.evaluate(lookAfterStartup)));
    } catch (error) {
      fallen.push(`l'avvio non è finito entro ${STARTUP_TIMEOUT / 1000} s (${error?.message ?? error})`);
    }
  } catch (error) {
    fallen.push(`la prova non è arrivata in fondo: ${error?.message ?? error}`);
  } finally {
    await page.context().close();
  }
  return fallen;
}

/// Nella pagina, col modulo trattenuto: ciò che si vede durante il lampo.
/// Restituisce i controlli caduti.
function lookBeforeModules(light) {
  const fallen = [];
  const root = document.documentElement;
  const avvio = document.querySelector(".avvio");

  /// `rgb(…)`/`rgba(…)` in canali 0–255 e alfa 0–1.
  const channels = (color) => {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return null;
    const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  };
  const luminance = ({ r, g, b }) => {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  // 1. Il fondo del documento: pieno e della luce attesa. Senza lo stile in
  //    linea è trasparente, cioè il bianco della finestra.
  const background = getComputedStyle(root).backgroundColor;
  const bg = channels(background);
  if (!bg || bg.a < 1) {
    fallen.push(`il fondo di <html> non è pieno (${background})`);
  } else {
    const l = luminance(bg);
    if (light === "dark" && l > 0.1) fallen.push(`il fondo di <html> non è scuro (${background})`);
    if (light === "light" && (l < 0.5 || l > 0.95)) {
      fallen.push(`il fondo di <html> non è il chiaro dello strato (${background})`);
    }
  }
  const resolved = root.getAttribute("data-avvio-luce");
  if (resolved !== light) fallen.push(`data-avvio-luce è «${resolved}», non «${light}»`);

  // 2. Lo strato copre tutta la finestra.
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!avvio) {
    fallen.push("non c'è .avvio");
  } else {
    const r = avvio.getBoundingClientRect();
    if (r.left > 0 || r.top > 0 || r.right < w || r.bottom < h) {
      fallen.push(
        `.avvio non copre la finestra: ${Math.round(r.left)},${Math.round(r.top)} ` +
          `${Math.round(r.width)}×${Math.round(r.height)} su ${w}×${h}`,
      );
    }
    // 3. Nove punti, dagli angoli al centro: tutti dentro lo strato.
    for (const fx of [0.02, 0.5, 0.98]) {
      for (const fy of [0.02, 0.5, 0.98]) {
        const x = Math.round(w * fx);
        const y = Math.round(h * fy);
        const hit = document.elementFromPoint(x, y);
        if (!hit || !avvio.contains(hit)) {
          const what = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}` : "niente";
          fallen.push(`il punto ${x},${y} cade su ${what}, non su .avvio`);
        }
      }
    }
  }

  // 4. L'app sotto è inerte.
  const app = document.getElementById("app");
  if (!app) fallen.push("non c'è #app");
  else if (!app.hasAttribute("inert")) fallen.push("#app non è inert");

  // 5. Nessun bottone di #app si vede con l'aspetto nativo. Il nativo si
  //    misura su un bottone sonda con lo stile del browser (`all: revert`),
  //    nella stessa luce; anche il bianco vale come nativo. Un bottone
  //    coperto dallo strato non si vede, qualunque aspetto abbia.
  if (app) {
    const probe = document.createElement("button");
    probe.style.setProperty("all", "revert");
    root.append(probe);
    const native = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const nativeLooks = new Set([native, "rgb(255, 255, 255)", "rgb(239, 239, 239)", "rgb(240, 240, 240)"]);
    let seen = 0;
    for (const button of app.querySelectorAll("button")) {
      const r = button.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const hit = document.elementFromPoint(x, y);
      if (avvio && hit && avvio.contains(hit)) continue;
      if (!nativeLooks.has(getComputedStyle(button).backgroundColor)) continue;
      seen += 1;
      if (seen <= 3) {
        const name = button.id ? `#${button.id}` : (button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "");
        fallen.push(`il bottone «${name}» si vede con l'aspetto nativo`);
      }
    }
    if (seen > 3) fallen.push(`e altri ${seen - 3} bottoni nativi`);
  }
  return fallen;
}

/// Nella pagina, ad avvio finito: lo strato è andato e non ha lasciato niente.
function lookAfterStartup() {
  const fallen = [];
  const root = document.documentElement;
  if (document.querySelector(".avvio")) fallen.push("dopo l'avvio .avvio c'è ancora");
  if (document.getElementById("avvio-stile")) fallen.push("dopo l'avvio #avvio-stile c'è ancora");
  const attributes = root.getAttributeNames().filter((n) => n.startsWith("data-avvio"));
  if (attributes.length > 0) fallen.push(`dopo l'avvio <html> ha ancora ${attributes.join(", ")}`);
  const properties = [...root.style].filter((p) => p.startsWith("--avvio-"));
  if (properties.length > 0) fallen.push(`dopo l'avvio <html> ha ancora ${properties.join(", ")}`);
  const app = document.getElementById("app");
  if (app?.hasAttribute("inert")) fallen.push("dopo l'avvio #app è ancora inert");
  if (app?.hasAttribute("aria-busy")) fallen.push("dopo l'avvio #app è ancora aria-busy");
  return fallen;
}

/// `--port 1448` o `--port=1448`: la porta di questa corsa, se c'è.
function portArgument(argv) {
  const i = argv.findIndex((a) => a === "--port" || a.startsWith("--port="));
  if (i < 0) return undefined;
  const raw = argv[i].includes("=") ? argv[i].slice("--port=".length) : argv[i + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`--port ${raw}: non è una porta`);
  }
  return value;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
