// **Il banco del moto**: per ogni coreografia dello Scrittoio, le quattro
// regole del §5 del piano, misurate nel browser.
//
//     node bench/motion.mjs                        # tutte
//     node bench/motion.mjs --only=light,kit-list  # solo quelle
//
// Gli altri banchi tengono fermo il movimento (`stage.mjs`: moto ridotto, ora
// congelata) perché fotografano stati d'arrivo. Questo fa il contrario: apre la
// pagina con `reducedMotion: "no-preference"` e senza toccare l'orologio, e
// guarda ciò che succede fra uno stato e l'altro.
//
// # Come avanza il tempo
//
// In due modi, e ognuno misura ciò che l'altro non può.
//
// - **Il tempo vero**, col motore di produzione (`Element.animate` che scorre
//   da sé), per le regole 1 e 2. Lo stato d'arrivo e ciò che resta a corsa
//   finita non dipendono da *quando* si guarda, purché si guardi a riposo: si
//   aspetta che `activeMotions()` e `document.getAnimations()` tacciano, e si
//   scatta due volte finché i due scatti coincidono (`stillShot`). Così è il
//   motore vero a dover chiudere le sue corse, non un sostituto.
// - **Il tempo in mano**, per le regole 3 e 4, che guardano a metà corsa. Si
//   installa nella pagina il motore manuale di `moto` (`createManualDriver`):
//   le animazioni restano quelle di WAAPI, ma in pausa, e il loro
//   `Animation.currentTime` avanza solo quando il banco chiama `advance`, a
//   passi di un sessantesimo di secondo; gli stessi passi servono i fotogrammi
//   dei valori a molla. «Metà corsa» è allora un istante esatto e ripetibile, e
//   il gesto che inverte cade sempre sullo stesso fotogramma.
//
// Due cose restano nel tempo vero anche col motore in mano, e il banco le
// aspetta invece di spostarle: le transizioni CSS della pelle (che per questo
// si leggono dagli eventi `transitionrun`, non da ciò che è vivo in un istante)
// e le attese del prodotto (la sosta del puntatore prima di una scheda o di un
// cassetto).
//
// # Che cosa si misura
//
// 1. **Stato finale identico.** Lo scatto a corsa finita coincide al pixel con
//    quello dello stesso stato raggiunto col moto ridotto. Ogni scatto segue
//    un ridisegno intero della pagina (`repaint`): si confronta lo stato, non
//    ciò che il motore di resa ha ridipinto o tenuto da prima.
// 2. **Nessun residuo.** A riposo non c'è un'animazione viva che il gesto abbia
//    fatto partire, e nessun elemento tiene in linea `transform`, `opacity`,
//    `translate`, `scale` o `rotate` che il moto ridotto non lascia.
// 3. **Solo proprietà ammesse.** Ogni corsa di `moto`, ogni animazione o
//    transizione CSS partita col gesto, ogni proprietà in linea riscritta a
//    ogni fotogramma tocca soltanto quelle cinque. Il referto dice di ogni
//    estranea se è di sola pittura (un colore) o di geometria.
// 4. **Interrompibile.** Si rifà il gesto, a metà corsa lo si inverte: si
//    arriva allo scatto dell'andata e ritorno completa, e ciò che si stava
//    muovendo prosegue da dov'era — lo stesso elemento o l'immagine che ne
//    prende il posto, entro `CONTINUITY`. Una corsa che riparte dalla posa di
//    partenza si vede come un salto all'istante del gesto.
//
// Il termine di paragone della regola 4 è l'andata e ritorno **completa**, non
// lo scatto di prima del gesto: un gesto e il suo contrario lasciano il fuoco
// dove l'ha messo l'ultimo, e quello è stato, non movimento. Se i due scatti
// differiscono il referto lo dice, senza farne una colpa della corsa.
//
// Due eccezioni, scritte perché siano le sole. Il cursore di CodeMirror
// lampeggia con un'animazione sua, senza fine, che `stage.mjs` nasconde e che
// qui non conta fra le vive. E ciò che era già vivo prima del gesto non è un
// residuo del gesto.
//
// # Un rosso è del prodotto
//
// Se una regola fallisce perché la coreografia non la rispetta, la voce resta
// rossa: questo file non ha un elenco di debiti e non deve averne uno. Lo
// script esce diverso da zero, e il referto in `bench/.output/moto/` porta il
// fotogramma di metà corsa e i due scatti che non coincidono. Non sta nella CI.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createServer } from "vite";
import { SCENE, sceneUrl } from "./scene.mjs";
import { openStage, prepareScene, stillShot, OUTPUT, WINDOW } from "./stage.mjs";
import {
  CHOREOGRAPHIES,
  UNCOVERED,
  family,
  foreignProperties,
  jumps,
  midpoint,
  residue,
} from "./motion-rules.mjs";

