// **Il confronto delle animazioni col prototipo**: la parte pura del banco
// delle animazioni (`animazioni.mjs`), che gira anche in Vitest
// (`confronto-animazioni.test.ts`).
//
// Le letture arrivano da `campiona.mjs`, uguali dai due lati. Qui si decide se
// il moto dell'app è quello del prototipo.
//
// # Che cosa si confronta
//
// Per ogni elemento di una voce, e per ogni suo canale (`geometria`,
// `opacity`, un colore):
//
// - **i campioni**, la cosa che conta di più: il progresso del canale (0 alla
//   nascita del moto, 1 a riposo) ai punti 0, 25, 50, 75 e 100 % della corsa
//   del prototipo. Il progresso, e non il valore, perché i due lati possono
//   partire da posti diversi (un blocco lasciato dove capita) e dipingere con
//   tavolozze diverse (i token, che si confrontano a parte);
// - **gli estremi**: da dove parte il moto (lo scarto della geometria dalla
//   posa di riposo, l'opacità alla nascita) e i colori a riposo prima e dopo il
//   gesto, coi token tradotti come in `verifica.mjs` (`confrontaPezzo`);
// - **la corsa**: ritardo, durata, curva, per ogni canale che i due lati
//   animano sullo stesso elemento. Il ritardo dice anche lo scaglionamento fra
//   fratelli. Una molla dell'app (una curva `linear(…)`, la molla campionata
//   del moto) non ha durata né curva da confrontare con una `cubic-bezier`:
//   lì decidono i campioni.
//
// # La soglia dei campioni
//
// Il progresso dell'app al tempo `t` deve stare fra il minimo e il massimo del
// prototipo da `t − 1 fotogramma` a `t + 1 fotogramma` (16,7 ms), allargati di
// `PROGRESSO` (0,02 della corsa) o della tolleranza assoluta del canale divisa
// per la corsa, se è più larga (mezzo pixel su una corsa di cinque è 0,1).
// Perché: un fotogramma di scarto nel tempo non si vede a 60 Hz, e la finestra
// assorbe la latenza di un fotogramma fra il gesto e la nascita del moto; 0,02
// della corsa è sotto il mezzo pixel di quasi ogni movimento dell'editor e sotto
// i due punti di canale di un colore che passa da un velo al pieno. Così una
// molla e una `cubic-bezier` valgono uguali se si muovono uguali, e una corsa
// più corta di un fotogramma su 120 ms (il 14 %) è già rossa a metà.
import { TOLLERANZA, colore, confrontaPezzo, lunghezza } from "./confronto.mjs";

/// Quanto può scostarsi il progresso, oltre la finestra di un fotogramma.
export const PROGRESSO = 0.02;

/// Quanto possono scostarsi ritardo e durata (ms), e i quattro numeri di una
/// `cubic-bezier`.
export const TEMPO = 1;
export const CURVA = 0.005;

/// Le proprietà che una voce può nominare: `geometria` (il riquadro
/// dell'elemento, trasformazioni comprese), `opacity`, i colori.
export function proprietaAmmessa(p) {
  return p === "geometria" || p === "opacity" || /(^|-)color$/.test(p);
}

/// Il canale animato che una proprietà di una corsa muove.
export function canaleDi(proprieta) {
  if (/^(transform|translate|scale|rotate|left|top|right|bottom|width|height|inset)$/.test(proprieta)) return "geometria";
  if (proprieta === "background") return "background-color";
  return proprieta;
}

const GEOMETRIA = ["x", "y", "larghezza", "altezza"];

/// I canali numerici di una lettura: la geometria in quattro (`geometria.x`…),
/// un colore come vettore RGBA premoltiplicato (l'alfa su 255, come i canali),
/// un numero.
export function canali(lettura, proprieta) {
  const out = {};
  if (!lettura) return out;
  for (const p of proprieta) {
    if (p === "geometria") {
      if (!lettura.rect) continue;
      GEOMETRIA.forEach((g, i) => {
        out[`geometria.${g}`] = [lettura.rect[i]];
      });
    } else if (/(^|-)color$/.test(p)) {
      // Premoltiplicato, come lo interpola CSS: un fondo che nasce dal
      // trasparente non salta al suo colore al primo fotogramma.
      const c = colore(lettura.valori[p]);
      if (c) out[p] = [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3] * 255];
    } else {
      const v = lettura.valori[p];
      const n = lunghezza(v) ?? Number(v);
      if (Number.isFinite(n)) out[p] = [n];
    }
  }
  return out;
}

