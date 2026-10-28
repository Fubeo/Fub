// **Il banco delle scene grandi**: quanto ci mette un disegno di decine di
// migliaia di elementi ad aprirsi, a muovere la vista, a scegliere un oggetto
// e a prendere un tratto a penna, e se fa davvero ciò che deve.
//
//     node bench/large.mjs                   # 5 000, 20 000 e 49 900 elementi, con le soglie
//     node bench/large.mjs --elements 30000  # da 200 a 49 900 elementi, anche più d'uno: 5000,30000
//     node bench/large.mjs --cpu 4           # la pagina quattro volte più lenta
//
// Il disegno è quello di `large-fixture.ts`: una lavagna di riquadri, ognuno
// col suo fondo, un titolo, un gruppo, una trentina di forme e qualche tratto
// a penna con la pressione, con esattamente gli elementi chiesti. Il più
// grande ne ha 49 900: il limite di una scena modificabile (formato della
// scena, §11) meno il posto per i tratti del banco. Il banco lo apre
// nell'app vera, dalla pagina del banco (`?large=N`, in `fake-ipc.ts`), al
// livello Standard, e lo percorre in otto corse, ognuna dal disegno com'era
// alla fine della precedente:
//
// 1. **Lo zoom coi tasti**: tre volte `+` e tre volte `-`.
// 2. **La rotella**: dodici passi che portano al centro della vista il
//    rettangolo scelto dal disegno, che all'apertura ne sta fuori.
// 3. **Ctrl+rotella** sul rettangolo: quattro passi avanti, due indietro,
//    due avanti.
// 4. **Da vicino**: otto `+`, che non si misurano, e il disegno sei volte
//    più grande della vista; sei passi della rotella verso destra e sei
//    indietro; Ctrl+rotella attorno al centro, quattro passi avanti, otto
//    indietro e quattro avanti; otto `-` per tornare.
// 5. **La scelta**: un clic sul rettangolo, con lo strumento Selezione.
// 6. **Gli strumenti coi tasti**: `P`, `V` e di nuovo `P`.
// 7. **Un tratto a penna**: la pressione, trenta movimenti, il rilascio.
// 8. **Annulla**: un Ctrl+Z.
//
// # Che cosa misura
//
// L'apertura, dal clic sul file nell'albero al fotogramma in cui ogni oggetto
// del disegno è dipinto; e poi, finché la pagina non resta quieta per mezzo
// secondo, i compiti lunghi che l'apertura si porta dietro.
//
// Per ogni evento delle corse (un tasto, un passo della rotella, la
// pressione, ogni movimento, il rilascio), il tempo da quando arriva alla
// pagina al fotogramma dopo, dipinto: un `requestAnimationFrame` chiesto
// mentre l'evento arriva, e in quel fotogramma un messaggio, che arriva
// quando il fotogramma ha finito stile, layout e pittura. Dentro c'è ciò che
// l'editor fa, l'attesa del fotogramma e il fotogramma stesso. Il banco
// registra anche il tempo dal `timeStamp` dell'evento, ma non ci mette la
// soglia: Chromium senza finestra tiene ogni passo della rotella due
// fotogrammi prima di darlo alla pagina, anche su una pagina vuota (32 ms su
// questa macchina), e quel tempo non dice niente del disegno. Ciò che lo
// allungherebbe davvero, un compito lungo che tiene occupata la pagina, ha la
// sua soglia. Durante le corse il banco registra gli intervalli fra un
// fotogramma e l'altro, i compiti lunghi (Long Tasks API: ogni compito oltre
// i 50 ms) e i fotogrammi lunghi (`long-animation-frame`, con gli script che
// ci pesano di più). Gli eventi vanno uno dopo l'altro, ognuno quando il
// precedente è dipinto e controllato; dopo l'ultimo la corsa aspetta 400 ms,
// per ciò che l'editor rimanda.
//
// Ogni passo si controlla: un banco veloce che sbaglia è rosso.
//
// - **Lo zoom**, coi tasti o con Ctrl+rotella, cambia la percentuale scritta
//   nel suo verso, ingrandisce o rimpicciolisce il rettangolo, e tiene fermo
//   il punto attorno a cui ingrandisce: il centro della vista coi tasti, il
//   puntatore con la rotella. Tre `+` e tre `-` tornano alla vista di prima,
//   e così la corsa da vicino.
// - **La rotella** sposta il rettangolo, sullo schermo, proprio del suo
//   passo, e non lo ingrandisce.
// - **La scelta** dice «1 oggetto scelto.», e la scheda «Design»
//   dell'ispettore mostra la posizione e la misura del rettangolo: il clic ha preso lui.
// - **Ogni tasto di uno strumento** sceglie il suo: Penna o Selezione.
// - **Il tratto** aggiunge un oggetto solo, un tracciato che copre la strada
//   del puntatore, e il disegno lo dice col numero nuovo degli oggetti.
// - **Annulla** lo toglie, e lo dice.
//
// # Le soglie
//
// Valgono per i tre disegni che il banco apre se non gli si dice altro. Un
// passo è di tre specie, come nel modello RAIL dei browser:
//
// - **segue un gesto**, un passo della rotella o un movimento della penna:
//   dipinto entro `MOVE_LIMIT_MS`, 50 ms, tre fotogrammi a 60 Hz, come nel
//   banco delle tavole, perché la mano non senta la vista restare indietro;
// - **risponde a un comando**, un tasto, la scelta o la pressione della
//   penna: dipinto entro `RESPONSE_LIMIT_MS`, 100 ms, il tempo entro cui una
//   risposta pare immediata;
// - **scrive**, il rilascio del tratto e Annulla: dipinto entro il tempo del
//   suo disegno (`BUDGETS`), perché ricava di nuovo dal testo la scena,
//   l'indice degli oggetti e il loro albero, e costa col disegno.
//
// Hanno il tempo del loro disegno anche l'apertura e l'**assestamento**:
// nelle scene grandi la vista che si muove porta con sé gli strati già
// dipinti, e 150 ms dopo che si è fermata il painter li ridisegna alla scala
// nuova. Il banco lo vede dalla radice del painter che perde la sua
// trasformazione, e lo misura come un passo, da lì al fotogramma dipinto. In
// quel fotogramma Chromium ridispone ogni testo SVG alla scala nuova: è il
// prezzo di una vista nitida, e cresce coi testi del disegno. Un passo che in
// una scena grande **ridisegna la vista** invece di portarla, perché
// scoprirebbe ciò che sta oltre il margine dipinto o perché salta, fa lo
// stesso lavoro, e ha il tempo dell'assestamento: il banco lo riconosce dalla
// camera degli strati, che il passo cambia. Infine nessun compito lungo fuori
// dai passi che rispondono, scrivono o ridisegnano e dagli assestamenti: un
// gesto non deve trovare la pagina occupata.
//
// # Le misure
//
// Sono di questa macchina (Ryzen 7 7730U, 16 thread, Chromium 149 senza
// finestra, pagina 1280×800, foglio 410×439, margine dipinto 110 pixel), per
// i disegni di 5 000, 20 000 e 49 900 elementi, nel peggio di ogni gruppo di
// corse:
//
// - **A riposo**, otto corse, tutte verdi. L'apertura 1,15, 1,48 e 3,08 s.
//   I passi che seguono un gesto al più 11,5, 6,4 e 11,8 ms: a 5 000
//   elementi, sotto la soglia delle scene grandi, Ctrl+rotella ridisegna a
//   ogni passo. I tasti dello zoom 17,8, 22,7 e 31,9 ms, la scelta 22, 32 e
//   48, gli strumenti 15, 20 e 31, la pressione della penna al più 24. Il
//   rilascio del tratto 50, 179 e 432 ms, Annulla 34, 99 e 224. I passi che
//   ridisegnano, a 20 000 e 49 900 elementi: con la rotella 8,4 e 17 ms; da
//   vicino, dove lo zoom indietro passa il margine, 30 e 72. L'assestamento
//   dopo Ctrl+rotella 43 e 82 ms, dopo la corsa da vicino 47 e 86. Ogni
//   compito lungo sta in un passo che scrive o ridisegna, o in un
//   assestamento.
// - **A macchina piena**, sedici processi che girano a vuoto, uno per
//   thread, quattro corse: l'apertura 3,6, 4,6 e 9,0 s; i passi che seguono
//   un gesto al più 37, 18 e 41 ms; i tasti dello zoom 36, 51 e 110, la
//   scelta 71, 109 e 368, gli strumenti 32, 39 e 94; il rilascio 178, 570 e
//   1 040, Annulla 124, 324 e 643; i passi che ridisegnano al più 109 e 235,
//   l'assestamento 107 e 265. Rossi la scelta e il rilascio dei due disegni
//   più grandi, e una volta il primo tasto dello zoom a 49 900 elementi.
// - **A pagina rallentata** (`--cpu N`, che chiede a Chromium di rallentarla
//   N volte, dopo l'apertura): due volte, due corse, verdi: i passi che
//   seguono un gesto al più 19 ms a 5 000 elementi e 21 negli altri; la
//   scelta 42, 62 e 93, il rilascio 96, 306 e 740, i passi che ridisegnano
//   55 e 139, l'assestamento 69 e 152. Quattro volte, tre corse: i gesti al
//   più 44 ms, la scelta 86, 167 e 194, il rilascio 190, 577 e 1 377, i
//   passi che ridisegnano 119 e 277, l'assestamento 125 e 294; a 49 900
//   elementi i primi tasti dello zoom fino a 178 ms, perché ogni passo parte
//   da fermo e fra un tasto e l'altro la vista si assesta, fino a 387 ms. È
//   rosso per la scelta, il rilascio e lo zoom coi tasti dei disegni più
//   grandi. Sei volte, due corse: i gesti di 5 000 elementi fino a 76 ms,
//   quelli delle scene grandi al più 67, la scelta fino a 293, il rilascio
//   fino a 2 039, l'assestamento 481, e qualche compito lungo, fino a 74 ms,
//   fuori dai passi: rosso quasi ovunque.
//
// Le soglie dei passi che seguono un gesto e che rispondono stanno sopra il
// peggio a riposo di quattro volte e di due (50 contro 11,8, 100 contro 48),
// e sopra la macchina piena tranne la scelta dei disegni più grandi e, una
// volta su quattro, il primo tasto dello zoom: un clic che a riposo costa
// 48 ms con la macchina presa ne costa fino a 368, e una soglia che lo
// tenesse sarebbe larga più di tre volte ciò che RAIL chiede a una risposta.
// La CI ha i tempi di questa macchina a riposo: il banco dei connettori vi
// misura un movimento in 13,7 ms (50° percentile), qui in 15. Le soglie dei
// passi che scrivono, 250, 500 e 1 000 ms, stanno sopra il peggio a riposo
// di due volte o più; a macchina piena le passano i rilasci dei due disegni
// più grandi, fino a 570 e 1 040 ms, anche perché il rilascio che segue la
// corsa da vicino paga il garbage collector (qui sotto). Quelle
// dell'assestamento e dei passi che ridisegnano, 150 e 300 ms, stanno sopra
// il riposo di più di tre volte e sopra la macchina piena (109 e 265 ms);
// quelle dell'apertura, 4, 6 e 10 s, sopra la macchina piena (3,6, 4,6 e
// 9,0 s). La lavagna di 5 000 elementi ha meno di 5 000 forme e non si
// assesta: il suo tempo, 100 ms, vale per una lavagna diversa che ne avesse
// di più.
//
// Dove va il tempo, a 49 900 elementi (16,7 MB di testo: 1 280 testi,
// 12 607 tracciati, 14 887 rettangoli e 1 283 gruppi). L'assestamento dopo
// uno zoom è un fotogramma di Chromium: il layout 39 ms, 27 dei quali per i
// testi; il primo hit test dopo il layout 15; il prepaint e la pittura 15
// ciascuno; il layerize 8. Senza testi sarebbe di 33 ms. Un passo che
// ridisegna con una scala nuova fa lo stesso lavoro. Il primo passo di un
// movimento dà alla radice uno strato suo e ce la dipinge, circa 14 ms in
// più: il primo tasto dello zoom ne costa 31, i seguenti 25. Un passo che
// scrive è circa 190 ms di JavaScript: 130 per ricavare dal testo la scena e
// il suo albero (da 50 a 64), l'indice degli oggetti (44), gli strati
// dipinti (da 16 a 19) e i controlli (10); 34 per applicare l'operazione al
// motore; 10 per la sessione. Il resto è il fotogramma. Il rilascio che
// segue la corsa da vicino, in cinque corse su otto, costa circa 140 ms in
// più: il garbage collector raccoglie ciò che i ridisegni della vista hanno
// lasciato, una sessantina di millisecondi, e intanto ogni funzione va più
// piano; lo zoom coi soli tasti non lo fa. Scendere ancora vuole una scena,
// un indice e un albero che si ricavino solo dove il testo cambia.
//
// Dopo le corse il banco prova sé stesso, sul primo disegno: una rotella che
// va il doppio del previsto e un clic accanto al rettangolo devono fargli
// vedere il passo sbagliato; un passo della rotella che tiene occupata la
// pagina 80 ms deve passare la soglia del passo e quella dei compiti lunghi;
// un tasto che la tiene occupata 130 ms, un rilascio che la tiene occupata
// 30 ms più del suo tempo e un compito di 80 ms senza nessun evento devono
// passare le loro. Sul primo disegno che si assesta, un assestamento che
// tiene occupata la pagina 30 ms più del suo tempo deve passare la sua; sul
// primo che ridisegna un passo, un passo della rotella lungo quanto la vista
// che la tiene occupata 30 ms più dell'assestamento.
//
// Il referto, con ogni passo, sta in `.output/large.json`
// (`large-N.json` con altri disegni, `-cpuK` a pagina rallentata).

