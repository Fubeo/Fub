// **Il comparatore della conformità al prototipo**: la parte pura del
// controllo, quella che decide se due stili calcolati sono «lo stesso».
//
// Il controllo legge `getComputedStyle` sugli elementi del prototipo
// (`estrai.mjs`, una volta, fuori dalla CI) e sugli elementi corrispondenti
// dell'app nel banco (`verifica.mjs`, in CI). Qui non c'è un browser: ci sono
// le regole di confronto, e per questo le prova `confronto.test.ts`.
//
// # Le tolleranze, e perché queste
//
// - **Lunghezze: 0,5 px.** I due lati sono letti dallo stesso Chromium, ma da
//   formule diverse (`min(740px, 100%)` contro `740px`, un token in `rem`
//   contro un valore in px): mezzo pixel assorbe l'arrotondamento del motore e
//   nient'altro. Un passo della scala degli spazi è almeno 2 px.
// - **Colori: ±2 per canale su 0–255, ±0,01 sull'opacità.** I due lati
//   arrivano allo stesso colore da strade diverse: il prototipo scrive
//   esadecimali e `rgba()`, la pelle di Fub scrive `oklch()` e `color-mix()`,
//   che il browser restituisce in spazi diversi (`oklch(…)`, `color(srgb …)`).
//   Qui tutto torna sRGB a virgola mobile, e la differenza che resta è solo
//   d'arrotondamento: una conversione oklch→sRGB e la quantizzazione a 8 bit
//   di un esadecimale stanno sotto 1,5. Due gradini vicini della tavolozza
//   distano almeno 6 per canale, quindi ±2 non confonde mai un token con un
//   altro. Si è scelto il canale e non ΔE OK perché il messaggio d'errore
//   mostra proprio quei numeri, e chi legge vede subito di quanto si sbaglia.
//   Due colori del tutto trasparenti sono uguali qualunque sia la tinta.
// - **Numeri senza unità** (`opacity`, `font-weight`): 0,01.
// - **Ombre e gradienti** si scompongono nelle loro parti, e ogni parte si
//   confronta con la regola del suo tipo.
// - **Caratteri**: conta la famiglia principale, la prima dell'elenco. I
//   ripieghi dipendono dal sistema e non sono una scelta di design.

/// Le tolleranze, dichiarate una volta: le cita il referto.
export const TOLLERANZA = Object.freeze({
  /// px.
  lunghezza: 0.5,
  /// Per canale, su 0–255.
  canale: 2,
  /// Sull'opacità, 0–1.
  alfa: 0.01,
  /// Sui numeri senza unità.
  numero: 0.01,
});

// ── Le proprietà ────────────────────────────────────────────────────────────

const LATI = ["top", "right", "bottom", "left"];
const ANGOLI = ["top-left", "top-right", "bottom-right", "bottom-left"];

/// I gruppi che la mappa può nominare, e le proprietà lunghe in cui si
/// sciolgono. Si leggono sempre le lunghe: `getComputedStyle` delle corte è
/// una stringa composta che cambia forma da un browser all'altro.
export const GRUPPI = Object.freeze({
  padding: LATI.map((l) => `padding-${l}`),
  margin: LATI.map((l) => `margin-${l}`),
  gap: ["row-gap", "column-gap"],
  border: LATI.flatMap((l) => [`border-${l}-width`, `border-${l}-style`, `border-${l}-color`]),
  "border-radius": ANGOLI.map((a) => `border-${a}-radius`),
  background: ["background-color", "background-image"],
  font: ["font-family", "font-size", "font-weight", "line-height", "letter-spacing"],
});

/// Le proprietà di base di un pezzo: quelle che il controllo guarda se la
/// mappa non dice altro. Dimensioni, `display` e allineamenti si aggiungono a
/// mano, dove sono fisse e contano.
export const BASE = Object.freeze([
  "padding",
  "margin",
  "gap",
  "border",
  "border-radius",
  "box-shadow",
  "font",
  "color",
  "background",
  "opacity",
]);