const REPORT = join(OUTPUT, "moto");
/// Una luce sola: il movimento non dipende dal colore, e la coreografia della
/// luce parte dal buio per arrivare al chiaro.
const LIGHT = "dark";
/// Quanto si aspetta il riposo prima di dire che non arriva (ms).
const REST_LIMIT_MS = 10_000;
/// Di quanto avanza il tempo in mano a ogni giro d'attesa (ms).
const REST_STEP_MS = 50;

const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);

// ── Ciò che gira nella pagina ───────────────────────────────────────────────

/// Il registro, installato prima di ogni script della pagina: ogni
/// `Element.animate` e ogni transizione o animazione CSS che parte, con le
/// proprietà che tocca. Non cambia niente di ciò che la pagina fa: annota.
function RECORDER() {
  const log = { waapi: [], css: [] };
  const paths = new WeakMap();
  const path = (el) => {
    if (!(el instanceof Element)) return "?";
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent = node.parentElement;
      const classes =
        typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      const place = parent ? `:nth-child(${[...parent.children].indexOf(node) + 1})` : "";
      parts.unshift(`${node.tagName.toLowerCase()}${classes.map((name) => `.${name}`).join("")}${place}`);
      node = parent;
    }
    if (!el.isConnected) parts.unshift("(staccato)");
    return parts.join(" > ") || el.tagName.toLowerCase();
  };
  const keysOf = (frames) => [...new Set(frames.flatMap((frame) => Object.keys(frame ?? {})))];

  const original = Element.prototype.animate;
  Element.prototype.animate = function animate(keyframes, options) {
    const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
    const pseudo = (typeof options === "object" && options !== null && options.pseudoElement) || "";
    const where = path(this);
    paths.set(this, where);
    log.waapi.push({ target: where, pseudo, keys: keysOf(frames) });
    return original.call(this, keyframes, options);
  };
  document.addEventListener(
    "transitionrun",
    (event) => {
      log.css.push({
        kind: "transizione",
        target: path(event.target),
        pseudo: event.pseudoElement || "",
        name: event.propertyName,
        keys: [event.propertyName],
      });
    },
    true,
  );
  document.addEventListener(
    "animationstart",
    (event) => {
      let keys = [];
      try {
        const animation = event.target
          .getAnimations({ subtree: true })
          .find((candidate) => candidate.animationName === event.animationName);
        keys = keysOf(animation?.effect?.getKeyframes() ?? []);
      } catch {
        // Un'animazione già finita non ha più fotogrammi da leggere.
      }
      log.css.push({
        kind: "animazione",
        target: path(event.target),
        pseudo: event.pseudoElement || "",
        name: event.animationName,
        keys,
      });
    },
    true,
  );
  window.__motoLog = { log, path, paths, keysOf };
}