import * as os from "node:os";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openStage, openPage, OUTPUT } from "./stage.mjs";

/// I disegni che il banco apre se non gli si dice altro, coi loro tempi:
/// l'apertura, un passo che scrive e un assestamento della vista, in
/// millisecondi (vedi sopra).
const BUDGETS = new Map([
  [5_000, { openMs: 4_000, writeMs: 250, settleMs: 100 }],
  [20_000, { openMs: 6_000, writeMs: 500, settleMs: 150 }],
  [49_900, { openMs: 10_000, writeMs: 1_000, settleMs: 300 }],
]);
/// Da quanti a quanti elementi, come `LARGE_LIMITS` di `large-fixture.ts`.
const LIMITS = [200, 49_900];
/// Di quanto, al più, `--cpu` rallenta la pagina.
const CPU_LIMIT = 20;
/// Le soglie di un passo che non scrive, dall'arrivo dell'evento al
/// fotogramma dipinto: uno che segue il gesto (un passo della rotella, un
/// movimento della penna) e uno che risponde a un comando (un tasto, la
/// scelta, la pressione della penna).
const MOVE_LIMIT_MS = 50;
const RESPONSE_LIMIT_MS = 100;
/// Un compito lungo, per il browser: oltre i 50 ms.
const LONG_TASK_MS = 50;
/// Quanto si aspetta dopo l'ultimo passo di una corsa: più dei 150 ms con
/// cui il painter rimette a posto gli strati dopo un movimento della vista.
const TAIL_MS = 400;
/// Per quanto la pagina dev'essere quieta, senza compiti lunghi, perché
/// l'apertura sia finita; e quanto si aspetta, al più, quella quiete.
const QUIET_MS = 500;
const QUIET_TIMEOUT_MS = 60_000;
/// Quanto si aspetta, al più, che il disegno si apra e che un passo si dipinga.
const OPEN_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 30_000;
/// Quanti passi della rotella portano il rettangolo al centro della vista.
const PAN_STEPS = 12;
/// Un passo di Ctrl+rotella, in pixel di rotella.
const ZOOM_WHEEL = 100;
/// I `+` che portano la quarta corsa vicino al disegno, sei volte più
/// grande; e i passi della rotella, verso destra e indietro, in pixel.
const NEAR_ZOOMS = 8;
const NEAR_PANS = 6;
const NEAR_PAN = 100;
/// I movimenti del tratto, quanto va avanti ognuno e quanto ondeggia.
const STROKE_MOVES = 30;
const STROKE_STEP_PX = 7;
const STROKE_WAVE_PX = 20;
/// Di quanto, in pixel dello schermo, ciò che si vede può scostarsi da ciò
/// che un passo doveva fare: i rettangoli dei browser hanno i loro
/// arrotondamenti.
const TOLERANCE_PX = 1;
/// Quante cose fuori posto dice la console; il referto le ha tutte.
const SHOWN_FAILURES = 20;
/// I tasti misurati: lo zoom, gli strumenti e Annulla.
const KEYS = ["+", "-", "p", "v", "z"];

