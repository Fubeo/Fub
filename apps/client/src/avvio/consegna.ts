// La consegna dello strato d'avvio all'app.
//
// Lo strato (`.avvio`, in `index.html`, `mobile.html` e `document.html`) copre
// la pagina dal primo disegno; `#app`, lo skip-link e `#document-window` sono
// `inert` e `aria-busy` finché l'avvio non finisce. I tempi e il guasto li
// tiene `public/avvio/stati.js`; da qui l'avvio gli dice la fase (`fase`), che
// la shell è in piedi (`pronta`) o che è caduta (`fallito`).
//
// `consegna()` si chiama alla fine vera dell'avvio (`startup` della cornice,
// `bootDocumentWindow`):
// 1. aspetta il tema definitivo e i caratteri, ciascuno al più 1,5 s;
// 2. salva `fub.avvio`, la cache che `luce.js` e `stati.js` leggono al
//    prossimo avvio: le scelte di luce, contrasto e moto, i colori della luce
//    in vigore e i testi dello strato nella lingua scelta;
// 3. porta i colori dello strato a quelli dell'app, così il velo sfuma verso
//    il fondo vero;
// 4. se il marchio non era ancora entrato (l'avvio istantaneo) toglie lo
//    strato subito: si è visto solo il fondo, che è già quello dell'app;
// 5. se no lascia il marchio almeno 400 ms, rende viva l'app (niente `inert`,
//    il fuoco al suo posto, lo strato senza puntatore) e solo dopo anima: lo
//    strato sfuma e le regioni dell'app entrano in ordine di lettura, ciascuna
//    con la molla `elastic` (la «cascata»); con meno movimento una sola
//    dissolvenza di 90 ms;
// 6. quando lo strato ha finito di sfumare lo toglie; il suo stile e ciò che
//    ha scritto su `<html>` se ne vanno quando anche la cascata è finita,
//    perché toglierli ricalcola lo stile di tutta la pagina (una sessantina di
//    ms con la CPU 4×) e lo si fa quando niente si muove. Le corse delle
//    regioni finiscono da sole e non lasciano niente.
//
// Senza strato (i test che montano un DOM loro, le pagine che non lo hanno)
// niente qui fa qualcosa. Il modulo non importa il tema: la finestra
// documento non ha IPC, e chi ha il tema dell'app lo passa in `ConsegnaOpzioni`.
import { DURATION, animate, motionLevel, stagger, type Motion, type Pose } from "../moto";
import { IT } from "../i18n/catalog";
import { catalogFor, resolvedLanguage } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";

/// La fase dell'avvio che la riga dello strato dice dopo 2 s.
export type FaseAvvio = "pagina" | "finestra" | "vault";

/// Il tema dell'app, come lo vede la consegna.
export interface TemaAvvio {
  /// Si risolve quando il tema montato è quello definitivo dell'avvio.
  definitivo(): Promise<void>;
  /// Le scelte di luce e di contrasto (`""` è «come il sistema»).
  scelte(): { readonly light: string; readonly contrast: string };
}

export interface ConsegnaOpzioni {
  /// Il tema da aspettare e da salvare. Senza (la finestra documento, il cui
  /// tema arriva dal ponte quando arriva) non si aspetta e `fub.avvio` non si
  /// scrive: i colori in vigore non sono quelli che l'app sceglie.
  tema?: TemaAvvio;
  /// Chiuderla porta lo strato via subito e ferma le corse del passaggio.
  vita?: Lifetime;
}

/// La cache dello strato d'avvio, in `localStorage`. La leggono soltanto
/// `public/avvio/luce.js` e `stati.js`.
export const CACHE = "fub.avvio";

/// Quanto si aspetta il tema definitivo, e quanto i caratteri (ms).
const ATTESA_MS = 1500;
/// Quanto resta visibile, al minimo, un marchio entrato (ms).
const MARCHIO_MS = 400;

/// Il ritmo della cascata: lo stesso del ventaglio dei fogli dell'accoglienza
/// (`FAN_EACH` di `shells/scrittoio/frame/welcome.ts`).
const FAN_EACH = 30;
/// Il marchio dello strato si stringe come un dialogo che entra
/// (`ENTER_SCALE` di `kit/dialog.ts`).
const ENTER_SCALE = 0.94;