/// Gli attrezzi, installati a scena pronta. Prendono `moto` dallo stesso modulo
/// che usa la pagina: il motore che il banco sostituisce è quello dell'app.
async function TOOLS() {
  const moto = await import("/src/moto/index.ts");
  const { log, path, paths, keysOf } = window.__motoLog;
  const MOTION = ["transform", "opacity", "translate", "scale", "rotate"];
  let driver = null;
  let ambient = new Set();
  let at = { waapi: 0, css: 0, plays: 0 };
  let written = new Map();
  let watched = [];

  /// Il cursore dell'editor: un'animazione senza fine che non è del moto.
  const caret = (animation) =>
    animation instanceof CSSAnimation &&
    animation.effect?.target instanceof Element &&
    animation.effect.target.closest(".cm-cursorLayer") !== null;
  const alive = () => document.getAnimations().filter((animation) => !ambient.has(animation) && !caret(animation));
  const describe = (animation) => {
    const effect = animation.effect;
    let keys = [];
    try {
      keys = keysOf(effect?.getKeyframes() ?? []);
    } catch {
      // Senza fotogrammi resta il nome.
    }
    const transition = animation instanceof CSSTransition;
    const named = animation instanceof CSSAnimation;
    return {
      kind: transition ? "transizione" : named ? "animazione" : "waapi",
      name: transition ? animation.transitionProperty : named ? animation.animationName : "",
      target: effect?.target ? path(effect.target) : "?",
      pseudo: effect?.pseudoElement ?? "",
      keys,
      state: animation.playState,
    };
  };

  const declarations = (text) => {
    const found = new Map();
    for (const part of text.split(";")) {
      const colon = part.indexOf(":");
      if (colon > 0) found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    return found;
  };
  const snapshot = () =>
    new Map([...document.querySelectorAll("[style]")].map((el) => [el, el.getAttribute("style") ?? ""]));

  /// Il riquadro che si vede di un elemento, o di un suo pseudo-elemento
  /// posizionato: dove sta, quanto è grande, quanto è opaco.
  const boxOf = (el, pseudo) => {
    if (!el.isConnected) return null;
    const host = el.getBoundingClientRect();
    if (!pseudo) {
      if (host.width === 0 && host.height === 0) return null;
      return {
        left: host.left,
        top: host.top,
        width: host.width,
        height: host.height,
        opacity: Number(getComputedStyle(el).opacity),
      };
    }
    const style = getComputedStyle(el, pseudo);
    if (style.content === "none" || style.display === "none" || style.position !== "absolute") return null;
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    const left = host.left + el.clientLeft + Number.parseFloat(style.left);
    const top = host.top + el.clientTop + Number.parseFloat(style.top);
    if (![width, height, left, top].every(Number.isFinite)) return null;
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const [ox, oy] = style.transformOrigin.split(" ").map(Number.parseFloat);
    const xs = [];
    const ys = [];
    for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
      const point = matrix.transformPoint(new DOMPoint(x - ox, y - oy));
      xs.push(point.x + ox);
      ys.push(point.y + oy);
    }
    return {
      left: left + Math.min(...xs),
      top: top + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      opacity: Number(style.opacity),
    };
  };

  window.__banco = {
    level: () => moto.motionLevel(),
    /// La scena è ferma: ciò che è vivo adesso non è del gesto. Da qui si
    /// contano le corse.
    rested() {
      ambient = new Set(document.getAnimations());
      at = { waapi: log.waapi.length, css: log.css.length, plays: driver ? driver.plays.length : 0 };
      written = new Map();
      return ambient.size;
    },
    /// Prende il tempo in mano. Va fatto a corse ferme.
    takeTime() {
      driver = moto.createManualDriver();
      moto.setMotionDriver(driver);
      at.plays = 0;
    },
    state() {
      return { active: moto.activeMotions(), live: alive().map(describe) };
    },
    /// Fa passare `ms` un fotogramma alla volta, e annota ogni proprietà in
    /// linea che cambia mentre passa soltanto il tempo.
    advance(ms) {
      if (!driver) return;
      const frame = 1000 / 60;
      let left = ms;
      let before = snapshot();
      while (left > 1e-9) {
        const step = Math.min(left, frame);
        left -= step;
        driver.advance(step);
        const after = snapshot();
        for (const [el, text] of after) {
          const was = before.get(el);
          // Un elemento nuovo nasce col suo stile: non è una riscrittura.
          if (was === undefined || was === text) continue;
          const old = declarations(was);
          const now = declarations(text);
          for (const name of new Set([...old.keys(), ...now.keys()])) {
            if (old.get(name) === now.get(name)) continue;
            const names = written.get(el) ?? new Map();
            names.set(name, (names.get(name) ?? 0) + 1);
            written.set(el, names);
          }
        }
        before = after;
      }
    },
    /// Quanto durano le corse vive, ritardo compreso.
    lengths() {
      if (!driver) return [];
      return driver.plays
        .filter((play) => play.state === "running")
        .map((play) => play.timing.delay + play.timing.duration);
    },
    /// Tutto ciò che è partito da `rested` in poi.
    seen() {
      const runs = (driver ? driver.plays.slice(at.plays) : []).map((play) => ({
        target: paths.get(play.el) ?? path(play.el),
        pseudo: play.timing.pseudo ?? "",
        keys: keysOf(play.keyframes),
        duration: Math.round(play.timing.duration),
        delay: Math.round(play.timing.delay),
        state: play.state,
      }));
      const rewritten = [];
      for (const [el, names] of written) {
        for (const [property, frames] of names) {
          // Una scrittura sola è un cambio di stato caduto in quel fotogramma.
          if (frames >= 2) rewritten.push({ target: path(el), property, frames });
        }
      }
      return {
        runs,
        waapi: log.waapi.slice(at.waapi),
        css: log.css.slice(at.css),
        live: alive().map(describe),
        written: rewritten,
      };
    },
    /// Le proprietà del moto che stanno in linea, elemento per elemento.
    inline() {
      const found = [];
      for (const el of document.querySelectorAll("[style]")) {
        for (const property of MOTION) {
          const value = el.style.getPropertyValue(property);
          if (value) found.push({ path: path(el), property, value });
        }
      }
      return found;
    },
    /// I riquadri di ciò che si sta muovendo: i bersagli delle corse vive e ciò
    /// che un valore a molla sposta. Con `remember` li tiene a mente; senza,
    /// aggiunge quelli tenuti a mente a quelli di adesso.
    moving(track, remember) {
      const pairs = [];
      const add = (el, pseudo) => {
        if (!pairs.some((pair) => pair[0] === el && pair[1] === pseudo)) pairs.push([el, pseudo]);
      };
      if (driver) {
        for (const play of driver.plays) {
          if (play.state === "running") add(play.el, play.timing.pseudo ?? "");
        }
      }
      for (const selector of track) {
        const el = document.querySelector(selector);
        if (el) add(el, "");
      }
      if (remember) watched = pairs.slice();
      else for (const [el, pseudo] of watched) add(el, pseudo);
      const boxes = [];
      for (const [el, pseudo] of pairs) {
        const box = boxOf(el, pseudo);
        if (box) boxes.push({ key: `${path(el)}${pseudo}`, ...box });
      }
      return boxes;
    },
  };
  return moto.motionLevel();
}