function args() {
  const out = { elements: [...BUDGETS.keys()], cpu: 1 };
  for (let i = 2; i < process.argv.length; i++) {
    const m = /^--(elements|cpu)(?:=([\d,]+))?$/.exec(process.argv[i]);
    if (!m) throw new RangeError(`argomento sconosciuto: ${process.argv[i]}`);
    const value = m[2] ?? process.argv[++i];
    if (m[1] === "elements") {
      if (!/^\d+(,\d+)*$/.test(value ?? "")) throw new RangeError("--elements vuole uno o più numeri, separati da virgole");
      out.elements = value.split(",").map(Number);
    } else {
      if (!/^\d+$/.test(value ?? "")) throw new RangeError("--cpu vuole un numero");
      out.cpu = Number(value);
    }
  }
  for (const n of out.elements) {
    if (n < LIMITS[0] || n > LIMITS[1]) throw new RangeError(`--elements va da ${LIMITS[0]} a ${LIMITS[1]}`);
  }
  if (new Set(out.elements).size !== out.elements.length) throw new RangeError("--elements ripete un disegno");
  if (out.cpu < 1 || out.cpu > CPU_LIMIT) throw new RangeError(`--cpu va da 1 a ${CPU_LIMIT}`);
  const standard = out.elements.length === BUDGETS.size && out.elements.every((n) => BUDGETS.has(n));
  return { ...out, standard };
}

// ---------------------------------------------------------------------------
// La sonda, nella pagina.
// ---------------------------------------------------------------------------

/// Mette nella pagina la sonda, `window.__largeProbe`: fra `begin` ed `end`
/// registra ogni evento delle corse, dal suo arrivo al fotogramma dipinto
/// dopo, i fotogrammi, i compiti lunghi e i fotogrammi lunghi; e legge ciò
/// che si vede. I compiti lunghi li tiene anche fuori dalle corse, per la
/// quiete dopo l'apertura. Con `plant(type, ms)` ogni evento misurato di quel
/// tipo tiene occupata la pagina per `ms`, e `lone(ms)` fa un compito di `ms`
/// senza nessun evento: sono le lentezze della prova del banco.
async function installProbe(page, target) {
  await page.evaluate(([keys, target]) => {
    const KEYS = new Set(keys);
    const TYPES = ["keydown", "wheel", "pointerdown", "pointermove", "pointerup"];
    const state = { active: false, run: 0, since: 0, steps: [], settles: [], frames: [], waiter: null, open: null, planted: new Map(), tasks: [], loafs: [] };
    const busy = (ms) => {
      const until = performance.now() + ms;
      while (performance.now() < until) {
        // La lentezza della prova: la pagina resta occupata.
      }
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.tasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
    let loaf = false;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          state.loafs.push({
            start: e.startTime,
            duration: e.duration,
            blocking: e.blockingDuration,
            scripts: e.scripts.map((script) => ({
              invoker: script.invoker,
              source: `${script.sourceFunctionName || "?"} in ${script.sourceURL.replace(/^.*\//, "").replace(/\?.*$/, "") || "?"}`,
              duration: script.duration,
              forced: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      }).observe({ type: "long-animation-frame" });
      loaf = true;
    } catch {
      // Il browser non dà i fotogrammi lunghi: il referto ne fa a meno.
    }
    const loop = (run) => (time) => {
      if (!state.active || state.run !== run) return;
      state.frames.push(time);
      requestAnimationFrame(loop(run));
    };
    const surface = () => document.querySelector(".draw-editor .draw-surface");
    /// La camera del primo strato vivo, e se il disegno è grande: un passo
    /// che la cambia in una scena grande ridisegna la vista invece di
    /// portarla con la radice.
    const camera = () => document.querySelector(".draw-editor .spatial-layer > g")?.getAttribute("transform") ?? null;
    const large = () => document.querySelector(".draw-editor .spatial-painter")?.hasAttribute("data-large") ?? false;
    const ids = () => [...surface().querySelectorAll("[data-scene-id]")].map((node) => node.getAttribute("data-scene-id"));
    /// Ciò che si vede: la regione viva, lo zoom scritto, il rettangolo
    /// sullo schermo, dentro il foglio, lo strumento, ciò che la scheda
    /// «Design» dell'ispettore dice della scelta.
    const read = () => {
      const host = surface();
      const box = host.getBoundingClientRect();
      const node = host.querySelector(`[data-scene-id="${target}"]`);
      const rect = node?.getBoundingClientRect();
      const zoom = [...document.querySelectorAll(".draw-editor .draw-zoom-level")].map((button) => /^(\d+)\s*%$/.exec(button.textContent.trim())).find((m) => m !== null);
      const field = (label) => {
        const input = [...document.querySelectorAll(".draw-properties-input")].find((each) => each.offsetParent !== null && (each.getAttribute("aria-label") ?? each.labels?.[0]?.textContent?.trim()) === label);
        return input === undefined ? null : Number(input.value.replace(",", "."));
      };
      return {
        live: document.querySelector('.draw-editor > [role="status"][aria-live="polite"]')?.textContent?.trim() ?? null,
        zoom: zoom === undefined ? null : Number(zoom[1]),
        target: rect ? [rect.x - box.x - host.clientLeft, rect.y - box.y - host.clientTop, rect.width, rect.height] : null,
        area: [box.x + host.clientLeft, box.y + host.clientTop, host.clientWidth, host.clientHeight],
        tool: host.dataset.tool ?? null,
        focused: document.activeElement === host,
        props: [field("X (px)"), field("Y (px)"), field("Larghezza (px)"), field("Altezza (px)")],
      };
    };
    /// Il fotogramma dopo `step`, quando è dipinto.
    const paint = (step) => {
      requestAnimationFrame(() => {
        step.frame = performance.now();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          step.painted = performance.now();
          if (step.type !== "settle") {
            step.redrawn = large() && camera() !== step.camera;
            if (state.open === step) state.open = null;
          }
          channel.port1.close();
          state.waiter?.();
        };
        channel.port2.postMessage(null);
      });
      const planted = state.planted.get(step.type) ?? 0;
      if (planted > 0) busy(planted);
    };
    const mark = (event) => {
      if (!state.active) return;
      if (event.type === "keydown" && !KEYS.has(event.key)) return;
      const step = { type: event.type, key: event.key ?? null, at: event.timeStamp, dispatched: performance.now(), frame: null, painted: null, camera: camera(), redrawn: false };
      state.steps.push(step);
      state.open = step;
      paint(step);
    };
    for (const type of TYPES) addEventListener(type, mark, { capture: true, passive: true });
    /// L'assestamento: in una scena grande la camera muove la radice del
    /// painter con una trasformazione, e quando si ferma il painter la toglie
    /// e ridisegna gli strati nella vista nuova. Lo si vede dalla radice che
    /// perde la sua trasformazione. Se la perde durante un passo, è il passo
    /// che ridisegna, e il suo tempo è già il suo.
    let moving = false;
    const settled = new MutationObserver(() => {
      const root = document.querySelector(".draw-editor .spatial-painter");
      if (root === null) return;
      if (root.style.transform !== "") {
        moving = true;
      } else if (moving) {
        moving = false;
        if (!state.active || state.open !== null) return;
        const now = performance.now();
        const step = { type: "settle", key: null, at: now, dispatched: now, frame: null, painted: null };
        state.settles.push(step);
        paint(step);
      }
    });
    window.__largeProbe = Object.freeze({
      supported: { longtask: PerformanceObserver.supportedEntryTypes.includes("longtask"), loaf },
      read,
      ids,
      plant: (type, ms) => {
        if (ms > 0) state.planted.set(type, ms);
        else state.planted.delete(type);
      },
      lone: (ms) => setTimeout(() => busy(ms), 0),
      /// Guarda la radice del painter, che c'è quando il disegno è aperto.
      watch: () => {
        const root = document.querySelector(".draw-editor .spatial-painter");
        if (root === null) return false;
        settled.observe(root, { attributes: true, attributeFilter: ["style"] });
        return true;
      },
      /// Aspetta che ogni oggetto del disegno sia dipinto, un fotogramma
      /// dopo l'altro, e dice quando.
      painted: (objects, timeoutMs) => new Promise((resolve, reject) => {
        const started = performance.now();
        const tick = () => {
          const host = surface();
          if (host !== null && host.querySelectorAll("[data-scene-id]").length >= objects) return resolve(performance.now());
          if (performance.now() - started > timeoutMs) return reject(new Error(`il disegno non si è dipinto in ${timeoutMs} ms`));
          requestAnimationFrame(tick);
        };
        tick();
      }),
      /// Aspetta che la pagina resti `quietMs` senza compiti lunghi, e dice
      /// quando è finito l'ultimo da `since`.
      quiet: (since, quietMs, timeoutMs) => new Promise((resolve, reject) => {
        const started = performance.now();
        const check = () => {
          const now = performance.now();
          const after = state.tasks.filter((task) => task.start + task.duration >= since);
          const last = after.reduce((end, task) => Math.max(end, task.start + task.duration), since);
          if (now - last >= quietMs) return resolve({ last, tasks: after });
          if (now - started > timeoutMs) return reject(new Error(`la pagina non è quieta dopo ${timeoutMs} ms`));
          setTimeout(check, 50);
        };
        check();
      }),
      /// Aspetta che ogni assestamento della corsa sia dipinto.
      calm: (timeoutMs) => new Promise((resolve, reject) => {
        const started = performance.now();
        const tick = () => {
          if (state.settles.every((step) => step.painted !== null)) return resolve(state.settles.length);
          if (performance.now() - started > timeoutMs) return reject(new Error(`l'assestamento non si è dipinto in ${timeoutMs} ms`));
          requestAnimationFrame(tick);
        };
        tick();
      }),
      now: () => performance.now(),
      begin: () => {
        state.steps = [];
        state.settles = [];
        state.frames = [];
        state.since = performance.now();
        state.active = true;
        state.run += 1;
        requestAnimationFrame(loop(state.run));
      },
      /// Aspetta che l'evento `count` sia dipinto, e dice ciò che si vede.
      step: (count, timeoutMs) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.waiter = null;
          reject(new Error(`l'evento ${count} non si è dipinto in ${timeoutMs} ms (${state.steps.length} eventi arrivati)`));
        }, timeoutMs);
        const check = () => {
          const step = state.steps[count - 1];
          if (step === undefined || step.painted === null) return;
          clearTimeout(timer);
          state.waiter = null;
          resolve({ steps: state.steps.length, type: step.type, ...read() });
        };
        state.waiter = check;
        check();
      }),
      end: () => {
        state.active = false;
        const since = state.since;
        const inside = (list) => list.filter((entry) => entry.start + entry.duration >= since);
        return { since, until: performance.now(), steps: state.steps, settles: state.settles, frames: state.frames, longtasks: inside(state.tasks), longFrames: inside(state.loafs) };
      },
    });
  }, [KEYS, target]);
}