/// Scioglie un elenco di proprietà e gruppi nelle proprietà lunghe, senza
/// doppioni e nell'ordine in cui compaiono.
export function espandi(proprieta) {
  const fuori = [];
  for (const nome of proprieta) {
    for (const lunga of GRUPPI[nome] ?? [nome]) {
      if (!fuori.includes(lunga)) fuori.push(lunga);
    }
  }
  return fuori;
}

/// Il gruppo a cui appartiene una proprietà lunga, o `null`.
export function gruppoDi(lunga) {
  for (const [gruppo, membri] of Object.entries(GRUPPI)) {
    if (membri.includes(lunga)) return gruppo;
  }
  return null;
}

// ── I pezzi di un valore ────────────────────────────────────────────────────

/// Divide una stringa sul separatore `sep` (`,` o spazi) fuori dalle parentesi
/// e dalle virgolette.
export function dividi(testo, sep) {
  const parti = [];
  let profondita = 0;
  let virgolette = null;
  let corrente = "";
  for (const c of testo) {
    if (virgolette) {
      corrente += c;
      if (c === virgolette) virgolette = null;
      continue;
    }
    if (c === '"' || c === "'") {
      virgolette = c;
      corrente += c;
      continue;
    }
    if (c === "(") profondita += 1;
    if (c === ")") profondita -= 1;
    const taglia = profondita === 0 && (sep === " " ? /\s/.test(c) : c === sep);
    if (taglia) {
      if (corrente.trim() !== "") parti.push(corrente.trim());
      corrente = "";
    } else {
      corrente += c;
    }
  }
  if (corrente.trim() !== "") parti.push(corrente.trim());
  return parti;
}

const LUNGHEZZA = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/i;
const PERCENTUALE = /^(-?\d*\.?\d+(?:e-?\d+)?)%$/;
const NUMERO = /^-?\d*\.?\d+(?:e-?\d+)?$/i;

/// Una lunghezza in px, o `null`.
export function lunghezza(token) {
  const m = LUNGHEZZA.exec(token);
  return m ? Number(m[1]) : null;
}

// ── I colori ────────────────────────────────────────────────────────────────

const NOMI = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

/// Un canale scritto come numero o percentuale, riportato a `scala`.
function canale(token, scala) {
  const p = PERCENTUALE.exec(token);
  if (p) return (Number(p[1]) / 100) * scala;
  if (token === "none") return 0;
  return Number(token);
}

/// L'alfa di un colore funzionale, 1 se manca.
function alfa(token) {
  if (token === undefined) return 1;
  const p = PERCENTUALE.exec(token);
  return p ? Number(p[1]) / 100 : Number(token);
}

/// Gli argomenti di una funzione di colore, colore e alfa separati: accetta la
/// sintassi a virgole (`rgba(1, 2, 3, 0.5)`) e quella a spazi (`rgb(1 2 3 / 50%)`).
function argomenti(interno) {
  const [valori, a] = interno.split("/").map((s) => s.trim());
  const parti = valori.includes(",") ? valori.split(",").map((s) => s.trim()) : dividi(valori, " ");
  if (a !== undefined) parti.push(a);
  return parti;
}

const gamma = (x) => {
  const v = Math.abs(x);
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.sign(x) * s * 255;
};

