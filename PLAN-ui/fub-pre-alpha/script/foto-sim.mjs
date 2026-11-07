// Fotografa ogni stato del simulatore v2 (le due luci, ogni larghezza che ha,
// movimento ridotto) e lo confronta con la sua fonte:
//  - uno stato che è una cattura pura del client (niente strati né toppe)
//    contro la foto del client presa dal banco;
//  - ogni strato di uno stato composto contro la pagina approvata del piano
//    (catture/piani/<cattura>-<luce>.png): lo strato si porta per un momento
//    alla misura della pagina, si fotografa e si rimette dov'era;
//  - la parte di client di uno stato composto, fuori dagli strati, dal DOM
//    scritto a mano (data-sim-toppa), dai pezzi di altre catture
//    (data-sim-composto) e dagli elementi a cui una toppa cambia testo,
//    attributi o classi (vista-sim.js, __simCambiati), contro la foto del
//    client da cui viene. Quando il DOM nuovo prende spazio, ciò che gli
//    viene dopo si sposta: lo scorrimento si riprova allineato al contenuto
//    spinto giù, e un quadretto che differisce conta come spiegato solo se si
//    ritrova uguale nella foto spostato in verticale o di lato (spostati).
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

// Il DOM nuovo prende spazio: ciò che gli viene dopo scende, sale o va di
// lato, e ogni suo punto conta come differenza. Per ogni quadretto di LATO px
// che differisce (fuori dalle zone già tolte) si cerca lo stesso quadretto
// nella foto del client, spostato in verticale o in orizzontale fino a `max`
// px. Rende i punti diversi dei quadretti che non si ritrovano (n su tot,
// come confronta), gli spostamenti più usati e l'immagine di ciò che resta.
const LATO = 16;
function spostati(a, c, via, max) {
  const { width: W, height: H } = a;
  const { n: n0, tot, d } = confronta(a, c, via);
  const tolto = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (via?.(x, y)) tolto[y * W + x] = 1;
  const rosso = (k) => d.data[k * 4] === 255 && d.data[k * 4 + 1] === 0 && d.data[k * 4 + 2] === 0;
  // Il quadretto [x0,x1)×[y0,y1) di c è uguale a quello di a spostato di
  // (dx,dy)? Si concede il 3 % di punti diversi (gli orli dei caratteri).
  const uguale = (x0, y0, x1, y1, dx, dy) => {
    let visti = 0;
    let diversi = 0;
    const tetto = Math.floor(0.03 * (x1 - x0) * (y1 - y0));
    for (let y = y0; y < y1; y++) {
      const ys = y + dy;
      if (ys < 0 || ys >= H) return false;
      for (let x = x0; x < x1; x++) {
        const k = y * W + x;
        if (tolto[k]) continue;
        const xs = x + dx;
        if (xs < 0 || xs >= W) return false;
        const i = k * 4;
        const j = (ys * W + xs) * 4;
        visti++;
        if (Math.abs(c.data[i] - a.data[j]) + Math.abs(c.data[i + 1] - a.data[j + 1]) + Math.abs(c.data[i + 2] - a.data[j + 2]) > 48 && ++diversi > tetto) return false;
      }
    }
    return visti > 0;
  };
  const prove = [];
  for (let s = 1; s <= max; s++) prove.push([0, s], [0, -s]);
  for (let s = 1; s <= max; s++) prove.push([s, 0], [-s, 0]);
  const usati = new Map();
  let n = 0;
  const resto = new PNG({ width: W, height: H });
  d.data.copy(resto.data);
  for (let y0 = 0; y0 < H; y0 += LATO) {
    for (let x0 = 0; x0 < W; x0 += LATO) {
      const x1 = Math.min(W, x0 + LATO);
      const y1 = Math.min(H, y0 + LATO);
      let rossi = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (rosso(y * W + x)) rossi++;
      if (!rossi) continue;
      // Prima gli spostamenti già trovati, dal più usato (pesato coi punti diversi).
      const primi = [...usati.entries()].sort((p, q) => q[1] - p[1]).map(([k]) => k.split(",").map(Number));
      const trovato = [...primi, ...prove].find(([dx, dy]) => uguale(x0, y0, x1, y1, dx, dy));
      if (trovato) {
        const k = trovato.join(",");
        usati.set(k, (usati.get(k) ?? 0) + rossi);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (rosso(y * W + x)) resto.data.fill(230, (y * W + x) * 4, (y * W + x) * 4 + 3);
      } else n += rossi;
    }
  }
  const ordinati = [...usati.entries()].sort((p, q) => q[1] - p[1]);
  // Gli spostamenti in giù (dy < 0), dal più pesante: lo scorrimento si prova con questi.
  const giu = ordinati.map(([k]) => k.split(",").map(Number)).filter(([dx, dy]) => dx === 0 && dy < 0).map(([, dy]) => -dy);
  const spost = ordinati
    .slice(0, 3)
    // Il quadretto del simulatore in (x,y) sta nella foto in (x+dx,y+dy): nel
    // simulatore è più in alto quando dy > 0, più a sinistra quando dx > 0.
    .map(([k]) => {
      const [dx, dy] = k.split(",").map(Number);
      return dy ? `${dy > 0 ? "su" : "giù"} di ${Math.abs(dy)} px` : `${dx > 0 ? "a sinistra" : "a destra"} di ${Math.abs(dx)} px`;
    });
  return { n, n0, tot, spost, giu, resto };
}

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
// `sposta`: fin dove il DOM nuovo può spostare il resto (0 = niente).
async function spiega(s, cap, luce, a, foto, fuori, sposta = 0, out = null) {
  const motivi = [];
  if (s.tema) motivi.push(`il tema d'esempio «${s.tema}» cambia la pelle (PA T42); la foto del client è quella di serie`);
  const isp = ispettoreDellaCattura(cap, luce);
  // L'ispettore più stretto di S2 T9 sposta di lato il foglio e le barre.
  if (isp) sposta = Math.max(sposta, 64);
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
    // PA T47 (92-prealpha-telefono.css): sul telefono l'interruttore torna di
    // 32 × 18 e le schede delle impostazioni non si stringono; nella foto del
    // client sono il cerchio di 44 px e i nomi in «…». Ogni interruttore
    // visibile accorcia la sua riga di 26 px.
    const tel = d.documentElement.dataset.clientShell === "mobile";
    const sw = tel ? [...d.querySelectorAll('input[role="switch"]')].filter((e) => e.getClientRects().length) : [];
    const nav = tel ? [...d.querySelectorAll(".settings-nav")].filter(visto) : [];
    const t47 = [...sw.map((e) => r(e, 14)), ...nav.map((e) => r(e))].filter(Boolean);
    const alto = d.documentElement.clientHeight;
    const viste = sw.filter((e) => {
      const q = e.getBoundingClientRect();
      return q.bottom > 0 && q.top < alto;
    }).length;
    return { t3, fuoco, t47, t47sposta: t47.length ? Math.min(480, 26 * Math.max(1, viste) + 64) : 0 };
  });
  if (z.t47sposta) sposta = Math.max(sposta, z.t47sposta);
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
  senza(z.t47, "PA T47: sul telefono l'interruttore torna il binario di 32 × 18 e le schede delle impostazioni scorrono intere (92-prealpha-telefono.css); nella foto del client sono il cerchio di 44 px e i nomi in «…» della regola dei 44 px di mobile.css; interruttori e schede tolti");
  if (sposta) {
    const via = (x, y) => fuori?.(x, y) || tolte.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    const r = spostati(a, foto, via, sposta);
    if (out && r.n) writeFileSync(out.replace(/\.png$/, ".resto.png"), PNG.sync.write(r.resto));
    motivi.push(
      `${z.t47sposta && !s.toppe?.length ? "l'interruttore più basso di PA T47" : isp && !s.toppe?.length ? "l'ispettore più stretto" : "il DOM nuovo"} sposta il resto${r.spost.length ? ` (${r.spost.join(", ")})` : ""}: i quadretti di ${LATO} px che differiscono si ritrovano uguali nella foto del client spostati fino a ${sposta} px; tolti quelli che si ritrovano resta ${pc(r.n, r.tot)}`,
    );
  }
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
        const perche = (100 * n) / tot > SOGLIA ? await spiega(s, cap, luce, a, foto, null, 0, out) : [];
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
      // Con loro si tolgono gli elementi a cui una toppa ha cambiato testo,
      // attributi o classi (vista-sim.js segna, __simCambiati).
      const misuraMessi = () =>
        p.evaluate(() => {
          const d = document.getElementById("sim-schermo").contentDocument;
          return [...d.querySelectorAll("[data-sim-toppa], [data-sim-composto]"), ...(d.__simCambiati ?? []).filter((e) => e.isConnected)]
            .map((e) => e.getBoundingClientRect())
            .filter((q) => q.width && q.height)
            .map((q) => ({ x: Math.floor(q.left), y: Math.floor(q.top), w: Math.ceil(q.width) + 1, h: Math.ceil(q.height) + 1 }));
        });
      // La parte di client, fuori dagli strati, contro la foto del client.
      // Una toppa che scorre per mettersi in vista (vista-sim.js portaInVista)
      // sposta tutto il contenuto che scorre: per il confronto si rimette lo
      // scorrimento della foto del client, poi si torna come prima.
      if (ref) {
        const a = PNG.sync.read(readFileSync(ref));
        if (a.width === foto.width && a.height === foto.height) {
          const scorsi = await p.evaluate(() =>
            [...document.getElementById("sim-schermo").contentDocument.querySelectorAll("[data-sim-scorso]")].map((e) => {
              const ora = e.scrollTop;
              e.scrollTop = Number(e.getAttribute("data-sim-scorso"));
              return ora;
            }),
          );
          let fotoC = foto;
          if (scorsi.length) {
            await p.waitForTimeout(80);
            fotoC = PNG.sync.read(await p.screenshot({ clip: r, path: out.replace(/\.png$/, ".client.png") }));
          }
          const messi = await misuraMessi();
          const dentro = (x, y) => [...rett, ...messi].some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
          const { n, tot, d } = confronta(a, fotoC, dentro);
          if (n > 0) writeFileSync(out.replace(/\.png$/, ".client.diff.png"), PNG.sync.write(d));
          const alta = (100 * n) / tot > SOGLIA;
          // Fin dove il DOM nuovo può spostare il resto: l'altezza dei pezzi
          // nuovi che stanno nel flusso (non i dialoghi e i menu, che stanno
          // sopra) o la larghezza degli elementi col testo cambiato, più 64 px
          // per ciò che una toppa toglie; mai oltre 480.
          const sposta =
            alta && toppe?.length
              ? await p.evaluate(() => {
                  const d = document.getElementById("sim-schermo").contentDocument;
                  const flusso = (e) => !["fixed", "absolute"].includes(getComputedStyle(e).position);
                  let h = 0;
                  let w = 0;
                  for (const e of d.querySelectorAll("[data-sim-toppa], [data-sim-composto]")) if (flusso(e)) h += e.getBoundingClientRect().height;
                  for (const e of d.__simCambiati ?? []) if (e.isConnected) w = Math.max(w, e.getBoundingClientRect().width);
                  return Math.min(480, Math.ceil(Math.max(h, w)) + 64);
                })
              : 0;
          // Un DOM nuovo sopra ciò che la foto mostra spinge giù il contenuto
          // che scorre: allo scorrimento della foto il simulatore fa vedere
          // righe che nella foto stavano sopra lo schermo. Si riprova scorrendo
          // in più di quanto il DOM nuovo spinge giù (lo spostamento verticale
          // più usato), e si tiene la prova che lascia meno differenze.
          let fotoS = fotoC;
          let dentroS = dentro;
          let allinea = "";
          // Che cosa scorre: ciò che vista-sim.js ha già scorso (data-sim-scorso),
          // se no il primo antenato che scorre di ogni pezzo nuovo; si parte
          // dallo scorrimento della foto.
          const scorri = (g) =>
            p.evaluate((g) => {
              const d = document.getElementById("sim-schermo").contentDocument;
              let cont = [...d.querySelectorAll("[data-sim-scorso]")];
              if (!cont.length) {
                const su = new Set();
                for (const e of d.querySelectorAll("[data-sim-toppa], [data-sim-composto]"))
                  for (let a = e.parentElement; a; a = a.parentElement)
                    if (/auto|scroll/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight) {
                      su.add(a);
                      break;
                    }
                cont = [...su];
              }
              for (const e of cont) {
                e.__simBase ??= e.hasAttribute("data-sim-scorso") ? Number(e.getAttribute("data-sim-scorso")) : e.scrollTop;
                e.scrollTop = e.__simBase + g;
              }
            }, g);
          if (alta && sposta) {
            const r0 = spostati(a, fotoC, dentro, sposta);
            let meglio = r0.n;
            let scelto = 0;
            // I tre spostamenti in giù più pesanti; si tiene il migliore.
            for (const giu of r0.giu.slice(0, 3)) {
              await scorri(giu);
              await p.waitForTimeout(80);
              const f2 = PNG.sync.read(await p.screenshot({ clip: r }));
              const messi2 = await misuraMessi();
              const dentro2 = (x, y) => [...rett, ...messi2].some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
              const r2 = spostati(a, f2, dentro2, sposta);
              if (r2.n < meglio) {
                meglio = r2.n;
                scelto = giu;
                fotoS = f2;
                dentroS = dentro2;
              }
            }
            await scorri(scelto);
            if (scelto) {
              await p.waitForTimeout(80);
              writeFileSync(out.replace(/\.png$/, ".client.png"), PNG.sync.write(fotoS));
              allinea = `lo scorrimento della foto più ${scelto} px, quanto il DOM nuovo spinge giù ciò che gli viene dopo (senza: resta ${pc(r0.n, r0.tot)})`;
            }
          }
          const perche = alta ? await spiega(s, cap, luce, a, fotoS, dentroS, sposta, out) : [];
          if (allinea) {
            perche.unshift(allinea);
            await scorri(0);
          }
          if (scorsi.length)
            await p.evaluate(
              (v) => [...document.getElementById("sim-schermo").contentDocument.querySelectorAll("[data-sim-scorso]")].forEach((e, i) => (e.scrollTop = v[i])),
              scorsi,
            );
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
        // Il DOM che il piano scrive nello strato (toppe con in: "strato"),
        // misurato con lo strato già alla misura della pagina.
        const zt = await p.evaluate((i) => {
          const f = document.getElementById("sim-schermo").contentDocument.querySelectorAll("iframe[data-sim-strato]")[i];
          return [...f.contentDocument.querySelectorAll("[data-sim-toppa], [data-sim-composto]")]
            .map((e) => e.getBoundingClientRect())
            .filter((q) => q.width && q.height)
            .map((q) => ({ x: Math.floor(q.left) - 2, y: Math.floor(q.top) - 2, w: Math.ceil(q.width) + 5, h: Math.ceil(q.height) + 5 }));
        }, i);
        await p.evaluate(
          ([i, v]) => document.getElementById("sim-schermo").contentDocument.querySelectorAll("iframe[data-sim-strato]")[i].setAttribute("style", v),
          [i, prima],
        );
        const { n, tot, d } = confronta(a, shot);
        writeFileSync(out.replace(/\.png$/, `.strato${i}.png`), PNG.sync.write(shot));
        if (n > 0) writeFileSync(out.replace(/\.png$/, `.strato${i}.diff.png`), PNG.sync.write(d));
        const alta = (100 * n) / tot > SOGLIA;
        const motivi = [];
        if (alta && zt.length) {
          const via = (x, y) => zt.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
          const r2 = confronta(a, shot, via);
          motivi.push(`le toppe del piano cambiano lo strato (DOM nuovo dentro la pagina); tolta questa zona resta ${pc(r2.n, r2.tot)}`);
        }
        riga(s, larghezza, luce, `strato ${q.cattura}`, pc(n, tot), motivi.join("; "));
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