const probe = (page, method, ...argv) => page.evaluate(([method, argv]) => window.__largeProbe[method](...argv), [method, argv]);

// ---------------------------------------------------------------------------
// I passi, e ciò che ogni passo deve mostrare.
// ---------------------------------------------------------------------------

/// Un passo che fa un'altra cosa da quella che doveva.
class WrongStep extends Error {}

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const centerOf = ([x, y, w, h]) => [x + w / 2, y + h / 2];
const near = (a, b) => Math.abs(a - b) <= TOLERANCE_PX;
const shown = (box) => (box === null ? "—" : box.map(round).join(", "));

const newRun = () => ({ count: 0, labels: [], kinds: [] });

const frames = (page, n = 2) =>
  page.evaluate((n) => new Promise((resolve) => {
    let left = n;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);

/// Un evento di una corsa: lo manda, aspetta che il fotogramma sia dipinto,
/// guarda che sia arrivato uno solo, di quel tipo, e dice ciò che si vede.
/// `kind` dice che passo è: `move` segue il gesto, `response` risponde a un
/// comando, `write` scrive.
async function emit(page, run, label, type, send, kind) {
  await send();
  run.count += 1;
  const seen = await probe(page, "step", run.count, STEP_TIMEOUT_MS);
  if (seen.steps !== run.count) throw new WrongStep(`${label}: arrivati ${seen.steps} eventi invece di ${run.count}`);
  if (seen.type !== type) throw new WrongStep(`${label}: era un ${seen.type} invece di un ${type}`);
  run.labels.push(label);
  run.kinds.push(kind);
  return seen;
}

/// Il rettangolo dev'essere dipinto, sullo schermo.
function targetOf(seen, label) {
  if (seen.target === null) throw new WrongStep(`${label}: il rettangolo scelto dal disegno non è dipinto`);
  return seen.target;
}

/// Uno zoom: la percentuale cambia nel verso giusto, il rettangolo cresce o
/// cala, e il punto `anchor` dello schermo resta dov'era.
function checkZoom(label, before, after, inwards, anchor) {
  const a = targetOf(before, label);
  const b = targetOf(after, label);
  const ratio = b[2] / a[2];
  if (after.zoom === null || before.zoom === null) throw new WrongStep(`${label}: lo zoom non è scritto`);
  if (inwards ? !(after.zoom > before.zoom && ratio > 1.05) : !(after.zoom < before.zoom && ratio < 0.95)) {
    throw new WrongStep(`${label}: lo zoom va da ${before.zoom}% a ${after.zoom}%, e il rettangolo da ${round(a[2])} a ${round(b[2])} px di larghezza`);
  }
  const [ax, ay] = centerOf(a);
  const [bx, by] = centerOf(b);
  const wanted = [anchor[0] + (ax - anchor[0]) * ratio, anchor[1] + (ay - anchor[1]) * ratio];
  if (!near(bx, wanted[0]) || !near(by, wanted[1])) {
    throw new WrongStep(`${label}: lo zoom non tiene fermo il punto ${anchor.map(round).join(", ")}: il rettangolo è a ${round(bx)}, ${round(by)} invece di ${wanted.map(round).join(", ")}`);
  }
}

/// Un passo della rotella senza Ctrl: il rettangolo va di `delta` al
/// contrario, e resta della sua misura.
function checkPan(label, before, after, delta) {
  const a = targetOf(before, label);
  const b = targetOf(after, label);
  if (after.zoom !== before.zoom || !near(a[2], b[2]) || !near(a[3], b[3])) throw new WrongStep(`${label}: la rotella ha cambiato lo zoom`);
  const moved = [b[0] - a[0], b[1] - a[1]];
  if (!near(moved[0], -delta[0]) || !near(moved[1], -delta[1])) {
    throw new WrongStep(`${label}: la vista si è spostata di ${moved.map(round).join(", ")} invece di ${-delta[0]}, ${-delta[1]}`);
  }
}

/// La coda di una corsa, con l'assestamento che vi cade dipinto, e ciò che
/// la sonda ha visto.
async function finish(page, run) {
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), TAIL_MS);
  await probe(page, "calm", STEP_TIMEOUT_MS);
  return summarize(await probe(page, "end"), run);
}

