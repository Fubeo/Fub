// Fotografa ogni stato del simulatore v2 (le due luci, ogni larghezza che ha,
// movimento ridotto) e lo confronta con la sua fonte:
//  - uno stato che è una cattura pura del client (niente strati né toppe)
//    contro la foto del client presa dal banco;
//  - ogni strato di uno stato composto contro la pagina approvata del piano
//    (catture/piani/<cattura>-<luce>.png): lo strato si porta per un momento
//    alla misura della pagina, si fotografa e si rimette dov'era;
//  - la parte di client di uno stato composto, fuori dagli strati, dal DOM
//    scritto a mano (data-sim-toppa) e dai pezzi di altre catture
//    (data-sim-composto), contro la foto del client da cui viene.
// Gli strati si confrontano a tutta larghezza (a 700 e al telefono la pagina
// approvata non ha una foto sua). La riga dei dati della nota si toglie prima
// della foto: il banco la mette solo nel DOM copiato (mods.mjs datiNota).
// Le foto delle pagine approvate e dei client vanno prese con gli stessi
// argomenti del browser (cattura.mjs usa bench/stage.mjs, cattura-piani.mjs li
// copia): una cattura presa prima di un cambio di blocchi/*.css si rifà con
// ricattura.mjs, perché il simulatore monta il CSS di oggi.
// node foto-sim.mjs <out-dir> <foto-dir> [solo=id,id] [gruppi=Nota,File] [larghezze=piena,700,tel]
// Scrive <foto-dir>/<id>--<larghezza>-<luce>.png, i .diff.png e confronto.tsv
// (id, S, gruppo, provenienza, larghezza, luce, che cosa, differenza, perché).
// Il browser parte con gli argomenti del banco (bench/stage.mjs): senza, i
// caratteri si disegnano diversi e ogni testo conta come differenza.
import { chromium } from "./client.mjs";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { indiceCatture } from "./elenco-sim.mjs";
const { richiedi: require } = await import("./client.mjs");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch").default ?? require("pixelmatch");
const [dir, fotoDir, ...resto] = process.argv.slice(2);
const opz = Object.fromEntries(resto.map((a) => a.split("=")));
const solo = opz.solo ? new Set(opz.solo.split(",")) : null;
const gruppi = opz.gruppi ? new Set(opz.gruppi.split(",")) : null;
const larghezzeOk = new Set((opz.larghezze ?? "piena,700,tel").split(","));
const SOGLIA = 0.5; // per cento: sopra si guarda e si spiega
mkdirSync(fotoDir, { recursive: true });
const indice = indiceCatture();
const pngDi = (cap, luce) => {
  const j = indice.get(`${cap}-${luce}`);
  const png = j?.replace(/\.json$/, ".png");
  return png && existsSync(png) ? png : null;
};


// Differenza fra due PNG della stessa misura. «maschera» (x,y) → true salta il
// punto; i punti trasparenti della fonte si saltano sempre (uno strato
// trasparente lascia vedere il client sotto).
function confronta(a, c, maschera) {
  let n = 0;
  let tot = 0;
  const d = new PNG({ width: a.width, height: a.height });
  const aa = Buffer.from(a.data);
  const cc = Buffer.from(c.data);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i + 3] < 255 || maschera?.(x, y)) {
        aa[i] = cc[i] = 0;
        aa[i + 1] = cc[i + 1] = 0;
        aa[i + 2] = cc[i + 2] = 0;
        aa[i + 3] = cc[i + 3] = 255;
      } else tot++;
    }
  }
  n = pixelmatch(aa, cc, d.data, a.width, a.height, { threshold: 0.1 });
  return { n, tot, d };
}
const pc = (n, tot) => (tot ? `${((100 * n) / tot).toFixed(2)}%` : "—");