/// Le regioni dell'app in ordine di lettura, con la posa da cui entrano:
/// ciascuna dal suo bordo, i fogli dal basso e un poco più piccoli (le pose
/// d'entrata dei dialoghi e del lanciatore). Al telefono il binario è la barra
/// in basso, e viene dopo i fogli.
type Voce = readonly [selettore: string, posa: Pose];
const CASCATA: readonly Voce[] = [
  ["#topbar", { y: -8 }],
  ["#rail", { x: -8 }],
  ["#sidebar", { x: -12 }],
  ["#panes", { y: 16, scale: 0.98 }],
  ["#right-pane", { x: 12 }],
  ["#status-band", { y: 8 }],
];
const CASCATA_TELEFONO: readonly Voce[] = [
  ["#topbar", { y: -8 }],
  ["#panes", { y: 16, scale: 0.98 }],
  ["#rail", { y: 8 }],
];
/// `document.html` non ha regioni: entra la finestra, come i fogli.
const CASCATA_DOCUMENTO: readonly Voce[] = [["#document-window", { y: 16, scale: 0.98 }]];

/// Gli elementi che l'HTML tiene inerti sotto lo strato.
const INERTI = ["#app", ".skip-link", "#document-window"];

/// Dove va il fuoco se l'avvio l'ha lasciato sul `body`: le `focus()` fatte
/// durante l'avvio su un `#app` inerte si sono perse. Nell'ordine: ciò che si
/// scrive nel foglio attivo, o nella finestra di un documento, il primo bottone
/// della scelta del vault, i fogli.
const FUOCO = [
  ".pane.focus [contenteditable='true']",
  "#document-window [contenteditable='true']",
  "#onboarding:not([hidden]) button:not([hidden])",
  "#panes",
];

/// I colori dello strato, con la variabile del tema da cui si leggono.
const COLORI: readonly (readonly [chiave: string, variabile: string])[] = [
  ["sfondo", "--bg"],
  ["testo", "--text"],
  ["tenue", "--muted"],
  ["accento", "--accent"],
  ["inchiostro", "--accent-contrast"],
  ["bordo", "--border"],
  ["guasto", "--danger"],
  ["fuoco", "--focus-ring"],
];

/// I testi che lo strato dice: i suoi, «Riprova» e i nomi delle fasi che il
/// guasto per tempo nomina.
const TESTI: readonly string[] = Object.keys(IT).filter(
  (chiave) => chiave.startsWith("app.avvio.") || chiave.startsWith("app.startup_phase.") || chiave === "app.retry",
);

/// Gli strati la cui shell è caduta: per loro niente consegna, resta il guasto.
const falliti = new WeakSet<Element>();
/// Una consegna per strato: chi la chiede di nuovo aspetta la stessa.
const inCorso = new WeakMap<Element, Promise<void>>();

function strato(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".avvio");
}

/// La fase che la riga dello strato dice, col nome del vault se c'è.
export function fase(f: FaseAvvio, nome?: string): void {
  const el = strato();
  if (!el) return;
  el.dataset.fase = f;
  if (nome === undefined) delete el.dataset.nome;
  else el.dataset.nome = nome;
}

/// La shell è in piedi: il guasto per tempo non scatta più.
export function pronta(): void {
  strato()?.setAttribute("data-pronta", "");
}

/// L'avvio è caduto: lo strato mostra il guasto col motivo, Riprova prende il
/// fuoco, e la consegna non avverrà. Vero se c'era uno strato a dirlo.
export function fallito(motivo: string): boolean {
  const el = strato();
  if (!el) return false;
  falliti.add(el);
  el.dispatchEvent(new CustomEvent("avvio:guasto", { detail: { motivo } }));
  return true;
}

export function consegna(opzioni: ConsegnaOpzioni = {}): Promise<void> {
  const el = strato();
  if (!el || falliti.has(el)) return Promise.resolve();
  const viva = inCorso.get(el);
  if (viva) return viva;
  const corsa = consegnaStrato(el, opzioni);
  inCorso.set(el, corsa);
  return corsa;
}

