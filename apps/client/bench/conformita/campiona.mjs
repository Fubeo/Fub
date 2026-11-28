// **Il campionamento delle animazioni a tempo fermo**, uguale dai due lati.
//
// Lo usa `animazioni.mjs` sul prototipo e sull'app: un modo solo di fermare il
// tempo, di leggere le corse e di leggere le pose, perché due letture scritte
// in due posti divergono, e una differenza nata dal lettore si presenterebbe
// come una differenza di moto.
//
// # Come si ferma il tempo
//
// Le quattro strade provate, e quale vale per quale animazione:
//
// - **CDP `Animation.setPlaybackRate(0)`** ferma la linea del tempo del
//   documento: ogni animazione che nasce dopo (una transizione CSS, una
//   `@keyframes`, un `el.animate()`) resta a `currentTime` 0, e si sposta a
//   mano. È la strada delle animazioni CSS e WAAPI del prototipo e delle
//   transizioni CSS della pelle dell'app: vale per tutte senza sapere chi le
//   crea, anche quelle che nascono da uno stile calcolato un fotogramma dopo il
//   gesto, perché nascono già ferme.
// - **L'orologio manuale del moto** (`createManualDriver` di `src/moto`) per le
//   corse del moto dell'app: il motore WAAPI arma un `setTimeout` di guardia
//   (ritardo + durata + 100 ms) che chiude la corsa a tempo vero, e con la
//   sola linea del tempo ferma la corsa sparirebbe a metà. Col motore manuale
//   la corsa è in pausa, il suo tempo è `advance`, e alla fine la posa di
//   riposo la scrive il moto stesso come in uso.
// - **`anim.pause()` + `currentTime`** da solo arriva tardi: ferma ciò che
//   esiste già, e una transizione che parte un fotogramma dopo il gesto
//   avrebbe già fatto un passo a tempo vero. Si usa solo per spostare il
//   tempo di ciò che la linea del tempo ha fermato.
// - **`page.clock`** di Playwright tiene `Date`, i timer e
//   `requestAnimationFrame`, non la linea del tempo delle animazioni: serve
//   solo a un moto scritto a mano in JS (un passo per fotogramma, un
//   `setTimeout` che toglie un elemento). Nessuna voce di oggi ne ha bisogno;
//   una che lo chiede lo installa nel suo `prepara`.
//
// # Il tempo zero
//
// Lo zero di ogni lato è la nascita della prima animazione del gesto, non il
// gesto: la latenza fra il gesto e l'inizio del moto (un fotogramma per
// montare un menu) non si misura qui. Le animazioni nate dopo, durante i
// campioni, contano dal campione in cui compaiono.
//
// Ogni funzione `*NellaPagina` gira nella pagina con `page.evaluate`: è
// autonoma, non usa niente di fuori.

/// Il passo di un fotogramma a 60 Hz (ms): la finestra di tolleranza dei
/// campioni (`confronto-animazioni.mjs`).
export const FOTOGRAMMA = 1000 / 60;

/// I punti di ogni corsa che si confrontano: 0, 25, 50, 75 e 100 %.
export const PUNTI = [0, 0.25, 0.5, 0.75, 1];

/// Annota ciò che è vivo a riposo (le animazioni infinite dell'ambiente, il
/// cursore che lampeggia): non è del gesto. Dal lato dell'app prende anche il
/// tempo del moto col motore manuale.
export async function riposoNellaPagina({ motore }) {
  const stato = { ambiente: new Set(document.getAnimations()), driver: null, moto: null, nate: new Map(), inizio: 0 };
  if (motore) {
    const moto = await import("/src/moto/index.ts");
    stato.driver = moto.createManualDriver();
    stato.moto = moto;
    moto.setMotionDriver(stato.driver);
  }
  window.__fubAnimazioni = stato;
  return stato.ambiente.size;
}

