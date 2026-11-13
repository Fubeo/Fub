// La forma simbolica di Marcuzzo: un colore solo, senza tratti, un path pieno
// con la regola pari-dispari. Si costruisce dalla forma minima a 24 px (fatta
// da logo-minima.py sul disegno dell'utente): le facce e l'iride diventano
// buchi, la pupilla, l'occhiolino e il becco restano pieni; un filo vuoto
// dentro la cartella davanti la stacca dalla pancia e dal retro; il retro e i
// fogli fanno sagoma col gufo. Si disegna la maschera in una tela, se ne segue
// il bordo a gradini (pixel per pixel) e lo si semplifica con Douglas-Peucker.
//
// node logo-simbolico.mjs <marcuzzo-24.svg> <uscita.svg> [filo=45] [tolleranza=1.2] [minimo=60] [limite=0]
// I valori di partenza sono quelli di logo/marcuzzo-simbolico.svg.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "./client.mjs";

const [src, out, filoArg = "45", tolArg = "1.2", minArg = "60", limArg = "0"] = process.argv.slice(2);
// 0: il filo corre lungo tutto il bordo della cartella davanti; altrimenti solo
// entro LIMITE × filo da quello che le sta fuori ma dentro la sagoma.
const LIMITE = Number(limArg);
// Gli anelli con meno lati di pixel di così sono briciole e si scartano.
const MINIMO = Number(minArg);
const FILO = Number(filoArg);
const TOL = Number(tolArg);
const t = readFileSync(src, "utf8");
const vb = /viewBox="([^"]*)"/.exec(t)[1].split(/\s+/).map(Number);
const paths = [...t.matchAll(/<path class="([^"]*)" fill="[^"]*"(?: stroke="[^"]*" stroke-width="(\d+)" stroke-linejoin="round")? d="([^"]*)"\/>/g)].map((m) => ({
  cls: m[1],
  sw: m[2] ? Number(m[2]) : 0,
  d: m[3],
}));
const RUOLO = {
  "logo-piumaggio": "pieno",
  "logo-pancia": "pieno",
  "logo-ali": "pieno",
  "logo-becco": "pieno",
  "logo-pupille": "pieno",
  "logo-zampe": "pieno",
  "logo-cartella": "staccato",
  "logo-cartella-retro": "pieno",
  "logo-foglio-1": "pieno",
  "logo-foglio-2": "pieno",
  "logo-bianco": "buco",
  "logo-occhi": "buco",
};
for (const p of paths) if (!RUOLO[p.cls]) throw new Error(`classe senza ruolo: ${p.cls}`);

const N = vb[2]; // un'unità del riquadro = un pixel
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 200, height: 200 } });
const contorni = await page.evaluate(
  ({ paths, RUOLO, vb, N, FILO, LIMITE }) => {
    const tela = () => {
      const c = document.createElement("canvas");
      c.width = N;
      c.height = N;
      const g = c.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, N, N);
      g.translate(-vb[0], -vb[1]);
      g.lineJoin = "round";
      g.lineCap = "butt";
      return g;
    };
    const riempi = (g, p, colore) => {
      const path = new Path2D(p.d);
      g.fillStyle = colore;
      g.fill(path);
      if (p.sw) {
        g.strokeStyle = colore;
        g.lineWidth = p.sw;
        g.stroke(path);
      }
    };
    const bianco = (g) => {
      const d = g.getImageData(0, 0, N, N).data;
      const m = new Uint8Array(N * N);
      for (let k = 0; k < N * N; k++) m[k] = d[k * 4] >= 128 ? 1 : 0;
      return m;
    };
    // 1. Il disegno pieno, in ordine: i buchi tolgono, il resto mette.
    const g = tela();
    for (const p of paths) riempi(g, p, RUOLO[p.cls] === "buco" ? "#000" : "#fff");
    const pienoM = bianco(g);
    // 2. Il filo dentro la cartella davanti, lungo i suoi bordi, coperto da
    //    quello che si disegna dopo di lei (le ali stanno davanti).
    // 3. Quello che sta fuori della cartella davanti ma dentro la sagoma: il
    //    filo resta solo dove la cartella confina con il gufo o col retro,
    //    non dove confina col vuoto (lì stringerebbe la sagoma e basta).
    const filo = new Uint8Array(N * N);
    const k0 = paths.findIndex((p) => RUOLO[p.cls] === "staccato");
    if (FILO > 0 && k0 >= 0) {
      const davanti = new Path2D(paths[k0].d);
      const gf = tela();
      gf.save();
      gf.clip(davanti);
      gf.strokeStyle = "#fff";
      gf.lineWidth = 2 * FILO;
      gf.stroke(davanti);
      gf.restore();
      for (const p of paths.slice(k0 + 1)) riempi(gf, p, "#000");
      const fm = bianco(gf);
      const gr = tela();
      for (const p of paths) riempi(gr, p, "#fff");
      gr.fillStyle = "#000";
      gr.fill(davanti);
      const rm = bianco(gr);
      // Distanza (smussata 3-4) da ogni pixel al più vicino pixel di «fuori».
      const INF = 1e9;
      const dist = new Float64Array(N * N);
      for (let k = 0; k < N * N; k++) dist[k] = rm[k] ? 0 : INF;
      const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? INF : dist[y * N + x]);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const k = y * N + x;
          dist[k] = Math.min(dist[k], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
        }
      for (let y = N - 1; y >= 0; y--)
        for (let x = N - 1; x >= 0; x--) {
          const k = y * N + x;
          dist[k] = Math.min(dist[k], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
        }
      for (let k = 0; k < N * N; k++) if (fm[k] && (!LIMITE || dist[k] / 3 <= LIMITE * FILO)) filo[k] = 1;
    }
    const pieno = (x, y) => x >= 0 && y >= 0 && x < N && y < N && pienoM[y * N + x] === 1 && filo[y * N + x] === 0;
    // I lati fra un pixel pieno e uno vuoto, orientati col pieno a destra.
    const uscite = new Map();
    const chiave = (x, y) => y * (N + 1) + x;
    const aggiungi = (x0, y0, x1, y1) => {
      const k = chiave(x0, y0);
      if (!uscite.has(k)) uscite.set(k, []);
      uscite.get(k).push([x1, y1]);
    };
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (!pieno(x, y)) continue;
        if (!pieno(x, y - 1)) aggiungi(x, y, x + 1, y);
        if (!pieno(x + 1, y)) aggiungi(x + 1, y, x + 1, y + 1);
        if (!pieno(x, y + 1)) aggiungi(x + 1, y + 1, x, y + 1);
        if (!pieno(x - 1, y)) aggiungi(x, y + 1, x, y);
      }
    const anelli = [];
    for (const [k0, lista] of uscite) {
      while (lista.length) {
        const x0 = k0 % (N + 1);
        const y0 = Math.floor(k0 / (N + 1));
        const anello = [[x0, y0]];
        let [x, y] = lista.pop();
        let dx = x - x0;
        let dy = y - y0;
        while (!(x === x0 && y === y0)) {
          anello.push([x, y]);
          const l = uscite.get(chiave(x, y));
          // Al punto di sella si gira sempre dallo stesso lato: i pixel pieni
          // che si toccano solo d'angolo restano separati.
          let scelta = 0;
          if (l.length > 1) {
            const destra = [-dy, dx];
            scelta = l.findIndex(([nx, ny]) => nx - x === destra[0] && ny - y === destra[1]);
            if (scelta < 0) scelta = 0;
          }
          const [nx, ny] = l.splice(scelta, 1)[0];
          dx = nx - x;
          dy = ny - y;
          x = nx;
          y = ny;
        }
        anelli.push(anello);
      }
    }
    return anelli;
  },
  { paths, RUOLO, vb, N, FILO, LIMITE },
);
await b.close();