/// La tolleranza assoluta di un canale, nella sua unità.
export function tolleranzaCanale(canale) {
  if (canale.startsWith("geometria.")) return TOLLERANZA.lunghezza;
  if (/(^|-)color$/.test(canale)) return TOLLERANZA.canale;
  if (canale === "opacity") return TOLLERANZA.alfa;
  return TOLLERANZA.numero;
}

const meno = (a, b) => a.map((x, i) => x - b[i]);
const punto = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norma = (a) => Math.sqrt(punto(a, a));

/// Il progresso di `v` sulla corsa da `v0` a `v1`: la sua proiezione, 0 alla
/// partenza e 1 all'arrivo; può uscire da [0, 1] (una molla che oltrepassa).
export function progresso(v, v0, v1) {
  const d = meno(v1, v0);
  const l2 = punto(d, d);
  return l2 === 0 ? 0 : punto(meno(v, v0), d) / l2;
}

/// La lettura più vicina a `t` fra i campioni di un lato.
export function campioneA(campioni, t) {
  let migliore = null;
  for (const c of campioni) {
    if (!migliore || Math.abs(c.t - t) < Math.abs(migliore.t - t)) migliore = c;
  }
  return migliore;
}

const CURVE = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/// Una curva per il confronto: `{ bezier: [a, b, c, d] }`, `{ molla: true }`
/// per una `linear(…)` a punti (la molla campionata del moto), altrimenti
/// `{ testo }` (`steps(…)`), che si confronta com'è scritto.
export function curva(testo) {
  const t = String(testo).trim();
  if (t in CURVE) return { bezier: CURVE[t] };
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(t);
  if (m) return { bezier: m[1].split(",").map(Number) };
  if (t.startsWith("linear(")) return { molla: true };
  return { testo: t };
}

/// Due curve uguali entro `CURVA`; `null` se lo sono, altrimenti il motivo.
export function confrontaCurve(a, b) {
  const ca = curva(a);
  const cb = curva(b);
  if (ca.molla || cb.molla) return null;
  if (ca.bezier && cb.bezier) {
    return ca.bezier.every((x, i) => Math.abs(x - cb.bezier[i]) <= CURVA) ? null : `${a} ≠ ${b}`;
  }
  return a === b ? null : `${a} ≠ ${b}`;
}

/// Per ogni canale nominato dall'elemento, la corsa che lo muove più a lungo.
export function corsePerCanale(lista, proprieta) {
  const out = {};
  for (const c of lista ?? []) {
    const fine = c.ritardo + c.durata * (c.iterazioni === "infinite" ? 1 : c.iterazioni);
    for (const p of c.proprieta) {
      const k = canaleDi(p);
      if (!proprieta.includes(k)) continue;
      const prima = out[k];
      if (!prima || fine > prima.ritardo + prima.durata) out[k] = c;
    }
  }
  return out;
}

const tondo = (x, cifre = 3) => Math.round(x * 10 ** cifre) / 10 ** cifre;