async function consegnaStrato(el: HTMLElement, { tema, vita }: ConsegnaOpzioni): Promise<void> {
  await Promise.all([
    tema ? entro(tema.definitivo(), ATTESA_MS, vita) : null,
    entro(caratteriPronti(), ATTESA_MS, vita),
  ]);
  if (!el.isConnected || falliti.has(el)) return;
  const colori = coloriDellApp();
  if (tema) salva(tema, colori);
  for (const [chiave, valore] of Object.entries(colori)) {
    document.documentElement.style.setProperty(`--avvio-${chiave}`, valore);
  }

  if (!el.hasAttribute("data-marchio")) {
    vivifica(el);
    el.remove();
    pulisci();
    return;
  }
  const da = Number(el.dataset.marchioDa);
  const resta = Number.isFinite(da) ? da + MARCHIO_MS - performance.now() : 0;
  if (resta > 0) await pausa(resta, vita);
  if (!el.isConnected || falliti.has(el)) return;

  // Da qui l'app risponde: un clic attraversa lo strato, un tasto va al fuoco.
  vivifica(el);
  const corse = passaggio(el, vita);
  await corse.strato.finished;
  corse.marchio?.cancel();
  el.remove();
  await corse.cascata?.finished;
  pulisci();
}

/// Le corse del passaggio: la dissolvenza dello strato, la stretta del marchio
/// (che finisce con lo strato) e la cascata delle regioni.
interface Corse {
  readonly strato: Motion;
  readonly marchio: Motion | null;
  readonly cascata: Motion | null;
}

function passaggio(el: HTMLElement, vita: Lifetime | undefined): Corse {
  const ridotto = motionLevel() === "reduced" || document.documentElement.dataset.avvioMoto === "ridotto";
  // Lo stato finale prima della corsa: se la fine arriva prima della pulizia
  // lo strato resta trasparente, non ricompare.
  el.style.opacity = "0";
  const dissolvenza = animate(el, {
    from: { opacity: 1 },
    to: { opacity: 0 },
    duration: DURATION.state,
    easing: "linear",
    whenReduced: "fade",
    lifetime: vita,
  });
  if (ridotto) return { strato: dissolvenza, marchio: null, cascata: null };

  const marchio = el.querySelector(".avvio-marchio");
  const stretta = marchio
    ? animate(marchio, { to: { scale: ENTER_SCALE }, spring: "snap", whenReduced: "none", lifetime: vita })
    : null;
  // Le regioni presenti e disegnate: una nascosta (il lato chiuso, l'ispettore
  // in una finestra stretta) si salta e le altre tengono il ritmo.
  const regioni = cascata().flatMap(([selettore, posa]) => {
    const regione = document.querySelector<HTMLElement>(selettore);
    if (!regione || regione.hidden) return [];
    const rettangolo = regione.getBoundingClientRect();
    return rettangolo.width > 0 && rettangolo.height > 0 ? [[regione, posa] as const] : [];
  });
  const entrata = stagger(
    regioni,
    ([regione, posa]) =>
      animate(regione, { from: { opacity: 0, ...posa }, spring: "elastic", whenReduced: "none", lifetime: vita }),
    { each: FAN_EACH },
  );
  return { strato: dissolvenza, marchio: stretta, cascata: entrata };
}

function cascata(): readonly Voce[] {
  if (!document.getElementById("app") && document.getElementById("document-window")) return CASCATA_DOCUMENTO;
  const root = document.documentElement.dataset;
  return root.clientShell === "mobile" && root.mobileFormFactor === "phone" ? CASCATA_TELEFONO : CASCATA;
}

/// L'app risponde: lo strato non prende più niente, `inert` e `aria-busy` se
/// ne vanno e il fuoco torna dove serve.
function vivifica(el: HTMLElement): void {
  el.dataset.consegna = "";
  el.setAttribute("aria-hidden", "true");
  for (const selettore of INERTI) {
    for (const inerte of document.querySelectorAll<HTMLElement>(selettore)) {
      inerte.removeAttribute("inert");
      inerte.removeAttribute("aria-busy");
    }
  }
  const attivo = document.activeElement;
  if (attivo && attivo !== document.body && !el.contains(attivo)) return;
  for (const selettore of FUOCO) {
    const bersaglio = document.querySelector<HTMLElement>(selettore);
    if (!bersaglio) continue;
    bersaglio.focus({ preventScroll: true });
    if (document.activeElement === bersaglio) return;
  }
}

/// Via lo stile dello strato e ciò che i due script hanno scritto su `<html>`.
function pulisci(): void {
  document.getElementById("avvio-stile")?.remove();
  const root = document.documentElement;
  for (const nome of root.getAttributeNames()) {
    if (nome.startsWith("data-avvio")) root.removeAttribute(nome);
  }
  for (const proprieta of Array.from(root.style)) {
    if (proprieta.startsWith("--avvio-")) root.style.removeProperty(proprieta);
  }
}

