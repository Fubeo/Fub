// Il movimento dei segni della griglia: un motore solo.
//
// I segni che scivolano (i lati del rettangolo, l'anello della cella attiva,
// il velo, le fasce delle intestazioni, il quadratino) si disegnano da dieci
// numeri (`MarkGeometry` di `marks.ts`). Il motore tiene il bersaglio
// (`want`) e ciò che si vede (`view`, coi numeri e la loro velocità in px al
// secondo). Un evento (un tasto, il puntatore, un comando, lo scorrimento
// sotto un trascinamento) cambia soltanto il bersaglio e ridisegna da ciò che
// si vede: dentro un evento non avanza niente. Avanza un ascoltatore di
// `onFrame`, iscritto finché i numeri non sono arrivati: una volta per
// fotogramma applica le regole del passo (`stepMarks`), fa un passo di molla
// per numero e ridisegna tutti i pezzi di tutti i livelli. Così il moto non
// dipende da quanti eventi arrivano in un fotogramma, e i pezzi non possono
// essere in disaccordo, perché vengono dagli stessi numeri nello stesso
// istante.
//
// Niente fotogrammi WAAPI per ciò che scivola: corse annullate e ripianificate
// a ogni cella erano la causa dei salti. `animate` resta per ciò che non
// segue i dieci numeri: la dissolvenza di un pezzo che compare già al suo
// posto o che esce (il contorno di un riempimento), il battito di una copia e
// i passi delle formiche, che camminano solo mentre il foglio non ha ancora
// risposto (griglia T6).
//
// È il solo modulo della griglia che muove i segni; `engine.ts` gli dice dove
// devono andare.
import { animate, exitGhost, flip, halt, motionDriver, motionLevel, onFrame, onMotionLevelChange, stagger } from "../../moto";
import { advanceSpring, DURATION, springAtRest, springFor, type Spring } from "../../moto/spring";
import { openLifetime, type Lifetime, type Teardown } from "../../ui/lifetime";
import {
  clipRect,
  cornerZone,
  looseRect,
  MARK_NUMBERS,
  wholeRect,
  ZONES,
  type Bands,
  type MarkGeometry,
  type MarkKind,
  type MarkPart,
  type Rect,
  type Zone,
} from "./marks";

// Le molle della griglia: un po' più svelte di `snap` e `soft` della barra,
// e appena sovrasmorzate (radici 35 e 40 al secondo per `GLIDE`, 25 e 28 per
// `SLIDE`). Su una griglia un segno che passa il bersaglio e torna indietro si
// legge come un difetto, non come un rimbalzo.
/// I segni: al 90 % in circa 105 ms, fermi in circa 250.
export const GLIDE: Spring = { stiffness: 1400, damping: 75 };
/// Le colonne che scivolano e le maniglie del tocco: al 90 % in circa 150 ms.
export const SLIDE: Spring = { stiffness: 700, damping: 53 };
/// Le maniglie del tocco lungo crescono da qui, come una sezione della barra.
export const ENTER_SCALE = 0.96;
/// Un passo delle formiche, il periodo del loro tratteggio.
export const ANTS_STEP = 8;
/// Il tempo di un passo delle formiche.
export const ANTS_MS = 320;
/// Un numero è fermo a meno di un decimo di pixel dal bersaglio e sotto i
/// 2 px al secondo (`springAtRest` con questa precisione).
export const REST_PX = 0.1;

/// La radice lenta della molla (1/s): sotto questa velocità per pixel che
/// manca, una molla sovrasmorzata arriva senza passare il bersaglio. `GLIDE`
/// 35, `SLIDE` 25.
export function slowRoot(spring: Spring): number {
  const mass = spring.mass !== undefined && spring.mass > 0 ? spring.mass : 1;
  const c = spring.damping / mass;
  const k = spring.stiffness / mass;
  return (c - Math.sqrt(Math.max(0, c * c - 4 * k))) / 2;
}