/// Da OKLab a sRGB 0–255 (le formule di Björn Ottosson, quelle dei browser).
function daOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/// Legge un colore CSS come lo restituisce `getComputedStyle` (o come lo
/// scriverebbe una persona) e lo porta a `[r, g, b, a]` in sRGB, canali 0–255 a
/// virgola mobile e alfa 0–1. `null` se non è un colore.
export function colore(testo) {
  const t = String(testo).trim().toLowerCase();
  if (t in NOMI) return [...NOMI[t]];
  const hex = /^#([0-9a-f]{3,8})$/.exec(t);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const f = /^([a-z-]+)\((.*)\)$/.exec(t);
  if (!f) return null;
  const [, nome, interno] = f;
  if (nome === "rgb" || nome === "rgba") {
    const p = argomenti(interno);
    if (p.length < 3) return null;
    return [canale(p[0], 255), canale(p[1], 255), canale(p[2], 255), alfa(p[3])];
  }
  if (nome === "color") {
    const p = argomenti(interno);
    const spazio = p.shift();
    const v = p.slice(0, 3).map((x) => canale(x, 1));
    if (spazio === "srgb") return [v[0] * 255, v[1] * 255, v[2] * 255, alfa(p[3])];
    if (spazio === "srgb-linear") return [gamma(v[0]), gamma(v[1]), gamma(v[2]), alfa(p[3])];
    return null;
  }
  if (nome === "oklab") {
    const p = argomenti(interno);
    const [r, g, b] = daOklab(canale(p[0], 1), canale(p[1], 0.4), canale(p[2], 0.4));
    return [r, g, b, alfa(p[3])];
  }
  if (nome === "oklch") {
    const p = argomenti(interno);
    const L = canale(p[0], 1);
    const C = canale(p[1], 0.4);
    const h = (canale(p[2].replace(/deg$/, ""), 360) * Math.PI) / 180;
    const [r, g, b] = daOklab(L, C * Math.cos(h), C * Math.sin(h));
    return [r, g, b, alfa(p[3])];
  }
  return null;
}

/// Un colore leggibile nel referto: `rgba(r, g, b, a)` con un decimale.
export function scriviColore(c) {
  const r = (x) => Math.round(x * 10) / 10;
  return `rgba(${r(c[0])}, ${r(c[1])}, ${r(c[2])}, ${Math.round(c[3] * 1000) / 1000})`;
}

/// Due colori sono uguali entro la tolleranza; due trasparenti lo sono sempre.
export function coloriUguali(a, b) {
  if (a[3] <= TOLLERANZA.alfa && b[3] <= TOLLERANZA.alfa) return true;
  if (Math.abs(a[3] - b[3]) > TOLLERANZA.alfa) return false;
  return [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= TOLLERANZA.canale);
}

// ── Token, ombre, gradienti, caratteri ──────────────────────────────────────

/// Confronta due token singoli: lunghezze, percentuali, numeri e colori con la
/// loro tolleranza, il resto alla lettera. Restituisce `null` se uguali, o la
/// ragione della differenza.
function confrontaToken(a, b) {
  const la = lunghezza(a);
  const lb = lunghezza(b);
  if (la !== null && lb !== null) {
    return Math.abs(la - lb) <= TOLLERANZA.lunghezza ? null : `${a} ≠ ${b}`;
  }
  const pa = PERCENTUALE.exec(a);
  const pb = PERCENTUALE.exec(b);
  if (pa && pb) return Math.abs(Number(pa[1]) - Number(pb[1])) <= TOLLERANZA.numero ? null : `${a} ≠ ${b}`;
  if (NUMERO.test(a) && NUMERO.test(b)) {
    return Math.abs(Number(a) - Number(b)) <= TOLLERANZA.numero ? null : `${a} ≠ ${b}`;
  }
  const ca = colore(a);
  const cb = colore(b);
  if (ca && cb) return coloriUguali(ca, cb) ? null : `${scriviColore(ca)} ≠ ${scriviColore(cb)}`;
  return a === b ? null : `${a} ≠ ${b}`;
}

/// Divide in token un valore che può contenere colori funzionali: le funzioni
/// di colore restano un token solo.
function token(valore) {
  return dividi(valore, " ");
}

/// Confronta due sequenze di token, uno a uno.
function confrontaSequenze(a, b) {
  const ta = token(a);
  const tb = token(b);
  if (ta.length !== tb.length) return `${ta.length} parti ≠ ${tb.length} parti`;
  for (let i = 0; i < ta.length; i += 1) {
    const d = confrontaToken(ta[i], tb[i]);
    if (d) return d;
  }
  return null;
}