const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push(`pageerror ${e.message}`));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource|Blocked script execution/.test(m.text()) && errori.push(`console ${m.text()}`));
await p.route(/^https?:/, (r) => r.abort());
// Il primo indirizzo è diverso da ogni indirizzo del giro (moto=pieno), così
// anche il primo stato si rimonta.
await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo&moto=pieno`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
// Lo schermo a scala 1, fermo in alto a sinistra, senza cornice né
// didascalie; il gemello e il segno restano montati ma non si vedono.
await p.evaluate(() => {
  const st = document.createElement("style");
  st.id = "foto-fissa";
  st.textContent =
    "#sim-box{position:fixed!important;top:0!important;left:0!important;display:block!important;gap:0!important;z-index:999;margin:0!important;padding:0!important}" +
    " #sim-fig-b,#sim-segno{visibility:hidden!important}" +
    // La didascalia dei gemelli sta sopra lo schermo: nascosta ma presente lo
    // spingerebbe in basso di una riga, e la foto prenderebbe la testata del
    // simulatore al posto della cima dello schermo.
    " #sim-cap-a{display:none!important}" +
    " .sim-vetro{width:auto!important;height:auto!important;border-radius:0!important;box-shadow:none!important}" +
    " #sim-schermo{transform:none!important}";
  document.head.append(st);
});
const STATI = await p.evaluate(() => window.SIM_STATI);

// Perché una cattura pura può non coincidere con la sua foto: le righe che il
// banco aggiunge al DOM dopo la foto (mods.mjs, datiNota).
const FACCIA = "riga dei dati della nota tolta dal confronto (mods.mjs datiNota la mette solo nel DOM copiato, non nella foto del client)";

// La larghezza dell'ispettore che la foto del client ha preso dalle
// preferenze (fub:preferenze): c'è solo con la finestra compatta.
function ispettoreDellaCattura(cap, luce) {
  const j = indice.get(`${cap}-${luce}`);
  if (!j) return null;
  const css = JSON.parse(readFileSync(j, "utf8")).css ?? [];
  const pref = css.find((c) => c.label === "fub:preferenze")?.text ?? "";
  return /--inspector-w:\s*(\d+px)/.exec(pref)?.[1] ?? null;
}

// Le differenze che il piano vuole, o che il DOM copiato non può portare. Le
// zone che le spiegano si tolgono dal confronto e si rimisura: la riga dice
// quanto resta senza, così si vede se la spiegazione basta.
async function spiega(s, cap, luce, a, foto, fuori) {
  const motivi = [];
  if (s.tema) motivi.push(`il tema d'esempio «${s.tema}» cambia la pelle (PA T42); la foto del client è quella di serie`);
  const isp = ispettoreDellaCattura(cap, luce);
  if (isp) motivi.push(`S2 T9: con la finestra compatta la foto del client ha l'ispettore delle preferenze di prima (${isp}, poi i blocchi sopra lo portano a 264); il simulatore ha quello di measures.ts dopo T9, fino a 216`);
  const z = await p.evaluate(() => {
    const d = document.getElementById("sim-schermo").contentDocument;
    const r = (e, g = 0) => {
      const q = e.getBoundingClientRect();
      return q.width && q.height ? { x: Math.floor(q.left) - g, y: Math.floor(q.top) - g, w: Math.ceil(q.width) + 1 + 2 * g, h: Math.ceil(q.height) + 1 + 2 * g } : null;
    };
    const visto = (e) => !e.hidden && getComputedStyle(e).display !== "none";
    const modo = [...d.querySelectorAll(".pane > .pane-mode-current")].filter(visto);
    const t3 = modo.length ? [...modo, ...d.querySelectorAll(".pane-toolbar, .pane > .format-bar, .rich-surface > .rich-side-open")].filter(visto).map((e) => r(e)).filter(Boolean) : [];
    const fuoco = [...d.querySelectorAll("[data-proto-focus]")].map((e) => r(e, 4)).filter(Boolean);
    return { t3, fuoco };
  });
  // Le zone si sommano: la seconda si misura senza anche la prima.
  const tolte = [];
  const senza = (zone, testo) => {
    if (!zone.length) return;
    tolte.push(...zone);
    const via = (x, y) => fuori?.(x, y) || tolte.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    const { n, tot } = confronta(a, foto, via);
    motivi.push(`${testo}; tolta anche questa zona resta ${pc(n, tot)}`);
  };
  senza(z.t3, "S2 T3: il bottone della modalità sta nella testata nella foto del client e dopo la barra di formato nel simulatore (si sposta solo nella copia, mods.mjs modo); la testata, il bottone, la barra di formato e il bottone del lato (90-mobile.css li sposta per lui) tolti");
  senza(z.fuoco, "il fuoco della pagina viva (data-proto-focus) non passa nel DOM copiato; nel simulatore si vede col bottone «Fuoco»");
  return motivi;
}