// ── Il palco ─────────────────────────────────────────────────────────────────

/// Una pagina del banco del moto. È quella di `stage.mjs` meno le due cose che
/// questo banco non ferma: il moto, che qui si sceglie, e l'ora.
async function openPage(browser, scene, reducedMotion) {
  const context = await browser.newContext({
    viewport: scene.viewport ?? WINDOW,
    deviceScaleFactor: 1,
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    reducedMotion,
    colorScheme: LIGHT,
  });
  await context.addInitScript(RECORDER);
  const page = await context.newPage();
  return { context, page };
}

const inPage = (page, method, ...args) =>
  page.evaluate(([name, values]) => window.__banco[name](...values), [method, args]);

/// Aspetta che `check` diventi vero senza far passare il tempo in mano.
async function until(page, check, limit = 5000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if (await check(page)) return true;
    await page.waitForTimeout(25);
  }
  return false;
}

/// Aspetta il riposo: nessuna corsa, nessuna animazione partita col gesto, e
/// lo stato che `done` riconosce. Col tempo in mano lo fa avanzare; le
/// transizioni della pelle e le attese del prodotto passano da sole.
async function settle(page, done, manual) {
  const start = Date.now();
  let quiet = 0;
  let last = { active: 0, live: [] };
  let arrived = true;
  while (Date.now() - start < REST_LIMIT_MS) {
    last = await page.evaluate(
      async ([advance, step]) => {
        if (advance) window.__banco.advance(step);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return window.__banco.state();
      },
      [manual, REST_STEP_MS],
    );
    arrived = done ? await done(page) : true;
    quiet = last.active === 0 && last.live.length === 0 && arrived ? quiet + 1 : 0;
    if (quiet >= 3) return { rest: true, arrived, ...last };
    await page.waitForTimeout(30);
  }
  return { rest: false, arrived, ...last };
}