/// Un colore che `luce.js` accetterà: un colore per il CSS, e niente che
/// possa uscire dalla dichiarazione.
function coloreBuono(valore: string): boolean {
  if (valore === "" || /[;{}<>]/.test(valore)) return false;
  try {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", valore);
  } catch {
    return false;
  }
}

/// I colori dell'app in vigore, con le chiavi dello strato. Uno che non si
/// legge, o non è un colore, manca: vale quello di serie dello strato.
function coloriDellApp(): Record<string, string> {
  const stile = getComputedStyle(document.documentElement);
  const colori: Record<string, string> = {};
  for (const [chiave, variabile] of COLORI) {
    const valore = stile.getPropertyValue(variabile).trim();
    if (coloreBuono(valore)) colori[chiave] = valore;
  }
  return colori;
}

/// Una scelta come la legge `luce.js`: i due valori espliciti, se no il sistema.
function scelta(valore: string, ammessi: readonly string[]): string {
  return ammessi.includes(valore) ? valore : "system";
}

/// Scrive `fub.avvio`. I colori delle altre luci, salvati da un avvio
/// precedente, restano: questa consegna sa soltanto quelli della luce in vigore.
function salva(tema: TemaAvvio, colori: Record<string, string>): void {
  const root = document.documentElement.dataset;
  const luce = `${root.theme === "light" ? "light" : "dark"}${root.contrast === "high" ? "-high" : ""}`;
  const { light, contrast } = tema.scelte();
  const lingua = catalogFor(resolvedLanguage());
  const testi: Record<string, string> = {};
  for (const chiave of TESTI) {
    const testo = lingua[chiave] ?? (IT as Record<string, string>)[chiave];
    if (typeof testo === "string") testi[chiave] = testo;
  }
  try {
    const prima = precedenti(localStorage.getItem(CACHE));
    prima[luce] = colori;
    const cache = {
      v: 1,
      luce: scelta(light, ["light", "dark"]),
      contrasto: scelta(contrast, ["normal", "high"]),
      moto: root.motion === "reduced" || root.motion === "calm" ? root.motion : "system",
      colori: prima,
      testi,
      lingua: resolvedLanguage(),
    };
    localStorage.setItem(CACHE, JSON.stringify(cache));
  } catch {
    // `localStorage` negato (finestra privata, archivio pieno): il prossimo
    // avvio parte dai colori di serie, e questa consegna va avanti lo stesso.
  }
}

/// Le tavolozze già salvate, se la cache è della forma giusta.
function precedenti(testo: string | null): Record<string, Record<string, string>> {
  const tavolozze: Record<string, Record<string, string>> = {};
  if (!testo) return tavolozze;
  try {
    const cache = JSON.parse(testo) as { v?: unknown; colori?: unknown };
    if (cache?.v !== 1 || !cache.colori || typeof cache.colori !== "object") return tavolozze;
    for (const luce of ["dark", "light", "dark-high", "light-high"]) {
      const voce = (cache.colori as Record<string, unknown>)[luce];
      if (!voce || typeof voce !== "object") continue;
      const buoni: Record<string, string> = {};
      for (const [chiave] of COLORI) {
        const valore = (voce as Record<string, unknown>)[chiave];
        if (typeof valore === "string" && coloreBuono(valore)) buoni[chiave] = valore;
      }
      tavolozze[luce] = buoni;
    }
  } catch {
    // Una cache rotta vale come assente.
  }
  return tavolozze;
}

/// `document.fonts.ready`, dove c'è: happy-dom può non averlo.
function caratteriPronti(): Promise<unknown> {
  try {
    const pronti = document.fonts?.ready;
    return pronti ? Promise.resolve(pronti) : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

/// Aspetta `promessa` al più `ms`, e non oltre la vita: comunque finisca, si
/// va avanti.
function entro(promessa: Promise<unknown>, ms: number, vita: Lifetime | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const fine = (): void => {
      clearTimeout(timer);
      resolve();
    };
    promessa.then(fine, fine);
    vita?.add(fine);
  });
}

function pausa(ms: number, vita: Lifetime | undefined): Promise<void> {
  return entro(new Promise<void>(() => {}), ms, vita);
}
