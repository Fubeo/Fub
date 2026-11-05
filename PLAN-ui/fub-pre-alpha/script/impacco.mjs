// Il pacco delle catture: testi messi una volta sola, i simili come toppe del
// primo (righe 148–242 di costruisci.mjs del pianificatore di Scrittoio 2).
import { createHash } from "node:crypto";
export const FONTS = [
  "hanken-grotesk-latin-wght-normal", "hanken-grotesk-latin-wght-italic",
  "newsreader-latin-opsz-normal", "newsreader-latin-opsz-italic",
  "ibm-plex-mono-latin-400-normal", "ibm-plex-mono-latin-400-italic",
  "ibm-plex-mono-latin-500-normal", "ibm-plex-mono-latin-600-normal",
  "inter-latin-wght-normal",
];
const tienFont = new Set(FONTS);
export const pulisciCss = (css) =>
  css.replace(/@font-face\s*{[^}]*}/g, (rule) => {
    const m = /\/fonts\/([\w-]+)\.woff2/.exec(rule);
    return m && !tienFont.has(m[1]) ? "" : rule;
  });
export const pulisciBody = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, (m) => (m.includes("\n") ? "><" : m));

function diff(a, b) {
  const ops = [];
  const rec = (a0, a1, b0, b1) => {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) (a0 += 1), (b0 += 1);
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) (a1 -= 1), (b1 -= 1);
    if (a0 === a1 && b0 === b1) return;
    if (a0 === a1 || b0 === b1) return void ops.push([a0, a1 - a0, b0, b1 - b0]);
    const ca = new Map();
    const cb = new Map();
    for (let i = a0; i < a1; i += 1) ca.set(a[i], ca.has(a[i]) ? -1 : i);
    for (let i = b0; i < b1; i += 1) cb.set(b[i], cb.has(b[i]) ? -1 : i);
    const pairs = [];
    for (const [t, i] of ca) {
      const j = cb.get(t);
      if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
    }
    if (!pairs.length) return void ops.push([a0, a1 - a0, b0, b1 - b0]);
    pairs.sort((x, y) => x[0] - y[0]);
    const tails = [];
    const prev = new Array(pairs.length);
    for (let k = 0; k < pairs.length; k += 1) {
      const j = pairs[k][1];
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (pairs[tails[m]][1] < j) lo = m + 1;
        else hi = m;
      }
      prev[k] = lo > 0 ? tails[lo - 1] : -1;
      tails[lo] = k;
    }
    const chain = [];
    for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) chain.push(pairs[k]);
    chain.reverse();
    let pa = a0;
    let pb = b0;
    for (const [i, j] of chain) {
      rec(pa, i, pb, j);
      pa = i + 1;
      pb = j + 1;
    }
    rec(pa, a1, pb, b1);
  };
  rec(0, a.length, 0, b.length);
  return ops;
}
const tok = (s, kind) => s.split(kind === "h" ? /(?<=>)/ : /(?<=})/);
export const applica = (base, kind, patch) => {
  const a = tok(base, kind);
  let outS = "";
  let pos = 0;
  for (const [s, n, ins] of patch) {
    outS += a.slice(pos, s).join("") + ins;
    pos = s + n;
  }
  return outS + a.slice(pos).join("");
};

export const texts = [];
const byHash = new Map();
const pieni = []; // indici dei testi pieni, per tipo e etichetta
export function metti(text, kind, label) {
  const h = createHash("sha1").update(text).digest("hex");
  if (byHash.has(h)) return byHash.get(h);
  let best = null;
  for (const p of pieni) {
    if (p.kind !== kind || p.label !== label) continue;
    const a = tok(p.text, kind);
    const b = tok(text, kind);
    const ops = diff(a, b);
    const patch = ops.map(([s, n, bs, bn]) => [s, n, b.slice(bs, bs + bn).join("")]);
    const size = JSON.stringify(patch).length;
    if (size < text.length * 0.4 && (!best || size < best.size)) best = { base: p.idx, patch, size };
  }
  const idx = texts.length;
  if (best) {
    if (applica(texts[best.base], kind, best.patch) !== text) throw new Error("toppa sbagliata");
    texts.push({ b: best.base, k: kind, p: best.patch });
  } else {
    texts.push(text);
    pieni.push({ idx, kind, label, text });
  }
  byHash.set(h, idx);
  return idx;
}
// per le toppe serve il testo pieno della base
export const testoDi = (i) => (typeof texts[i] === "string" ? texts[i] : applica(testoDi(texts[i].b), texts[i].k, texts[i].p));