/// Toglie il puntatore da sopra l'ultimo controllo, come fa `prepareScene`:
/// si confronta lo stato, non un hover. Non dove lo stato dura finché il
/// puntatore resta (lì si toglie solo il suggerimento).
async function park(page, choreography) {
  if (!choreography.holds) {
    await page.mouse.move(0, 0);
    return;
  }
  // Dove lo stato dura finché il puntatore resta, il puntatore resta; ma il
  // suggerimento che compare dopo la sosta non è lo stato della coreografia:
  // arriva solo se la riga sotto il puntatore è già lì quando scade l'attesa,
  // cioè dipende da come ci si è arrivati. Si toglie, come si toglie l'hover.
  await page.evaluate(() => {
    const tip = document.getElementById("fub-tooltip");
    if (tip) tip.hidden = true;
  });
}

/// Fa ridipingere tutta la pagina, senza toccare layout, fuoco o stato: per due
/// fotogrammi la radice prende un'opacità appena sotto l'uno, poi torna com'era.
///
/// Serve perché Chromium non ridipinge sempre tutto ciò che un cambio tocca:
/// l'antialiasing di un angolo tondo accanto a ciò che è cambiato può restare
/// quello di prima (fino a 6 livelli su 255), e di quanto dipende dalla strada.
/// Col moto ridotto il cambio è un salto e invalida poco; col moto passa per
/// uno strato composito, e quando lo strato se ne va ridipinge di più. I due
/// scatti differivano così di qualche pixel anche a stato identico: dopo un
/// ridisegno intero coincidono. La regola confronta lo stato, non la storia
/// delle tessere.
async function repaint(page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.documentElement;
    const was = root.style.getPropertyValue("opacity");
    root.style.setProperty("opacity", "0.999");
    await frame();
    if (was) root.style.setProperty("opacity", was);
    else root.style.removeProperty("opacity");
    await frame();
  });
}

/// Uno scatto fermo, o l'ultimo che si è riusciti a fare e la nota che la
/// scena non sta ferma. Sempre dopo un ridisegno intero (`repaint`).
async function shot(page) {
  await repaint(page);
  try {
    return { png: await stillShot(page), still: true };
  } catch {
    return { png: await page.screenshot(), still: false };
  }
}

/// Porta la pagina alla scena, ferma, con gli attrezzi installati.
async function ready(stage, choreography, scene, reducedMotion) {
  const opened = await openPage(stage.browser, scene, reducedMotion);
  try {
    const { page } = opened;
    await prepareScene(page, scene, LIGHT, stage.base, sceneUrl);
    if (choreography.setup) await choreography.setup(page);
    const level = await page.evaluate(TOOLS);
    if (!choreography.mount) {
      await settle(page, null, false);
      await inPage(page, "rested");
    }
    return { ...opened, level };
  } catch (error) {
    await opened.context.close();
    throw error;
  }
}

/// Il gesto, e l'attesa che il movimento parta dove una sosta lo separa dal
/// gesto. Col moto ridotto ciò che `started` riconosce può non esserci mai (la
/// scena della luce non parte): lì è solo un'attesa, non una condizione.
async function gesture(page, choreography, strict = true) {
  if (!choreography.act) return;
  await choreography.act(page);
  if (!choreography.started) return;
  if (!(await until(page, choreography.started, strict ? 5000 : 1500)) && strict) {
    throw new Error("il gesto non ha fatto partire niente: `started` non si è avverato");
  }
}

/// Lo stato d'arrivo, col motore vero e nel tempo vero (regole 1 e 2).
async function arrival(stage, choreography, scene, reducedMotion) {
  const { context, page, level } = await ready(stage, choreography, scene, reducedMotion);
  try {
    await gesture(page, choreography, reducedMotion !== "reduce");
    await settle(page, choreography.arrived, false);
    await park(page, choreography);
    const rest = await settle(page, choreography.arrived, false);
    const final = await shot(page);
    return {
      level,
      rest,
      final,
      seen: await inPage(page, "seen"),
      inline: await inPage(page, "inline"),
    };
  } finally {
    await context.close();
  }
}

