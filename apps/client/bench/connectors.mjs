// **Il banco dei connettori**: quanto ci mette un disegno di 200 forme e 300
// connettori a seguire le forme che si spostano, e se le segue davvero.
//
//     node bench/connectors.mjs                   # 300 connettori, con le soglie
//     node bench/connectors.mjs --connectors 1000 # da 6 a 2000 connettori
//     node bench/connectors.mjs --cpu 4           # la pagina quattro volte più lenta
//
// Il disegno è quello di `connectors-fixture.ts`: 200 forme, rettangoli,
// ellissi e poligoni, su una griglia larga, unite da 300 connettori dritti, a
// gomito e curvi, con agganci automatici e di lato, quasi tutti con una punta
// e trenta con un'etichetta; sei forme «nodo» portano una ventina di
// connettori ciascuna. Il banco lo apre nell'app vera, dalla pagina del banco
// (`?connectors=N`, in `fake-ipc.ts`), al livello Standard, e lo percorre in
// cinque corse, ognuna dal disegno com'era alla fine della precedente:
//
// 1. **Il nodo** più vicino al centro, con la vista che lo inquadra: il mouse
//    lo preme, fa 60 movimenti, un fotogramma ciascuno, e lo rilascia.
// 2. **Le 200 forme con le 30 etichette**, scelte insieme senza i connettori
//    (Ctrl+A sceglie anche quelli), con tutto il disegno in vista: stessa
//    corsa del mouse.
// 3. **Le frecce** sulla stessa scelta: otto volte Maiusc+Destra, otto
//    Maiusc+Giù e otto Sinistra, un tasto dopo l'altro.
// 4. **Tutto il disegno**, 530 oggetti con Ctrl+A, col mouse.
// 5. **Le frecce** sull'intero disegno.
//
// # Che cosa misura
//
// Per ogni evento del gesto (la pressione, ogni movimento, il rilascio, ogni
// tasto), il tempo dal suo `timeStamp`, cioè da quando il browser l'ha
// ricevuto, al fotogramma dopo, dipinto: un `requestAnimationFrame` chiesto
// mentre l'evento arriva, e in quel fotogramma un messaggio, che arriva
// quando il fotogramma ha finito stile, layout e pittura. Durante le corse
// registra anche gli intervalli fra un fotogramma e l'altro, i compiti lunghi
// (Long Tasks API: ogni compito oltre i 50 ms), i fotogrammi lunghi
// (`long-animation-frame`, con gli script che ci pesano di più) e, dove il
// browser la dà, la durata dell'evento fino alla presentazione (Event
// Timing, solo oltre i 16 ms). Gli eventi vanno uno dopo l'altro, ognuno
// quando il precedente è dipinto; dopo l'ultimo la corsa aspetta 400 ms, per
// ciò che l'editor rimanda. Dopo ogni corsa viene Annulla, misurato anche
// lui.
//
// Ogni passo si controlla: un banco veloce che sbaglia è rosso.
//
// - **Le frecce** spostano il nodo, dopo ogni tasto, del passo del tasto.
// - **Il gesto** muove le forme che deve (una; tutte e 200), tutte dello
//   stesso tratto, e arrivano dove il puntatore le ha portate, a 10 px
//   dall'aggancio alle guide; col nodo cambiano il nodo, i suoi connettori e
//   le loro etichette, e nient'altro; con le 200 forme cambiano tutti e 300 i
//   connettori; gli oggetti dipinti restano gli stessi.
// - **Il file salvato**, con Ctrl+S, riletto da zero: i 571 elementi di
//   prima; i 300 connettori, ognuno con i suoi agganci, il suo tipo, la sua
//   punta e il `d` che è la sua `fub:geom`; i due capi di ognuno, 600 in
//   tutto, sul contorno della forma che unisce, al più mezzo spessore del
//   contorno e 0,6 unità fuori (la corda che approssima l'ellisse e i due
//   decimali del file; si vede 0,084); le etichette vicine alla loro linea
//   (al più 90 unità oltre la distanza che portano; si vedono 34); e ciò che
//   si vede è ciò che è scritto, oggetto per oggetto.
// - **Annulla.** Dopo il mouse, un Ctrl+Z rimette tutto com'era, oggetto per
//   oggetto. Dopo le 24 frecce, la cronologia fonde i tasti a meno di mezzo
//   secondo l'uno dall'altro in un passo solo (`MERGE_MS`, in `history.ts`):
//   ventiquattro tasti si annullano in due Ctrl+Z (cinque con tutto il
//   disegno), e ognuno deve riportare il nodo a un punto già percorso, più
//   indietro del precedente, fino a com'era. Tre tasti a 650 ms l'uno
//   dall'altro, invece, sono tre passi, e si annullano uno alla volta.
//
// # Le soglie, misurate
//
// Valgono fino a 300 connettori; oltre, il banco misura, controlla e
// riferisce senza soglie. Sono quattro: ogni movimento del puntatore, con la
// pressione, dipinto entro `MOVE_LIMIT_MS`, 150 ms, nove fotogrammi a 60 Hz;
// ogni passo che scrive (il rilascio, un tasto, Annulla) entro
// `COMMIT_LIMIT_MS`, un secondo; il 95° percentile degli intervalli fra i
// fotogrammi di una corsa che trascina entro `FRAME_P95_MS`, 85 ms, cinque
// fotogrammi; e nessun compito lungo fuori dai passi del gesto. Le misure
// sono di questa macchina (Ryzen 7 7730U, 16 thread, Chromium 149 senza
// finestra, pagina 1280×800, foglio 410×439), a 300 connettori e 571
// elementi, nel peggio di ogni gruppo di corse:
//
// - **A riposo**, tre corse. Il nodo si muove in 15 ms (50° percentile),
//   24 al più, e si rilascia in 35. Le 200 forme, o tutto il disegno, si
//   muovono in 30 ms (50° percentile), 44 al più, a 60 fotogrammi al
//   secondo: il 95° percentile degli intervalli è 16,8 ms. Nessun compito
//   lungo durante i movimenti. Il rilascio di 230 o 530 oggetti costa da 118
//   a 145 ms, un compito lungo solo; un tasto da 91 a 100 ms (50° percentile),
//   168 al più; Annulla 70 al più.
// - **A macchina piena**, sedici processi che girano a vuoto, uno per
//   thread, tre corse: i movimenti al più 104 ms (50° percentile da 51 a 59),
//   il 95° percentile degli intervalli 50 ms, il rilascio al più 405 ms, un
//   tasto 494 al più, Annulla 258. Qualche movimento contiene un compito
//   lungo, fino a 89 ms.
// - **A pagina rallentata** (`--cpu N`, che chiede a Chromium di rallentarla
//   N volte, dopo l'apertura): due volte, i movimenti al più 64 ms, gli
//   intervalli 33 ms, il rilascio 262, un tasto 251, nessun compito lungo
//   durante i movimenti; quattro volte, 120 ms, 67, 524 e 771 (in una delle
//   due corse un tasto ha toccato i 771 ms, nell'altra il peggio era 495);
//   sei volte, un movimento di 445 ms e intervalli di 100 ms, ed è rosso.
//
// Le soglie stanno una volta e mezza sopra il peggio della macchina piena per
// i movimenti, due volte per i passi che scrivono e una volta e settanta per
// gli intervalli; con la pagina quattro volte più lenta le rispettano, con
// sei no. Un secondo, per un passo che scrive, è il limite oltre il quale chi
// lavora perde il filo: a riposo il rilascio e i tasti ne usano un decimo o
// poco più, e la soglia è larga perché un banco che sfarfalla si spegne, non
// perché sia il traguardo.
//
// I 50 ms dei compiti lunghi bastano ai movimenti a riposo e a pagina due
// volte più lenta, non alla macchina piena: un movimento di un gruppo è circa
// 15 ms di lavoro dell'editor, e con la macchina presa un compito arriva a
// 89. Perciò durante i movimenti i compiti lunghi si misurano e si
// riferiscono, e vale la soglia del movimento; si vietano fuori dai passi del
// gesto, dove a riposo non ce n'è mai, e non ce ne sono nemmeno a pagina sei
// volte più lenta.
//
// Dove va il tempo, a riposo: un movimento di un gruppo è circa 15 ms di
// lavoro, 4 per il percorso dei 300 connettori che lo seguono
// (`ConnectorPreview`), 5 per le maniglie e la barra, 3 per disegnare la
// bozza, il resto per il fotogramma. Un tasto sono circa 100 ms: 43 per
// rimettere a posto i pannelli e le maniglie (`refresh`), 23 perché il
// motore riscriva i 300 connettori, 20 per calcolare i loro percorsi
// (`followConnectors`); il rilascio di un gruppo è lo stesso lavoro, in un
// compito solo.
//
// A mille connettori (667 forme) le soglie non valgono: il lavoro cresce con
// i connettori. A riposo un movimento di un gruppo si dipinge in 49-61 ms
// (50° percentile), 90 al più; il rilascio costa da 450 a 540 ms e un tasto
// da 390 a 500.
//
// Dopo le corse il banco prova sé stesso: un file con una forma spostata, un
// connettore tolto, un aggancio cambiato o un'etichetta staccata deve fargli
// vedere la cosa fuori posto, e un movimento che tiene la pagina occupata
// 180 ms, un rilascio di 1030 e un compito di 80 senza nessun evento devono
// fargli vedere, ognuno, la soglia passata.
//
// Il referto, con ogni passo, sta in `.output/connectors-N.json`
// (`connectors-N-cpuK.json` a pagina rallentata).

import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";