/// Le corse nate dal gesto, per elemento, con la loro forma: tipo, proprietà,
/// ritardo, durata, iterazioni, curva. Col motore manuale, se il gesto non ha
/// ancora fatto nascere niente (una corsa che parte al fotogramma dopo),
/// fa passare un fotogramma alla volta, fino a 30, e lo zero è lì.
export function corseNellaPagina({ radice, elementi }) {
  const stato = window.__fubAnimazioni;
  const contenitore = radice ? document.querySelector(radice) : null;
  const base = !radice ? document : contenitore;
  const nuove = () => document.getAnimations().filter((a) => !stato.ambiente.has(a));
  if (stato.driver) {
    for (let i = 0; i < 30 && nuove().length === 0; i += 1) stato.driver.advance(1000 / 60);
    stato.inizio = stato.driver.now();
  }
  const vive = nuove();
  for (const a of vive) stato.nate.set(a, 0);
  const trova = (selettore) => {
    const testo = typeof selettore === "string" ? null : selettore.testo;
    const m = /^(.*?)(::(?:before|after))?$/.exec(typeof selettore === "string" ? selettore : selettore.css);
    const el = base
      ? [...base.querySelectorAll(m[1])].find((e) => e.getClientRects().length > 0 && (!testo || e.textContent.includes(testo)))
      : null;
    return el ? { el, pseudo: m[2] ?? null } : null;
  };
  const kebab = (p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const descrivi = (a) => {
    const t = a.effect.getTiming();
    const kf = a.effect.getKeyframes();
    const proprieta = new Set();
    for (const k of kf) {
      for (const p of Object.keys(k)) {
        if (!["offset", "computedOffset", "easing", "composite"].includes(p)) proprieta.add(kebab(p));
      }
    }
    // Una `@keyframes` porta la curva sui fotogrammi chiave, non sulla corsa.
    let curva = t.easing;
    if (curva === "linear") curva = kf.map((k) => k.easing).find((e) => e && e !== "linear") ?? curva;
    return {
      tipo: a.constructor.name,
      nome: a.transitionProperty ?? a.animationName ?? a.id ?? "",
      proprieta: [...proprieta].sort(),
      ritardo: t.delay,
      durata: typeof t.duration === "number" ? t.duration : 0,
      iterazioni: t.iterations === Infinity ? "infinite" : t.iterations,
      curva,
    };
  };
  const corse = {};
  for (const e of elementi) {
    const trovato = trova(e.selettore);
    corse[e.id] = trovato
      ? vive
          .filter((a) => a.effect?.target === trovato.el && (a.effect.pseudoElement ?? null) === trovato.pseudo)
          .map(descrivi)
      : null;
  }
  let fine = 0;
  for (const a of vive) {
    const t = a.effect.getTiming();
    const giri = t.iterations === Infinity ? 1 : t.iterations;
    fine = Math.max(fine, t.delay + (typeof t.duration === "number" ? t.duration : 0) * giri);
  }
  return { corse, fine, quante: vive.length };
}

/// Le pose agli istanti `tempi` (ms dallo zero, crescenti): sposta il tempo di
/// ogni animazione del gesto (col motore manuale, `advance`), poi rilegge ogni
/// elemento **per selettore** (e per testo, `{ css, testo }`), perché
/// CodeMirror può aver rifatto la riga. Il
/// giro è sincrono: fra un campione e l'altro la pagina non fa niente, nessun
/// `finish` né `animationend` arriva prima dell'ultimo, e un `onfinish` che
/// toglie l'elemento lo toglie dopo che è stato letto. Un'animazione infinita
/// si legge nel suo primo giro: i tempi li sceglie chi chiama.
export function campionaNellaPagina({ radice, elementi, tempi }) {
  const stato = window.__fubAnimazioni;
  const contenitore = radice ? document.querySelector(radice) : null;
  const base = !radice ? document : contenitore;
  const driver = stato.driver;
  const delMotore = new Set();
  const leggi = (e) => {
    const testo = typeof e.selettore === "string" ? null : e.selettore.testo;
    const m = /^(.*?)(::(?:before|after))?$/.exec(typeof e.selettore === "string" ? e.selettore : e.selettore.css);
    const el = base
      ? [...base.querySelectorAll(m[1])].find((x) => x.getClientRects().length > 0 && (!testo || x.textContent.includes(testo)))
      : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const stile = getComputedStyle(el, m[2] ?? null);
    const valori = {};
    for (const p of e.proprieta) if (p !== "geometria") valori[p] = stile.getPropertyValue(p);
    return { rect: m[2] ? null : [r.left, r.top, r.width, r.height], valori };
  };
  const campioni = [];
  for (const t of tempi) {
    if (driver) {
      const passo = stato.inizio + t - driver.now();
      if (passo > 1e-9) driver.advance(passo);
      for (const p of driver.plays) if (p.animation) delMotore.add(p.animation);
    }
    for (const a of document.getAnimations()) {
      if (stato.ambiente.has(a) || delMotore.has(a)) continue;
      if (!stato.nate.has(a)) stato.nate.set(a, t);
      a.currentTime = Math.max(0, t - stato.nate.get(a));
    }
    campioni.push({ t, letture: Object.fromEntries(elementi.map((e) => [e.id, leggi(e)])) });
  }
  return campioni;
}

/// Ridà il tempo alla pagina: col motore manuale porta in fondo le corse
/// rimaste (il moto scrive la posa di riposo) e torna al motore di serie.
export function liberaNellaPagina() {
  const stato = window.__fubAnimazioni;
  if (!stato) return;
  if (stato.driver) {
    stato.driver.advance(10_000);
    stato.moto.setMotionDriver(null);
  }
  for (const a of document.getAnimations()) {
    if (!stato.ambiente.has(a) && a.effect?.getTiming().iterations !== Infinity) a.finish();
  }
  delete window.__fubAnimazioni;
}

/// Aspetta che non scorra più niente di finito (le infinite dell'ambiente
/// non finiscono mai: non si aspettano), al più due secondi, poi due
/// fotogrammi.
export async function fermoNellaPagina() {
  const vive = document
    .getAnimations()
    .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
  await Promise.race([
    Promise.all(vive.map((a) => a.finished.catch(() => null))),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/// Gli istanti da leggere nel prototipo: per ogni elemento i `PUNTI` della sua
/// corsa (dal primo ritardo alla fine più lontana; senza corse sue, la
/// finestra di tutto il gesto), e ognuno anche un fotogramma prima e dopo,
/// per la finestra di tolleranza. Un'animazione infinita conta un giro.
export function tempiDelPrototipo(corse, fine) {
  const finestre = {};
  const tempi = new Set([0, fine]);
  for (const [id, lista] of Object.entries(corse)) {
    let da = 0;
    let a = fine;
    if (lista && lista.length) {
      da = Math.min(...lista.map((c) => c.ritardo));
      a = Math.max(...lista.map((c) => c.ritardo + c.durata * (c.iterazioni === "infinite" ? 1 : c.iterazioni)));
    }
    const punti = PUNTI.map((k) => arrotonda(da + k * (a - da)));
    finestre[id] = punti;
    for (const t of punti) {
      for (const d of [-FOTOGRAMMA, 0, FOTOGRAMMA]) tempi.add(arrotonda(Math.min(fine, Math.max(0, t + d))));
    }
  }
  return { finestre, tempi: [...tempi].sort((x, y) => x - y) };
}

function arrotonda(t) {
  return Math.round(t * 1000) / 1000;
}