/// L'andata e ritorno completa, poi la stessa interrotta a metà, col tempo in
/// mano (regole 3 e 4).
async function reversal(stage, choreography, scene) {
  const { context, page } = await ready(stage, choreography, scene, "no-preference");
  const track = choreography.track ?? [];
  try {
    await inPage(page, "takeTime");
    const pristine = await shot(page);

    const back = async () => {
      await settle(page, choreography.returned, true);
      await page.mouse.move(0, 0);
      return settle(page, choreography.returned, true);
    };

    let round = null;
    if (choreography.undo) {
      await gesture(page, choreography);
      await settle(page, choreography.arrived, true);
      await park(page, choreography);
      await settle(page, choreography.arrived, true);
      await choreography.undo(page);
      const rest = await back();
      round = { ...(await shot(page)), rest };
    }

    await gesture(page, choreography);
    // Il puntatore se ne va come nell'andata e ritorno completa, dove `park`
    // lo toglie prima del gesto contrario: lasciato sul bottone premuto,
    // l'inversione troverebbe un hover che l'altro scatto non ha.
    await park(page, choreography);
    const middle = midpoint(await inPage(page, "lengths"));
    await inPage(page, "advance", middle);
    const flying = await inPage(page, "state");
    const frame = await page.screenshot();
    const before = await inPage(page, "moving", track, true);

    let interrupted = null;
    let after = [];
    if (choreography.undo) {
      await choreography.undo(page);
      if (choreography.reversing) await until(page, choreography.reversing);
      after = await inPage(page, "moving", track, false);
      const rest = await back();
      interrupted = { ...(await shot(page)), rest };
    } else {
      await settle(page, choreography.arrived, true);
    }
    return { pristine, round, interrupted, middle, flying, frame, before, after, seen: await inPage(page, "seen") };
  } finally {
    await context.close();
  }
}

// ── I confronti ──────────────────────────────────────────────────────────────

/// Due scatti, al pixel: quanti differiscono, dove, e l'immagine della
/// differenza. Nessuna soglia: la regola dice «al pixel».
function compare(first, second) {
  if (first.equals(second)) return { same: true, different: 0 };
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  if (a.width !== b.width || a.height !== b.height) {
    return { same: false, different: -1, box: null, diff: null };
  }
  let different = 0;
  const box = { left: a.width, top: a.height, right: -1, bottom: -1 };
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (
        a.data[i] === b.data[i] &&
        a.data[i + 1] === b.data[i + 1] &&
        a.data[i + 2] === b.data[i + 2] &&
        a.data[i + 3] === b.data[i + 3]
      ) {
        continue;
      }
      different += 1;
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  if (different === 0) return { same: true, different: 0 };
  const diff = new PNG({ width: a.width, height: a.height });
  pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0, includeAA: true });
  return { same: false, different, box, diff: PNG.sync.write(diff) };
}

const boxText = (box) =>
  box ? `fra ${box.left},${box.top} e ${box.right},${box.bottom}` : "le due immagini non hanno la stessa misura";

/// Le proprietà estranee di tutto ciò che è partito, una riga per origine,
/// bersaglio e proprietà.
function foreign(seen) {
  const found = new Map();
  const note = (origin, target, pseudo, names) => {
    for (const property of foreignProperties(names)) {
      const key = `${origin}\n${target}${pseudo}\n${property}`;
      if (!found.has(key)) found.set(key, { origin, target: `${target}${pseudo}`, property, family: family(property) });
    }
  };
  for (const run of seen.runs ?? []) note("corsa di moto", run.target, run.pseudo, run.keys);
  for (const call of seen.waapi ?? []) note("corsa di moto", call.target, call.pseudo, call.keys);
  for (const entry of seen.css ?? []) note(`${entry.kind} CSS`, entry.target, entry.pseudo, entry.keys);
  for (const live of seen.live ?? []) {
    note(live.kind === "waapi" ? "corsa di moto" : `${live.kind} CSS`, live.target, live.pseudo, live.keys);
  }
  for (const entry of seen.written ?? []) note("scrittura in linea a ogni fotogramma", entry.target, "", [entry.property]);
  return [...found.values()];
}

async function save(name, png) {
  if (png) await writeFile(join(REPORT, name), png);
}