/// Quanti connettori, se non lo si dice; e da quanti a quanti: quelli che il
/// disegno del banco sa fare (`connectors-fixture.ts`).
const DEFAULT_CONNECTORS = 300;
const LIMITS = [6, 2000];
/// Di quanto, al più, `--cpu` rallenta la pagina.
const CPU_LIMIT = 20;
/// Fino a quanti connettori valgono le soglie.
const GATED_CONNECTORS = 300;
/// Le soglie, dall'evento al fotogramma dipinto: quella di un movimento del
/// puntatore, quella di un passo che scrive (il rilascio, un tasto, Annulla),
/// e il 95° percentile degli intervalli fra due fotogrammi di una corsa che
/// trascina. Stanno da una volta e mezza a due volte sopra il peggio della
/// macchina piena, e la pagina quattro volte più lenta le rispetta.
const MOVE_LIMIT_MS = 150;
const COMMIT_LIMIT_MS = 1000;
const FRAME_P95_MS = 85;
/// Un compito lungo, per il browser: oltre i 50 ms. Fuori dai passi del gesto
/// non ce ne devono essere; dentro un passo, il passo li misura.
const LONG_TASK_MS = 50;
/// Quanto si aspetta dopo l'ultimo passo di una corsa, perché ciò che
/// l'editor rimanda arrivi dentro la corsa.
const TAIL_MS = 400;
/// Quanto si aspetta, al più, che il disegno si apra e che un passo si dipinga.
const OPEN_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 30_000;
/// Quante cose fuori posto dice la console; il referto le ha tutte.
const SHOWN_FAILURES = 20;

/// I movimenti del puntatore di un trascinamento.
const DRAG_MOVES = 60;
/// Quanto il trascinamento si allontana dall'oggetto preso, in pixel: sul
/// nodo, con la vista che lo inquadra, e sulle forme scelte insieme, con
/// tutto il disegno in vista.
const HUB_TRAVEL_PX = [90, 60];
const ALL_TRAVEL_PX = [70, 40];
/// L'ondeggiare del percorso, in pixel: perché i gomiti cambino strada.
const WOBBLE_PX = 14;
/// Le frecce di una corsa, in tre tratti, e di quanto ognuna sposta.
const ARROW_KEYS = [
  { key: "Shift+ArrowRight", dx: 10, dy: 0, times: 8 },
  { key: "Shift+ArrowDown", dx: 0, dy: 10, times: 8 },
  { key: "ArrowLeft", dx: -1, dy: 0, times: 8 },
];
/// Quanto la forma presa dal trascinamento può discostarsi dal puntatore, in
/// pixel: l'aggancio alle guide la sposta di poco.
const FOLLOW_SLACK_PX = 10;
/// Quanto un capo può stare fuori dal contorno della forma, oltre mezzo
/// spessore del contorno, in unità del disegno: la corda che approssima
/// l'ellisse e i due decimali del file.
const CONTOUR_SLACK = 0.6;
/// Quanto un'etichetta può stare lontana dalla sua linea, oltre la distanza
/// che porta, in unità del disegno: la metà del suo testo e la sua altezza.
const LABEL_SLACK = 90;
/// Quanti tasti si premono a una pausa l'uno dall'altro per vederli annullare
/// uno alla volta; la pausa supera i 500 ms con cui la cronologia fonde i passi.
/// Un tasto è al più un passo di Annulla: ventiquattro frecce si annullano in
/// ventiquattro Ctrl+Z al più, e in meno se la cronologia le ha fuse.
const SPACED_KEYS = 3;
const MERGE_PAUSE_MS = 650;
/// La tolleranza con cui il puntatore prende un oggetto, in pixel: quella
/// dell'editor per il mouse.
const HIT_PX = 4;
/// I tasti che non sono eventi da misurare.
const MODIFIERS = ["Control", "Shift", "Alt", "Meta"];

function args() {
  const out = { connectors: DEFAULT_CONNECTORS, cpu: 1 };
  for (let i = 2; i < process.argv.length; i++) {
    const m = /^--(connectors|cpu)(?:=(\d+))?$/.exec(process.argv[i]);
    if (!m) throw new RangeError(`argomento sconosciuto: ${process.argv[i]}`);
    const value = m[2] ?? process.argv[++i];
    if (!/^\d+$/.test(value ?? "")) throw new RangeError(`--${m[1]} vuole un numero`);
    out[m[1]] = Number(value);
  }
  if (out.connectors < LIMITS[0] || out.connectors > LIMITS[1]) throw new RangeError(`--connectors va da ${LIMITS[0]} a ${LIMITS[1]}`);
  if (out.cpu < 1 || out.cpu > CPU_LIMIT) throw new RangeError(`--cpu va da 1 a ${CPU_LIMIT}`);
  return { ...out, gated: out.connectors <= GATED_CONNECTORS };
}

// ---------------------------------------------------------------------------
// La sonda, nella pagina.
// ---------------------------------------------------------------------------

/// Mette nella pagina la sonda, `window.__connectorsProbe`: registra ogni
/// evento del gesto (pressione, movimento e rilascio del puntatore, tasti)
/// dal suo `timeStamp` al fotogramma dipinto dopo, e, fra `begin` ed `end`, i
/// fotogrammi, i compiti lunghi, i fotogrammi lunghi e le durate di Event
/// Timing. Con `plant(ms)` ogni evento misurato tiene occupata la pagina per
/// `ms`: è la lentezza della prova del banco.
async function installProbe(page, modifiers) {
  await page.evaluate((modifiers) => {
    const SKIPPED = new Set(modifiers);
    const EVENTS = ["pointerdown", "pointermove", "pointerup", "keydown"];
    const state = { active: false, run: 0, since: 0, steps: [], frames: [], waiter: null, planted: 0 };
    // Che cosa si osserva, con che cosa se ne tiene: i compiti lunghi, i
    // fotogrammi lunghi, le durate di Event Timing.
    const KINDS = {
      longtask: [{}, (e) => ({ start: e.startTime, duration: e.duration })],
      "long-animation-frame": [{}, (e) => ({
        start: e.startTime,
        duration: e.duration,
        blocking: e.blockingDuration,
        scripts: e.scripts.map((script) => ({
          invoker: script.invoker,
          source: `${script.sourceFunctionName || "?"} in ${script.sourceURL.replace(/^.*\//, "").replace(/\?.*$/, "") || "?"}`,
          duration: script.duration,
          forced: script.forcedStyleAndLayoutDuration,
        })),
      })],
      event: [{ durationThreshold: 16 }, (e) => ({ name: e.name, start: e.startTime, duration: e.duration })],
    };
    const observed = Object.fromEntries(Object.keys(KINDS).map((type) => [type, []]));
    const keep = (entry) => observed[entry.entryType]?.push(KINDS[entry.entryType][1](entry));
    const observers = [];
    const supported = Object.fromEntries(Object.entries(KINDS).map(([type, [options]]) => {
      try {
        const observer = new PerformanceObserver((list) => list.getEntries().forEach(keep));
        observer.observe({ type, ...options });
        observers.push(observer);
        return [type, true];
      } catch {
        return [type, false];
      }
    }));
    const drain = () => {
      for (const observer of observers) observer.takeRecords().forEach(keep);
    };
    /// I fotogrammi di una corsa, finché la corsa dura.
    const loop = (run) => (time) => {
      if (!state.active || state.run !== run) return;
      state.frames.push(time);
      requestAnimationFrame(loop(run));
    };
    for (const type of EVENTS) {
      addEventListener(type, (event) => {
        if (!state.active || (type === "keydown" && SKIPPED.has(event.key))) return;
        const step = {
          type,
          key: type === "keydown" ? event.key : null,
          at: event.timeStamp,
          dispatched: performance.now(),
          handled: null,
          frame: null,
          painted: null,
        };
        state.steps.push(step);
        requestAnimationFrame(() => {
          step.frame = performance.now();
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            step.painted = performance.now();
            channel.port1.close();
            state.waiter?.();
          };
          channel.port2.postMessage(null);
        });
        if (state.planted > 0) {
          const until = performance.now() + state.planted;
          while (performance.now() < until) {
            // La lentezza della prova: la pagina resta occupata.
          }
        }
      }, true);
      // In bolla sulla finestra: dopo l'editor, che ascolta sulla sua radice.
      addEventListener(type, (event) => {
        const step = state.steps[state.steps.length - 1];
        if (state.active && step !== undefined && step.handled === null && step.at === event.timeStamp) step.handled = performance.now();
      });
    }
    window.__connectorsProbe = Object.freeze({
      supported,
      plant: (ms) => { state.planted = ms; },
      /// Un compito lungo fuori da ogni evento del gesto: fra un fotogramma e
      /// l'altro, la pagina resta occupata per `ms`.
      stall: (ms) => new Promise((resolve) => setTimeout(() => {
        const until = performance.now() + ms;
        while (performance.now() < until) {
          // La lentezza della prova: la pagina resta occupata.
        }
        resolve();
      }, 120)),
      begin: () => {
        drain();
        for (const list of Object.values(observed)) list.length = 0;
        state.steps = [];
        state.frames = [];
        state.since = performance.now();
        state.active = true;
        state.run += 1;
        requestAnimationFrame(loop(state.run));
      },
      /// Aspetta che il passo `count` sia dipinto, e dice di che cosa era.
      painted: (count, timeoutMs) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.waiter = null;
          reject(new Error(`il passo ${count} non si è dipinto in ${timeoutMs} ms (${state.steps.length} eventi arrivati)`));
        }, timeoutMs);
        const check = () => {
          const step = state.steps[count - 1];
          if (step === undefined || step.painted === null) return;
          clearTimeout(timer);
          state.waiter = null;
          resolve({ steps: state.steps.length, type: step.type, key: step.key });
        };
        state.waiter = check;
        check();
      }),
      end: () => {
        state.active = false;
        drain();
        const since = state.since;
        const inside = (list) => list.filter((entry) => entry.start >= since);
        return {
          since,
          until: performance.now(),
          steps: state.steps,
          frames: state.frames,
          longtasks: inside(observed.longtask),
          longFrames: inside(observed["long-animation-frame"]),
          events: inside(observed.event).filter((entry) => EVENTS.includes(entry.name)),
        };
      },
    });
  }, modifiers);
}