/// Dove vanno i segni.
export interface MarksTarget {
  readonly geometry: MarkGeometry;
  readonly spring: Spring;
  /// Si tira il riempimento: il quadratino sta sul suo angolo, non su quello
  /// del rettangolo.
  readonly fill: boolean;
}

/// Dove si vedono i segni adesso, e a che velocità (px al secondo).
export interface MarksPose {
  readonly x: number[];
  readonly v: number[];
}

/// [numero del rettangolo, numero della cella attiva, +1 se il rettangolo
/// sta prima della cella attiva su quel lato].
const SIDES: readonly (readonly [number, number, number])[] = [
  [0, 4, 1],
  [1, 5, 1],
  [2, 6, -1],
  [3, 7, -1],
];

/// La cella attiva dentro il rettangolo. Su un lato dove la cella attiva ne
/// esce, il rettangolo la raggiunge se il suo bersaglio sta oltre di lei;
/// altrimenti è la cella attiva a fermarsi sul lato.
export function containMarks(pose: MarksPose, geometry: MarkGeometry): void {
  const { x, v } = pose;
  for (const [b, a, s] of SIDES) {
    if ((x[a] - x[b]) * s >= 0) continue;
    if ((x[a] - geometry[b]) * s >= 0) {
      x[b] = x[a];
      v[b] = v[a];
    } else {
      x[a] = x[b];
      v[a] = v[b];
    }
  }
}

/// Se tutti i numeri sono sul bersaglio, fermi.
export function marksAtTarget(target: MarksTarget, pose: MarksPose): boolean {
  return pose.x.every((x, index) => x === target.geometry[index]) && pose.v.every((v) => v === 0);
}

/// Un passo di `seconds`: le regole sul bersaglio, la molla, il
/// contenimento, il quadratino. Dice se tutti i numeri sono arrivati.
///
/// 1. Per ognuno degli otto numeri del rettangolo e della cella attiva, una
///    velocità che porta lontano dal bersaglio si azzera (un bersaglio nuovo
///    dall'altra parte non fa mai tornare indietro); quella verso il
///    bersaglio non supera la radice lenta della molla per la distanza che
///    manca, da cui una molla sovrasmorzata arriva senza passarlo; dopo il
///    passo, un numero che avrebbe passato il bersaglio, o fermo, sta
///    esattamente sul bersaglio con velocità zero.
/// 2. Il contenimento (`containMarks`).
/// 3. Il quadratino sta sull'angolo del rettangolo, o salta all'angolo del
///    riempimento mentre lo si tira.
export function stepMarks(target: MarksTarget, pose: MarksPose, seconds: number, backward = true): boolean {
  const { geometry, spring } = target;
  const { x, v } = pose;
  const slow = slowRoot(spring);
  const state = { x: 0, v: 0 };
  for (let index = 0; index < 8; index += 1) {
    const goal = geometry[index];
    const distance = x[index] - goal;
    if (distance === 0) {
      v[index] = 0;
      continue;
    }
    // `backward` falso solo per la prova che la regola serve.
    if (backward && v[index] * distance > 0) v[index] = 0;
    if (Math.abs(v[index]) > slow * Math.abs(distance)) v[index] = -Math.sign(distance) * slow * Math.abs(distance);
    state.x = x[index];
    state.v = v[index];
    if (seconds > 0) advanceSpring(spring, state, goal, seconds);
    if ((state.x - goal) * distance <= 0 || springAtRest(state, goal, REST_PX)) {
      state.x = goal;
      state.v = 0;
    }
    x[index] = state.x;
    v[index] = state.v;
  }
  containMarks(pose, geometry);
  followHandle(target, pose);
  return marksAtTarget(target, pose);
}

/// Il quadratino sta sull'angolo del rettangolo che si vede, o sull'angolo
/// del riempimento mentre lo si tira.
export function followHandle(target: MarksTarget, pose: MarksPose): void {
  const { x, v } = pose;
  for (const [handle, side] of [
    [8, 2],
    [9, 3],
  ] as const) {
    x[handle] = target.fill ? target.geometry[handle] : x[side];
    v[handle] = target.fill ? 0 : v[side];
  }
}

