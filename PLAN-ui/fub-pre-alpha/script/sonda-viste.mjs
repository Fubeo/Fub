// La sonda di D19 («Il controllo di tutte le viste»): passa ogni vista del
// simulatore, stato per larghezza per luce, e cerca dentro lo schermo (e negli
// strati, le pagine dei piani fotografate):
//  - taglio: un testo tagliato con «…» (text-overflow: ellipsis con
//    scrollWidth > clientWidth) o a righe (line-clamp con scrollHeight >
//    clientHeight);
//  - tagliato: un testo o un controllo tagliato in parte dal contenitore
//    (overflow hidden, che non scorre) o dal bordo dello schermo; esce: la
//    pagina che scorre di lato, un controllo spinto fuori dallo schermo;
//  - sovrapposti: due controlli che si coprono in parte; testi-sovrapposti:
//    due testi uno sull'altro; entrambi col rettangolo che si vede (tagliato
//    dai contenitori) e nello stesso livello (un menu, un dialogo o uno strato
//    fisso che copre il resto non si sovrappone: ci sta sopra); una superficie
//    di testo (l'editor, la griglia, un albero) coi suoi bottoni sopra non conta;
//  - bersaglio: un controllo sotto i 24 px (44 al telefono), misurato dove il
//    clic lo prende davvero (anche un ::before più largo o l'etichetta di un
//    campo), che non sia un testo in linea; sotto i 24 vale l'eccezione della
//    distanza di WCAG 2.5.8 (bersaglio-distanziato: si conta, non è un difetto);
//  - contrasto: un testo sotto 4,5 (3 se grande), un segnaposto o un valore sotto
//    4,5, l'icona di un bottone senza testo sotto 3 (le soglie «normal» del
//    contratto del tema, recipe.ts THRESHOLDS), contro lo sfondo che si vede
//    davvero sotto (elementsFromPoint, con veli, sfumature e opacità; il testo
//    e gli antenati con pointer-events: none, che elementsFromPoint salta, si
//    rimettono nella pila); un testo spento (disabled, aria-disabled) non
//    conta, come in WCAG; un'icona a opacità 0 conta col segno che ha al posto
//    (::before, ::after); il testo colorato dal file sulla carta del file
//    (look-file, fuori dall'editor della cella) si conta a parte
//    (contrasto-file: il colore è di chi l'ha scritto, non di Fub);
//  - fuoco: un controllo che col fuoco della tastiera non cambia niente
//    (fuoco-invisibile), che cambia solo un colore (fuoco-debole), il cui anello
//    sta sotto 3 contro lo sfondo vicino su tutti e quattro i lati
//    (anello-contrasto) o è tagliato su tutti i lati (anello-tagliato); un
//    controllo che non prende il fuoco (non-focusabile).
// Rigorosa è una vista che ha la sua cattura a quella misura (o è del
// telefono); le altre sono ricomposte (vista-sim.js, risolvi) e un difetto lì
// può essere della ricomposizione, non del piano.
// Scrive viste.tsv (un riscontro per riga, man mano), gruppi.tsv (lo stesso
// riscontro in più viste, una riga) e riassunto.json.
// node sonda-viste.mjs <out-dir> <dir-uscita> [larghezze=piena,700,tel] [luci=light,dark] [solo=id,id]
import { chromium } from "./client.mjs";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, uscita, ...resto] = process.argv.slice(2);
const opz = Object.fromEntries(resto.map((a) => a.split("=")));
const LARGHEZZE = (opz.larghezze ?? "piena,700,tel").split(",");
const LUCI = (opz.luci ?? "light,dark").split(",");
const solo = opz.solo ? new Set(opz.solo.split(",")) : null;
mkdirSync(uscita, { recursive: true });
const TSV = join(uscita, "viste.tsv");
const COLONNE = ["S", "stato", "larghezza", "luce", "vista", "prov", "tipo", "dove", "selettore", "testo", "dettaglio"];
writeFileSync(TSV, COLONNE.join("\t") + "\n");

const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errori = [];
p.on("pageerror", (e) => errori.push(`pageerror ${e.message}`));
await p.route(/^https?:/, (r) => r.abort());
p.setDefaultTimeout(20000);

await p.goto(`file://${dir}/simulatore.html#stato=nota-riposo&moto=pieno`);
await p.waitForFunction(() => document.getElementById("sim-box")?.dataset.pronto, null, { timeout: 30000 });
const STATI = await p.evaluate(() =>
  window.SIM_STATI.map((s) => ({ id: s.id, n: s.n, prov: s.prov ?? "", telefono: !!s.telefono, w700: s.w700 ? { toppe: !!s.w700.toppe } : null, tel: s.tel ? { toppe: !!s.tel.toppe } : null })),
);

// Le viste: uno stato del telefono si vede solo al telefono (risolvi lo monta
// uguale a ogni larghezza); gli altri alle tre larghezze, nelle due luci.
const viste = [];
for (const s of STATI) {
  if (solo && !solo.has(s.id)) continue;
  for (const larghezza of s.telefono ? ["tel"] : LARGHEZZE) {
    const w = larghezza === "700" ? s.w700 : larghezza === "tel" ? s.tel : null;
    const rigorosa = s.telefono || larghezza === "piena" || (!!w && !w.toppe);
    for (const luce of LUCI) viste.push({ s, larghezza, luce, rigorosa });
  }
}

let giro = 0;
async function monta(id, luce, larghezza) {
  // Il moto cambia fra ridotto e calmo solo per rimontare lo stesso indirizzo;
  // le entrate col moto calmo si aspettano finite, come in prova-sim.
  const moto = giro++ % 2 ? "calmo" : "ridotto";
  await p.evaluate(([h]) => {
    delete document.getElementById("sim-box").dataset.pronto;
    location.hash = h;
  }, [`stato=${id}&luce=${luce}&larghezza=${larghezza}&moto=${moto}`]);
  const ok = await p
    .waitForFunction(([id, luce]) => {
      const k = document.getElementById("sim-box").dataset.pronto;
      return k && k.startsWith(`${id}--`) && k.endsWith(`-${luce}`);
    }, [id, luce])
    .then(() => true, () => false);
  if (!ok) return false;
  await p.waitForTimeout(60);
  await p.evaluate(() => {
    const doc = document.getElementById("sim-schermo").contentDocument;
    const docs = [doc, ...[...doc.querySelectorAll("iframe[data-sim-strato]")].map((f) => f.contentDocument).filter(Boolean)];
    const finite = docs.flatMap((d) => d.getAnimations()).filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    return Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1500))]);
  });
  return true;
}