// ---------------------------------------------------------------------------
// Il mondo, nella pagina: ciò che si vede e ciò che si salva.
// ---------------------------------------------------------------------------

/// Mette nella pagina `window.__connectorsWorld`, che legge il disegno com'è
/// dipinto e com'è salvato, e dice se ogni connettore sta dove deve:
///
/// - `check(text)`: il file salvato, riletto da zero. I connettori sono
///   quelli del disegno, ognuno agganciato alle sue forme e con la sua
///   punta; il suo `d` è la sua `fub:geom`; i suoi due capi stanno sul
///   contorno delle forme che uniscono, fuori al più di mezzo spessore; le
///   etichette stanno vicino alla loro linea; il numero degli elementi è
///   quello di prima.
/// - `compare(text)`: ciò che si vede è ciò che si salva, oggetto per oggetto.
/// - `keep(name)` e `diff(name)`: lo stato dipinto, fermato e confrontato.
/// - `tamper(text, how)`: il file salvato con un guasto, per la prova del
///   banco.
async function installWorld(page, fixture, tolerances) {
  await page.evaluate(([fixture, tolerances]) => {
    const FUB = "https://fubeo.github.io/ns/scene/1";
    const IDENTITY = [1, 0, 0, 1, 0, 0];
    const mul = (p, q) => [
      p[0] * q[0] + p[2] * q[1],
      p[1] * q[0] + p[3] * q[1],
      p[0] * q[2] + p[2] * q[3],
      p[1] * q[2] + p[3] * q[3],
      p[0] * q[4] + p[2] * q[5] + p[4],
      p[1] * q[4] + p[3] * q[5] + p[5],
    ];
    const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const invert = (m) => {
      const det = m[0] * m[3] - m[1] * m[2];
      if (det === 0) throw new Error("trasformazione non invertibile");
      return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    };
    const numbers = (text) => (text ?? "").match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    /// La trasformazione scritta: `matrix` e `translate`, che sono quelle che
    /// l'editor scrive; ogni altra si dice, e non si indovina.
    const transformOf = (text) => {
      if (text === null || text.trim() === "") return IDENTITY;
      let m = IDENTITY;
      const rest = text.replace(/(matrix|translate)\s*\(([^)]*)\)/g, (_, name, list) => {
        const n = numbers(list);
        m = mul(m, name === "matrix" ? n : [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
        return "";
      });
      if (rest.replace(/[\s,]/g, "") !== "") throw new Error(`una trasformazione che il banco non sa leggere: ${text}`);
      return m;
    };
    /// La trasformazione dell'elemento nel disegno: quella sua, dopo quelle
    /// degli avi.
    const matrixOf = (element) => {
      const chain = [];
      for (let each = element; each !== null && each.nodeType === 1; each = each.parentNode) chain.unshift(each);
      return chain.reduce((m, each) => mul(m, transformOf(each.getAttribute("transform"))), IDENTITY);
    };
    const toSegment = (p, a, b) => {
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const length = ex * ex + ey * ey;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / length));
      return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
    };
    /// La distanza di `p`, nelle coordinate dell'elemento, dal contorno della
    /// forma: del rettangolo (con gli angoli tondi), dell'ellisse, del
    /// poligono.
    const contourDistance = (element, p) => {
      const n = (name) => Number(element.getAttribute(name) ?? 0);
      if (element.localName === "rect") {
        const [w, h] = [n("width"), n("height")];
        const r = Math.min(n("rx") || n("ry"), w / 2, h / 2);
        const qx = Math.abs(p[0] - (n("x") + w / 2)) - (w / 2 - r);
        const qy = Math.abs(p[1] - (n("y") + h / 2)) - (h / 2 - r);
        return Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
      }
      if (element.localName === "ellipse") {
        const [dx, dy, rx, ry] = [p[0] - n("cx"), p[1] - n("cy"), n("rx"), n("ry")];
        const f = (dx / rx) ** 2 + (dy / ry) ** 2 - 1;
        const g = Math.hypot((2 * dx) / (rx * rx), (2 * dy) / (ry * ry));
        return g === 0 ? Math.min(rx, ry) : Math.abs(f) / g;
      }
      if (element.localName === "polygon") {
        const list = numbers(element.getAttribute("points"));
        const points = Array.from({ length: list.length / 2 }, (_, k) => [list[2 * k], list[2 * k + 1]]);
        return Math.min(...points.map((point, k) => toSegment(p, point, points[(k + 1) % points.length])));
      }
      throw new Error(`una forma che il banco non sa misurare: ${element.localName}`);
    };
    /// La linea di un connettore, nel disegno: i suoi punti, e per la curva
    /// una ventina di punti sulla Bézier.
    const polyline = (kind, points) => {
      if (kind !== "curved") return points;
      const [a, b, c, d] = points;
      return Array.from({ length: 21 }, (_, k) => {
        const t = k / 20;
        const u = 1 - t;
        return [0, 1].map((i) => u ** 3 * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t ** 3 * d[i]);
      });
    };
    const surface = () => document.querySelector(".draw-editor .draw-surface");
    const painted = (id) => surface().querySelector(`[data-scene-id="${id}"]`);
    const KEYS = ["d", "transform", "x", "y", "width", "height", "cx", "cy", "rx", "ry", "points"];
    const same = (x, y) => {
      const [a, b] = [numbers(x), numbers(y)];
      return a.length === b.length && a.every((value, k) => Math.abs(value - b[k]) <= 0.006);
    };
    /// Il centro di una forma dipinta, nel disegno: quello dei suoi punti, con
    /// la trasformazione che porta lei, e non quelle del foglio.
    const middle = (element) => {
      const n = (name) => Number(element.getAttribute(name) ?? 0);
      let local;
      if (element.localName === "rect") local = [n("x") + n("width") / 2, n("y") + n("height") / 2];
      else if (element.localName === "ellipse") local = [n("cx"), n("cy")];
      else {
        const list = numbers(element.getAttribute("points"));
        const count = list.length / 2;
        local = [0, 1].map((axis) => list.filter((_, k) => k % 2 === axis).reduce((sum, value) => sum + value, 0) / count);
      }
      return apply(transformOf(element.getAttribute("transform")), local);
    };
    const home = new Map(fixture.shapes.map((shape) => [shape.id, middle(painted(shape.id))]));
    /// Le cose che stanno sopra le forme, sullo schermo: i punti dei
    /// connettori ogni due pixel, raccolti in caselle da 16, e i riquadri
    /// delle etichette. Il disegno non prende il puntatore (`pointer-events:
    /// none`): chi sceglie è l'editor, con la sua tolleranza, quindi si misura
    /// la distanza invece di chiedere al browser chi sta sotto.
    const above = () => {
      const CELL = 16;
      const cells = new Map();
      for (const line of fixture.connectors) {
        const element = painted(line.id);
        const m = element.getScreenCTM();
        const length = element.getTotalLength();
        const step = 2 / Math.max(Math.hypot(m.a, m.b), 1e-6);
        for (let at = 0; at <= length + step; at += step) {
          const p = element.getPointAtLength(Math.min(at, length));
          const [x, y] = [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f];
          const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(x, y);
        }
      }
      const labels = fixture.labels.map((id) => painted(id).getBoundingClientRect());
      return (x, y) => {
        let best = CELL;
        const [cx, cy] = [Math.floor(x / CELL), Math.floor(y / CELL)];
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            const list = cells.get(`${cx + i},${cy + j}`);
            for (let k = 0; list !== undefined && k < list.length; k += 2) best = Math.min(best, Math.hypot(list[k] - x, list[k + 1] - y));
          }
        }
        for (const r of labels) best = Math.min(best, Math.hypot(Math.max(r.x - x, 0, x - r.right), Math.max(r.y - y, 0, y - r.bottom)));
        return best;
      };
    };
    const grab = (ids, central) => {
      const clearance = above();
      const area = surface().getBoundingClientRect();
      let best = null;
      for (const id of ids) {
        const element = painted(id);
        const r = element.getBoundingClientRect();
        if (central && (r.x + r.width / 2 < area.x + area.width / 4 || r.x + r.width / 2 > area.right - area.width / 4 || r.y + r.height / 2 < area.y + area.height / 4 || r.y + r.height / 2 > area.bottom - area.height / 4)) continue;
        const inverse = element.getScreenCTM().inverse();
        const inside = (x, y) => element.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse));
        const grid = 9;
        for (let i = 0; i < grid; i++) {
          for (let j = 0; j < grid; j++) {
            const [x, y] = [r.x + ((i + 0.5) * r.width) / grid, r.y + ((j + 0.5) * r.height) / grid];
            if (!inside(x, y) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inside(x + dx, y + dy))) continue;
            const room = clearance(x, y);
            if (best === null || room > best[2]) best = [x, y, room];
          }
        }
      }
      return best;
    };
    const kept = new Map();
    const shapesById = new Map(fixture.shapes.map((shape) => [shape.id, shape]));
    const connectorsByLabel = new Map(fixture.connectors.filter((line) => line.label !== null).map((line) => [line.label, line]));
    const parse = (text) => {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("il file salvato non è XML");
      return doc;
    };
    const idsOf = (doc) => {
      const byId = new Map();
      for (const element of doc.getElementsByTagName("*")) {
        const id = element.getAttribute("id");
        if (id !== null) byId.set(id, element);
      }
      return byId;
    };

    window.__connectorsWorld = Object.freeze({
      /// Il riquadro di un oggetto dipinto sullo schermo: x, y, larghezza,
      /// altezza; e quello del foglio.
      box: (id) => {
        const r = painted(id)?.getBoundingClientRect();
        return r === undefined ? null : [r.x, r.y, r.width, r.height];
      },
      area: () => {
        const r = surface().getBoundingClientRect();
        return [r.x + surface().clientLeft, r.y + surface().clientTop, surface().clientWidth, surface().clientHeight];
      },
      /// Un punto, sullo schermo, dove premere per prendere una delle forme di
      /// `ids` (tutte, se è `null`; allora solo quelle nella metà di mezzo del
      /// foglio): quello del loro corpo che sta più lontano da ogni altra cosa
      /// dipinta sopra di loro. Dà il punto e la distanza, in pixel.
      grab: (ids) => grab(ids ?? fixture.shapes.map((shape) => shape.id), ids === null),
      /// Quanti pixel sono un'unità del disegno.
      scale: () => painted(fixture.shapes[0].id).getScreenCTM().a,
      count: () => surface().querySelectorAll("[data-scene-id]").length,
      /// Di quanto una forma dipinta si è spostata dall'apertura: il suo
      /// centro, che sia scritto in una trasformazione o nei punti.
      shift: (id) => {
        const [x, y] = middle(painted(id));
        return [x - home.get(id)[0], y - home.get(id)[1]];
      },
      /// Le forme spostate, e di quanto: quante, e il più piccolo e il più
      /// grande spostamento in x e in y.
      shifted: () => {
        const out = { moved: 0, dx: [Infinity, -Infinity], dy: [Infinity, -Infinity] };
        for (const shape of fixture.shapes) {
          const [x, y] = middle(painted(shape.id));
          const [dx, dy] = [x - home.get(shape.id)[0], y - home.get(shape.id)[1]];
          if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) continue;
          out.moved += 1;
          out.dx = [Math.min(out.dx[0], dx), Math.max(out.dx[1], dx)];
          out.dy = [Math.min(out.dy[0], dy), Math.max(out.dy[1], dy)];
        }
        return out;
      },
      /// Lo stato dipinto, fermato col nome `name`; e ciò che da allora è cambiato.
      keep: (name) => {
        const state = {};
        for (const element of surface().querySelectorAll("[data-scene-id]")) {
          state[element.getAttribute("data-scene-id")] = KEYS.map((key) => element.getAttribute(key) ?? "").join("|");
        }
        kept.set(name, state);
        return Object.keys(state).length;
      },
      diff: (name) => {
        const before = kept.get(name);
        const changed = [];
        const seen = new Set();
        for (const element of surface().querySelectorAll("[data-scene-id]")) {
          const id = element.getAttribute("data-scene-id");
          seen.add(id);
          if (before[id] !== KEYS.map((key) => element.getAttribute(key) ?? "").join("|")) changed.push(id);
        }
        for (const id of Object.keys(before)) if (!seen.has(id)) changed.push(id);
        return changed;
      },
      /// Ciò che si vede è ciò che si salva: oggetto per oggetto, `d`,
      /// trasformazione e misure.
      compare: (text) => {
        const byId = idsOf(parse(text));
        const wrong = [];
        for (const element of surface().querySelectorAll("[data-scene-id]")) {
          const id = element.getAttribute("data-scene-id");
          const saved = byId.get(id);
          if (saved === undefined) {
            wrong.push(`${id}: dipinto, ma non nel file salvato`);
            continue;
          }
          for (const key of KEYS) {
            const [seen, written] = [element.getAttribute(key), saved.getAttribute(key)];
            if (key === "transform" ? !same(seen === null ? "1 0 0 1 0 0" : seen, written === null ? "1 0 0 1 0 0" : written) : seen !== null && written !== null && !same(seen, written)) {
              wrong.push(`${id}: ${key} dipinto «${seen}», salvato «${written}»`);
            }
          }
        }
        return wrong.slice(0, 20);
      },
      /// Il file salvato, riletto da zero.
      check: (text) => {
        const failures = [];
        const fail = (message) => failures.push(message);
        const doc = parse(text);
        const all = [...doc.getElementsByTagName("*")];
        const byId = idsOf(doc);
        const lines = all.filter((element) => element.getAttributeNS(FUB, "shape") === "connector");
        const stats = { elements: all.length, connectors: lines.length, ends: 0, endOffMax: 0, endOffWorst: null, labels: 0, labelOffMax: 0, labelOffWorst: null };
        if (all.length !== fixture.elements) fail(`gli elementi sono ${all.length} invece di ${fixture.elements}`);
        if (lines.length !== fixture.connectors.length) fail(`i connettori sono ${lines.length} invece di ${fixture.connectors.length}`);
        for (const shape of fixture.shapes) {
          const element = byId.get(shape.id);
          if (element === undefined) fail(`la forma ${shape.id} non c'è più`);
          else if (element.localName !== (shape.kind === "polygon" ? "polygon" : shape.kind)) fail(`la forma ${shape.id} è un ${element.localName} invece di un ${shape.kind}`);
          else if (element.getAttributeNS(FUB, "name") !== shape.name) fail(`la forma ${shape.id} non si chiama più «${shape.name}»`);
        }
        const drawn = new Map();
        for (const line of fixture.connectors) {
          const element = byId.get(line.id);
          if (element === undefined || element.getAttributeNS(FUB, "shape") !== "connector") {
            fail(`il connettore ${line.id} non c'è più`);
            continue;
          }
          const ends = { from: line.from, to: line.to };
          for (const [name, end] of Object.entries(ends)) {
            const written = element.getAttributeNS(FUB, name);
            if (written !== `${end.id} ${end.anchor}`) fail(`${line.id}: fub:${name} è «${written}» invece di «${end.id} ${end.anchor}»`);
          }
          if ((element.getAttribute("marker-end") !== null) !== line.tip) fail(`${line.id}: la punta ${line.tip ? "manca" : "è comparsa"}`);
          const geom = (element.getAttributeNS(FUB, "geom") ?? "").trim().split(/\s+/);
          const values = numbers(geom.slice(1).join(" "));
          if (geom[0] !== line.kind) fail(`${line.id}: è ${geom[0]} invece di ${line.kind}`);
          if (!same(element.getAttribute("d"), values.join(" "))) fail(`${line.id}: il d non è la fub:geom`);
          const m = matrixOf(element);
          const points = Array.from({ length: values.length / 2 }, (_, k) => apply(m, [values[2 * k], values[2 * k + 1]]));
          drawn.set(line.id, polyline(line.kind, points));
          for (const [name, point] of [["from", points[0]], ["to", points[points.length - 1]]]) {
            const target = byId.get(ends[name].id);
            if (target === undefined) continue;
            const reach = shapesById.get(ends[name].id).reach;
            const off = contourDistance(target, apply(invert(matrixOf(target)), point)) - reach;
            stats.ends += 1;
            if (off > stats.endOffMax) {
              stats.endOffMax = off;
              stats.endOffWorst = `${line.id} fub:${name} su ${ends[name].id}`;
            }
            if (off > tolerances.contour) fail(`${line.id}: il capo fub:${name} sta a ${off.toFixed(2)} dal contorno di ${ends[name].id}`);
          }
        }
        for (const label of fixture.labels) {
          const element = byId.get(label);
          const line = connectorsByLabel.get(label);
          if (element === undefined || line === undefined) {
            fail(`l'etichetta ${label} non c'è più`);
            continue;
          }
          const along = (element.getAttributeNS(FUB, "along") ?? "").trim().split(/\s+/);
          const [t, offset] = [Number(along[1]), Number(along[2])];
          if (along.length !== 3 || along[0] !== line.id || !(t >= 0 && t <= 1) || !Number.isFinite(offset)) {
            fail(`${label}: fub:along è «${along.join(" ")}» e non sta su ${line.id}`);
            continue;
          }
          const path = drawn.get(line.id);
          if (path === undefined) continue;
          const anchor = apply(matrixOf(element), [0, 0]);
          const away = Math.min(...path.slice(0, -1).map((point, k) => toSegment(anchor, point, path[k + 1]))) - Math.abs(offset);
          stats.labels += 1;
          if (away > stats.labelOffMax) {
            stats.labelOffMax = away;
            stats.labelOffWorst = label;
          }
          if (away > tolerances.label) fail(`${label}: sta a ${away.toFixed(1)} oltre la distanza dalla sua linea ${line.id}`);
        }
        const round = (value) => Math.round(value * 1000) / 1000;
        return { failures: failures.slice(0, 40), failureCount: failures.length, stats: { ...stats, endOffMax: round(stats.endOffMax), labelOffMax: round(stats.labelOffMax) } };
      },
      /// Il file salvato con un guasto: `shape` sposta una forma di 60 unità
      /// senza i suoi connettori, `drop` toglie un connettore, `rewire`
      /// aggancia un capo a un'altra forma, `strand` stacca un'etichetta.
      tamper: (text, how) => {
        const doc = parse(text);
        const byId = idsOf(doc);
        const line = fixture.connectors.find((each) => each.label !== null && each.tip);
        if (how === "shape") {
          const element = byId.get(line.from.id);
          element.setAttribute("transform", `translate(60 0) ${element.getAttribute("transform") ?? ""}`);
        } else if (how === "drop") {
          byId.get(line.id).remove();
        } else if (how === "rewire") {
          const other = fixture.shapes.find((shape) => shape.id !== line.from.id && shape.id !== line.to.id);
          byId.get(line.id).setAttributeNS(FUB, "fub:from", `${other.id} ${line.from.anchor}`);
        } else if (how === "strand") {
          const element = byId.get(line.label);
          element.setAttribute("transform", `translate(600 600) ${element.getAttribute("transform") ?? ""}`);
        } else {
          throw new Error(`guasto sconosciuto: ${how}`);
        }
        return new XMLSerializer().serializeToString(doc);
      },
    });
  }, [fixture, tolerances]);
}