/// Ciò che la griglia dà al motore: i livelli del piano e la misura delle
/// fasce ferme.
export interface MarksHost {
  /// Il livello dei segni di ogni zona, che taglia ciò che ne esce.
  readonly layers: Readonly<Record<Zone, HTMLElement>>;
  /// Il livello «lift» di ogni zona, per i segni d'angolo interi.
  readonly lifts: Readonly<Record<Zone, HTMLElement>>;
  readonly lifetime: Lifetime;
  bands(): Bands;
  /// Il titolo di un pezzo (il quadratino), se ne ha uno.
  title?(kind: MarkKind): string | null;
}

/// Un aggiornamento dei segni.
export interface MarksUpdate {
  readonly geometry: MarkGeometry;
  /// I pezzi che scivolano, da una geometria: quella del bersaglio dà i posti
  /// d'arrivo, quella che si vede i rettangoli di adesso.
  readonly parts: (geometry: MarkGeometry) => MarkPart[];
  /// I pezzi che non scivolano mai: i fili del blocco, gli altri intervalli.
  readonly still?: readonly MarkPart[];
  /// Di serie `GLIDE`.
  readonly spring?: Spring;
  readonly fill?: boolean;
  /// Falso: i segni saltano al bersaglio (il cambio di foglio, una selezione
  /// rimessa dall'host).
  readonly glide?: boolean;
  /// Vero: le formiche (i pezzi `ants`) camminano, perché il foglio non ha
  /// ancora risposto; altrimenti stanno ferme.
  readonly walk?: boolean;
}

export interface MarksMotion {
  /// Mette i segni dove `next` dice e li disegna subito alla geometria che
  /// si vede; chi scivola parte dal fotogramma dopo.
  update(next: MarksUpdate): void;
  /// I dieci numeri che si vedono adesso, o `null` senza segni.
  shown(): MarkGeometry | null;
  /// Nasconde tutti i segni e dimentica la corsa.
  clear(): void;
  /// Se `element` è un pezzo del motore.
  owns(element: Element): boolean;
  /// Se c'è un ascoltatore di fotogramma iscritto.
  moving(): boolean;
  /// Il battito di una copia: un velo su `rect` (coordinate del piano), in
  /// ogni zona dove cade, che svanisce in `DURATION.swap`. È solo una
  /// dissolvenza, quindi resta anche col movimento ridotto.
  pulse(rect: Rect): void;
  /// Se le formiche camminano adesso.
  walking(): boolean;
}

interface Drawn {
  box: string;
  transform: string;
}