// ── La sonda dentro la pagina ───────────────────────────────────────────────
function sonda(o) {
  const T = o.tel ? 44 : 24;
  const trovati = [];
  const conti = { testi: 0, controlli: 0, fuochi: 0, indeterminati: 0, fvNo: 0, distanziati: 0 };
  const SEL =
    'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=switch], [role=checkbox], [role=option], [role=treeitem], [role=link], [role=gridcell], [role=columnheader], [role=slider], [role=spinbutton], [contenteditable=true], [tabindex="0"]';
  // I ruoli che in un widget composto possono non prendere il fuoco vero
  // (aria-activedescendant): non si segnano come non-focusabili.
  const COMPOSTI = "[role=option], [role=treeitem], [role=gridcell], [role=columnheader], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]";

  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  // Ogni colore CSS (rgb, oklch, color-mix, color()) in sRGB a 8 bit, col canvas.
  const rgba = (s) => {
    if (!s) return null;
    if (cache.has(s)) return cache.get(s);
    let v = null;
    cx.fillStyle = "#010203";
    cx.fillStyle = s;
    if (cx.fillStyle !== "#010203" || /^#010203$/i.test(s)) {
      cx.clearRect(0, 0, 1, 1);
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      v = [d[0], d[1], d[2], d[3] / 255];
    }
    cache.set(s, v);
    return v;
  };
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const rapporto = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const sopra = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const COLORI = /(rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|transparent)/gi;
  const pulisci = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const uno = (e) =>
    e.tagName.toLowerCase() +
    (e.id ? "#" + e.id : "") +
    [...e.classList].slice(0, 2).map((c) => "." + c).join("") +
    (e.getAttribute("role") ? `[role=${e.getAttribute("role")}]` : "") +
    (e.getAttribute("data-setting-key") ? `[data-setting-key=${e.getAttribute("data-setting-key")}]` : "");
  const sel = (e) => {
    const pe = e.parentElement;
    return (pe && pe.tagName !== "BODY" ? uno(pe) + " > " : "") + uno(e);
  };
  const nome = (e) => pulisci(e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.getAttribute("title") || e.value || "").slice(0, 60);
  const trova = (tipo, dove, el, testo, dettaglio) => trovati.push({ tipo, dove, sel: el ? sel(el) : "", testo: pulisci(testo).slice(0, 60), dettaglio });

  // Gli strati di background-image che coprono (x, y): una sfumatura larga 1 px
  // (un separatore) copre solo la sua striscia. Misure e posizioni in px o %;
  // con calc() o altro lo strato conta come se coprisse tutto.
  const lista = (v) => v.split(/,(?![^(]*\))/).map((t) => t.trim());
  const tessere = (e, cs, x, y) => {
    const imgs = lista(cs.backgroundImage);
    const sizes = lista(cs.backgroundSize);
    const pxs = lista(cs.backgroundPositionX);
    const pys = lista(cs.backgroundPositionY);
    const reps = lista(cs.backgroundRepeat);
    const r = e.getBoundingClientRect();
    const box = { left: r.left + e.clientLeft, top: r.top + e.clientTop, w: e.clientWidth || r.width, h: e.clientHeight || r.height };
    const len = (v, tot) => (v.endsWith("%") ? (parseFloat(v) / 100) * tot : v.endsWith("px") ? parseFloat(v) : null);
    return imgs.filter((img, k) => {
      const sz = (sizes[k % sizes.length] || "auto").split(/\s+/);
      const piena = sz[0] === "cover" || sz[0] === "contain";
      const tw = piena || sz[0] === "auto" ? box.w : len(sz[0], box.w);
      const th = piena || (sz[1] ?? "auto") === "auto" ? box.h : len(sz[1], box.h);
      if (tw == null || th == null) return true;
      const rp = (reps[k % reps.length] || "repeat").split(/\s+/);
      const [rx, ry] = rp.length === 2 ? rp : rp[0] === "repeat-x" ? ["repeat", "no-repeat"] : rp[0] === "repeat-y" ? ["no-repeat", "repeat"] : [rp[0], rp[0]];
      const posx = pxs[k % pxs.length] || "0%";
      const posy = pys[k % pys.length] || "0%";
      const ox = posx.endsWith("%") ? (parseFloat(posx) / 100) * (box.w - tw) : posx.endsWith("px") ? parseFloat(posx) : null;
      const oy = posy.endsWith("%") ? (parseFloat(posy) / 100) * (box.h - th) : posy.endsWith("px") ? parseFloat(posy) : null;
      if (ox == null || oy == null) return true;
      const dentroX = rx !== "no-repeat" || (x >= box.left + ox && x < box.left + ox + tw);
      const dentroY = ry !== "no-repeat" || (y >= box.top + oy && y < box.top + oy + th);
      return dentroX && dentroY;
    });
  };
  // Qualcosa che, sopra un elemento, lo copre in (x, y): un'immagine, un
  // iframe, uno sfondo.
  const opaco = (e, win, x, y) => {
    if (/^(IMG|CANVAS|VIDEO|IFRAME|OBJECT|EMBED)$/.test(e.tagName)) return true;
    const cs = win.getComputedStyle(e);
    if (cs.backgroundImage !== "none" && tessere(e, cs, x, y).length) return true;
    return (rgba(cs.backgroundColor)?.[3] ?? 0) * +cs.opacity > 0.05;
  };
  // Tagliato da un antenato che ritaglia o scorre (o da el stesso, con «daSe»:
  // un testo nel suo .sr-only largo 1 px): in (x, y) non si vede.
  const tagliato = (doc, el, x, y, daSe = false) => {
    const win = doc.defaultView;
    for (let a = daSe ? el : el.parentElement; a && a !== doc.body; a = a.parentElement) {
      const s = win.getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible" && !/paint|strict|content/.test(s.contain)) continue;
      const r = a.getBoundingClientRect();
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return true;
    }
    return false;
  };
  // Dentro un <details> chiuso, fuori dal suo <summary>: non si disegna, ma
  // getClientRects lo misura lo stesso.
  const chiuso = (el) => {
    for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])")) {
      const sm = d.querySelector(":scope > summary");
      if (!sm || !sm.contains(el)) return true;
    }
    return false;
  };
  // Se el si vede: il suo rettangolo, o null (nascosto, fuori, coperto).
  const vede = (doc, el) => {
    const win = doc.defaultView;
    if (el.closest("[data-sim-velo], [hidden], [inert]") || chiuso(el)) return null;
    const q = el.getBoundingClientRect();
    if (q.width < 2 || q.height < 2 || q.bottom <= 0 || q.right <= 0 || q.top >= win.innerHeight || q.left >= win.innerWidth) return null;
    const cs = win.getComputedStyle(el);
    if (cs.visibility !== "visible" || +cs.opacity === 0 || cs.display === "none") return null;
    const x = Math.min(win.innerWidth - 1, Math.max(0, q.left + q.width / 2));
    const y = Math.min(win.innerHeight - 1, Math.max(0, q.top + q.height / 2));
    if (tagliato(doc, el, x, y)) return null;
    for (const e of doc.elementsFromPoint(x, y)) {
      if (e === el || el.contains(e) || e.contains(el)) return q;
      if (opaco(e, win, x, y)) return null;
    }
    return q;
  };

  // Lo sfondo che si vede in (x, y) sotto el (dall'alto se el è null; sotto
  // el escluso se «dopo»): { alt: [[r,g,b]…], base } o { perche }. Le
  // sfumature danno più colori possibili: conta il peggiore.
  function sfondo(doc, x, y, el, dopo = false) {
    const win = doc.defaultView;
    let pila = doc.elementsFromPoint(x, y);
    let i = 0;
    if (el) {
      i = -1;
      // elementsFromPoint salta gli elementi con pointer-events: none (le
      // testate della griglia, per esempio): el e gli antenati che mancano
      // si rimettono nella pila sopra il primo antenato che c'è.
      const mancano = [];
      for (let a = el; a && i < 0; a = a.parentElement) {
        i = pila.indexOf(a);
        if (i < 0) mancano.push(a);
      }
      if (i < 0) return { perche: "fuori" };
      if (mancano.length) {
        pila = [...pila.slice(0, i), ...mancano, ...pila.slice(i)];
      }
      if (!dopo) for (const e of pila.slice(0, i)) if (!el.contains(e) && opaco(e, win, x, y)) return { perche: "coperto" };
      if (dopo) i += 1;
    }
    const strati = [];
    let base = null;
    for (const e of pila.slice(i)) {
      if (/^(IMG|CANVAS|VIDEO|IFRAME|OBJECT|EMBED)$/.test(e.tagName)) return { perche: "immagine" };
      if (e.tagName.toLowerCase() === "svg" && !(el && e.contains(el))) return { perche: "immagine" };
      const cs = win.getComputedStyle(e);
      const op = +cs.opacity;
      const ti = cs.backgroundImage !== "none" ? tessere(e, cs, x, y) : [];
      if (ti.length) {
        if (ti.some((t) => /url\(/.test(t))) return { perche: "immagine" };
        const cols = (ti.join(" ").match(COLORI) || []).map(rgba).filter(Boolean).map((c) => [c[0], c[1], c[2], c[3] * op]);
        if (cols.length) {
          strati.push(cols);
          if (cols.every((c) => c[3] > 0.995)) {
            base = e;
            break;
          }
        }
      }
      const c = rgba(cs.backgroundColor);
      if (c && c[3] * op > 0.004) {
        strati.push([[c[0], c[1], c[2], c[3] * op]]);
        if (c[3] * op > 0.995) {
          base = e;
          break;
        }
      }
    }
    if (base) return { alt: componi(strati, null), base };
    const f = win.frameElement;
    if (f && f.hasAttribute("data-sim-strato")) {
      const r = f.getBoundingClientRect();
      const sotto = sfondo(f.ownerDocument, x + r.left, y + r.top, f, true);
      if (sotto.perche) return sotto;
      return { alt: componi(strati, sotto.alt), base: null };
    }
    const sch = win.getComputedStyle(doc.documentElement).colorScheme;
    const tela = /dark/.test(sch) && !/light/.test(sch) ? [18, 18, 18] : [255, 255, 255];
    return { alt: componi(strati, [tela]), base: null, tela: true };
  }
  function componi(strati, basi) {
    let alt = basi ?? strati.pop().map((c) => c.slice(0, 3));
    for (let k = strati.length - 1; k >= 0; k--) {
      const nuovi = new Map();
      for (const bb of alt) for (const c of strati[k]) {
        const v = sopra(c, bb);
        nuovi.set(v.map((n) => Math.round(n)).join(","), v);
      }
      alt = [...nuovi.values()].slice(0, 24);
    }
    return alt;
  }
  const peggiore = (col, alt) => Math.min(...alt.map((bb) => rapporto(sopra(col, bb), bb)));

  // Il bordo interno di un contenitore (padding box).
  const interno = (a) => {
    const r = a.getBoundingClientRect();
    return { left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight };
  };
  // Il rettangolo q tagliato in parte (non tutto: ciò che è tutto fuori è
  // nascosto di proposito) dal contenitore più vicino che ritaglia senza
  // scorrere, o dallo schermo.
  function taglio(doc, el, q) {
    const win = doc.defaultView;
    const W = win.innerWidth;
    const H = win.innerHeight;
    const parte = (a0, a1, b0, b1) => {
      const l = Math.min(a1, b1) - Math.max(a0, b0);
      return l > 0 && l < a1 - a0 - 2;
    };
    let fx = false;
    let fy = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = win.getComputedStyle(a);
      const pittura = /paint|strict|content/.test(cs.contain);
      const ox = pittura && cs.overflowX === "visible" ? "clip" : cs.overflowX;
      const oy = pittura && cs.overflowY === "visible" ? "clip" : cs.overflowY;
      if (cs.textOverflow === "ellipsis" && ox !== "visible") return null;
      if (!fx && ox !== "visible") {
        fx = true;
        if (ox === "hidden" || ox === "clip") {
          const r = interno(a);
          if (parte(q.left, q.right, r.left, r.right)) return { asse: "di lato", chi: a };
        }
      }
      if (!fy && oy !== "visible") {
        fy = true;
        if (oy === "hidden" || oy === "clip") {
          const r = interno(a);
          if (parte(q.top, q.bottom, r.top, r.bottom)) return { asse: "in basso o in alto", chi: a };
        }
      }
      if (fx && fy) break;
    }
    if (!fx && parte(q.left, q.right, 0, W)) return { asse: "di lato", chi: null };
    if (!fy && parte(q.top, q.bottom, 0, H)) {
      const sc = win.getComputedStyle(doc.documentElement).overflowY;
      const sb = win.getComputedStyle(doc.body).overflowY;
      if (sc === "hidden" || sc === "clip" || sb === "hidden" || sb === "clip") return { asse: "in basso", chi: null };
    }
    return null;
  }

  function esamina(doc, dove) {
    const win = doc.defaultView;
    const W = win.innerWidth;
    const H = win.innerHeight;
    const nt = doc.createElement("style");
    nt.textContent = "*, *::before, *::after { transition: none !important; }";
    doc.head.append(nt);

    // La pagina che scorre di lato.
    const se = doc.scrollingElement;
    const ox = [win.getComputedStyle(doc.documentElement).overflowX, win.getComputedStyle(doc.body).overflowX];
    if (se && se.scrollWidth > W + 1 && !ox.some((v) => v === "hidden" || v === "clip")) trova("esce", dove, doc.body, "", `la pagina scorre di lato: ${se.scrollWidth} px su ${W}`);

    // ── I testi: contrasto, tagli, sovrapposizioni ──
    const peggio = new Map();
    const rett = [];
    const conTesto = new Map();
    const rg = doc.createRange();
    const tw = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.data.trim()) continue;
      const pe = n.parentElement;
      if (!pe || pe.closest("svg, style, script, noscript, template, option, [hidden], [inert], [data-sim-velo]") || chiuso(pe)) continue;
      const cs = win.getComputedStyle(pe);
      if (cs.visibility !== "visible" || cs.display === "none") continue;
      rg.selectNodeContents(n);
      const rs = [...rg.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
      const dentro = rs.filter((q) => q.right > 0 && q.bottom > 0 && q.left < W && q.top < H);
      if (!dentro.length) continue;
      const q = dentro[0];
      const x = Math.min(W - 1, Math.max(0, q.left + q.width / 2));
      const y = Math.min(H - 1, Math.max(0, q.top + q.height / 2));
      if (tagliato(doc, pe, x, y, true)) continue;
      const sf = sfondo(doc, x, y, pe);
      if (sf.perche === "fuori" || sf.perche === "coperto") continue;
      let col = rgba(cs.webkitTextFillColor) ?? rgba(cs.color);
      let o = 1;
      for (let a = pe; a && a !== sf.base; a = a.parentElement) o *= +win.getComputedStyle(a).opacity;
      if (!col || o * col[3] < 0.05) continue;
      conti.testi++;
      for (const r of rs) rett.push({ el: pe, q: r });
      const tr = conTesto.get(pe) ?? [];
      tr.push(...rs);
      conTesto.set(pe, tr);
      if (pe.closest(':disabled, [aria-disabled="true"]')) continue;
      if (sf.perche) {
        conti.indeterminati++;
        continue;
      }
      col = [col[0], col[1], col[2], col[3] * o];
      const v = peggiore(col, sf.alt);
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && (+cs.fontWeight || 400) >= 700);
      const soglia = grande ? 3 : 4.5;
      if (v < soglia - 0.005) {
        const prima = peggio.get(pe);
        // Il colore del file (una cella o un paragrafo con l'aspetto del file,
        // colorati da chi l'ha scritto) non è un colore di Fub: si conta a parte.
        const carta = pe.closest(".look-file .grid-cell, .look-file .rich-desk");
        let delFile = false;
        if (carta && !pe.closest(".cm-editor")) {
          const inchiostro = rgba(win.getComputedStyle(carta).getPropertyValue("--doc-fg").trim() || "#14161a");
          delFile = !inchiostro || Math.abs(inchiostro[0] - col[0]) + Math.abs(inchiostro[1] - col[1]) + Math.abs(inchiostro[2] - col[2]) > 6;
        }
        if (!prima || v < prima.v) peggio.set(pe, { v, soglia, testo: n.data, px, decor: !!pe.closest('[aria-hidden="true"]'), tela: !!sf.tela, delFile });
      }
    }
    for (const [el, f] of peggio) trova(f.delFile ? "contrasto-file" : "contrasto", dove, el, f.testo, `${f.v.toFixed(2)} < ${f.soglia} (${f.px}px${f.decor ? ", aria-hidden" : ""}${f.tela ? ", sulla tela" : ""})`);

    // I segnaposto e i valori dei campi.
    for (const el of doc.querySelectorAll("input, textarea")) {
      if (/^(checkbox|radio|range|color|button|submit|reset|file|image|hidden)$/.test(el.type) || el.disabled) continue;
      const q = vede(doc, el);
      if (!q) continue;
      const vuoto = !el.value;
      if (vuoto && !el.placeholder) continue;
      const cs = win.getComputedStyle(el, vuoto ? "::placeholder" : null);
      const col = rgba(cs.color);
      const sf = sfondo(doc, Math.min(W - 1, q.left + 8), Math.min(H - 1, q.top + q.height / 2), el);
      if (!col || sf.perche) continue;
      const v = peggiore(col, sf.alt);
      if (v < 4.495) trova("contrasto", dove, el, vuoto ? el.placeholder : el.value, `${v.toFixed(2)} < 4.5 (${vuoto ? "segnaposto" : "valore"})`);
    }

    // Il rettangolo che si vede davvero: q tagliato dai contenitori che non
    // lasciano uscire (overflow diverso da visible), fino a uno strato fisso.
    const visto = (el, q) => {
      let r = { left: q.left, right: q.right, top: q.top, bottom: q.bottom };
      // Da el stesso: il testo di un elemento coi «…» si vede solo dentro di lui.
      for (let a = el; a && a !== doc.body; a = a.parentElement) {
        const s = win.getComputedStyle(a);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") {
          const c = a.getBoundingClientRect();
          r = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) };
        }
        if (s.position === "fixed") break;
      }
      return r;
    };
    // Il livello: un menu, un dialogo, un elenco a comparsa, un suggerimento o
    // uno strato fisso stanno sopra il resto; ciò che coprono non si sovrappone
    // a loro, ci sta sotto.
    const LIVELLO = '[role=menu], [role=dialog], [role=alertdialog], [role=listbox], [role=tooltip], [popover], dialog';
    const livelli = new Map();
    const livello = (el) => {
      if (livelli.has(el)) return livelli.get(el);
      let l = el.closest(LIVELLO);
      if (!l) for (let a = el; a && a !== doc.body; a = a.parentElement) if (win.getComputedStyle(a).position === "fixed") { l = a; break; }
      livelli.set(el, l ?? null);
      return l ?? null;
    };
    // Una superficie di testo (l'editor, la griglia, un albero) ospita i suoi
    // segni e i suoi bottoni sopra di sé: non è una sovrapposizione.
    const superficie = (el) => el.matches('[role=document], [role=textbox][aria-multiline=true], [contenteditable=true], [role=grid], [role=tree], [role=treegrid], [role=application], .cm-scroller, .cm-content, textarea');

    // I testi uno sull'altro (elementi diversi, non uno dentro l'altro).
    const coppie = new Set();
    for (let i = 0; i < rett.length; i++) {
      const a = rett[i];
      for (let j = i + 1; j < rett.length; j++) {
        const c = rett[j];
        if (a.el === c.el) continue;
        if (a.el.contains(c.el) || c.el.contains(a.el) || livello(a.el) !== livello(c.el)) continue;
        const va = visto(a.el, a.q);
        const vc = visto(c.el, c.q);
        const w = Math.min(va.right, vc.right) - Math.max(va.left, vc.left);
        const h = Math.min(va.bottom, vc.bottom) - Math.max(va.top, vc.top);
        if (w < 4 || h < 4) continue;
        const k = sel(a.el) + "|" + sel(c.el);
        if (coppie.has(k)) continue;
        coppie.add(k);
        trova("testi-sovrapposti", dove, a.el, `${pulisci(a.el.textContent).slice(0, 28)} ⟂ ${pulisci(c.el.textContent).slice(0, 28)}`, `con ${sel(c.el)}: ${Math.round(w)}×${Math.round(h)} px`);
      }
    }

    // I testi tagliati dal contenitore o dallo schermo.
    for (const [el, rs] of conTesto) {
      const q = { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
      const t = taglio(doc, el, q);
      if (t) trova("tagliato", dove, el, el.textContent, `${t.asse}, da ${t.chi ? uno(t.chi) : "lo schermo"}`);
    }

    // I «…».
    for (const el of doc.body.querySelectorAll("*")) {
      const cs = win.getComputedStyle(el);
      const ell = cs.textOverflow === "ellipsis" && cs.overflowX !== "visible";
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
      if (!ell && !clamp) continue;
      if (!vede(doc, el)) continue;
      // Il nome intero si legge altrove? Un title o un aria-label sull'elemento
      // o su un antenato vicino (fino a tre livelli), con dentro il testo.
      const intero = () => {
        const testo = pulisci(el.textContent).slice(0, 24);
        for (let a = el, k = 0; a && k < 4; a = a.parentElement, k++) {
          for (const at of ["title", "aria-label", "data-tooltip"]) {
            const v = a.getAttribute?.(at);
            if (v && pulisci(v).includes(testo)) return `, intero nel ${at}`;
          }
        }
        return ", intero da nessuna parte";
      };
      if (ell && el.scrollWidth > el.clientWidth + 1) trova("taglio", dove, el, el.textContent, `«…»: ${el.scrollWidth} px in ${el.clientWidth}${intero()}`);
      else if (clamp && el.scrollHeight > el.clientHeight + 1) trova("taglio", dove, el, el.textContent, `a righe (${cs.webkitLineClamp}): ${el.scrollHeight} px in ${el.clientHeight}${intero()}`);
    }

    // ── I controlli ──
    const ctrl = [];
    for (const el of doc.querySelectorAll(SEL)) {
      const q = vede(doc, el);
      if (q) ctrl.push({ el, q });
      else if (!el.closest("[data-sim-velo], [hidden], [inert], [aria-hidden=true]")) {
        // Spinto fuori dallo schermo di lato, senza un contenitore che scorre
        // né un cassetto spostato con transform.
        const r = el.getBoundingClientRect();
        const cs = win.getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || cs.visibility !== "visible" || +cs.opacity === 0 || r.bottom <= 0 || r.top >= H) continue;
        if (!(r.left >= W || r.right <= 0)) continue;
        let via = false;
        for (let a = el.parentElement; a && !via; a = a.parentElement) {
          const s = win.getComputedStyle(a);
          via = s.transform !== "none" || s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden" || s.overflowX === "clip" || s.visibility !== "visible" || +s.opacity === 0;
        }
        if (!via) trova("esce", dove, el, nome(el), `fuori dallo schermo: da ${Math.round(r.left)} a ${Math.round(r.right)} su ${W}`);
      }
    }
    conti.controlli += ctrl.length;
    const spento = (el) => el.matches(':disabled, [aria-disabled="true"]') || !!el.closest('[aria-disabled="true"], fieldset:disabled');

    // Due controlli che si coprono in parte (uno posato tutto sopra l'altro,
    // come la × di una scheda, lo prende chi sta sopra: non conta).
    for (let i = 0; i < ctrl.length; i++) {
      for (let j = i + 1; j < ctrl.length; j++) {
        const a = ctrl[i];
        const c = ctrl[j];
        if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
        if (livello(a.el) !== livello(c.el) || superficie(a.el) || superficie(c.el)) continue;
        const va = visto(a.el, a.q);
        const vc = visto(c.el, c.q);
        const w = Math.min(va.right, vc.right) - Math.max(va.left, vc.left);
        const h = Math.min(va.bottom, vc.bottom) - Math.max(va.top, vc.top);
        if (w < 3 || h < 3) continue;
        const [pic] = [a, c].sort((m, n) => m.q.width * m.q.height - n.q.width * n.q.height);
        if (w >= pic.q.width - 0.5 && h >= pic.q.height - 0.5) continue;
        trova("sovrapposti", dove, a.el, `${nome(a.el).slice(0, 28)} ⟂ ${nome(c.el).slice(0, 28)}`, `con ${sel(c.el)}: ${Math.round(w)}×${Math.round(h)} px`);
      }
    }

    // I bersagli: misurati dove il clic li prende davvero.
    const etichetta = (el) => (el.matches("input") ? el.closest("label") || (el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) : null);
    const prende = (el, lab, x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const h = doc.elementFromPoint(x, y);
      return !!h && (el.contains(h) || (!!lab && lab.contains(h)));
    };
    const piccoli = [];
    for (const { el, q } of ctrl) {
      const cs = win.getComputedStyle(el);
      if (cs.pointerEvents === "none" || spento(el) || el.closest('[aria-hidden="true"]')) continue;
      if (cs.display === "inline" && [...(el.parentElement?.childNodes ?? [])].some((n) => n !== el && n.nodeType === 3 && n.data.trim())) continue;
      const lab = etichetta(el);
      let t = q;
      if (lab) {
        const lq = lab.getBoundingClientRect();
        if (lq.width * lq.height > t.width * t.height) t = lq;
      }
      if (t.width >= T - 0.5 && t.height >= T - 0.5) continue;
      const mx = q.left + q.width / 2;
      const my = q.top + q.height / 2;
      const est = (dx, dy) => {
        let k = 0;
        while (k < T && prende(el, lab, mx + dx * (k + 1), my + dy * (k + 1))) k++;
        return k;
      };
      if (!prende(el, lab, mx, my)) continue;
      const ew = Math.max(t.width, est(1, 0) + est(-1, 0) + 1);
      const eh = Math.max(t.height, est(0, 1) + est(0, -1) + 1);
      if (ew >= T - 0.5 && eh >= T - 0.5) continue;
      piccoli.push({ el, q, ew, eh, mx, my });
    }
    for (const pc of piccoli) {
      let distanziato = !o.tel;
      if (distanziato) {
        for (const { el, q } of ctrl) {
          if (el === pc.el || el.contains(pc.el) || pc.el.contains(el)) continue;
          const dx = Math.max(q.left - pc.mx, 0, pc.mx - q.right);
          const dy = Math.max(q.top - pc.my, 0, pc.my - q.bottom);
          // Il vicino conta solo se il clic lo prende nel suo punto più vicino:
          // un controllo coperto da un livello (la barra sotto la tavolozza
          // aperta) non è un bersaglio lì.
          const vx = Math.min(Math.max(pc.mx, q.left + 0.5), q.right - 0.5);
          const vy = Math.min(Math.max(pc.my, q.top + 0.5), q.bottom - 0.5);
          if (Math.hypot(dx, dy) < 12 && prende(el, etichetta(el), vx, vy)) distanziato = false;
          const altro = piccoli.find((z) => z.el === el);
          if (altro && Math.hypot(altro.mx - pc.mx, altro.my - pc.my) < 24) distanziato = false;
          if (!distanziato) break;
        }
      }
      if (distanziato) conti.distanziati++;
      trova(distanziato ? "bersaglio-distanziato" : "bersaglio", dove, pc.el, nome(pc.el), `${Math.round(pc.ew)}×${Math.round(pc.eh)} px (soglia ${T})`);
    }

    // Le icone dei bottoni senza testo: 3 contro lo sfondo.
    for (const { el, q } of ctrl) {
      if (spento(el) || pulisci(el.textContent)) continue;
      const svg = el.querySelector("svg");
      if (!svg) continue;
      const sq = svg.getBoundingClientRect();
      if (sq.width < 6 || sq.height < 6) continue;
      const sf = sfondo(doc, Math.min(W - 1, Math.max(0, sq.left + sq.width / 2)), Math.min(H - 1, Math.max(0, sq.top + sq.height / 2)), svg.parentElement);
      if (sf.perche) continue;
      // Un'icona spenta a opacità 0 non si vede: al suo posto c'è un segno
      // fatto con ::before o ::after (il pallino di una scheda non salvata),
      // e conta quello; senza segno, il bottone si mostra solo col puntatore.
      let oSvg = 1;
      for (let a = svg; a && a !== el.parentElement; a = a.parentElement) oSvg *= +win.getComputedStyle(a).opacity;
      if (oSvg < 0.05) {
        let vs = 0;
        for (const ps of ["::before", "::after"]) {
          const pcs = win.getComputedStyle(el, ps);
          const col = pcs.content !== "none" && rgba(pcs.backgroundColor);
          if (col && col[3] > 0.05) vs = Math.max(vs, peggiore(col, sf.alt));
        }
        if (vs > 0 && vs < 2.995) trova("contrasto", dove, el, nome(el), `${vs.toFixed(2)} < 3 (segno al posto dell'icona)`);
        continue;
      }
      // Un'icona a più forme (un logo) si vede se si vede la sua forma più
      // marcata: conta la migliore.
      let v = 0;
      for (const forma of [...svg.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse, text")].slice(0, 16)) {
        const fs = win.getComputedStyle(forma);
        let o2 = +fs.opacity;
        for (let a = forma.parentElement; a && a !== el.parentElement; a = a.parentElement) o2 *= +win.getComputedStyle(a).opacity;
        for (const [tinta, op, tratto] of [[fs.stroke, +fs.strokeOpacity, true], [fs.fill, +fs.fillOpacity, false]]) {
          if (!tinta || tinta === "none" || /url\(/.test(tinta)) continue;
          if (tratto && !(parseFloat(fs.strokeWidth) > 0)) continue;
          const col = rgba(tinta);
          if (col) v = Math.max(v, peggiore([col[0], col[1], col[2], col[3] * o2 * (Number.isFinite(op) ? op : 1)], sf.alt));
        }
      }
      if (v > 0 && v < 2.995) trova("contrasto", dove, el, nome(el), `${v.toFixed(2)} < 3 (icona)`);
    }

    // ── Il fuoco della tastiera ──
    const PROP = ["outline-style", "outline-width", "outline-color", "outline-offset", "box-shadow", "background-color", "background-image", "border-top-color", "border-bottom-color", "border-left-color", "border-right-color", "border-top-width", "color", "text-decoration-line", "opacity", "transform"];
    const parti = (el) => [
      [el, null, "il controllo"],
      [el, "::before", "il ::before"],
      [el, "::after", "l'::after"],
      [el.parentElement, null, "il genitore"],
      [el.parentElement?.parentElement, null, "il nonno"],
      [el.nextElementSibling, null, "il fratello dopo"],
      [el.firstElementChild, null, "il primo figlio"],
    ];
    const campo = (el) => el.isContentEditable || el.matches("textarea, input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=url], input[type=password]");
    const firma = (el) => parti(el).map(([e, ps]) => (e ? PROP.map((pp) => win.getComputedStyle(e, ps).getPropertyValue(pp)) : null));
    const ombre = (bs) =>
      bs === "none"
        ? []
        : bs.split(/,(?![^(]*\))/).map((s) => {
            const col = (s.match(COLORI) || [])[0];
            const num = s.replace(COLORI, "").trim().split(/\s+/).filter((t) => /px$/.test(t)).map(parseFloat);
            return { col: rgba(col), inset: /inset/.test(s), est: (num[3] ?? 0) + Math.max(Math.abs(num[0] ?? 0), Math.abs(num[1] ?? 0)) };
          });
    for (const { el, q } of ctrl) {
      if (el.matches(":disabled")) continue;
      const prima = firma(el);
      try {
        el.focus({ preventScroll: true, focusVisible: true });
      } catch {
        continue;
      }
      if (doc.activeElement !== el) {
        if (!el.matches(COMPOSTI) && !el.closest("[aria-activedescendant]")) trova("non-focusabile", dove, el, nome(el), "focus() non lo prende");
        continue;
      }
      conti.fuochi++;
      if (!el.matches(":focus-visible")) {
        conti.fvNo++;
        el.blur();
        continue;
      }
      const dopo = firma(el);
      const cambiati = [];
      parti(el).forEach(([e, , chi], k) => {
        if (!e || !prima[k] || !dopo[k]) return;
        const pr = PROP.filter((pp, z) => prima[k][z] !== dopo[k][z]);
        if (pr.length) cambiati.push({ e, k, chi, pr });
      });
      // Le parti dell'anello: un contorno o un'ombra che col fuoco ci sono.
      const anelli = [];
      for (const { k, chi, pr } of cambiati) {
        const [e, ps] = parti(el)[k];
        const cs = win.getComputedStyle(e, ps);
        const w = parseFloat(cs.outlineWidth);
        const oc = rgba(cs.outlineColor);
        if (cs.outlineStyle !== "none" && w >= 1 && oc && oc[3] > 0.1 && pr.some((pp) => pp.startsWith("outline"))) anelli.push({ chi, col: oc, inset: parseFloat(cs.outlineOffset) + w <= 0, est: parseFloat(cs.outlineOffset) + w, e });
        if (pr.includes("box-shadow")) for (const om of ombre(cs.boxShadow)) if (om.col && om.col[3] > 0.1) anelli.push({ chi, col: om.col, inset: om.inset || om.est <= 0, est: om.est, e });
        if (ps && pr.some((pp) => pp.startsWith("border") || pp === "background-color" || pp === "opacity")) {
          const bc = rgba(cs.borderTopColor);
          if (parseFloat(cs.borderTopWidth) >= 1 && bc && bc[3] > 0.1) anelli.push({ chi, col: bc, inset: false, est: 0, e });
        }
      }
      if (!cambiati.length) {
        trova(campo(el) ? "fuoco-solo-cursore" : "fuoco-invisibile", dove, el, nome(el), "col fuoco non cambia niente");
      } else if (!anelli.length) {
        // In un campo di testo il cursore che lampeggia dice dov'è il fuoco.
        trova(campo(el) ? "fuoco-solo-cursore" : "fuoco-debole", dove, el, nome(el), cambiati.map((c) => `${c.chi}: ${c.pr.join(", ")}`).join("; ").slice(0, 160));
      } else {
        // Il contrasto della parte più visibile dell'anello contro lo sfondo
        // vicino. Un anello fuori dal controllo si misura appena fuori, sui
        // quattro lati dentro lo schermo, e vale il lato migliore: un anello
        // che da un lato tocca un bottone vicino dello stesso colore si vede
        // dagli altri tre (e il lato di sopra può cadere fuori dalla barra,
        // su un velo che la barra non ha).
        let meglio = 0;
        let indet = false;
        for (const an of anelli) {
          const punti = [];
          if (an.inset) punti.push([Math.min(W - 1, Math.max(0, q.left + q.width / 2)), Math.min(H - 1, Math.max(0, q.top + q.height / 2)), an.e === el || el.contains(an.e) ? el : an.e]);
          else {
            const d = Math.max(1, an.est) + 1;
            const cx = q.left + q.width / 2;
            const cy = q.top + q.height / 2;
            for (const [x, y] of [[cx, q.top - d], [cx, q.bottom + d], [q.left - d, cy], [q.right + d, cy]]) if (x >= 0 && x < W && y >= 0 && y < H) punti.push([x, y, null]);
          }
          let suo = -1;
          for (const [x, y, chi] of punti) {
            const sf = sfondo(doc, x, y, chi);
            if (!sf.perche) suo = Math.max(suo, peggiore(an.col, sf.alt));
          }
          if (suo < 0) {
            indet = true;
            continue;
          }
          meglio = Math.max(meglio, suo);
        }
        if (!indet && meglio < 2.995) trova("anello-contrasto", dove, el, nome(el), `${meglio.toFixed(2)} < 3 (${[...new Set(anelli.map((a) => a.chi))].join(", ")})`);
        // L'anello fuori dal controllo tagliato su tutti i lati.
        const fuori = anelli.filter((a) => !a.inset && a.est > 0);
        if (fuori.length && fuori.length === anelli.length) {
          const e = Math.max(...fuori.map((a) => a.est));
          const R = { left: q.left - e, top: q.top - e, right: q.right + e, bottom: q.bottom + e };
          const lati = { su: true, giu: true, sx: true, dx: true };
          const cont = [{ left: 0, top: 0, right: W, bottom: H }];
          for (let a = el.parentElement; a && a !== doc.documentElement; a = a.parentElement) {
            const s = win.getComputedStyle(a);
            if (s.overflowX !== "visible" || s.overflowY !== "visible" || /paint|strict|content/.test(s.contain)) cont.push(interno(a));
          }
          for (const A of cont) {
            if (R.top < A.top - 0.5) lati.su = false;
            if (R.bottom > A.bottom + 0.5) lati.giu = false;
            if (R.left < A.left - 0.5) lati.sx = false;
            if (R.right > A.right + 0.5) lati.dx = false;
          }
          if (!Object.values(lati).some(Boolean)) trova("anello-tagliato", dove, el, nome(el), `l'anello (${Math.round(e)} px fuori) è tagliato su tutti i lati`);
        }
      }
      el.blur();
    }
  }

  const top = document.getElementById("sim-schermo").contentDocument;
  esamina(top, "schermo");
  for (const ifr of top.querySelectorAll("iframe[data-sim-strato]")) {
    if (ifr.contentDocument?.body) esamina(ifr.contentDocument, `strato:${ifr.getAttribute("data-sim-strato")}`);
  }
  return { trovati, conti };
}