// ---------------------------------------------------------------------------
// I numeri.
// ---------------------------------------------------------------------------

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const stats = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { count: 0, p50: null, p95: null, max: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { count: a.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(a[a.length - 1]) };
};

/// I fotogrammi lunghi di una corsa: quanto durano, quanto bloccano, e gli
/// script che ci pesano di più, sommati per chi li chiama. Il resto della
/// loro durata è del browser: stile, layout, pittura.
function longFrames(frames) {
  const scripts = new Map();
  for (const frame of frames) {
    for (const script of frame.scripts) {
      const key = `${script.invoker} · ${script.source}`;
      const seen = scripts.get(key) ?? { script: key, count: 0, totalMs: 0, maxMs: 0, forcedLayoutMs: 0 };
      seen.count += 1;
      seen.totalMs += script.duration;
      seen.maxMs = Math.max(seen.maxMs, script.duration);
      seen.forcedLayoutMs += script.forced;
      scripts.set(key, seen);
    }
  }
  const heaviest = [...scripts.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 5)
    .map((seen) => ({ ...seen, totalMs: round(seen.totalMs), maxMs: round(seen.maxMs), forcedLayoutMs: round(seen.forcedLayoutMs) }));
  return {
    ...stats(frames.map((frame) => frame.duration)),
    blockingMs: stats(frames.map((frame) => frame.blocking)),
    scripts: heaviest,
  };
}