/// Un tasto fuori misura, per preparare una corsa.
async function prepare(page, key) {
  await page.keyboard.press(key);
  await frames(page, 2);
}

/// La prima corsa: tre `+` e tre `-`, attorno al centro della vista, che
/// tornano alla vista di prima.
async function zoomRun(page) {
  const run = newRun();
  const first = await probe(page, "read");
  const [, , w, h] = first.area;
  const middle = [w / 2, h / 2];
  let last = first;
  await probe(page, "begin");
  for (const key of ["+", "+", "+", "-", "-", "-"]) {
    const label = `zoom col tasto ${key}`;
    const seen = await emit(page, run, label, "keydown", () => page.keyboard.press(key), "response");
    checkZoom(label, last, seen, key === "+", middle);
    last = seen;
  }
  const a = targetOf(first, "zoom");
  const b = targetOf(last, "zoom");
  if (last.zoom !== first.zoom || !a.every((value, i) => near(value, b[i]))) {
    throw new WrongStep(`tre + e tre - non tornano alla vista di prima: ${first.zoom}% e ${shown(a)}, poi ${last.zoom}% e ${shown(b)}`);
  }
  return finish(page, run);
}

/// La seconda corsa: dodici passi della rotella che portano il rettangolo al
/// centro della vista. La prova del banco dà invece la strada, `travel`, e
/// con `scale` moltiplica il passo dato alla rotella, non quello atteso: è il
/// passo sbagliato.
async function panRun(page, { steps = PAN_STEPS, travel = null, scale = 1 } = {}) {
  const run = newRun();
  const first = await probe(page, "read");
  const [ax, ay, aw, ah] = first.area;
  const [tx, ty] = centerOf(targetOf(first, "rotella"));
  const total = travel ?? [Math.round(tx - aw / 2), Math.round(ty - ah / 2)];
  await page.mouse.move(ax + aw / 2, ay + ah / 2);
  await frames(page, 2);
  let last = first;
  let done = [0, 0];
  await probe(page, "begin");
  for (let k = 1; k <= steps; k++) {
    const to = [Math.round((total[0] * k) / steps), Math.round((total[1] * k) / steps)];
    const delta = [to[0] - done[0], to[1] - done[1]];
    const label = `rotella, passo ${k} di ${steps}`;
    const seen = await emit(page, run, label, "wheel", () => page.mouse.wheel(delta[0] * scale, delta[1] * scale), "move");
    checkPan(label, last, seen, delta);
    last = seen;
    done = to;
  }
  return finish(page, run);
}

/// La terza corsa: Ctrl+rotella col puntatore sul rettangolo, quattro passi
/// avanti, due indietro, due avanti; la prova dell'assestamento ne fa uno.
async function wheelZoomRun(page, moves = [true, true, true, true, false, false, true, true]) {
  const run = newRun();
  const first = await probe(page, "read");
  const [ax, ay] = first.area;
  const anchor = centerOf(targetOf(first, "Ctrl+rotella"));
  await page.mouse.move(ax + anchor[0], ay + anchor[1]);
  await frames(page, 2);
  let last = first;
  await page.keyboard.down("Control");
  try {
    await probe(page, "begin");
    for (const [k, inwards] of moves.entries()) {
      const label = `Ctrl+rotella ${inwards ? "avanti" : "indietro"}, passo ${k + 1}`;
      const seen = await emit(page, run, label, "wheel", () => page.mouse.wheel(0, inwards ? -ZOOM_WHEEL : ZOOM_WHEEL), "move");
      checkZoom(label, last, seen, inwards, anchor);
      last = seen;
    }
  } finally {
    await page.keyboard.up("Control");
  }
  return finish(page, run);
}

/// La quarta corsa: il disegno visto da vicino, molto più largo della vista,
/// dove la radice del painter porta soltanto ciò che si vede e il suo
/// margine. Otto `+`, che non si misurano, ingrandiscono sei volte; poi sei
/// passi della rotella verso destra e sei indietro, e Ctrl+rotella attorno al
/// centro della vista, quattro passi avanti, otto indietro e quattro avanti.
/// Otto `-` tornano alla vista di prima.
async function nearRun(page) {
  const before = await probe(page, "read");
  for (let k = 0; k < NEAR_ZOOMS; k++) await prepare(page, "+");
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), TAIL_MS);
  const run = newRun();
  const first = await probe(page, "read");
  const [ax, ay, aw, ah] = first.area;
  const middle = [aw / 2, ah / 2];
  await page.mouse.move(ax + middle[0], ay + middle[1]);
  await frames(page, 2);
  let last = first;
  await probe(page, "begin");
  const pans = [...Array(NEAR_PANS).fill([NEAR_PAN, 0]), ...Array(NEAR_PANS).fill([-NEAR_PAN, 0])];
  for (const [k, delta] of pans.entries()) {
    const label = `da vicino, rotella, passo ${k + 1}`;
    const seen = await emit(page, run, label, "wheel", () => page.mouse.wheel(delta[0], delta[1]), "move");
    checkPan(label, last, seen, delta);
    last = seen;
  }
  const zooms = [...Array(4).fill(true), ...Array(8).fill(false), ...Array(4).fill(true)];
  await page.keyboard.down("Control");
  try {
    for (const [k, inwards] of zooms.entries()) {
      const label = `da vicino, Ctrl+rotella ${inwards ? "avanti" : "indietro"}, passo ${k + 1}`;
      const seen = await emit(page, run, label, "wheel", () => page.mouse.wheel(0, inwards ? -ZOOM_WHEEL : ZOOM_WHEEL), "move");
      checkZoom(label, last, seen, inwards, middle);
      last = seen;
    }
  } finally {
    await page.keyboard.up("Control");
  }
  const summary = await finish(page, run);
  for (let k = 0; k < NEAR_ZOOMS; k++) await prepare(page, "-");
  await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), TAIL_MS);
  const after = await probe(page, "read");
  const a = targetOf(before, "da vicino");
  const b = targetOf(after, "da vicino");
  if (after.zoom !== before.zoom || !a.every((value, i) => near(value, b[i]))) {
    throw new WrongStep(`da vicino: la vista non torna quella di prima: ${before.zoom}% e ${shown(a)}, poi ${after.zoom}% e ${shown(b)}`);
  }
  return summary;
}

/// La coda dell'id della scheda «Design»: l'ispettore scrive l'id del
/// pannello (`draw.design`) in esadecimale, un byte per trattino.
const DESIGN_TAB = [...Buffer.from("draw.design")].map((byte) => byte.toString(16)).join("-");

/// La scelta: un clic in `at`, che deve prendere il rettangolo. `at` è il
/// centro del rettangolo, o un altro punto per la prova del banco.
async function selectRun(page, fixture, at = null) {
  const run = newRun();
  const first = await probe(page, "read");
  const [ax, ay] = first.area;
  const point = at ?? centerOf(targetOf(first, "scelta"));
  await page.mouse.move(ax + point[0], ay + point[1]);
  await frames(page, 2);
  await probe(page, "begin");
  await emit(page, run, "scelta: pressione", "pointerdown", () => page.mouse.down(), "response");
  const seen = await emit(page, run, "scelta: rilascio", "pointerup", () => page.mouse.up(), "response");
  if (seen.live !== "1 oggetto scelto.") throw new WrongStep(`scelta: il disegno dice «${seen.live}» invece di «1 oggetto scelto.»`);
  const summary = await finish(page, run);
  // Le proprietà stanno nella scheda «Design» dell'ispettore dello
  // Scrittoio, che si apre dopo la misura. Il pannello si aggiorna quando la
  // pagina ha tempo: si guarda dopo la coda.
  await page.click(`.inspector-tab[id$="${DESIGN_TAB}"]`);
  await frames(page, 2);
  const props = (await probe(page, "read")).props;
  await page.focus(".draw-editor .draw-surface");
  const box = fixture.target.box;
  if (!props.every((value, i) => value !== null && Math.abs(value - box[i]) < 0.01)) {
    throw new WrongStep(`scelta: la scheda «Design» mostra ${props.map((value) => value ?? "—").join(", ")} invece del rettangolo ${box.join(", ")}`);
  }
  return summary;
}