// Douglas-Peucker su un anello chiuso: si spezza nei due punti più lontani.
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const dist = (p, a, b) => {
    const [x, y] = p;
    const [x1, y1] = a;
    const [x2, y2] = b;
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L === 0) return Math.hypot(x - x1, y - y1);
    return Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / L;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let m = -1;
    let md = 0;
    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > md) {
        md = d;
        m = k;
      }
    }
    if (md > tol) {
      keep[m] = 1;
      stack.push([i, m], [m, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
function anelloDp(anello, tol) {
  let far = 0;
  let fd = 0;
  for (let k = 1; k < anello.length; k++) {
    const d = Math.hypot(anello[k][0] - anello[0][0], anello[k][1] - anello[0][1]);
    if (d > fd) {
      fd = d;
      far = k;
    }
  }
  const a = dp(anello.slice(0, far + 1), tol);
  const c = dp([...anello.slice(far), anello[0]], tol);
  return [...a.slice(0, -1), ...c.slice(0, -1)];
}
// I punti a metà dei gradini seguono meglio il bordo vero dei pixel a gradini.
function mezzi(anello) {
  return anello.map((p, k) => {
    const q = anello[(k + 1) % anello.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  });
}

const piccoli = contorni.filter((a) => a.length < MINIMO).map((a) => a.length);
const anelli = contorni.filter((a) => a.length >= MINIMO).map((a) => anelloDp(mezzi(a), TOL));
const scatola = (a) => {
  const xs = a.map((p) => p[0] + vb[0]);
  const ys = a.map((p) => p[1] + vb[1]);
  return `${a.length}@${Math.min(...xs)},${Math.min(...ys)}-${Math.max(...xs)},${Math.max(...ys)}`;
};
console.log("anelli tenuti:", contorni.filter((a) => a.length >= MINIMO).map(scatola).join(" "));
const fmt = (v) => String(Math.round(v));
const d = anelli
  .map((a) => "M" + a.map(([x, y], k) => (k === 1 ? "L" : k ? " " : "") + fmt(x + vb[0]) + " " + fmt(y + vb[1])).join("") + "Z")
  .join("");
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}">\n  <title>Marcuzzo</title>\n` +
  `  <path fill="#000" fill-rule="evenodd" d="${d}"/>\n</svg>\n`;
writeFileSync(out, svg);
console.log(out, svg.length, "byte,", anelli.length, "anelli,", anelli.reduce((s, a) => s + a.length, 0), "punti, scartate", piccoli.length, "briciole");