// ── Il giro ────────────────────────────────────────────────────────────────
const somma = { testi: 0, controlli: 0, fuochi: 0, indeterminati: 0, fvNo: 0, distanziati: 0 };
const nonMontate = [];
const gruppi = new Map();
const perTipo = {};
let fatte = 0;
const t0 = Date.now();
for (const v of viste) {
  const { s, larghezza, luce, rigorosa } = v;
  const tag = `S${s.n} ${s.id} ${larghezza} ${luce}`;
  if (!(await monta(s.id, luce, larghezza))) {
    nonMontate.push(tag);
    console.log(`NO   ${tag}: non si monta`);
    continue;
  }
  let r;
  try {
    r = await p.evaluate(sonda, { tel: larghezza === "tel" });
  } catch (e) {
    nonMontate.push(`${tag}: ${e.message.split("\n")[0]}`);
    console.log(`NO   ${tag}: ${e.message.split("\n")[0]}`);
    continue;
  }
  fatte++;
  for (const k of Object.keys(somma)) somma[k] += r.conti[k] ?? 0;
  const righe = [];
  for (const f of r.trovati) {
    righe.push([`S${s.n}`, s.id, larghezza, luce, rigorosa ? "rigorosa" : "ricomposta", s.prov, f.tipo, f.dove, f.sel, f.testo, f.dettaglio].map((c) => String(c).replace(/[\t\n]/g, " ")).join("\t"));
    const pt = (perTipo[f.tipo] ??= { riscontri: 0, rigorosi: 0 });
    pt.riscontri++;
    if (rigorosa) pt.rigorosi++;
    const dove = f.dove.startsWith("strato:") ? f.dove : "schermo";
    const testo = f.tipo === "contrasto" || f.tipo.startsWith("bersaglio") || f.tipo.startsWith("fuoco") || f.tipo.startsWith("anello") ? f.testo.replace(/\d+/g, "#") : f.testo;
    const k = [f.tipo, dove, f.sel, testo].join("|");
    const g = gruppi.get(k) ?? { tipo: f.tipo, dove, sel: f.sel, testo: f.testo, viste: 0, rigorose: 0, stati: new Set(), larghezze: new Set(), luci: new Set(), prov: new Set(), dettaglio: f.dettaglio, peggio: Infinity };
    g.viste++;
    if (rigorosa) g.rigorose++;
    g.stati.add(`S${s.n}`);
    g.larghezze.add(larghezza);
    g.luci.add(luce);
    g.prov.add(s.prov);
    const num = parseFloat(f.dettaglio);
    if (f.tipo === "contrasto" || f.tipo === "anello-contrasto") {
      if (num < g.peggio) {
        g.peggio = num;
        g.dettaglio = f.dettaglio;
      }
    }
    gruppi.set(k, g);
  }
  if (righe.length) appendFileSync(TSV, righe.join("\n") + "\n");
  if (fatte % 50 === 0) console.log(`${fatte}/${viste.length} viste, ${Math.round((Date.now() - t0) / 1000)} s`);
}