/// Gli strumenti coi tasti: `P`, `V` e di nuovo `P`, ognuno col suo
/// strumento. Lo strumento cambia il cursore della superficie, e un disegno
/// grande non deve pagarlo oggetto per oggetto.
async function toolRun(page) {
  const run = newRun();
  await page.focus(".draw-editor .draw-surface");
  await probe(page, "begin");
  for (const [key, tool] of [["p", "pen"], ["v", "select"], ["p", "pen"]]) {
    const label = `strumento col tasto ${key.toUpperCase()}`;
    const seen = await emit(page, run, label, "keydown", () => page.keyboard.press(key), "response");
    if (seen.tool !== tool) throw new WrongStep(`${label}: lo strumento è ${seen.tool} invece di ${tool}`);
  }
  return finish(page, run);
}

/// Il tratto: la pressione, trenta movimenti, il rilascio, che scrive.
/// Controlla che sia arrivato un tracciato solo, sulla strada del puntatore,
/// e che il disegno lo dica.
async function strokeRun(page, fixture, { lone = 0 } = {}) {
  const run = newRun();
  const first = await probe(page, "read");
  if (first.tool !== "pen") throw new WrongStep(`lo strumento Penna non si sceglie con P: è ${first.tool}`);
  const [ax, ay, aw, ah] = first.area;
  const start = [ax + aw / 2 - (STROKE_MOVES * STROKE_STEP_PX) / 2, ay + ah / 2 + ah / 5];
  const path = Array.from({ length: STROKE_MOVES }, (_, k) => [start[0] + (k + 1) * STROKE_STEP_PX, start[1] + STROKE_WAVE_PX * Math.sin(((k + 1) / STROKE_MOVES) * 2 * Math.PI)]);
  const before = await probe(page, "ids");
  await page.mouse.move(start[0], start[1]);
  await frames(page, 2);
  await probe(page, "begin");
  await emit(page, run, "tratto: pressione", "pointerdown", () => page.mouse.down(), "response");
  for (const [k, [x, y]] of path.entries()) {
    await emit(page, run, `tratto: movimento ${k + 1}`, "pointermove", () => page.mouse.move(x, y), "move");
    if (lone > 0 && k === Math.floor(STROKE_MOVES / 2)) {
      await probe(page, "lone", lone);
      await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms + 20)), lone);
    }
  }
  const seen = await emit(page, run, "tratto: rilascio", "pointerup", () => page.mouse.up(), "write");
  const summary = await finish(page, run);
  const after = await probe(page, "ids");
  const known = new Set(before);
  const added = after.filter((id) => !known.has(id));
  if (after.length !== before.length + 1 || added.length !== 1) throw new WrongStep(`tratto: gli oggetti dipinti passano da ${before.length} a ${after.length}, ${added.length} nuovi, invece di uno`);
  const stroke = await page.evaluate((id) => {
    const node = document.querySelector(`.draw-editor .draw-surface [data-scene-id="${CSS.escape(id)}"]`);
    const r = node.getBoundingClientRect();
    return { tag: node.localName, box: [r.x, r.y, r.width, r.height] };
  }, added[0]);
  const [sx, sy, sw, sh] = stroke.box;
  const covered = [start, ...path].every(([x, y]) => x >= sx - TOLERANCE_PX && x <= sx + sw + TOLERANCE_PX && y >= sy - TOLERANCE_PX && y <= sy + sh + TOLERANCE_PX);
  if (stroke.tag !== "path" || !covered) throw new WrongStep(`tratto: il nuovo oggetto è un ${stroke.tag} in ${shown(stroke.box)}, e non copre la strada del puntatore`);
  const said = /^Tratto aggiunto\. Il disegno ha (\d+) oggetti\.$/.exec(seen.live ?? "");
  if (said === null || Number(said[1]) !== fixture.objects + 1) throw new WrongStep(`tratto: il disegno dice «${seen.live}» invece di «Tratto aggiunto. Il disegno ha ${fixture.objects + 1} oggetti.»`);
  return { summary, before: before.length, added: added[0] };
}

/// Annulla, misurato: toglie il tratto, e lo dice.
async function undoRun(page, stroke) {
  const run = newRun();
  await page.focus(".draw-editor .draw-surface");
  await probe(page, "begin");
  const seen = await emit(page, run, "Annulla", "keydown", () => page.keyboard.press("Control+z"), "write");
  const summary = await finish(page, run);
  if (seen.live !== "Annullato: Tratto.") throw new WrongStep(`Annulla: il disegno dice «${seen.live}» invece di «Annullato: Tratto.»`);
  const after = await probe(page, "ids");
  if (after.length !== stroke.before || after.includes(stroke.added)) throw new WrongStep(`Annulla: gli oggetti dipinti sono ${after.length} invece di ${stroke.before}`);
  return summary;
}

// ---------------------------------------------------------------------------
// I numeri.
// ---------------------------------------------------------------------------

const stats = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { count: 0, p50: null, p95: null, max: null };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { count: a.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(a[a.length - 1]) };
};

/// I fotogrammi lunghi di una corsa: quanto durano, quanto bloccano, e gli
/// script che ci pesano di più, sommati per chi li chiama.
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
  return { ...stats(frames.map((frame) => frame.duration)), blockingMs: stats(frames.map((frame) => frame.blocking)), scripts: heaviest };
}

/// I passi e i fotogrammi di una corsa, in numeri. Un compito lungo è
/// «dentro» un passo che risponde, che scrive o che ridisegna la vista, o un
/// assestamento, se ne tocca il tempo, dall'arrivo dell'evento, o
/// dall'assestamento, al fotogramma dipinto.
function summarize(probe, run) {
  const steps = probe.steps.map((step, i) => ({
    label: run.labels[i] ?? null,
    type: step.type,
    kind: run.kinds[i] ?? null,
    stepMs: round(step.painted - step.dispatched),
    latencyMs: round(step.painted - step.at),
    inputDelayMs: round(step.dispatched - step.at),
    renderMs: round(step.painted - step.frame),
    redrawn: step.redrawn === true,
    window: [step.dispatched, step.painted],
  }));
  const settles = probe.settles.map((step) => ({
    startMs: round(step.dispatched - probe.since),
    stepMs: round(step.painted - step.dispatched),
    renderMs: round(step.painted - step.frame),
    window: [step.dispatched, step.painted],
  }));
  const intervals = probe.frames.slice(1).map((time, i) => time - probe.frames[i]);
  const frame = stats(intervals);
  const touches = (task, window) => task.start <= window[1] && task.start + task.duration >= window[0] - 1;
  const longTasks = probe.longtasks.map((task) => ({
    startMs: round(task.start - probe.since),
    durationMs: round(task.duration),
    inStep: steps.some((step) => (step.kind !== "move" || step.redrawn) && touches(task, step.window)),
    inSettle: settles.some((step) => touches(task, step.window)),
  }));
  return {
    steps: steps.map(({ window, ...step }) => step),
    settles: settles.map(({ window, ...step }) => step),
    moveMs: stats(steps.filter((step) => step.kind === "move" && !step.redrawn).map((step) => step.stepMs)),
    responseMs: stats(steps.filter((step) => step.kind === "response" && !step.redrawn).map((step) => step.stepMs)),
    redrawMs: stats(steps.filter((step) => step.kind !== "write" && step.redrawn).map((step) => step.stepMs)),
    writeMs: stats(steps.filter((step) => step.kind === "write").map((step) => step.stepMs)),
    settleMs: stats(settles.map((step) => step.stepMs)),
    latencyMs: stats(steps.map((step) => step.latencyMs)),
    inputDelayMs: stats(steps.map((step) => step.inputDelayMs)),
    frames: { ...frame, long: intervals.filter((value) => value > 1.5 * (frame.p50 ?? Infinity)).length },
    longTasks,
    longFrames: longFrames(probe.longFrames),
    wallMs: round(probe.until - probe.since),
  };
}