/// I campioni di un elemento: per ogni canale che nel prototipo si muove, il
/// progresso dell'app ai punti della corsa del prototipo, contro la finestra di
/// un fotogramma. Restituisce le differenze (una per canale, col punto peggiore)
/// e le righe del referto.
export function confrontaCampioni({ elemento, finestra, proto, app, fotogramma }) {
  const differenze = [];
  const righe = [];
  const primo = (campioni) => canali(campioni[0]?.letture[elemento.id], elemento.proprieta);
  const ultimo = (campioni) => canali(campioni.at(-1)?.letture[elemento.id], elemento.proprieta);
  const p0 = primo(proto);
  const p1 = ultimo(proto);
  const a0 = primo(app);
  const a1 = ultimo(app);
  for (const canale of Object.keys(p0)) {
    if (!p1[canale]) continue;
    const corsa = norma(meno(p1[canale], p0[canale]));
    const assoluta = tolleranzaCanale(canale);
    if (corsa <= assoluta) continue;
    const tolleranza = Math.max(PROGRESSO, assoluta / corsa);
    const muoveApp = a0[canale] && a1[canale] && norma(meno(a1[canale], a0[canale])) > assoluta;
    let peggiore = null;
    for (const [i, t] of finestra.entries()) {
      const intorno = [t - fotogramma, t, t + fotogramma].map((x) => {
        const c = canali(campioneA(proto, x)?.letture[elemento.id], elemento.proprieta)[canale];
        return c ? progresso(c, p0[canale], p1[canale]) : null;
      }).filter((x) => x !== null);
      const min = Math.min(...intorno) - tolleranza;
      const max = Math.max(...intorno) + tolleranza;
      const v = canali(campioneA(app, t)?.letture[elemento.id], elemento.proprieta)[canale];
      const pa = muoveApp && v ? progresso(v, a0[canale], a1[canale]) : null;
      const fuori = pa === null ? Infinity : pa < min ? min - pa : pa > max ? pa - max : 0;
      righe.push({ canale, punto: i / (finestra.length - 1), t: tondo(t, 1), prototipo: [tondo(min + tolleranza), tondo(max - tolleranza)], app: pa === null ? null : tondo(pa) });
      if (fuori > 0 && (!peggiore || fuori > peggiore.fuori)) peggiore = { fuori, i, t, min, max, pa };
    }
    if (!muoveApp) {
      differenze.push({ proprieta: `campioni.${canale}`, atteso: `si muove di ${tondo(corsa, 2)}`, trovato: "fermo", motivo: "nell'app questo canale non si muove" });
    } else if (peggiore) {
      const k = Math.round((peggiore.i / (finestra.length - 1)) * 100);
      differenze.push({
        proprieta: `campioni.${canale}`,
        atteso: `${tondo(peggiore.min + tolleranza)}–${tondo(peggiore.max - tolleranza)}`,
        trovato: String(tondo(peggiore.pa)),
        motivo: `progresso al ${k} % (t = ${tondo(peggiore.t, 1)} ms), tolleranza ±${tondo(tolleranza)} oltre un fotogramma`,
      });
    }
  }
  return { differenze, righe };
}

/// Da dove parte il moto, coi numeri che non dipendono dalla tavolozza: lo
/// scarto della geometria dalla posa d'arrivo (in px; larghezza e altezza come
/// rapporto) e l'opacità alla nascita. Un elemento in `corsa` (la sua partenza
/// dipende dal gesto, un blocco lasciato dove capita) non confronta lo scarto.
export function confrontaPartenza({ elemento, proto, app }) {
  const differenze = [];
  const partenza = (campioni) => {
    const c0 = canali(campioni[0]?.letture[elemento.id], elemento.proprieta);
    const c1 = canali(campioni.at(-1)?.letture[elemento.id], elemento.proprieta);
    const out = {};
    for (const [k, v] of Object.entries(c0)) {
      if (!c1[k]) continue;
      if (k === "geometria.x" || k === "geometria.y") out[k] = { valore: v[0] - c1[k][0], tolleranza: TOLLERANZA.lunghezza };
      else if (k === "geometria.larghezza" || k === "geometria.altezza") {
        out[k] = { valore: c1[k][0] ? v[0] / c1[k][0] : 1, tolleranza: Math.max(0.005, TOLLERANZA.lunghezza / (c1[k][0] || 1)) };
      } else if (k === "opacity") out[k] = { valore: v[0], tolleranza: TOLLERANZA.alfa };
    }
    return out;
  };
  const p = partenza(proto);
  const a = partenza(app);
  for (const [k, atteso] of Object.entries(p)) {
    if (elemento.corsa && k.startsWith("geometria.")) continue;
    const trovato = a[k];
    if (!trovato) continue;
    if (Math.abs(atteso.valore - trovato.valore) > atteso.tolleranza) {
      differenze.push({ proprieta: `da.${k}`, atteso: String(tondo(atteso.valore)), trovato: String(tondo(trovato.valore)), motivo: "parte da un altro punto" });
    }
  }
  return differenze;
}