const ordine = ["contrasto", "taglio", "tagliato", "esce", "sovrapposti", "testi-sovrapposti", "bersaglio", "fuoco-invisibile", "fuoco-debole", "anello-contrasto", "anello-tagliato", "non-focusabile", "fuoco-solo-cursore", "bersaglio-distanziato", "contrasto-file"];
const lista = [...gruppi.values()].sort((a, c) => ordine.indexOf(a.tipo) - ordine.indexOf(c.tipo) || c.rigorose - a.rigorose || c.viste - a.viste);
const corto = (set, n = 14) => {
  const l = [...set];
  return l.slice(0, n).join(" ") + (l.length > n ? ` …(+${l.length - n})` : "");
};
writeFileSync(
  join(uscita, "gruppi.tsv"),
  ["tipo\tviste\trigorose\tstati\tlarghezze\tluci\tprov\tdove\tselettore\ttesto\tdettaglio", ...lista.map((g) => [g.tipo, g.viste, g.rigorose, corto(g.stati), [...g.larghezze].join(","), [...g.luci].join(","), [...g.prov].join(","), g.dove, g.sel, g.testo, g.dettaglio].map((c) => String(c).replace(/[\t\n]/g, " ")).join("\t"))].join("\n") + "\n",
);
const gruppiPerTipo = {};
for (const g of lista) {
  const x = (gruppiPerTipo[g.tipo] ??= { gruppi: 0, gruppiRigorosi: 0 });
  x.gruppi++;
  if (g.rigorose) x.gruppiRigorosi++;
}
const riassunto = {
  viste: viste.length,
  esaminate: fatte,
  rigorose: viste.filter((v) => v.rigorosa).length,
  stati: new Set(viste.map((v) => v.s.id)).size,
  perTipo: Object.fromEntries(Object.entries(perTipo).map(([k, x]) => [k, { ...x, ...gruppiPerTipo[k] }])),
  conti: somma,
  nonMontate,
  errori: errori.slice(0, 20),
  secondi: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(uscita, "riassunto.json"), JSON.stringify(riassunto, null, 2) + "\n");
console.log(JSON.stringify(riassunto, null, 2));
await b.close();