/// I passi e i fotogrammi di una corsa, in numeri.
function summarize(probe, labels) {
  const steps = probe.steps.map((step, i) => {
    const timing = probe.events.find((entry) => entry.name === step.type && Math.abs(entry.start - step.at) < 0.5);
    return {
      label: labels[i] ?? null,
      type: step.type,
      key: step.key,
      startMs: round(step.at - probe.since),
      endMs: round(step.painted - probe.since),
      latencyMs: round(step.painted - step.at),
      inputDelayMs: round(step.dispatched - step.at),
      handlerMs: step.handled === null ? null : round(step.handled - step.dispatched),
      renderMs: round(step.painted - step.frame),
      presentedMs: timing ? round(timing.duration) : null,
    };
  });
  const intervals = probe.frames.slice(1).map((time, i) => time - probe.frames[i]);
  const frame = stats(intervals);
  const moves = steps.filter((step) => step.type === "pointermove");
  const commits = steps.filter((step) => step.type !== "pointermove");
  const latency = (list) => stats(list.map((step) => step.latencyMs));
  return {
    steps,
    latencyMs: latency(steps),
    moves: { latencyMs: latency(moves), handlerMs: stats(moves.map((step) => step.handlerMs)), renderMs: stats(moves.map((step) => step.renderMs)) },
    commits: { latencyMs: latency(commits), handlerMs: stats(commits.map((step) => step.handlerMs)), renderMs: stats(commits.map((step) => step.renderMs)) },
    frames: { ...frame, long: intervals.filter((value) => value > 1.5 * (frame.p50 ?? Infinity)).length },
    longTasks: probe.longtasks.map((entry) => ({ startMs: round(entry.start - probe.since), durationMs: round(entry.duration) })),
    longFrames: longFrames(probe.longFrames),
    eventTiming: { ...stats(steps.map((step) => step.presentedMs)), note: "solo gli eventi oltre i 16 ms, arrotondati a 8 ms" },
    wallMs: round(probe.until - probe.since),
  };
}

/// Ciò che una corsa sbaglia contro le soglie:
///
/// - la pressione e ogni movimento del puntatore si dipingono entro
///   `MOVE_LIMIT_MS`;
/// - un passo che scrive (il rilascio, un tasto, Annulla) si dipinge entro
///   `COMMIT_LIMIT_MS`;
/// - nessun compito lungo fuori dai passi del gesto: ciò che l'editor
///   rimanda a dopo il gesto, o fa fra un evento e l'altro, non blocca la
///   pagina; dentro un passo, il compito è parte della sua misura;
/// - con `smooth`, il 95° percentile degli intervalli fra i fotogrammi di una
///   corsa che trascina è entro `FRAME_P95_MS`.
function verdict(run, { name, smooth = false }) {
  const failures = [];
  const inside = (task) => run.steps.some((step) => task.startMs >= step.startMs - 5 && task.startMs <= step.endMs);
  for (const task of run.longTasks) {
    if (task.durationMs > LONG_TASK_MS && !inside(task)) {
      failures.push(`${name}: un compito lungo di ${task.durationMs} ms, a ${task.startMs} ms dall'inizio della corsa, fuori da ogni passo`);
    }
  }
  for (const step of run.steps) {
    const limit = step.type === "pointermove" || step.type === "pointerdown" ? MOVE_LIMIT_MS : COMMIT_LIMIT_MS;
    if (!(step.latencyMs <= limit)) failures.push(`${step.label}: dipinto dopo ${step.latencyMs} ms, oltre i ${limit}`);
  }
  if (smooth && !(run.frames.p95 <= FRAME_P95_MS)) failures.push(`${name}: i fotogrammi: il 95° percentile degli intervalli è ${run.frames.p95} ms, oltre i ${FRAME_P95_MS}`);
  return failures;
}

// ---------------------------------------------------------------------------
// I passi, e ciò che ogni passo deve mostrare.
// ---------------------------------------------------------------------------

/// Un gesto che fa un'altra cosa da quella che doveva, o che lascia il
/// disegno sbagliato.
class WrongStep extends Error {}

const newRun = () => ({ count: 0, labels: [] });
const frames = (page, n = 2) =>
  page.evaluate((n) => new Promise((resolve) => {
    let left = n;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
const world = (page, method, ...argv) => page.evaluate(([method, argv]) => window.__connectorsWorld[method](...argv), [method, argv]);
const live = (page) => page.evaluate(() => document.querySelector('.draw-editor > [role="status"][aria-live="polite"]')?.textContent?.trim() ?? "");

/// Un evento del gesto: lo manda, aspetta che il fotogramma sia dipinto, e
/// guarda che sia arrivato uno solo, di quel tipo.
async function emit(page, run, label, type, send) {
  await send();
  run.count += 1;
  const seen = await page.evaluate(([count, timeoutMs]) => window.__connectorsProbe.painted(count, timeoutMs), [run.count, STEP_TIMEOUT_MS]);
  if (seen.steps !== run.count) throw new WrongStep(`${label}: arrivati ${seen.steps} eventi invece di ${run.count}`);
  if (seen.type !== type) throw new WrongStep(`${label}: era un ${seen.type} invece di un ${type}`);
  run.labels.push(label);
}

/// La coda di una corsa, e ciò che la sonda ha visto.
async function finish(page, run) {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), TAIL_MS);
  const probe = await page.evaluate(() => window.__connectorsProbe.end());
  return summarize(probe, run.labels);
}

const begin = (page) => page.evaluate(() => window.__connectorsProbe.begin());

/// Il percorso del puntatore: `moves` passi da `start`, `travel` più in là
/// con un ondeggiare, che non torna mai al punto di partenza.
function pathOf(start, travel, moves) {
  return Array.from({ length: moves }, (_, k) => {
    const t = (k + 1) / moves;
    return [
      start[0] + travel[0] * t + WOBBLE_PX * Math.sin(2 * Math.PI * 3 * t),
      start[1] + travel[1] * t + WOBBLE_PX * (Math.cos(2 * Math.PI * 3 * t) - 1),
    ];
  });
}

/// Quante chiamate ha fatto il disegno all'host finora.
const mark = (page) => page.evaluate(() => window.bench.calls.length);

/// Il testo che il disegno ha scritto dopo la chiamata numero `since`: salva
/// con Ctrl+S, e prende l'ultima scrittura. Il disegno si salva anche da sé,
/// poco dopo l'ultimo cambio, e allora Ctrl+S non ha niente da scrivere: la
/// scrittura giusta è quella già fatta. Se è vecchia, ciò che si vede non è ciò
/// che è scritto, e `verify` lo dice.
async function save(page, since) {
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(
    (since) => window.bench.calls.some((call, i) => i >= since && call.gate === "writeDocument"),
    since,
    { timeout: STEP_TIMEOUT_MS },
  );
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  return page.evaluate(() => {
    const writes = window.bench.calls.filter((call) => call.gate === "writeDocument");
    return writes[writes.length - 1].args[1];
  });
}

/// L'ultimo file salvato dal banco: la prova del banco lo guasta.
let lastSaved = null;

/// Controlla il disegno dopo un gesto: salvato e riletto, i connettori sono
/// tutti ai loro posti; e ciò che si vede è ciò che si salva.
async function verify(page, label, since) {
  const text = await save(page, since);
  lastSaved = text;
  const saved = await world(page, "check", text);
  if (saved.failureCount > 0) {
    const more = saved.failureCount > saved.failures.length ? `, e altre ${saved.failureCount - saved.failures.length}` : "";
    throw new WrongStep(`${label}: il file salvato ha ${saved.failureCount} cose fuori posto: ${saved.failures.slice(0, 4).join("; ")}${more}`);
  }
  const seen = await world(page, "compare", text);
  if (seen.length > 0) throw new WrongStep(`${label}: ciò che si vede non è ciò che si salva: ${seen.slice(0, 3).join("; ")}`);
  return { text, stats: saved.stats };
}

/// Un solo Ctrl+Z, misurato: deve rimettere tutto com'era.
async function undoOnce(page, label, kept) {
  const run = newRun();
  await page.focus(".draw-editor .draw-surface");
  await begin(page);
  await emit(page, run, `${label}: Ctrl+Z`, "keydown", () => page.keyboard.press("Control+z"));
  const summary = await finish(page, run);
  const changed = await world(page, "diff", kept);
  if (changed.length > 0) throw new WrongStep(`${label}: dopo un Ctrl+Z ${changed.length} oggetti non sono com'erano (${changed.slice(0, 4).join(", ")})`);
  return summary;
}

// ---------------------------------------------------------------------------
// La vista, la scelta.
// ---------------------------------------------------------------------------

/// Il centro, sullo schermo, di un oggetto dipinto.
async function centerOf(page, id) {
  const box = await world(page, "box", id);
  if (box === null) throw new WrongStep(`${id} non è dipinto`);
  return [box[0] + box[2] / 2, box[1] + box[3] / 2];
}

/// Aspetta che un oggetto smetta di muoversi sullo schermo.
async function settle(page, id) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    await frames(page, 3);
    const now = JSON.stringify(await world(page, "box", id));
    if (now === last) return;
    last = now;
  }
  throw new WrongStep(`la vista non si ferma: ${id} si muove ancora`);
}