/// Ritardo, durata e curva dei canali che i due lati animano sullo stesso
/// elemento. Un canale animato da un lato solo non è rosso qui: può muoverlo
/// un antenato (lo dicono i campioni); finisce fra le note del referto.
///
/// I campioni contano più del modo: durata e curva diverse sono rosse solo se
/// anche i campioni di quel canale lo sono (`campioniRossi`, i canali coi
/// campioni fuori soglia), e allora dicono il perché; con i campioni dentro
/// sono un altro modo di fare la stessa corsa e finiscono fra le note. Il
/// ritardo resta stretto sempre: è lo scaglionamento, e un passo di 15 ms
/// starebbe dentro la finestra di un fotogramma dei campioni.
export function confrontaCorse({ elemento, proto, app, campioniRossi = null }) {
  const differenze = [];
  const note = [];
  const p = corsePerCanale(proto, elemento.proprieta);
  const a = corsePerCanale(app, elemento.proprieta);
  for (const canale of new Set([...Object.keys(p), ...Object.keys(a)])) {
    const cp = p[canale];
    const ca = a[canale];
    if (!cp || !ca) {
      note.push(`${canale}: corsa ${cp ? "solo nel prototipo" : "solo nell'app"} su questo elemento`);
      continue;
    }
    if (Math.abs(cp.ritardo - ca.ritardo) > TEMPO) {
      differenze.push({ proprieta: `ritardo.${canale}`, atteso: `${tondo(cp.ritardo, 1)} ms`, trovato: `${tondo(ca.ritardo, 1)} ms`, motivo: "parte a un altro ritardo" });
    }
    const molla = curva(cp.curva).molla || curva(ca.curva).molla;
    if (molla) {
      note.push(`${canale}: una molla (${curva(cp.curva).molla ? "prototipo" : "app"}), durata e curva le dicono i campioni`);
      continue;
    }
    const pesa = !campioniRossi || campioniRossi.has(canale);
    const segna = (d) => {
      if (pesa) differenze.push(d);
      else note.push(`${canale}: ${d.proprieta.split(".")[0]} ${d.atteso} nel prototipo, ${d.trovato} nell'app, ma i campioni coincidono`);
    };
    if (Math.abs(cp.durata - ca.durata) > TEMPO) {
      segna({ proprieta: `durata.${canale}`, atteso: `${tondo(cp.durata, 1)} ms`, trovato: `${tondo(ca.durata, 1)} ms`, motivo: "dura un altro tempo" });
    }
    const m = confrontaCurve(cp.curva, ca.curva);
    if (m) segna({ proprieta: `curva.${canale}`, atteso: cp.curva, trovato: ca.curva, motivo: "un'altra curva" });
  }
  return { differenze, note };
}

/// Col moto ridotto: i canali che hanno ancora una corsa (di durata non nulla)
/// devono essere gli stessi dai due lati, di solito nessuno.
export function confrontaRidotto({ elemento, proto, app }) {
  const vivi = (lista) =>
    Object.keys(corsePerCanale((lista ?? []).filter((c) => c.durata > 0), elemento.proprieta)).sort();
  const p = vivi(proto);
  const a = vivi(app);
  if (p.join() === a.join()) return [];
  return [{ proprieta: "ridotto.corse", atteso: p.join(", ") || "nessuna corsa", trovato: a.join(", ") || "nessuna corsa", motivo: "col moto ridotto le corse non sono le stesse" }];
}

/// Le proprietà di un elemento lette a riposo (prima e dopo il gesto), con le
/// regole e i token di `verifica.mjs`: la geometria resta fuori, la dicono i
/// campioni.
export function proprietaARiposo(elemento) {
  return elemento.proprieta.filter((p) => p !== "geometria");
}

/// Confronta una lettura a riposo (`prima` o `dopo`) con `confrontaPezzo`; le
/// differenze escono con la proprietà preceduta da `da.` o `a.`.
export function confrontaRiposo({ elemento, idPezzo, stato, quando, atteso, trovato }) {
  const pezzo = { id: idPezzo, prototipo: elemento.prototipo, app: elemento.app, proprieta: proprietaARiposo(elemento) };
  if (pezzo.proprieta.length === 0) return { differenze: [], mancanti: [] };
  const esito = confrontaPezzo(pezzo, stato, atteso, trovato);
  return {
    mancanti: esito.mancanti,
    differenze: esito.differenze.map((d) => ({ ...d, proprieta: `${quando}.${d.proprieta}` })),
  };
}

/// Gli id dei pezzi delle animazioni (`<voce>.<elemento>`): quelli che le
/// eccezioni nominano.
export function pezziAnimazioni(voci) {
  return voci.flatMap((v) => v.elementi.map((e) => ({ id: `${v.id}.${e.id}` })));
}