const righe = [];
const riga = (s, larghezza, luce, cosa, diff, motivo = "") => righe.push([s.id, `S${s.n}`, s.g, s.prov, larghezza, luce, cosa, diff, motivo].join("\t"));
for (const s of STATI) {
  if (solo && !solo.has(s.id)) continue;
  if (gruppi && !gruppi.has(s.g)) continue;
  const forme = s.telefono
    ? [["tel", s.cap, s.strati, s.toppe]]
    : [["piena", s.cap, s.strati, s.toppe], ...(s.w700?.cap ? [["700", s.w700.cap, s.w700.toppe ? s.strati : [], s.w700.toppe ? s.toppe : []]] : []), ...(s.tel?.cap ? [["tel", s.tel.cap, s.tel.toppe ? s.strati : [], s.tel.toppe ? s.toppe : []]] : [])];
  for (const [larghezza, cap, strati, toppe] of forme) {
    if (!larghezzeOk.has(larghezza)) continue;
    const pura = s.prov === "cattura" && !strati?.length && !toppe?.length;
    for (const luce of ["light", "dark"]) {
      await p.setViewportSize({ width: 1440, height: 1000 });
      await p.evaluate(([h]) => {
        delete document.getElementById("sim-box").dataset.pronto;
        location.hash = h;
      }, [`stato=${s.id}&luce=${luce}&larghezza=${larghezza}&moto=ridotto`]);
      const chiave = `${s.id}--${larghezza}-${luce}`;
      const ok = await p
        .waitForFunction((k) => document.getElementById("sim-box").dataset.pronto === k, chiave, { timeout: 20000 })
        .then(() => true, () => false);
      if (!ok) {
        errori.push(`non pronto ${chiave}`);
        continue;
      }
      const r = await p.evaluate(() => {
        const f = document.getElementById("sim-schermo");
        return { x: 0, y: 0, width: +f.width, height: +f.height };
      });
      await p.setViewportSize({ width: Math.max(1440, r.width), height: Math.max(1000, r.height) });
      // La riga dei dati della nota (mods.mjs datiNota) entra solo nel DOM
      // copiato, non nella foto del client: per il confronto si toglie, e la
      // riga dice che c era.
      const faccia = await p.evaluate(() => {
        const d = document.getElementById("sim-schermo").contentDocument;
        if (!d.querySelector(".note-facts")) return false;
        const st = d.createElement("style");
        st.id = "foto-senza-dati";
        st.textContent = ".note-facts{display:none!important}";
        d.head.append(st);
        return true;
      });
      await p.waitForTimeout(120);
      const out = join(fotoDir, `${chiave}.png`);
      await p.screenshot({ path: out, clip: r });
      const foto = PNG.sync.read(readFileSync(out));
      const ref = pngDi(cap, luce);

      if (pura) {
        if (!ref) {
          riga(s, larghezza, luce, "client", "senza png");
          continue;
        }
        const a = PNG.sync.read(readFileSync(ref));
        if (a.width !== foto.width || a.height !== foto.height) {
          riga(s, larghezza, luce, "client", `misura ${a.width}x${a.height} ≠ ${foto.width}x${foto.height}`);
          continue;
        }
        const { n, tot, d } = confronta(a, foto);
        if (n > 0) writeFileSync(out.replace(/\.png$/, ".diff.png"), PNG.sync.write(d));
        const perche = (100 * n) / tot > SOGLIA ? await spiega(s, cap, luce, a, foto) : [];
        riga(s, larghezza, luce, "client", pc(n, tot), [...perche, faccia ? FACCIA : ""].filter(Boolean).join("; "));
        continue;
      }

      // Gli strati: dove stanno nello schermo, e la loro pagina approvata.
      const rett = await p.evaluate(() =>
        [...document.getElementById("sim-schermo").contentDocument.querySelectorAll("iframe[data-sim-strato]")].map((f) => {
          const q = f.getBoundingClientRect();
          return { cattura: f.getAttribute("data-sim-strato"), x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) };
        }),
      );
      // Il DOM scritto a mano (toppe) e i pezzi presi da un altra cattura non
      // hanno una foto del client: si tolgono dal confronto come gli strati.
      const messi = await p.evaluate(() =>
        [...document.getElementById("sim-schermo").contentDocument.querySelectorAll("[data-sim-toppa], [data-sim-composto]")].map((e) => {
          const q = e.getBoundingClientRect();
          return { x: Math.floor(q.left), y: Math.floor(q.top), w: Math.ceil(q.width) + 1, h: Math.ceil(q.height) + 1 };
        }),
      );
      // La parte di client, fuori dagli strati, contro la foto del client.
      if (ref) {
        const a = PNG.sync.read(readFileSync(ref));
        if (a.width === foto.width && a.height === foto.height) {
          const dentro = (x, y) => [...rett, ...messi].some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
          const { n, tot, d } = confronta(a, foto, dentro);
          if (n > 0) writeFileSync(out.replace(/\.png$/, ".client.diff.png"), PNG.sync.write(d));
          const alta = (100 * n) / tot > SOGLIA;
          const perche = alta ? await spiega(s, cap, luce, a, foto, dentro) : [];
          riga(s, larghezza, luce, "client fuori dagli strati", pc(n, tot), [alta && toppe?.length ? "le toppe del piano cambiano il client attorno al DOM nuovo (classi, testi, spazio che il DOM nuovo prende)" : "", ...perche, faccia ? FACCIA : ""].filter(Boolean).join("; "));
        } else riga(s, larghezza, luce, "client fuori dagli strati", `misura ${a.width}x${a.height} ≠ ${foto.width}x${foto.height}`);
      }
      for (const [i, q] of rett.entries()) {
        // La pagina approvata ha una foto sola, alla sua misura: lo strato si
        // confronta a tutta larghezza, dove lo schermo la contiene; a 700 e
        // al telefono è la stessa pagina che si adatta.
        if (larghezza !== "piena") {
          riga(s, larghezza, luce, `strato ${q.cattura}`, "a tutta larghezza", "la pagina approvata è fotografata solo alla sua misura; qui lo strato è la stessa pagina che si adatta");
          continue;
        }
        const png = pngDi(q.cattura, luce);
        if (!png) {
          riga(s, larghezza, luce, `strato ${q.cattura}`, "senza png");
          continue;
        }
        const a = PNG.sync.read(readFileSync(png));
        // Lo strato alla misura della pagina, in alto a sinistra, sopra tutto.
        const prima = await p.evaluate(
          ([i, w, h]) => {
            const f = document.getElementById("sim-schermo").contentDocument.querySelectorAll("iframe[data-sim-strato]")[i];
            const vecchio = f.getAttribute("style");
            Object.assign(f.style, { left: "0px", top: "0px", width: `${w}px`, height: `${h}px`, zIndex: "2147483000" });
            return vecchio;
          },
          [i, a.width, a.height],
        );
        await p.waitForTimeout(150);
        const shot = PNG.sync.read(await p.screenshot({ clip: { x: 0, y: 0, width: a.width, height: a.height } }));
        await p.evaluate(
          ([i, v]) => document.getElementById("sim-schermo").contentDocument.querySelectorAll("iframe[data-sim-strato]")[i].setAttribute("style", v),
          [i, prima],
        );
        const { n, tot, d } = confronta(a, shot);
        if (n > 0) writeFileSync(out.replace(/\.png$/, `.strato${i}.diff.png`), PNG.sync.write(d));
        const conToppe = toppe?.some((t) => t.in === "strato");
        const regione = q.w === a.width && q.h === a.height ? "" : `nel simulatore lo strato sta in ${q.w}x${q.h} e si adatta; la pagina è ${a.width}x${a.height}`;
        const alta = (100 * n) / tot > SOGLIA;
        riga(s, larghezza, luce, `strato ${q.cattura}`, pc(n, tot), [alta && conToppe ? "le toppe del piano cambiano lo strato" : "", regione].filter(Boolean).join("; "));
      }
    }
  }
}
writeFileSync(join(fotoDir, "confronto.tsv"), righe.join("\n") + "\n");
const conf = righe.filter((r) => r.split("\t")[7].endsWith("%"));
const alte = conf.filter((r) => parseFloat(r.split("\t")[7]) > SOGLIA);
const perTipo = {};
for (const r of conf) {
  const k = r.split("\t")[6].replace(/ p-.*$/, "");
  perTipo[k] = perTipo[k] ?? { n: 0, alte: 0 };
  perTipo[k].n++;
  if (parseFloat(r.split("\t")[7]) > SOGLIA) perTipo[k].alte++;
}
console.log(`${righe.length} confronti, ${conf.length} misurati, ${alte.length} sopra lo ${SOGLIA}%`, JSON.stringify(perTipo));
for (const r of alte) console.log(`  ${r}`);
for (const r of righe.filter((r) => /misura|senza png/.test(r.split("\t")[7]))) console.log(`  ${r}`);
console.log("errori:", errori.length ? errori.join("\n") : "nessuno");
await b.close();
process.exit(errori.length ? 1 : 0);