/// Misura una coreografia e ne dà il referto: una voce per regola, con
/// `pass` (`null` se la regola non si applica) e le ragioni di un rosso.
async function measure(stage, choreography, scene) {
  const moving = await arrival(stage, choreography, scene, "no-preference");
  const still = await arrival(stage, choreography, scene, "reduce");
  const turned = choreography.mount ? null : await reversal(stage, choreography, scene);
  const id = choreography.id;
  const rules = {};

  // 1. Stato finale identico.
  const final = compare(moving.final.png, still.final.png);
  const why1 = [];
  if (!moving.rest.arrived || !still.rest.arrived) why1.push("lo stato d'arrivo non è stato raggiunto");
  if (!moving.final.still) why1.push("col movimento la scena non sta ferma: due scatti di fila non coincidono");
  if (!still.final.still) why1.push("col moto ridotto la scena non sta ferma");
  if (!final.same) {
    why1.push(`${final.different} pixel diversi ${boxText(final.box)}: ${id}-regola1-*.png`);
    await save(`${id}-regola1-mosso.png`, moving.final.png);
    await save(`${id}-regola1-fermo.png`, still.final.png);
    await save(`${id}-regola1-diff.png`, final.diff);
  }
  rules[1] = { pass: why1.length === 0, why: why1 };

  // 2. Nessun residuo.
  const why2 = [];
  if (!moving.rest.rest) why2.push(`non torna a riposo entro ${REST_LIMIT_MS / 1000} s`);
  if (moving.rest.active > 0) why2.push(`${moving.rest.active} corse di moto ancora vive a riposo`);
  for (const live of moving.rest.live) {
    why2.push(`${live.kind} ${live.name || live.keys.join(",")} ancora viva su ${live.target}${live.pseudo}`);
  }
  const left = residue(moving.inline, still.inline);
  for (const entry of left) {
    const instead = entry.still === null ? "il moto ridotto non la lascia" : `col moto ridotto vale «${entry.still}»`;
    why2.push(`${entry.property}: ${entry.value} in linea su ${entry.path} (${instead})`);
  }
  rules[2] = { pass: why2.length === 0, why: why2 };

  // 3. Solo proprietà ammesse.
  const strangers = [...foreign(moving.seen), ...(turned ? foreign(turned.seen) : [])];
  const unique = [...new Map(strangers.map((s) => [`${s.origin}\n${s.target}\n${s.property}`, s])).values()];
  rules[3] = {
    pass: unique.length === 0,
    why: unique.map((s) => `${s.origin}: ${s.property} (${s.family === "paint" ? "pittura" : "geometria"}) su ${s.target}`),
    foreign: unique,
  };

  // Che qualcosa si sia mosso davvero: senza, le altre regole non dicono niente.
  const runs = (turned?.seen.runs.length ?? 0) + moving.seen.waapi.length;
  const springs = turned?.seen.written.length ?? 0;
  const inFlight = turned ? turned.flying.active > 0 : moving.seen.waapi.length > 0;
  const moved = runs + springs > 0;

  // 4. Interrompibile.
  if (!turned || !choreography.undo) {
    rules[4] = { pass: null, why: [choreography.irreversible ?? "non c'è un gesto da invertire"] };
  } else {
    const why4 = [];
    const same = compare(turned.interrupted.png, turned.round.png);
    if (!turned.round.rest.rest || !turned.round.rest.arrived) why4.push("l'andata e ritorno completa non torna a riposo");
    if (!turned.interrupted.rest.rest || !turned.interrupted.rest.arrived) {
      why4.push("dopo l'inversione non si torna allo stato di partenza");
    }
    if (!same.same) {
      why4.push(`dopo l'inversione ${same.different} pixel diversi dall'andata e ritorno completa, ${boxText(same.box)}: ${id}-regola4-*.png`);
      await save(`${id}-regola4-andata-e-ritorno.png`, turned.round.png);
      await save(`${id}-regola4-interrotta.png`, turned.interrupted.png);
      await save(`${id}-regola4-diff.png`, same.diff);
    }
    if (!inFlight && !choreography.still) why4.push("a metà corsa non c'era niente in viaggio da interrompere");
    const jumped = jumps(turned.before, turned.after);
    for (const jump of jumped) {
      why4.push(
        jump.nearest === null
          ? `${jump.key} sparisce all'inversione, senza un'immagine che prosegua`
          : `${jump.key} salta all'inversione: ${jump.px} px, ${jump.opacity} di opacità dal riquadro più vicino (${jump.nearest})`,
      );
    }
    rules[4] = { pass: why4.length === 0, why: why4, jumps: jumped, watched: turned.before.length };
  }

  const notes = [];
  if (!moved && !choreography.still) notes.push("non si è mosso niente: nessuna corsa di moto e nessun valore a molla");
  if (!moved && choreography.still) notes.push("non passa da moto: nessuna corsa, le regole valgono a vuoto");
  if (moving.level !== "full") notes.push(`il livello del moto era «${moving.level}», non «full»`);
  if (turned?.round) {
    const drift = compare(turned.round.png, turned.pristine.png);
    if (!drift.same) {
      notes.push(`andata e ritorno completa: ${drift.different} pixel diversi dallo scatto di prima del gesto (${boxText(drift.box)}); è stato, non corsa`);
    }
  }
  if (turned) {
    await save(`${id}-meta.png`, turned.frame);
    notes.push(`metà corsa a ${Math.round(turned.middle)} ms: ${id}-meta.png`);
  }

  return {
    id,
    title: choreography.title,
    rules,
    moved: moved || Boolean(choreography.still),
    notes,
    runs: turned?.seen.runs ?? moving.seen.waapi,
    css: [...moving.seen.css, ...(turned?.seen.css ?? [])],
    written: turned?.seen.written ?? [],
  };
}