/// Un'ombra calcolata nelle sue parti: `{ inset, x, y, blur, spread, colore }`.
export function ombre(valore) {
  const v = String(valore).trim();
  if (v === "none" || v === "") return [];
  return dividi(v, ",").map((parte) => {
    const pezzi = token(parte);
    let inset = false;
    let col = [0, 0, 0, 1];
    const misure = [];
    for (const p of pezzi) {
      if (p === "inset") inset = true;
      else if (lunghezza(p) !== null || p === "0") misure.push(lunghezza(p) ?? 0);
      else {
        const c = colore(p);
        if (!c) throw new Error(`parte d'ombra non riconosciuta: «${p}» in «${parte}»`);
        col = c;
      }
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = misure;
    return { inset, x, y, blur, spread, colore: col };
  });
}

/// Confronta due `box-shadow` parte per parte.
function confrontaOmbre(a, b) {
  const oa = ombre(a);
  const ob = ombre(b);
  if (oa.length !== ob.length) return `${oa.length} ombre ≠ ${ob.length} ombre`;
  for (let i = 0; i < oa.length; i += 1) {
    const x = oa[i];
    const y = ob[i];
    const n = oa.length > 1 ? `ombra ${i + 1}: ` : "";
    if (x.inset !== y.inset) return `${n}inset ${x.inset} ≠ ${y.inset}`;
    for (const k of ["x", "y", "blur", "spread"]) {
      if (Math.abs(x[k] - y[k]) > TOLLERANZA.lunghezza) return `${n}${k} ${x[k]}px ≠ ${y[k]}px`;
    }
    if (!coloriUguali(x.colore, y.colore)) {
      return `${n}colore ${scriviColore(x.colore)} ≠ ${scriviColore(y.colore)}`;
    }
  }
  return null;
}

/// Un'immagine di fondo nelle sue parti: `{ funzione, argomenti }`, dove ogni
/// argomento è una sequenza di token (colore, posizione, direzione).
export function immagini(valore) {
  const v = String(valore).trim();
  if (v === "none" || v === "") return [];
  return dividi(v, ",").map((parte) => {
    const f = /^([a-z-]+)\((.*)\)$/is.exec(parte);
    if (!f) return { funzione: parte, argomenti: [] };
    return { funzione: f[1].toLowerCase(), argomenti: dividi(f[2], ",") };
  });
}

/// Confronta due `background-image`: stessa funzione, stessi argomenti con le
/// tolleranze dei loro token.
function confrontaImmagini(a, b) {
  const ia = immagini(a);
  const ib = immagini(b);
  if (ia.length !== ib.length) return `${ia.length} immagini ≠ ${ib.length} immagini`;
  for (let i = 0; i < ia.length; i += 1) {
    const x = ia[i];
    const y = ib[i];
    if (x.funzione !== y.funzione) return `${x.funzione} ≠ ${y.funzione}`;
    if (x.argomenti.length !== y.argomenti.length) {
      return `${x.funzione}: ${x.argomenti.length} argomenti ≠ ${y.argomenti.length}`;
    }
    for (let j = 0; j < x.argomenti.length; j += 1) {
      const d = confrontaSequenze(x.argomenti[j], y.argomenti[j]);
      if (d) return `${x.funzione}, argomento ${j + 1}: ${d}`;
    }
  }
  return null;
}

/// La famiglia principale di un `font-family`, senza virgolette e in minuscolo.
///
/// Il taglio variabile di un carattere è lo stesso carattere: Fub distribuisce
/// «Hanken Grotesk Variable» e «Newsreader Variable» (`@fontsource-variable`)
/// dove il prototipo nomina «Hanken Grotesk» e «Newsreader», quindi il
/// suffisso « Variable» non conta.
export function famiglia(valore) {
  const prima = dividi(String(valore), ",")[0] ?? "";
  return prima
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase()
    .replace(/ variable$/, "");
}

const COLORI = /(^|-)color$/;

/// Confronta il valore atteso (dal prototipo) e quello trovato (nell'app) di
/// una proprietà lunga. `null` se coincidono entro le tolleranze, altrimenti
/// una frase breve che dice dove differiscono.
export function confronta(proprieta, atteso, trovato) {
  if (atteso === trovato) return null;
  if (atteso === undefined || atteso === null) return "il prototipo non ha questo valore";
  if (trovato === undefined || trovato === null) return "l'app non ha questo valore";
  if (proprieta === "box-shadow") return confrontaOmbre(atteso, trovato);
  if (proprieta === "background-image") return confrontaImmagini(atteso, trovato);
  if (proprieta === "font-family") {
    const a = famiglia(atteso);
    const b = famiglia(trovato);
    return a === b ? null : `${a} ≠ ${b}`;
  }
  if (COLORI.test(proprieta)) {
    const a = colore(atteso);
    const b = colore(trovato);
    if (a && b) return coloriUguali(a, b) ? null : `${scriviColore(a)} ≠ ${scriviColore(b)}`;
  }
  return confrontaSequenze(atteso, trovato);
}

// ── Le eccezioni ────────────────────────────────────────────────────────────

/// Controlla la forma di un elenco di eccezioni: ognuna ha pezzo, proprietà,
/// motivo e riferimento. Restituisce gli errori, uno per riga.
export function validaEccezioni(eccezioni, pezzi) {
  const errori = [];
  const ids = new Set(pezzi.map((p) => p.id));
  eccezioni.forEach((e, i) => {
    const dove = `eccezione ${i + 1}`;
    for (const campo of ["pezzo", "proprieta", "motivo", "riferimento"]) {
      if (typeof e[campo] !== "string" || e[campo].trim() === "") {
        errori.push(`${dove}: manca «${campo}»`);
      }
    }
    if (typeof e.pezzo === "string" && !ids.has(e.pezzo)) {
      errori.push(`${dove}: il pezzo «${e.pezzo}» non è nella mappa`);
    }
    if (e.stati !== undefined && !Array.isArray(e.stati)) {
      errori.push(`${dove}: «stati» è un elenco`);
    }
  });
  return errori;
}

/// Se un'eccezione copre una differenza: stesso pezzo, la proprietà lunga o il
/// suo gruppo, e lo stato fra i suoi (tutti, se non ne elenca).
export function copre(eccezione, differenza) {
  if (eccezione.pezzo !== differenza.pezzo) return false;
  const proprieta =
    eccezione.proprieta === differenza.proprieta || eccezione.proprieta === gruppoDi(differenza.proprieta);
  if (!proprieta) return false;
  return !eccezione.stati || eccezione.stati.includes(differenza.stato);
}

/// Divide le differenze in giustificate e no, e trova le eccezioni che non
/// coprono più niente: anche quelle sono rosse, così l'elenco non invecchia.
export function applicaEccezioni(differenze, eccezioni) {
  const usate = new Set();
  const rosse = [];
  const giustificate = [];
  for (const d of differenze) {
    const i = eccezioni.findIndex((e) => copre(e, d));
    if (i === -1) rosse.push(d);
    else {
      usate.add(i);
      giustificate.push({ ...d, eccezione: eccezioni[i] });
    }
  }
  const inutili = eccezioni.filter((_, i) => !usate.has(i));
  return { rosse, giustificate, inutili };
}

/// Controlla `DA_COPRIRE` contro i pezzi e ne ricava le coperture: le voci
/// con `proprieta` diventano, una proprietà alla volta, voci della stessa
/// forma di un'eccezione (con `daCoprire: true`), così `applicaEccezioni` le
/// tratta allo stesso modo, anche quando non coprono più niente. `stati`
/// (facoltativo) restringe la voce a quegli stati, come in un'eccezione: una
/// differenza solo di giorno si copre senza fare rosso di notte. Le voci
/// senza `proprieta` sono pezzi interi che non si confrontano.
export function coperture(daCoprire, pezzi) {
  const errori = [];
  const voci = [];
  for (const d of daCoprire) {
    const pezzo = pezzi.find((p) => p.id === d.id);
    if (typeof d.perche !== "string" || d.perche.trim() === "") errori.push(`${d.id}: una voce da coprire dice perché`);
    if (!d.proprieta) {
      if (pezzo) errori.push(`${d.id}: è un pezzo intero da coprire, ma è anche in PEZZI`);
      continue;
    }
    if (!pezzo) {
      errori.push(`${d.id}: ha proprietà da coprire, ma non è in PEZZI`);
      continue;
    }
    if (d.stati !== undefined && (!Array.isArray(d.stati) || d.stati.length === 0)) {
      errori.push(`${d.id}: \`stati\` da coprire è un elenco non vuoto`);
      continue;
    }
    const sue = espandi(pezzo.proprieta);
    for (const p of d.proprieta) {
      if (!espandi([p]).every((l) => sue.includes(l))) {
        errori.push(`${d.id}: «${p}» da coprire non è fra le proprietà che il pezzo confronta`);
        continue;
      }
      const voce = { pezzo: d.id, proprieta: p, motivo: d.perche, riferimento: "DA_COPRIRE", daCoprire: true };
      voci.push(d.stati ? { ...voce, stati: d.stati } : voce);
    }
  }
  return { errori, voci };
}

/// La riga del referto per una differenza: pezzo, stato, i due selettori,
/// proprietà, atteso e trovato.
export function scriviDifferenza(d) {
  return (
    `${d.pezzo} [${d.stato}] ${d.selettorePrototipo} → ${d.selettoreApp}: ` +
    `${d.proprieta} atteso «${d.atteso}», trovato «${d.trovato}» (${d.motivo})`
  );
}

/// La riga del referto per un elemento che non c'è, o che non si vede: rosso,
/// mai verde in silenzio.
export function scriviMancante(m) {
  const dove = m.lato === "app" ? "nel banco dell'app" : "nei valori estratti dal prototipo";
  return (
    `${m.pezzo} [${m.stato}] ${m.selettorePrototipo} → ${m.selettoreApp}: ` +
    `nessun elemento visibile ${dove} (${m.lato === "app" ? m.selettoreApp : m.selettorePrototipo})`
  );
}

/// Confronta i valori letti nell'app con quelli attesi per un pezzo in uno
/// stato. `trovati` è una mappa proprietà lunga → valore, `null` se il
/// selettore dell'app non ha trovato niente di visibile. `attesi` mappa ogni
/// proprietà a un valore, o a un elenco di alternative `{ valore, come }`
/// (le espressioni coi token di Fub risolte nell'app, vedi
/// `espressioniFub`): basta che una coincida.
export function confrontaPezzo(pezzo, stato, attesi, trovati) {
  const base = {
    pezzo: pezzo.id,
    stato,
    selettorePrototipo: pezzo.prototipo,
    selettoreApp: pezzo.app,
  };
  if (attesi === null || attesi === undefined) return { mancanti: [{ ...base, lato: "prototipo" }], differenze: [] };
  if (trovati === null || trovati === undefined) return { mancanti: [{ ...base, lato: "app" }], differenze: [] };
  const differenze = [];
  for (const proprieta of espandi(pezzo.proprieta)) {
    const voce = attesi[proprieta];
    const alternative = Array.isArray(voce) ? voce : [{ valore: voce, come: null }];
    let motivo = null;
    for (const a of alternative) {
      motivo = confronta(proprieta, a.valore, trovati[proprieta]);
      if (!motivo) break;
    }
    if (motivo) {
      const atteso = alternative.map((a) => (a.come ? `${a.come} = ${a.valore}` : a.valore)).join(" | ");
      differenze.push({ ...base, proprieta, atteso, trovato: trovati[proprieta], motivo });
    }
  }
  return { mancanti: [], differenze };
}

// ── I token: dai colori del prototipo a quelli di Fub ───────────────────────
//
// Il prototipo ha una tavolozza sua (`--line`, `--faint`, `--acc-ink`…), e il
// piano dice con quale token di Fub si scrive ognuno («Dal prototipo»).
// Confrontare i colori crudi farebbe rosso ogni pezzo che segue il piano alla
// lettera, perché le due tavolozze non coincidono. Quindi l'estrazione legge
// ogni pezzo due volte: con la tavolozza vera, e con i token della traduzione
// sostituiti da **sentinelle**, colori opachi lontani fra loro. Un colore che
// con le sentinelle diventa una sentinella è quel token; uno che diventa la
// mescolanza di due sentinelle (o di una e il trasparente) è quel
// `color-mix`; uno che non cambia è scritto a mano, e resta crudo. Da qui
// l'espressione coi token di Fub (`var(--border)`, `color-mix(in srgb,
// var(--sheet-2) 55%, var(--sheet))`), che la verifica risolve nell'app sotto
// l'elemento stesso: il colore atteso è la regola del prototipo con la
// tavolozza di Fub. Le sentinelle tolgono l'ambiguità che avrebbe il
// riconoscere un token dal suo valore: due token vicini, o tre quasi allineati,
// darebbero la stessa tinta per strade diverse.

/// La sentinella `i`: opaca, con canali dispari lontani da quelli vicini, mai
/// grigia. Le genera una formula fissa perché estrazione e test ne vedano le
/// stesse.
export function sentinella(i) {
  const r = (53 + i * 97) % 251;
  const g = (181 + i * 61) % 241;
  const b = (17 + i * 139) % 233;
  return [r | 1, g | 1, b | 1, 1];
}

/// Le sentinelle di una traduzione: token del prototipo → colore.
export function sentinelle(traduzione) {
  return Object.fromEntries(Object.keys(traduzione).map((t, i) => [t, sentinella(i)]));
}

/// I contesti di un pezzo. La pagina del documento ha una tavolozza sua
/// (`--doc-fg`, `--doc-rule-soft`…), che si cambia a parte da quella
/// dell'interfaccia: un pezzo con `contesto: "documento"` traduce i token del
/// prototipo con quella. Gli altri sono dell'interfaccia.
export const CONTESTO_DI_BASE = "interfaccia";

/// La traduzione del contesto di un pezzo; `undefined` se il contesto non
/// c'è fra le traduzioni della mappa.
export function traduzioneDi(pezzo, traduzioni) {
  return traduzioni[pezzo.contesto ?? CONTESTO_DI_BASE];
}

/// Controlla le traduzioni di una mappa contro i suoi pezzi. Tutte nominano
/// gli stessi token del prototipo nello stesso ordine: l'estrazione mette una
/// sentinella sola per token, e ogni contesto la legge con la sua traduzione.
export function validaTraduzioni(traduzioni, pezzi) {
  const errori = [];
  const base = traduzioni[CONTESTO_DI_BASE];
  if (!base) errori.push(`manca la traduzione «${CONTESTO_DI_BASE}»`);
  for (const [nome, t] of Object.entries(traduzioni)) {
    if (base && JSON.stringify(Object.keys(t)) !== JSON.stringify(Object.keys(base))) {
      errori.push(`la traduzione «${nome}» non nomina gli stessi token di «${CONTESTO_DI_BASE}», nello stesso ordine`);
    }
    for (const [token, fub] of Object.entries(t)) {
      if (!Array.isArray(fub) || fub.length === 0) errori.push(`la traduzione «${nome}» non dice come si scrive ${token}`);
    }
  }
  for (const p of pezzi) {
    if (!traduzioneDi(p, traduzioni)) errori.push(`${p.id}: il contesto «${p.contesto}» non ha una traduzione`);
  }
  return errori;
}

/// Uguaglianza stretta fra due colori dello stesso browser.
function identici(a, b) {
  return Math.abs(a[3] - b[3]) <= 0.004 && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= 0.75);
}