/// Tutto il disegno in vista, lo strumento Selezione, niente di scelto.
async function overview(page, anchor) {
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.keyboard.press("Shift+1");
  await settle(page, anchor);
}

/// La vista sul nodo `hub`: tutto in vista, poi lo zoom attorno al nodo e il
/// nodo portato al centro del foglio.
async function focusOn(page, hub) {
  await overview(page, hub);
  const [x, y] = await centerOf(page, hub);
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -100);
    await frames(page, 3);
  }
  await page.keyboard.up("Control");
  await settle(page, hub);
  const [ax, ay, aw, ah] = await world(page, "area");
  const [hx, hy] = await centerOf(page, hub);
  await page.mouse.wheel(hx - (ax + aw / 2), hy - (ay + ah / 2));
  await settle(page, hub);
  const box = await world(page, "box", hub);
  const margin = 40;
  if (box[0] < ax + margin || box[1] < ay + margin || box[0] + box[2] > ax + aw - margin || box[1] + box[3] > ay + ah - margin) {
    throw new WrongStep(`il nodo ${hub} non sta nel mezzo della vista: ${box.map(round).join(", ")} in ${[ax, ay, aw, ah].map(round).join(", ")}`);
  }
  return { area: { width: aw, height: ah }, hubBox: box.map(round), scale: round(await world(page, "scale")) };
}

/// Dove premere per prendere la forma `id`, o una delle forme in mezzo al
/// foglio se è `null`: un punto del suo corpo a più di HIT_PX dalle cose
/// che le stanno sopra, o l'editor prenderebbe quelle.
async function grabOne(page, id) {
  const best = await world(page, "grab", id === null ? null : [id]);
  if (best === null || best[2] <= HIT_PX) {
    throw new WrongStep(`${id ?? "nessuna forma"} non si prende: il punto più libero sta a ${best === null ? "—" : round(best[2])} px dalle altre cose, e il puntatore ne prende ${HIT_PX}`);
  }
  return [best[0], best[1]];
}

/// Quanti oggetti dice di aver scelto il disegno.
async function chosen(page) {
  const said = /(\d+) oggett/.exec(await live(page));
  return said === null ? null : Number(said[1]);
}

/// Sceglie tutto, con Ctrl+A.
async function chooseAll(page, expected) {
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  const count = await chosen(page);
  if (count !== expected) throw new WrongStep(`Ctrl+A doveva scegliere ${expected} oggetti, ne dice ${count}`);
}

/// Sceglie le sole forme, e le etichette: con un connettore, «Stesso tipo di
/// oggetto» sceglie tutti i connettori, e «Inverti la selezione» tutto il
/// resto. Prova i connettori in vista finché uno è quello che si prende.
async function chooseShapes(page, fixture, hub) {
  const [ax, ay, aw, ah] = await world(page, "area");
  const candidates = fixture.connectors.filter((line) => line.from.id === hub || line.to.id === hub);
  const expectedLines = fixture.connectors.length;
  const expectedRest = fixture.shapes.length + fixture.labels.length;
  const tried = [];
  for (const line of candidates.slice(0, 8)) {
    const middle = await page.evaluate((id) => {
      const element = document.querySelector(`.draw-surface [data-scene-id="${id}"]`);
      if (element === null) return null;
      const p = element.getPointAtLength(element.getTotalLength() / 2);
      const m = element.getScreenCTM();
      return [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f];
    }, line.id);
    if (middle === null || middle[0] < ax + 20 || middle[1] < ay + 20 || middle[0] > ax + aw - 20 || middle[1] > ay + ah - 20) continue;
    await page.focus(".draw-editor .draw-surface");
    await page.keyboard.press("Escape");
    await page.mouse.click(middle[0], middle[1], { button: "right" });
    await page.getByRole("menuitem", { name: "Stesso tipo di oggetto" }).click();
    const lines = await chosen(page);
    tried.push(`${line.id}: ${lines}`);
    if (lines !== expectedLines) continue;
    await page.focus(".draw-editor .draw-surface");
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Inverti la selezione" }).click();
    const rest = await chosen(page);
    if (rest !== expectedRest) throw new WrongStep(`le forme e le etichette sono ${expectedRest}, il disegno ne sceglie ${rest}`);
    await page.focus(".draw-editor .draw-surface");
    return;
  }
  throw new WrongStep(`nessun connettore del nodo si sceglie col clic destro (${tried.join("; ") || "nessuno in vista"})`);
}

// ---------------------------------------------------------------------------
// Le corse.
// ---------------------------------------------------------------------------

/// Il trascinamento col mouse: preme su `start`, percorre `DRAG_MOVES` passi,
/// rilascia; poi controlla, e un Ctrl+Z rimette tutto.
///
/// `kind` dice che cosa si trascina: `hub`, il solo nodo, e solo i suoi
/// connettori cambiano; `group`, tutta la scelta, che sposta ogni forma di
/// uno stesso tratto.
async function dragRun(page, fixture, { name, kind, start, travel, hub }) {
  const label = name;
  await world(page, "keep", name);
  const since = await mark(page);
  const scale = await world(page, "scale");
  const objects = await world(page, "count");
  const run = newRun();
  await page.mouse.move(start[0], start[1]);
  await frames(page, 2);
  await begin(page);
  await emit(page, run, `${label}: pressione`, "pointerdown", () => page.mouse.down());
  const path = pathOf(start, travel, DRAG_MOVES);
  for (const [k, [x, y]] of path.entries()) {
    await emit(page, run, `${label}: movimento ${k + 1}`, "pointermove", () => page.mouse.move(x, y));
  }
  await emit(page, run, `${label}: rilascio`, "pointerup", () => page.mouse.up());
  const gesture = await finish(page, run);
  const said = await live(page);

  // Dove si è arrivati, e che cosa si è mosso.
  const end = path[path.length - 1];
  const wanted = [end[0] - start[0], end[1] - start[1]];
  const shifted = await world(page, "shifted");
  if (kind === "hub") {
    if (shifted.moved !== 1) throw new WrongStep(`${label}: si sono mosse ${shifted.moved} forme invece di una; il disegno dice «${said}»`);
    const [dx, dy] = await world(page, "shift", hub);
    const off = Math.hypot(dx * scale - wanted[0], dy * scale - wanted[1]);
    if (off > FOLLOW_SLACK_PX) throw new WrongStep(`${label}: il nodo è andato dove il puntatore a ${round(off)} px di distanza (più di ${FOLLOW_SLACK_PX})`);
    const changed = await world(page, "diff", name);
    const around = fixture.connectors.filter((line) => line.from.id === hub || line.to.id === hub);
    const attached = new Set(around.map((line) => line.id));
    const carried = new Set(around.flatMap((line) => (line.label === null ? [] : [line.label])));
    const strays = changed.filter((id) => id !== hub && !attached.has(id) && !carried.has(id));
    if (strays.length > 0) throw new WrongStep(`${label}: si sono mossi anche ${strays.length} oggetti che non c'entrano (${strays.slice(0, 4).join(", ")})`);
    const still = [...attached].filter((id) => !changed.includes(id));
    if (still.length > 0) throw new WrongStep(`${label}: ${still.length} connettori del nodo non l'hanno seguito (${still.slice(0, 4).join(", ")})`);
  } else {
    if (shifted.moved !== fixture.shapes.length) throw new WrongStep(`${label}: si sono mosse ${shifted.moved} forme invece di ${fixture.shapes.length}`);
    const [mx, my] = [shifted.dx[1] - shifted.dx[0], shifted.dy[1] - shifted.dy[0]];
    if (mx > 0.01 || my > 0.01) throw new WrongStep(`${label}: le forme non si sono mosse tutte dello stesso tratto (${round(mx)}, ${round(my)} di differenza)`);
    const off = Math.hypot(shifted.dx[0] * scale - wanted[0], shifted.dy[0] * scale - wanted[1]);
    if (off > FOLLOW_SLACK_PX) throw new WrongStep(`${label}: le forme sono andate dove il puntatore a ${round(off)} px di distanza (più di ${FOLLOW_SLACK_PX})`);
    const changed = await world(page, "diff", name);
    const lines = new Set(fixture.connectors.map((line) => line.id));
    const still = [...lines].filter((id) => !changed.includes(id));
    if (still.length > 0) throw new WrongStep(`${label}: ${still.length} connettori non hanno seguito le forme (${still.slice(0, 4).join(", ")})`);
  }
  if ((await world(page, "count")) !== objects) throw new WrongStep(`${label}: gli oggetti dipinti non sono più ${objects}`);
  const checked = await verify(page, label, since);
  const undo = await undoOnce(page, label, name);
  return { objects, moved: shifted.moved, said, wantedPx: wanted.map(round), gesture, check: checked.stats, undo };
}