// ── La corsa ─────────────────────────────────────────────────────────────────

const mark = (rule) => (rule.pass === null ? "–" : rule.pass ? "✓" : "✗");

const chosen = only ? CHOREOGRAPHIES.filter((c) => only.includes(c.id)) : CHOREOGRAPHIES;
if (only && chosen.length !== only.length) {
  const known = new Set(CHOREOGRAPHIES.map((c) => c.id));
  console.error(`coreografia sconosciuta: ${only.filter((id) => !known.has(id)).join(", ")}`);
  process.exit(2);
}

await rm(REPORT, { recursive: true, force: true });
await mkdir(REPORT, { recursive: true });

// Una corsa dura minuti: un file salvato intanto non deve ricaricare la pagina
// sotto la misura. Il server non guarda il disco e non manda aggiornamenti.
const stage = await openStage({
  createServer: (options) => createServer({ ...options, server: { hmr: false, watch: null } }),
});
const report = [];
try {
  for (const choreography of chosen) {
    const scene = SCENE.find((candidate) => candidate.id === choreography.scene);
    let row;
    try {
      if (!scene) throw new Error(`la scena «${choreography.scene}» non c'è`);
      row = await measure(stage, choreography, scene);
    } catch (error) {
      row = {
        id: choreography.id,
        title: choreography.title,
        error: String(error?.message ?? error).split("\n")[0],
      };
    }
    report.push(row);
    if (row.error) {
      console.log(`✗ ${row.id} — ${row.title}\n    non misurata: ${row.error}`);
      continue;
    }
    const red = !row.moved || Object.values(row.rules).some((rule) => rule.pass === false);
    const marks = [1, 2, 3, 4].map((n) => `${n} ${mark(row.rules[n])}`).join("  ");
    console.log(`${red ? "✗" : "·"} ${row.id} — ${row.title}\n    ${marks}`);
    for (const n of [1, 2, 3, 4]) {
      if (row.rules[n].pass !== false) continue;
      for (const why of row.rules[n].why) console.log(`    [${n}] ${why}`);
    }
    for (const note of row.notes) console.log(`    · ${note}`);
  }
} finally {
  await stage.close();
}

await writeFile(join(REPORT, "moto.json"), `${JSON.stringify({ light: LIGHT, report, uncovered: UNCOVERED }, null, 2)}\n`);

const failed = report.filter(
  (row) => row.error || !row.moved || Object.values(row.rules).some((rule) => rule.pass === false),
);
console.log("");
console.log("Le regole: 1 stato finale identico · 2 nessun residuo · 3 solo proprietà ammesse · 4 interrompibile");
if (!only) {
  console.log("Senza coreografia:");
  for (const entry of UNCOVERED) console.log(`    ${entry.source} — ${entry.reason}`);
}
console.log(`${report.length - failed.length}/${report.length} coreografie rispettano le regole`);
console.log(`Il referto: ${join(REPORT, "moto.json")}`);
process.exit(failed.length > 0 ? 1 : 0);