/// `color-mix(in srgb, a p, b)` con `p` fra 0 e 1: interpolazione con alfa
/// premoltiplicato, come la fanno i browser.
export function mescola(a, p, b) {
  const q = 1 - p;
  const alfa = a[3] * p + b[3] * q;
  if (alfa === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((i) => (a[i] * a[3] * p + b[i] * b[3] * q) / alfa).concat(alfa);
}

/// Di quali token è fatto un colore letto con le sentinelle: `["var(--line)"]`,
/// o le mescolanze che lo producono; vuoto se non è fatto di sentinelle.
export function decodifica(c, sent) {
  const nomi = Object.keys(sent);
  const esatti = nomi.filter((n) => identici(c, sent[n]));
  if (esatti.length) return esatti.map((n) => `var(${n})`);
  const fuori = [];
  for (const a of nomi) {
    // Con il trasparente: la tinta della sentinella, l'alfa è la quota.
    if (c[3] < 1 && c[3] > 0 && identici([...c.slice(0, 3), 1], sent[a])) {
      fuori.push(`color-mix(in srgb, var(${a}) ${Math.round(c[3] * 100)}%, transparent)`);
    }
    for (const b of nomi) {
      if (a === b) continue;
      // La quota dal canale che più separa le due sentinelle.
      const k = [0, 1, 2].reduce((m, i) => (Math.abs(sent[a][i] - sent[b][i]) > Math.abs(sent[a][m] - sent[b][m]) ? i : m), 0);
      const p = Math.round(((c[k] - sent[b][k]) / (sent[a][k] - sent[b][k])) * 100);
      if (p <= 0 || p >= 100 || p < 50) continue;
      if (identici(c, mescola(sent[a], p / 100, sent[b]))) {
        fuori.push(`color-mix(in srgb, var(${a}) ${p}%, var(${b}))`);
      }
    }
  }
  return fuori;
}

const COLORE_IN_VALORE = /rgba?\([^()]*\)|color\([^()]*\)|oklch\([^()]*\)|oklab\([^()]*\)|#[0-9a-f]{3,8}\b/gi;

/// Riscrive un valore calcolato del prototipo coi token di Fub. `crudo` è il
/// valore letto con la tavolozza vera, `conSentinelle` lo stesso letto con le
/// sentinelle; `traduzione` mappa ogni token del prototipo all'elenco dei
/// token di Fub con cui si scrive. Ogni colore fatto di token diventa la sua
/// espressione, gli altri restano crudi. Restituisce le espressioni possibili
/// (più d'una quando un token ha due traduzioni), al più `massimo`; `null` se
/// nel valore non c'è un colore fatto di token.
export function espressioniFub(crudo, conSentinelle, traduzione, massimo = 16) {
  const testo = String(crudo);
  const veri = [...testo.matchAll(COLORE_IN_VALORE)];
  const finti = [...String(conSentinelle).matchAll(COLORE_IN_VALORE)];
  if (veri.length === 0 || veri.length !== finti.length) return null;
  const sent = sentinelle(traduzione);
  const pezzi = [];
  let ultimo = 0;
  let tocca = false;
  veri.forEach((m, i) => {
    pezzi.push([testo.slice(ultimo, m.index)]);
    const c = colore(finti[i][0]);
    const scelte = new Set();
    for (const espr of c ? decodifica(c, sent) : []) {
      // Ogni `var(--x)` del prototipo diventa ognuna delle sue traduzioni.
      let varianti = [espr];
      for (const nome of espr.match(/--[a-z0-9-]+/gi) ?? []) {
        varianti = varianti.flatMap((v) => traduzione[nome].map((t) => v.replace(`var(${nome})`, `var(${t})`)));
      }
      varianti.forEach((v) => scelte.add(v));
    }
    if (scelte.size) tocca = true;
    pezzi.push(scelte.size ? [...scelte] : [m[0]]);
    ultimo = m.index + m[0].length;
  });
  if (!tocca) return null;
  pezzi.push([testo.slice(ultimo)]);
  let fuori = [""];
  for (const scelte of pezzi) {
    fuori = fuori.flatMap((f) => scelte.map((s) => f + s)).slice(0, massimo);
  }
  return fuori;
}