/// Le frecce sulla selezione: ogni tasto fa un passo, e un passo di Annulla;
/// poi controlla, e tanti Ctrl+Z quanti tasti rimettono tutto, uno alla volta.
async function keysRun(page, fixture, { name, hub }) {
  const label = name;
  await world(page, "keep", name);
  const since = await mark(page);
  const objects = await world(page, "count");
  const presses = ARROW_KEYS.flatMap(({ key, dx, dy, times }) => Array.from({ length: times }, () => ({ key, dx, dy })));
  const at = [await world(page, "shift", hub)];
  const run = newRun();
  await page.focus(".draw-editor .draw-surface");
  await begin(page);
  for (const [k, press] of presses.entries()) {
    await emit(page, run, `${label}: ${press.key} ${k + 1}`, "keydown", () => page.keyboard.press(press.key));
    const now = await world(page, "shift", hub);
    const [px, py] = at[at.length - 1];
    if (Math.abs(now[0] - px - press.dx) > 0.01 || Math.abs(now[1] - py - press.dy) > 0.01) {
      throw new WrongStep(`${label}: ${press.key} ${k + 1} doveva spostare di (${press.dx}, ${press.dy}), ha spostato di (${round(now[0] - px)}, ${round(now[1] - py)})`);
    }
    at.push(now);
  }
  const gesture = await finish(page, run);
  const said = await live(page);
  const shifted = await world(page, "shifted");
  if (shifted.moved !== fixture.shapes.length) throw new WrongStep(`${label}: si sono mosse ${shifted.moved} forme invece di ${fixture.shapes.length}`);
  const changed = await world(page, "diff", name);
  const still = fixture.connectors.filter((line) => !changed.includes(line.id));
  if (still.length > 0) throw new WrongStep(`${label}: ${still.length} connettori non hanno seguito le forme`);
  if ((await world(page, "count")) !== objects) throw new WrongStep(`${label}: gli oggetti dipinti non sono più ${objects}`);
  const checked = await verify(page, label, since);

  // Annulla: i tasti a meno di mezzo secondo l'uno dall'altro sono un passo
  // solo, se il motore li sa comporre (`MERGE_MS` in `history.ts`), e ventiquattro
  // tasti a ritmo di tastiera si annullano in pochi Ctrl+Z. Ogni Ctrl+Z deve
  // riportare il nodo a un punto per cui è già passato, più indietro del
  // precedente, e dopo l'ultimo tutto deve essere com'era.
  const undoRun = newRun();
  await page.focus(".draw-editor .draw-surface");
  await begin(page);
  let undoSteps = 0;
  let back = presses.length;
  while (back > 0 && undoSteps < presses.length) {
    undoSteps += 1;
    await emit(page, undoRun, `${label}: Ctrl+Z ${undoSteps}`, "keydown", () => page.keyboard.press("Control+z"));
    const now = await world(page, "shift", hub);
    const stop = at.findIndex(([x, y]) => Math.abs(now[0] - x) <= 0.01 && Math.abs(now[1] - y) <= 0.01);
    if (stop < 0 || stop >= back) {
      throw new WrongStep(`${label}: il Ctrl+Z ${undoSteps} ha portato il nodo a (${round(now[0] - at[0][0])}, ${round(now[1] - at[0][1])}) dal punto di partenza, dov'era dopo ${back} tasti: non è un punto già percorso, più indietro`);
    }
    back = stop;
  }
  const undo = await finish(page, undoRun);
  const left = await world(page, "diff", name);
  if (left.length > 0) throw new WrongStep(`${label}: dopo ${undoSteps} Ctrl+Z ${left.length} oggetti non sono com'erano (${left.slice(0, 4).join(", ")}); ${presses.length} tasti si annullano in ${presses.length} passi al più`);

  // Tre tasti con una pausa più lunga di `MERGE_MS` fra l'uno e l'altro sono
  // tre passi, e ogni Ctrl+Z riporta la forma dov'era dopo il tasto prima.
  const spaced = [await world(page, "shift", hub)];
  for (let k = 0; k < SPACED_KEYS; k++) {
    await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), MERGE_PAUSE_MS);
    await page.keyboard.press("Shift+ArrowRight");
    await frames(page, 3);
    spaced.push(await world(page, "shift", hub));
  }
  for (let k = SPACED_KEYS - 1; k >= 0; k--) {
    await page.keyboard.press("Control+z");
    await frames(page, 3);
    const now = await world(page, "shift", hub);
    if (Math.abs(now[0] - spaced[k][0]) > 0.01 || Math.abs(now[1] - spaced[k][1]) > 0.01) {
      throw new WrongStep(`${label}: tre tasti a una pausa l'uno dall'altro non si annullano uno alla volta: il Ctrl+Z ${SPACED_KEYS - k} doveva riportare il nodo a (${round(spaced[k][0])}, ${round(spaced[k][1])}), è a (${round(now[0])}, ${round(now[1])})`);
    }
  }
  const rest = await world(page, "diff", name);
  if (rest.length > 0) throw new WrongStep(`${label}: dopo i tre tasti a pausa e i loro Ctrl+Z ${rest.length} oggetti non sono com'erano`);
  return { objects, presses: presses.length, undoSteps, moved: shifted.moved, said, gesture, check: checked.stats, undo };
}

// ---------------------------------------------------------------------------
// La prova del banco.
// ---------------------------------------------------------------------------

/// Il banco prova sé stesso, dopo le corse: un file con un guasto deve fargli
/// vedere la cosa fuori posto, e un movimento, un rilascio e un compito che
/// costano troppo le soglie passate.
async function selfTest(page, fixture, hub, text, view) {
  const result = { tamper: {} };
  const clean = await world(page, "check", text);
  result.clean = { failures: clean.failureCount };
  for (const how of ["shape", "drop", "rewire", "strand"]) {
    const broken = await world(page, "check", await world(page, "tamper", text, how));
    result.tamper[how] = { seen: broken.failureCount > 0, failures: broken.failureCount, first: broken.failures[0] ?? null };
  }

  // Il movimento lento, il rilascio lento e il compito lungo fuori dai passi:
  // la pagina resta occupata oltre la soglia di un movimento, poi oltre quella
  // di un passo che scrive, poi per un compito lungo senza nessun evento.
  await focusOn(page, hub);
  const start = await grabOne(page, hub);
  await world(page, "keep", "selfTest");
  const planted = MOVE_LIMIT_MS + 30;
  const plantedCommit = COMMIT_LIMIT_MS + 30;
  const plantedFree = LONG_TASK_MS + 30;
  const run = newRun();
  await page.mouse.move(start[0], start[1]);
  await frames(page, 2);
  await begin(page);
  await emit(page, run, "prova: pressione", "pointerdown", () => page.mouse.down());
  await page.evaluate((ms) => window.__connectorsProbe.plant(ms), planted);
  try {
    for (const [k, [x, y]] of pathOf(start, [30, 20], 6).entries()) {
      await emit(page, run, `prova: movimento lento ${k + 1}`, "pointermove", () => page.mouse.move(x, y));
    }
    await page.evaluate((ms) => window.__connectorsProbe.plant(ms), plantedCommit);
    await emit(page, run, "prova: rilascio lento", "pointerup", () => page.mouse.up());
  } finally {
    await page.evaluate(() => window.__connectorsProbe.plant(0));
  }
  await page.evaluate((ms) => window.__connectorsProbe.stall(ms), plantedFree);
  const slow = await finish(page, run);
  const failures = verdict(slow, { name: "prova" });
  const move = failures.some((failure) => failure.includes("movimento lento") && failure.includes("dipinto dopo"));
  const commit = failures.some((failure) => failure.startsWith("prova: rilascio lento: dipinto dopo"));
  const free = failures.some((failure) => failure.includes("un compito lungo") && failure.includes("fuori da ogni passo"));
  result.slow = { plantedMs: planted, plantedCommitMs: plantedCommit, plantedFreeMs: plantedFree, seen: move && commit && free, move, commit, free, failures: failures.slice(0, 5) };
  await page.focus(".draw-editor .draw-surface");
  await page.keyboard.press("Control+z");
  await frames(page, 3);
  const left = await world(page, "diff", "selfTest");
  result.restored = left.length === 0;
  result.view = view;
  return result;
}

// ---------------------------------------------------------------------------
// Il disegno, la macchina, il referto.
// ---------------------------------------------------------------------------