/// Il motore dei segni di una griglia.
export function createMarksMotion(host: MarksHost): MarksMotion {
  let want: MarksTarget | null = null;
  let view: MarksPose | null = null;
  let parts: MarksUpdate["parts"] = () => [];
  let still: readonly MarkPart[] = [];
  let release: Teardown | null = null;
  let closed = false;
  /// `${zona}:${nome}` → l'elemento, che c'è sempre una volta nato.
  const pool = new Map<string, HTMLElement>();
  /// I pezzi che si vedono, col rettangolo di riposo nel loro livello.
  const shownRests = new Map<string, Rect>();
  const drawn = new WeakMap<HTMLElement, Drawn>();
  /// I nomi dei pezzi già nati in tutti i loro livelli.
  const born = new Set<string>();
  const owned = new WeakSet<Element>();
  /// I pezzi che escono con una dissolvenza (`fade`), e la corsa d'uscita di
  /// quelli che stanno uscendo: un pezzo che torna prima della fine la ferma.
  const fades = new Set<string>();
  const leaving = new Map<HTMLElement, number>();
  let leaves = 0;
  /// Le formiche: se il bersaglio le vuole in cammino, la vita dell'attesa
  /// finché camminano, e i pezzi che ci camminano dentro.
  let walkWanted = false;
  let walk: Lifetime | null = null;
  let walkers = new WeakSet<HTMLElement>();
  /// Il numero dell'ultimo battito: la fine di uno vecchio non nasconde il
  /// velo di uno nuovo.
  let pulses = 0;

  const instant = () => motionLevel() === "reduced" || motionDriver().instant;

  const stop = (): void => {
    release?.();
    release = null;
  };

  const element = (id: string, zone: Zone, point: boolean): HTMLElement => {
    let el = pool.get(id);
    if (!el) {
      el = document.createElement("div");
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      owned.add(el);
      pool.set(id, el);
    }
    const parent = (point ? host.lifts : host.layers)[zone];
    if (el.parentElement !== parent) parent.append(el);
    return el;
  };

  /// Porta `el`, messo nel rettangolo `base`, a vedersi nel rettangolo
  /// `seen`. Scrive solo ciò che cambia.
  const place = (el: HTMLElement, base: Rect, seen: Rect): void => {
    const sx = base.w > 0 ? seen.w / base.w : 1;
    const sy = base.h > 0 ? seen.h / base.h : 1;
    const tx = seen.x - base.x;
    const ty = seen.y - base.y;
    const same = Math.abs(tx) < 1e-3 && Math.abs(ty) < 1e-3 && Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6;
    const box = `${base.x} ${base.y} ${base.w} ${base.h}`;
    const transform = same ? "" : `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
    let last = drawn.get(el);
    if (!last) {
      last = { box: "", transform: "" };
      drawn.set(el, last);
    }
    if (last.box !== box) {
      el.style.left = `${base.x}px`;
      el.style.top = `${base.y}px`;
      el.style.width = `${base.w}px`;
      el.style.height = `${base.h}px`;
      last.box = box;
    }
    if (last.transform !== transform) {
      el.style.transform = transform;
      last.transform = transform;
    }
    if (el.hidden) el.hidden = false;
  };

  /// Nasconde un pezzo, senza il `transform` che lo portava: nascosto non
  /// porta niente, come quando il moto è ridotto e non ha mai corso.
  const hide = (el: HTMLElement): void => {
    el.hidden = true;
    const last = drawn.get(el);
    if (last?.transform) {
      el.style.transform = "";
      last.transform = "";
    }
  };

  const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

  /// Disegna ogni pezzo in ogni livello dove cade, dalla geometria che si
  /// vede. Un pezzo col suo riposo sta lì, e un `transform` lo porta dove i
  /// numeri dicono, tagliato al bordo della zona; uno senza riposo (l'anello
  /// e il velo su una cella sola, un pezzo che esce da un livello) resta nel
  /// posto che aveva e si nasconde quando i numeri arrivano; uno senza riposo
  /// che non si vedeva non compare. Un segno d'angolo non si taglia: sta
  /// intero nel livello «lift» della zona dove la geometria che si vede mette
  /// il suo angolo, e se l'angolo passa il filo cambia livello nello stesso
  /// fotogramma. Un pezzo che compare al suo riposo si dissolve dentro in
  /// `DURATION.state`; uno che non serve più si nasconde subito.
  const draw = (): void => {
    if (!want || !view) return;
    const bands = host.bands();
    const resting = view.x.every((x, index) => x === want!.geometry[index]);
    const seen = new Map(parts(view.x).map((part) => [part.name, part]));
    const next = new Set<string>();
    const all = [...parts(want.geometry), ...still];
    // Ogni pezzo nasce una volta, nascosto, in ogni livello dove può cadere:
    // un cambio di selezione poi lo sposta o lo nasconde, e non aggiunge né
    // toglie nodi.
    for (const part of all) {
      if (born.has(part.name)) continue;
      born.add(part.name);
      for (const zone of part.zones ?? ZONES) element(`${zone}:${part.name}`, zone, Boolean(part.corner));
    }
    for (const part of all) {
      const fixedPart = part.glide === false;
      const now = fixedPart ? part : (seen.get(part.name) ?? part);
      const corner = part.corner;
      const zoneOf = (p: MarkPart) => cornerZone(p.corner!.x, p.corner!.y, p.corner!.start, bands);
      const restZone = corner ? zoneOf(part) : null;
      const nowZone = corner ? zoneOf(now.corner ? now : part) : null;
      for (const zone of corner ? [nowZone!] : (part.zones ?? ZONES)) {
        const id = `${zone}:${part.name}`;
        const rest = part.rest === false
          ? null
          : corner
            ? (restZone === zone ? wholeRect(zone, part.rect, bands) : null)
            : (clipRect(zone, part.rect, bands, { band: part.band })?.rect ?? null);
        const was = shownRests.get(id);
        const fixed = fixedPart || resting;
        const image = fixed
          ? rest
          : corner
            ? wholeRect(zone, now.rect, bands)
            : looseRect(zone, now.rect, bands, part.band);
        const base = fixed ? rest : (rest ?? was ?? (corner ? image : null));
        if (!base || !image) continue;
        next.add(id);
        const el = element(id, zone, Boolean(corner));
        const className = `grid-mark grid-mark-${part.kind}`;
        if (el.className !== className) el.className = className;
        // Le formiche sono un nastro tratteggiato dentro il lato, più lungo
        // di un passo: camminando si sposta lui, e il lato lo taglia.
        const strip = el.firstElementChild;
        if (part.kind === "ants" && !strip) {
          const ants = document.createElement("div");
          ants.className = "grid-ants";
          el.append(ants);
        } else if (part.kind !== "ants" && strip) {
          strip.remove();
        }
        if (part.fade) fades.add(id);
        else fades.delete(id);
        if (leaving.delete(el)) halt(el);
        if (el.dataset.mark !== part.name) el.dataset.mark = part.name;
        if (part.dir) {
          if (el.dataset.dir !== part.dir) el.dataset.dir = part.dir;
        } else if (el.dataset.dir !== undefined) {
          delete el.dataset.dir;
        }
        const title = host.title?.(part.kind) ?? null;
        if (title !== null && el.title !== title) el.title = title;
        // Un segno d'angolo che arriva da un altro livello non ricompare.
        const moved = Boolean(corner) && !was && ZONES.some((other) => other !== zone && shownRests.has(`${other}:${part.name}`));
        if (!was && !moved && sameRect(image, base)) {
          animate(el, { from: { opacity: 0 }, duration: DURATION.state, whenReduced: "fade", lifetime: host.lifetime });
        }
        place(el, base, image);
        // Se il posto dove sta è il suo arrivo (e non l'ultimo riposo di un
        // pezzo che esce): chi misura il moto (il banco) legge qui il bersaglio.
        const arriving = base === rest;
        if (el.hasAttribute("data-arrive") !== arriving) el.toggleAttribute("data-arrive", arriving);
        shownRests.set(id, base);
      }
    }
    for (const id of [...shownRests.keys()]) {
      if (next.has(id)) continue;
      const el = pool.get(id)!;
      shownRests.delete(id);
      if (fades.has(id) && !instant()) {
        leave(el);
        continue;
      }
      halt(el);
      leaving.delete(el);
      hide(el);
    }
    syncAnts();
  };

  /// Un pezzo che non serve più esce con una dissolvenza in `DURATION.swap`
  /// e poi si nasconde, se nel frattempo non è tornato.
  const leave = (el: HTMLElement): void => {
    if (leaving.has(el)) return;
    const ticket = ++leaves;
    leaving.set(el, ticket);
    const done = (): void => {
      if (leaving.get(el) !== ticket) return;
      leaving.delete(el);
      hide(el);
    };
    void animate(el, { to: { opacity: 0 }, duration: DURATION.swap, easing: "ease-out", whenReduced: "fade", lifetime: host.lifetime })
      .finished.then(done);
  };

  /// Le formiche camminano nei pezzi `ants` che si vedono finché il bersaglio
  /// dice `walk`, mai col movimento ridotto. Ogni passo è una corsa lineare
  /// di `ANTS_STEP` px in `ANTS_MS`, nella vita dell'attesa, che riparte
  /// quando finisce (`moto` non ripete): il tratteggio ha il periodo di un
  /// passo, quindi la fine di una corsa e l'inizio della dopo sono la stessa
  /// immagine. La risposta del foglio, lo smontaggio e «ridotto» chiudono la
  /// vita, e le corse si fermano.
  const syncAnts = (): void => {
    if (!walkWanted || instant() || closed) {
      stopAnts();
      return;
    }
    if (!walk) {
      walk = openLifetime();
      walkers = new WeakSet();
      // «Ridotto» acceso mentre camminano le ferma subito.
      walk.add(onMotionLevelChange(() => {
        if (instant()) stopAnts();
      }));
    }
    const life = walk;
    for (const id of shownRests.keys()) {
      const el = pool.get(id)!;
      if (!el.classList.contains("grid-mark-ants") || walkers.has(el) || leaving.has(el)) continue;
      const strip = el.firstElementChild;
      if (!strip) continue;
      walkers.add(el);
      // In senso orario: in alto verso destra, a destra in giù, in basso
      // verso sinistra, a sinistra in su.
      const name = el.dataset.mark ?? "";
      const forward = name.endsWith("-top") || name.endsWith("-right");
      const ahead = el.dataset.dir === "v" ? { y: ANTS_STEP } : { x: ANTS_STEP };
      const step = (): void => {
        if (life.closed || el.hidden || leaving.has(el) || instant()) {
          walkers.delete(el);
          return;
        }
        void animate(strip, {
          from: forward ? {} : ahead,
          to: forward ? ahead : {},
          duration: ANTS_MS,
          easing: "linear",
          lifetime: life,
        }).finished.then(step);
      };
      step();
    }
  };

  const stopAnts = (): void => {
    walk?.close();
    walk = null;
  };

  const frame = (elapsed: number): void => {
    if (!want || !view) {
      stop();
      return;
    }
    let arrived: boolean;
    if (instant()) {
      view = { x: want.geometry.slice(), v: want.geometry.map(() => 0) };
      arrived = true;
    } else {
      arrived = stepMarks(want, view, elapsed / 1000);
    }
    draw();
    if (arrived) stop();
  };

  host.lifetime.add(() => {
    closed = true;
    stop();
    stopAnts();
    for (const el of pool.values()) halt(el);
  });

  return {
    update(next) {
      if (closed) return;
      if (next.geometry.length !== MARK_NUMBERS) throw new Error("i segni della griglia vogliono dieci numeri");
      const calm = motionLevel() === "calm";
      want = { geometry: next.geometry.slice(), spring: springFor(next.spring ?? GLIDE, calm), fill: next.fill ?? false };
      parts = next.parts;
      still = next.still ?? [];
      walkWanted = next.walk ?? false;
      if (next.glide === false || !view || instant()) {
        view = { x: want.geometry.slice(), v: want.geometry.map(() => 0) };
      } else {
        // Il quadratino segue subito il riempimento che comincia o finisce;
        // le velocità le tocca solo il passo, così dieci eventi in un
        // fotogramma muovono come l'ultimo da solo.
        followHandle(want, view);
      }
      draw();
      if (marksAtTarget(want, view)) stop();
      else if (!release) release = onFrame(frame);
    },
    shown: () => (view ? view.x.slice() : null),
    clear() {
      stop();
      stopAnts();
      walkWanted = false;
      want = null;
      view = null;
      for (const id of shownRests.keys()) {
        const el = pool.get(id)!;
        halt(el);
        hide(el);
      }
      for (const el of leaving.keys()) {
        halt(el);
        hide(el);
      }
      leaving.clear();
      shownRests.clear();
    },
    owns: (el) => owned.has(el),
    moving: () => release !== null,
    pulse(rect) {
      if (closed) return;
      const bands = host.bands();
      const ticket = ++pulses;
      for (const zone of ZONES) {
        const piece = clipRect(zone, rect, bands);
        const id = `${zone}:flash`;
        const el = piece ? element(id, zone, false) : pool.get(id);
        if (!el) continue;
        halt(el);
        if (!piece) {
          el.hidden = true;
          continue;
        }
        if (el.className !== "grid-mark grid-mark-flash") el.className = "grid-mark grid-mark-flash";
        el.dataset.mark = "flash";
        // A riposo il velo è trasparente: la dissolvenza lo porta da pieno a
        // niente, e la sua fine è già il suo riposo.
        el.style.opacity = "0";
        place(el, piece.rect, piece.rect);
        const done = (): void => {
          if (pulses === ticket) el.hidden = true;
        };
        void animate(el, { from: { opacity: 1 }, to: { opacity: 0 }, duration: DURATION.swap, easing: "ease-out", whenReduced: "fade", lifetime: host.lifetime })
          .finished.then(done);
      }
    },
    walking: () => walk !== null,
  };
}

/// La cornice della cella aperta compare (griglia T4): una dissolvenza in
/// `DURATION.state`, che resta anche col movimento ridotto. Il resto della
/// cella aperta (la carta, il testo, la misura) è già al suo posto, e lo stato
/// finale è lo stesso con il movimento e senza.
export function showEditorFrame(frame: HTMLElement, lifetime: Lifetime): void {
  animate(frame, { from: { opacity: 0 }, duration: DURATION.state, whenReduced: "fade", lifetime });
}

/// La cornice della cella aperta se ne va quando la cella si chiude: ne resta
/// un'immagine che sfuma in `DURATION.state` da dov'era (anche a metà della
/// sua entrata), mentre la cella aperta è già nascosta.
export function hideEditorFrame(frame: HTMLElement): void {
  if (!frame.isConnected) return;
  exitGhost(frame, { to: { opacity: 0 }, duration: DURATION.state, easing: "ease-in", whenReduced: "fade" });
}

/// Il valore che il foglio dà a una cella scritta compare (griglia T5): il
/// testo della cella, già al suo posto e nel suo stato finale, entra con una
/// dissolvenza in `DURATION.state`, che resta anche col movimento ridotto.
export function fadeInValue(text: HTMLElement, lifetime: Lifetime): void {
  animate(text, { from: { opacity: 0 }, duration: DURATION.state, whenReduced: "fade", lifetime });
}

/// L'etichetta della misura di un bordo tirato se ne va al rilascio: ne
/// resta un'immagine che sfuma in `DURATION.swap` da dov'era, mentre la
/// griglia ha già tolto l'etichetta vera.
export function fadeOutResizeLabel(label: HTMLElement): void {
  if (!label.isConnected) return;
  exitGhost(label, { to: { opacity: 0 }, duration: DURATION.swap, easing: "ease-out", whenReduced: "fade" });
}

/// I valori che il foglio dà a un riempimento entrano uno dopo l'altro
/// (griglia T6): il testo di ogni cella, già al suo posto e nel suo stato
/// finale, si dissolve dentro in `DURATION.state`, ognuno `STAGGER_MS` dopo
/// il precedente e al più `STAGGER_MAX` sfalsati. Col movimento ridotto
/// restano le dissolvenze, senza sfalsamento.
export function enterValues(texts: readonly HTMLElement[], lifetime: Lifetime): void {
  if (!texts.length) return;
  stagger(texts, (text) => animate(text, { from: { opacity: 0 }, duration: DURATION.state, whenReduced: "fade", lifetime }));
}

/// Una misura tirata cambia le colonne (o le righe) dopo il bordo (griglia
/// T5): `mutate` mette le misure nuove, e i pezzi `targets` scivolano dal
/// posto di prima a quello nuovo con la molla `SLIDE`. Un pezzo ancora in
/// volo (un no che torna, un altro bordo tirato) riparte da dove lo si vede,
/// con la sua velocità. Col movimento ridotto tutto salta.
export function slideLines(targets: readonly Element[], mutate: () => void, lifetime: Lifetime): void {
  flip(targets, mutate, { spring: SLIDE, scale: false, lifetime });
}