/// Ciò che una corsa sbaglia contro le soglie del suo disegno.
function verdict(name, run, budget) {
  const failures = [];
  for (const step of run.steps) {
    if (step.kind === "write") {
      if (!(step.stepMs <= budget.writeMs)) failures.push(`${name}: ${step.label} dipinto dopo ${step.stepMs} ms, oltre i ${budget.writeMs}`);
      continue;
    }
    const kind = step.kind === "response" ? RESPONSE_LIMIT_MS : MOVE_LIMIT_MS;
    const limit = step.redrawn ? Math.max(kind, budget.settleMs) : kind;
    const what = step.redrawn ? `${step.label}, che ridisegna la vista,` : step.label;
    if (!(step.stepMs <= limit)) failures.push(`${name}: ${what} dipinto dopo ${step.stepMs} ms, oltre i ${limit}`);
  }
  for (const step of run.settles) {
    if (!(step.stepMs <= budget.settleMs)) failures.push(`${name}: l'assestamento della vista dipinto dopo ${step.stepMs} ms, oltre i ${budget.settleMs}`);
  }
  for (const task of run.longTasks) {
    if (!task.inStep && !task.inSettle && task.durationMs > LONG_TASK_MS) failures.push(`${name}: un compito lungo di ${task.durationMs} ms fuori dai passi che rispondono, scrivono o ridisegnano e dagli assestamenti, a ${task.startMs} ms dall'inizio della corsa`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// La prova del banco.
// ---------------------------------------------------------------------------

/// Il banco prova sé stesso, dopo le corse del primo disegno: un passo
/// sbagliato della rotella, un clic accanto al rettangolo, un passo della
/// rotella lento, un tasto lento, un rilascio lento, un compito lungo senza
/// eventi.
async function selfTest(page, fixture, budget) {
  const result = {};
  const expectWrong = async (key, run) => {
    try {
      await run();
      result[key] = { seen: false, message: "è passato per giusto" };
    } catch (error) {
      if (!(error instanceof WrongStep)) throw error;
      result[key] = { seen: true, message: error.message };
    }
    await probe(page, "end");
  };
  await page.focus(".draw-editor .draw-surface");
  await prepare(page, "Escape");
  await prepare(page, "v");

  // La rotella che va il doppio: la vista si sposta del doppio del passo.
  await expectWrong("wheel", () => panRun(page, { steps: 1, travel: [-30, -20], scale: 2 }));

  // Il clic accanto al rettangolo, a sinistra di un quarto della sua
  // larghezza più sei pixel: prende un altro oggetto, o niente.
  const seen = await probe(page, "read");
  const [x, y, w, h] = targetOf(seen, "prova");
  await prepare(page, "Escape");
  await expectWrong("click", () => selectRun(page, fixture, [x - 6 - w / 4, y + h / 2]));

  // Il passo lento della rotella: la pagina resta occupata oltre la soglia
  // del passo e oltre un compito lungo.
  const planted = Math.max(MOVE_LIMIT_MS, LONG_TASK_MS) + 30;
  await probe(page, "plant", "wheel", planted);
  let slow;
  try {
    slow = verdict("prova", await panRun(page, { steps: 1, travel: [30, 20] }), budget);
  } finally {
    await probe(page, "plant", "wheel", 0);
  }
  result.slowStep = {
    plantedMs: planted,
    seen: slow.some((failure) => failure.includes("dipinto dopo")) && slow.some((failure) => failure.includes("compito lungo")),
    failures: slow,
  };

  // Il tasto lento: uno strumento che risponde oltre la soglia di un comando.
  const slowKey = RESPONSE_LIMIT_MS + 30;
  await probe(page, "plant", "keydown", slowKey);
  let responding;
  try {
    responding = verdict("prova", await toolRun(page), budget);
  } finally {
    await probe(page, "plant", "keydown", 0);
  }
  result.slowResponse = {
    plantedMs: slowKey,
    seen: responding.some((failure) => failure.includes("dipinto dopo")),
    failures: responding,
  };

  // Il rilascio lento, e un compito lungo nel mezzo del tratto, senza eventi.
  // `toolRun` finisce con la Penna.
  const late = budget.writeMs + 30;
  await probe(page, "plant", "pointerup", late);
  let writing;
  try {
    const stroke = await strokeRun(page, fixture, { lone: planted });
    writing = verdict("prova", stroke.summary, budget);
  } finally {
    await probe(page, "plant", "pointerup", 0);
  }
  await prepare(page, "Control+z");
  result.slowWrite = {
    plantedMs: late,
    loneMs: planted,
    seen: writing.some((failure) => failure.includes("rilascio dipinto dopo")) && writing.some((failure) => failure.includes("fuori dai passi che rispondono")),
    failures: writing,
  };
  return result;
}

/// La prova del passo che ridisegna, sul primo disegno che ne ha uno: un
/// passo della rotella lungo quanto la vista, che la radice non può portare,
/// e che tiene occupata la pagina 30 ms più del tempo dell'assestamento.
async function redrawTest(page, budget) {
  const late = Math.max(MOVE_LIMIT_MS, budget.settleMs) + 30;
  await page.focus(".draw-editor .draw-surface");
  await probe(page, "plant", "wheel", late);
  let failures;
  try {
    const [, , w] = (await probe(page, "read")).area;
    failures = verdict("prova", await panRun(page, { steps: 1, travel: [Math.round(w), 0] }), budget);
  } finally {
    await probe(page, "plant", "wheel", 0);
  }
  return { plantedMs: late, seen: failures.some((failure) => failure.includes("che ridisegna la vista, dipinto dopo")), failures };
}

/// La prova dell'assestamento, sul primo disegno che si assesta: uno che
/// tiene occupata la pagina 30 ms più del suo tempo deve passare la soglia.
async function settleTest(page, budget) {
  const late = budget.settleMs + 30;
  await page.focus(".draw-editor .draw-surface");
  await prepare(page, "v");
  await probe(page, "plant", "settle", late);
  let failures;
  try {
    failures = verdict("prova", await wheelZoomRun(page, [true]), budget);
  } finally {
    await probe(page, "plant", "settle", 0);
  }
  return { plantedMs: late, seen: failures.some((failure) => failure.includes("assestamento della vista dipinto dopo")), failures };
}

// ---------------------------------------------------------------------------
// Il disegno, la macchina, il referto.
// ---------------------------------------------------------------------------

/// Apre il disegno dall'albero: il tempo fino al fotogramma con tutti gli
/// oggetti dipinti, e la quiete dopo.
async function openDrawing(page, fixture) {
  const clicked = await probe(page, "now");
  await page.click(`#file-list .tree-row[data-path="${fixture.doc}"]`);
  const painted = await probe(page, "painted", fixture.objects, OPEN_TIMEOUT_MS);
  const quiet = await probe(page, "quiet", clicked, QUIET_MS, QUIET_TIMEOUT_MS);
  await page.evaluate(() => document.fonts.ready);
  await page.focus(".draw-editor .draw-surface");
  const tasks = quiet.tasks.map((task) => ({ startMs: round(task.start - clicked), durationMs: round(task.duration) }));
  return {
    openMs: round(painted - clicked),
    quietMs: round(Math.max(quiet.last, painted) - clicked),
    longTasks: { count: tasks.length, maxMs: round(Math.max(0, ...tasks.map((task) => task.durationMs))), afterPainted: tasks.filter((task) => task.startMs >= painted - clicked) },
  };
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
  const { elements, cpu, standard } = report.config;
  const path = join(OUTPUT, `large${standard ? "" : `-${elements.join("-")}`}${cpu > 1 ? `-cpu${cpu}` : ""}.json`);
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

/// Un disegno: lo apre in una pagina sua, fa le corse e, se è il primo, la
/// prova del banco; quella dell'assestamento, se `tests.settle` non l'ha
/// ancora vista e il disegno si assesta, e quella del passo che ridisegna,
/// se `tests.redraw` non l'ha vista e il disegno ha un passo che ridisegna.
async function measure(stage, config, elements, first, report, tests) {
  const page = await openPage(stage.browser, "dark", { clock: false });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
  try {
    await page.goto(`${stage.base}/?large=${elements}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.bench === "ready", null, { timeout: 120_000 });
    const fixture = await page.evaluate(() => globalThis.__fubLargeBench?.fixture ?? null);
    if (fixture === null) throw new Error("la pagina del banco non ha la lavagna: risponde un altro server?");
    if (fixture.elements !== elements) throw new Error(`la lavagna ha ${fixture.elements} elementi invece di ${elements}`);
    report.environment.browser ??= await stage.browser.version();
    report.environment.viewport ??= await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }));
    await installProbe(page, fixture.target.id);
    const supported = await page.evaluate(() => window.__largeProbe.supported);
    if (!supported.longtask) throw new Error("il browser non dà i compiti lunghi, e la soglia non si misura");

    const result = {
      fixture: { doc: fixture.doc, elements: fixture.elements, objects: fixture.objects, strokes: fixture.strokes, bytes: fixture.bytes, digest: fixture.digest },
      open: await openDrawing(page, fixture),
    };
    if (!(await probe(page, "watch"))) throw new Error("il disegno aperto non ha il painter");
    result.view = (await probe(page, "read")).area.slice(2);
    // Il rallentamento vale per le corse e per la prova, non per l'apertura.
    if (config.cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: config.cpu });
    }
    await prepare(page, "v");
    const tool = (await probe(page, "read")).tool;
    if (tool !== "select") throw new WrongStep(`lo strumento Selezione non si sceglie con V: è ${tool}`);
    result.runs = {};
    result.runs.zoom = await zoomRun(page);
    result.runs.pan = await panRun(page);
    result.runs.wheelZoom = await wheelZoomRun(page);
    result.runs.near = await nearRun(page);
    result.runs.select = await selectRun(page, fixture);
    await prepare(page, "Escape");
    result.runs.tools = await toolRun(page);
    const stroke = await strokeRun(page, fixture);
    result.runs.stroke = stroke.summary;
    result.runs.undo = await undoRun(page, stroke);
    const budget = BUDGETS.get(elements) ?? null;
    const trial = budget ?? { openMs: Infinity, writeMs: 1000, settleMs: 1000 };
    if (first) result.selfTest = await selfTest(page, fixture, trial);
    if (!tests.settle && Object.values(result.runs).some((run) => run.settles.length > 0)) {
      result.settleTest = await settleTest(page, trial);
      tests.settle = true;
    }
    if (!tests.redraw && Object.values(result.runs).some((run) => run.redrawMs.count > 0)) {
      result.redrawTest = await redrawTest(page, trial);
      tests.redraw = true;
    }
    result.gate = { applied: config.standard, failures: [] };
    if (config.standard) {
      if (!(result.open.openMs <= budget.openMs)) result.gate.failures.push(`apertura in ${result.open.openMs} ms, oltre i ${budget.openMs}`);
      for (const [name, run] of Object.entries(result.runs)) result.gate.failures.push(...verdict(name, run, budget));
    }
    if (pageErrors.length) result.pageErrors = pageErrors;
    return result;
  } finally {
    await page.context().close();
  }
}

const NAMES = { zoom: "zoom    ", pan: "rotella ", wheelZoom: "Ctrl+rot", near: "vicino  ", select: "scelta  ", tools: "strument", stroke: "tratto  ", undo: "annulla " };

async function main() {
  const started = Date.now();
  const config = args();
  const report = {
    config: { ...config, budgets: Object.fromEntries(BUDGETS), moveLimitMs: MOVE_LIMIT_MS, responseLimitMs: RESPONSE_LIMIT_MS, longTaskMs: LONG_TASK_MS, tailMs: TAIL_MS, quietMs: QUIET_MS },
    environment: environment(),
    drawings: {},
    pass: false,
  };
  let stage;
  let primary;
  try {
    stage = await openStage();
    const failures = [];
    const tests = { settle: false, redraw: false };
    for (const [i, elements] of config.elements.entries()) {
      const result = await measure(stage, config, elements, i === 0, report, tests);
      report.drawings[elements] = result;
      const slowed = config.cpu > 1 ? `, CPU rallentata ${config.cpu} volte` : "";
      console.log(`${elements} elementi, ${result.fixture.objects} oggetti${slowed}: dipinto in ${ms(result.open.openMs)}, quieto in ${ms(result.open.quietMs)}`);
      for (const [name, run] of Object.entries(result.runs)) {
        const parts = [];
        if (run.moveMs.count > 0) parts.push(`segue in p50 ${ms(run.moveMs.p50)}, max ${ms(run.moveMs.max)}`);
        if (run.responseMs.count > 0) parts.push(`risponde in ${ms(run.responseMs.max)}`);
        if (run.redrawMs.count > 0) parts.push(`ridisegna in ${ms(run.redrawMs.max)}`);
        if (run.writeMs.count > 0) parts.push(`scrive in ${ms(run.writeMs.max)}`);
        if (run.settleMs.count > 0) parts.push(`si assesta in ${ms(run.settleMs.max)}`);
        parts.push(`dal timeStamp al più ${ms(run.latencyMs.max)}`, `compiti lunghi ${run.longTasks.length}`);
        console.log(`  ${NAMES[name]}  ${run.steps.length} ${run.steps.length === 1 ? "passo" : "passi"}: ${parts.join("; ")}`);
      }
      if (result.selfTest) {
        const t = result.selfTest;
        const said = (check) => (check.seen ? "visto" : "NON visto");
        console.log(`  prova: rotella doppia ${said(t.wheel)}, clic accanto ${said(t.click)}, passo lento di ${t.slowStep.plantedMs} ms ${said(t.slowStep)}, tasto lento di ${t.slowResponse.plantedMs} ms ${said(t.slowResponse)}, rilascio lento di ${t.slowWrite.plantedMs} ms e compito di ${t.slowWrite.loneMs} ${said(t.slowWrite)}`);
        for (const [key, check] of Object.entries(t)) if (!check.seen) failures.push(`la prova del banco non vede ${key}: ${check.message ?? check.failures.join("; ")}`);
      }
      if (result.settleTest) {
        const check = result.settleTest;
        console.log(`  prova: assestamento lento di ${check.plantedMs} ms ${check.seen ? "visto" : "NON visto"}`);
        if (!check.seen) failures.push(`la prova del banco non vede l'assestamento lento: ${check.failures.join("; ")}`);
      }
      if (result.redrawTest) {
        const check = result.redrawTest;
        console.log(`  prova: passo che ridisegna, lento di ${check.plantedMs} ms, ${check.seen ? "visto" : "NON visto"}`);
        if (!check.seen) failures.push(`la prova del banco non vede il passo lento che ridisegna: ${check.failures.join("; ")}`);
      }
      failures.push(...result.gate.failures.map((failure) => `${elements}: ${failure}`));
    }
    // I disegni grandi muovono la vista con la radice del painter, si
    // assestano e, oltre il margine, ridisegnano: se il banco non lo vede,
    // non vede più le loro soglie.
    if (config.standard && !tests.settle) failures.push("nessun disegno si è assestato dopo un movimento della vista: la prova dell'assestamento non si è fatta");
    if (config.standard && !tests.redraw) failures.push("nessun passo ha ridisegnato la vista di un disegno grande: la prova del passo che ridisegna non si è fatta");
    if (!config.standard) console.log(`soglie solo coi disegni di ${[...BUDGETS.keys()].join(", ")} elementi`);
    if (failures.length > 0) {
      const shown = failures.slice(0, SHOWN_FAILURES);
      const more = failures.length > shown.length ? `\n  e altre ${failures.length - shown.length}, nel referto` : "";
      const error = new Error(`${failures.length} cose fuori posto:\n  ${shown.join("\n  ")}${more}`);
      error.failures = failures;
      throw error;
    }
  } catch (error) {
    primary = error;
    report.failure = { name: error?.name, message: String(error?.message ?? error) };
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
  console.error(`large: ${error.message}`);
  process.exitCode = 1;
});