/// Controlla la forma delle voci: id unici, selettori dei due lati, proprietà
/// ammesse, gesti.
export function validaVoci(voci, stati) {
  const errori = [];
  const ids = new Set();
  for (const v of voci) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(v.id ?? "")) errori.push(`voce «${v.id}»: l'id è fatto di parole minuscole e punti`);
    if (ids.has(v.id)) errori.push(`voce «${v.id}»: id ripetuto`);
    ids.add(v.id);
    for (const s of v.stati ?? []) if (!stati[s]) errori.push(`voce «${v.id}»: lo stato «${s}» non è in STATI`);
    for (const lato of ["prototipo", "app"]) {
      if (typeof v[lato]?.gesto !== "function") errori.push(`voce «${v.id}»: manca ${lato}.gesto`);
    }
    if (typeof v.app?.scena !== "string") errori.push(`voce «${v.id}»: manca app.scena`);
    if (!Array.isArray(v.elementi) || v.elementi.length === 0) errori.push(`voce «${v.id}»: nessun elemento`);
    const elementi = new Set();
    for (const e of v.elementi ?? []) {
      if (elementi.has(e.id)) errori.push(`voce «${v.id}»: elemento «${e.id}» ripetuto`);
      elementi.add(e.id);
      if (!e.prototipo || !e.app) errori.push(`${v.id}.${e.id}: manca un selettore`);
      for (const lato of ["prototipo", "app"]) {
        const s = e[lato];
        if (!s || typeof s === "string") continue;
        if (typeof s.css !== "string" || typeof s.testo !== "string" || !s.testo) {
          errori.push(`${v.id}.${e.id}: il selettore ${lato} per testo è { css, testo }`);
        }
        // La lettura a riposo (`leggi.mjs`) conosce solo i selettori CSS.
        if ((e.proprieta ?? []).some((p) => p !== "geometria")) {
          errori.push(`${v.id}.${e.id}: un selettore per testo vale solo per la geometria`);
        }
      }
      for (const p of e.proprieta ?? []) {
        if (!proprietaAmmessa(p)) errori.push(`${v.id}.${e.id}: la proprietà «${p}» non si campiona (geometria, opacity o un colore)`);
      }
      if (!e.proprieta?.length) errori.push(`${v.id}.${e.id}: nessuna proprietà`);
    }
  }
  return errori;
}

/// Lo stato di una differenza delle animazioni: `<stato>/<moto>`, come lo
/// scrivono le eccezioni (`chiaro-1280/pieno`).
export function statoMoto(stato, moto) {
  return `${stato}/${moto}`;
}

/// Gli aspetti di una differenza delle animazioni: la prima parte della sua
/// proprietà (`campioni.opacity`, `durata.geometria`, `a.background-color`).
export const ASPETTI = ["campioni", "da", "a", "ritardo", "durata", "curva", "ridotto", "prima"];

/// `DA_COPRIRE_ANIMAZIONI` come `DA_COPRIRE` della mappa: una differenza vera,
/// trovata e non ancora corretta, che non fa rosso finché c'è; se non
/// differisce più è rossa lo stesso, così chi la corregge la toglie. Ogni voce
/// è `{ id: "<voce>.<elemento>", proprieta: ["durata.opacity", …], stati?,
/// perche }`; ne escono voci della forma di un'eccezione, con `daCoprire`.
export function copertureAnimazioni(daCoprire, voci) {
  const errori = [];
  const out = [];
  const pezzi = new Map(voci.flatMap((v) => v.elementi.map((e) => [`${v.id}.${e.id}`, e])));
  for (const d of daCoprire) {
    const elemento = pezzi.get(d.id);
    if (!elemento) {
      errori.push(`${d.id}: non è un elemento di una voce`);
      continue;
    }
    if (typeof d.perche !== "string" || d.perche.trim() === "") errori.push(`${d.id}: una voce da coprire dice perché`);
    if (d.stati !== undefined && !Array.isArray(d.stati)) errori.push(`${d.id}: «stati» è un elenco`);
    if (!d.proprieta?.length) errori.push(`${d.id}: nessuna proprietà da coprire`);
    for (const p of d.proprieta ?? []) {
      const [aspetto, ...resto] = p.split(".");
      const canale = resto.join(".");
      const proprieta = canale.startsWith("geometria") ? "geometria" : canale;
      if (!ASPETTI.includes(aspetto) || (canale && !["ridotto", "prima"].includes(aspetto) && !elemento.proprieta.includes(proprieta))) {
        errori.push(`${d.id}: «${p}» non è una differenza che l'elemento può avere`);
        continue;
      }
      out.push({ pezzo: d.id, proprieta: p, ...(d.stati ? { stati: d.stati } : {}), motivo: d.perche, riferimento: "DA_COPRIRE_ANIMAZIONI", daCoprire: true });
    }
  }
  return { errori, voci: out };
}

/// Un selettore di una voce da scrivere nel referto: il CSS, o il CSS col
/// testo che la riga deve contenere.
export function scriviSelettore(s) {
  return typeof s === "string" ? s : `${s.css} «${s.testo}»`;
}