/// Apre il disegno dall'albero e aspetta l'editor al livello Standard, con
/// tutti gli oggetti dipinti.
async function openDrawing(page, fixture) {
  const started = performance.now();
  await page.click(`#file-list .tree-row[data-path="${fixture.doc}"]`);
  await page.waitForSelector(".draw-editor .draw-surface", { timeout: OPEN_TIMEOUT_MS });
  const objects = fixture.shapes.length + fixture.connectors.length + fixture.labels.length;
  await page.waitForFunction(
    (painted) => {
      const host = document.querySelector(".draw-editor .draw-surface");
      return host !== null && host.querySelectorAll("[data-scene-id]").length >= painted;
    },
    objects,
    { timeout: OPEN_TIMEOUT_MS, polling: 250 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
  return round(performance.now() - started);
}

function environment() {
  const cpus = os.cpus();
  return {
    node: { version: process.version, platform: process.platform, arch: process.arch, kernelRelease: os.release() },
    cpu: { model: cpus[0]?.model ?? null, logicalCount: cpus.length },
    memory: { totalBytes: os.totalmem() },
    browser: null,
    viewport: null,
  };
}

async function writeReport(report) {
  await mkdir(OUTPUT, { recursive: true });
  const { connectors, cpu } = report.config;
  const path = join(OUTPUT, `connectors-${connectors}${cpu > 1 ? `-cpu${cpu}` : ""}.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify(report, null, 2) + "\n");
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  return path;
}

const ms = (value) => (value === null ? "—" : `${value} ms`);

/// Le corse, nell'ordine: il nodo, poi le forme senza i connettori (la scelta
/// ottenuta dal nodo) con tutto in vista, poi tutto il disegno.
const RUNS = [
  { name: "hub", title: "nodo      " },
  { name: "drag-shapes", title: "forme     " },
  { name: "keys-shapes", title: "frecce    " },
  { name: "drag-all", title: "tutto     " },
  { name: "keys-all", title: "frecce tutto" },
];

async function main() {
  const started = Date.now();
  const config = args();
  const report = {
    config: {
      ...config,
      moveLimitMs: MOVE_LIMIT_MS,
      commitLimitMs: COMMIT_LIMIT_MS,
      longTaskMs: LONG_TASK_MS,
      frameP95Ms: FRAME_P95_MS,
      tailMs: TAIL_MS,
      dragMoves: DRAG_MOVES,
      contourSlack: CONTOUR_SLACK,
      labelSlack: LABEL_SLACK,
    },
    environment: environment(),
    pass: false,
  };
  const pageErrors = [];
  let stage;
  let primary;
  try {
    stage = await openStage();
    const page = await openPage(stage.browser, "dark", { clock: false });
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    await page.goto(`${stage.base}/?connectors=${config.connectors}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 60_000 });
    const fixture = await page.evaluate(() => globalThis.__fubConnectorsBench?.fixture ?? null);
    if (fixture === null) throw new Error("la pagina del banco non ha il disegno dei connettori: risponde un altro server?");
    if (fixture.connectors.length !== config.connectors) throw new Error(`il disegno ha ${fixture.connectors.length} connettori invece di ${config.connectors}`);
    report.fixture = {
      doc: fixture.doc,
      shapes: fixture.shapes.length,
      connectors: fixture.connectors.length,
      labels: fixture.labels.length,
      hubs: fixture.hubs.length,
      elements: fixture.elements,
      bytes: fixture.bytes,
      digest: fixture.digest,
    };
    report.environment.browser = await stage.browser.version();
    report.environment.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }));

    report.openMs = await openDrawing(page, fixture);
    await installProbe(page, MODIFIERS);
    await installWorld(page, fixture, { contour: CONTOUR_SLACK, label: LABEL_SLACK });
    report.supported = await page.evaluate(() => window.__connectorsProbe.supported);
    if (!report.supported.longtask) throw new Error("il browser non dà i compiti lunghi, e la soglia non si misura");
    report.painted = await world(page, "count");

    // Il nodo: quello più vicino al centro del disegno, con la vista tutta.
    await page.focus(".draw-editor .draw-surface");
    await page.keyboard.press("v");
    await page.keyboard.press("Shift+1");
    await frames(page, 4);
    const [ax, ay, aw, ah] = await world(page, "area");
    let hub = null;
    let nearest = Infinity;
    for (const id of fixture.hubs) {
      const [x, y] = await centerOf(page, id);
      const off = Math.hypot(x - (ax + aw / 2), y - (ay + ah / 2));
      if (off < nearest) [hub, nearest] = [id, off];
    }
    report.hub = {
      id: hub,
      connectors: fixture.connectors.filter((line) => line.from.id === hub || line.to.id === hub).length,
    };

    // Il rallentamento vale per le corse e per la prova, non per l'apertura.
    if (config.cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
    }

    report.runs = {};
    const total = fixture.shapes.length + fixture.connectors.length + fixture.labels.length;
    /// Dove si preme per trascinare la scelta: sulla forma più vicina al
    /// centro del foglio.
    const grabAt = () => grabOne(page, null);
    const grabHub = () => grabOne(page, hub);
    const view = await focusOn(page, hub);
    report.view = view;
    // 1. Il nodo, con la vista che lo inquadra.
    report.runs.hub = await dragRun(page, fixture, { name: "hub", kind: "hub", start: await grabHub(), travel: HUB_TRAVEL_PX, hub });
    // 2. Le forme senza i connettori, scelte da un connettore del nodo, con
    //    tutto il disegno in vista.
    await chooseShapes(page, fixture, hub);
    await page.keyboard.press("Shift+1");
    await settle(page, hub);
    report.runs["drag-shapes"] = await dragRun(page, fixture, { name: "drag-shapes", kind: "group", start: await grabAt(), travel: ALL_TRAVEL_PX, hub });
    await chooseShapes(page, fixture, hub);
    report.runs["keys-shapes"] = await keysRun(page, fixture, { name: "keys-shapes", hub });
    // 3. Tutto il disegno.
    await chooseAll(page, total);
    report.runs["drag-all"] = await dragRun(page, fixture, { name: "drag-all", kind: "group", start: await grabAt(), travel: ALL_TRAVEL_PX, hub });
    await chooseAll(page, total);
    report.runs["keys-all"] = await keysRun(page, fixture, { name: "keys-all", hub });

    report.selfTest = await selfTest(page, fixture, hub, lastSaved, view);

    const failures = [];
    for (const [how, outcome] of Object.entries(report.selfTest.tamper)) {
      if (!outcome.seen) failures.push(`la prova del banco non vede il guasto «${how}» nel file salvato`);
    }
    if (report.selfTest.clean.failures > 0) failures.push(`la prova del banco: il file salvato intatto ha ${report.selfTest.clean.failures} cose fuori posto`);
    if (!report.selfTest.slow.seen) {
      const { plantedMs, plantedCommitMs, plantedFreeMs, move, commit, free } = report.selfTest.slow;
      const missed = [!move && `un movimento lento di ${plantedMs} ms`, !commit && `un rilascio lento di ${plantedCommitMs} ms`, !free && `un compito lungo di ${plantedFreeMs} ms fuori dai passi`].filter(Boolean);
      failures.push(`la prova del banco non vede ${missed.join(", né ")}`);
    }
    if (!report.selfTest.restored) failures.push("la prova del banco non è tornata allo stato di prima con Ctrl+Z");
    report.gate = { applied: config.gated, failures: [] };
    if (config.gated) {
      for (const [name, run] of Object.entries(report.runs)) {
        report.gate.failures.push(...verdict(run.gesture, { name, smooth: name.startsWith("drag") || name === "hub" }));
        report.gate.failures.push(...verdict(run.undo, { name: `${name}, annulla` }));
      }
      failures.push(...report.gate.failures);
    }
    const slowed = config.cpu > 1 ? `, CPU rallentata ${config.cpu} volte` : "";
    console.log(`${config.connectors} connettori, ${fixture.shapes.length} forme${slowed}: aperto in ${ms(report.openMs)}, nodo con ${report.hub.connectors} connettori`);
    for (const { name, title } of RUNS) {
      const run = report.runs[name];
      const g = run.gesture;
      console.log(`${title}  ${g.steps.length} eventi (${run.moved} forme mosse): movimenti p50 ${ms(g.moves.latencyMs.p50)}, p95 ${ms(g.moves.latencyMs.p95)}, max ${ms(g.moves.latencyMs.max)}; scritture p50 ${ms(g.commits.latencyMs.p50)}, max ${ms(g.commits.latencyMs.max)}; fotogrammi p95 ${ms(g.frames.p95)}, max ${ms(g.frames.max)}; compiti lunghi ${g.longTasks.length}; annulla max ${ms(run.undo.latencyMs.max)}`);
    }
    const { tamper, slow } = report.selfTest;
    console.log(`prova: guasti visti ${Object.entries(tamper).map(([how, outcome]) => `${how} ${outcome.seen ? "sì" : "NO"}`).join(", ")}; un movimento lento di ${slow.plantedMs} ms, un rilascio lento di ${slow.plantedCommitMs} ms e un compito lungo di ${slow.plantedFreeMs} ms fuori dai passi ${slow.seen ? "visti" : "NON visti"}${config.gated ? "" : `; soglie solo fino a ${GATED_CONNECTORS} connettori`}`);
    if (failures.length > 0) {
      const shown = failures.slice(0, SHOWN_FAILURES);
      const more = failures.length > shown.length ? `\n  e altre ${failures.length - shown.length}, nel referto` : "";
      const error = new Error(`${failures.length} cose fuori posto:\n  ${shown.join("\n  ")}${more}`);
      error.failures = failures;
      throw error;
    }
  } catch (error) {
    primary = error;
    report.failure = {
      name: error?.name,
      message: String(error?.message ?? error),
      ...(error instanceof WrongStep || error?.failures ? {} : { stack: String(error?.stack ?? "").split("\n").slice(0, 8) }),
      ...(pageErrors.length ? { pageErrors } : {}),
    };
  }
  try {
    if (stage) await stage.close();
  } catch (error) {
    primary ??= error;
  }
  report.pass = !primary;
  report.totalMs = Date.now() - started;
  try {
    const path = await writeReport(report);
    console.log(`referto in ${path}`);
  } catch (error) {
    primary ??= error;
  }
  if (primary) throw primary;
}

main().catch((error) => {
  console.error(`connectors: ${error.message}`);
  process.exitCode = 1;
});
