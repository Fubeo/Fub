// Le molle del movimento: i cinque caratteri, il loro campionamento e le
// costanti che valgono dove una molla non serve.
//
// Una molla si integra a passo fisso (Eulero semi-implicito, 1/480 s) e si
// campiona al ritmo dello schermo (`samplePeriodMs`, da 60 a 240 Hz): il
// browser interpola in linea retta fra due fotogrammi chiave, e a 180 Hz una
// tabella a 60 Hz piegava la velocità ogni tre fotogrammi. La traiettoria è
// la stessa a ogni ritmo: i campioni la leggono, fra due passi in linea retta.
// La stessa tabella di campioni dà i fotogrammi chiave a `animate` e la posa a
// metà corsa a chi la interrompe; lo stesso passo muove i valori vivi di
// `springValue`. Niente `linear()` e niente forma chiusa: un solo integratore,
// uguale ovunque.
//
// Unità: le durate sono in millisecondi e le velocità in unità al
// millisecondo, come quelle che danno i gesti. Rigidezza e smorzamento restano
// al secondo, come nei numeri del disegno.

import { screenPeriodMs } from "../theme/frame-rate";

export type SpringName = "snap" | "soft" | "wide" | "elastic" | "jelly";

export interface Spring {
  stiffness: number;
  damping: number;
  /// Di serie 1.
  mass?: number;
}

/// Scatto, Morbido, Ampio, Elastico, Gelatina. Una pelle può sostituirli con i
/// token `--spring-<nome>-k` e `--spring-<nome>-c`: vedi `resolveSpring`.
export const SPRINGS: Record<SpringName, Spring> = {
  snap: { stiffness: 560, damping: 38 },
  soft: { stiffness: 300, damping: 30 },
  wide: { stiffness: 170, damping: 24 },
  elastic: { stiffness: 420, damping: 20 },
  jelly: { stiffness: 260, damping: 12 },
};

/// Le durate (ms) di ciò che non è una molla: dissolvenze di stato, cambio di
/// contenuto, entrate e uscite brevi, uscite di superfici grandi, scene.
export const DURATION = { state: 90, swap: 140, short: 220, large: 360, scene: 560 } as const;
/// La scala di un controllo premuto.
export const PRESS_SCALE = 0.97;
/// Lo sfalsamento fra le voci di un elenco (ms) e quante ne sfalsa al massimo.
export const STAGGER_MS = 12;
export const STAGGER_MAX = 8;
/// Non è una durata del disegno: è il tetto oltre il quale un'uscita non può
/// restare appesa (ms).
export const EXIT_SAFETY_MS = 600;
/// L'attesa prima di mostrare uno scheletro (ms).
export const SKELETON_DELAY_MS = 120;

/// Il periodo dei campioni di serie (ms): 60 Hz, finché lo schermo non è noto.
/// È anche il più lungo: uno schermo più lento non dirada i campioni.
export const SAMPLE_MS = 1000 / 60;
/// Il periodo più corto dei campioni (ms): 240 Hz. Oltre, i fotogrammi chiave
/// costano più di quanto l'occhio guadagna.
export const MIN_SAMPLE_MS = 1000 / 240;

/// Il periodo dei campioni di una molla (ms): quello dello schermo
/// (`screenPeriodMs`), fra `MIN_SAMPLE_MS` e `SAMPLE_MS`.
export function samplePeriodMs(): number {
  return Math.min(SAMPLE_MS, Math.max(MIN_SAMPLE_MS, screenPeriodMs()));
}
/// Una molla che non si assesta entro qui viene chiusa sul bersaglio (ms). È
/// per i parametri degeneri di una pelle: le cinque di serie stanno sotto 1,2 s.
export const SPRING_MAX_MS = 2000;

/// Il passo dell'integrazione (s): otto passi per campione a 60 Hz.
const STEP_S = 1 / 480;
/// Le soglie dell'assestamento: lo spostamento residuo è una frazione della
/// corsa, mai sotto un minimo assoluto; la velocità (al secondo) vi è legata.
const RELATIVE_PRECISION = 0.001;
const MIN_PRECISION = 0.0005;
const REST_SPEED = 20;

/// Posizione e velocità di una molla in corsa; `v` è in unità al secondo.
export interface SpringState {
  x: number;
  v: number;
}

/// Avanza lo stato di `seconds`, a passi non più lunghi di `STEP_S`.
export function advanceSpring(
  spring: Spring,
  state: SpringState,
  target: number,
  seconds: number,
): void {
  const mass = spring.mass !== undefined && spring.mass > 0 ? spring.mass : 1;
  let steps = Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
  const h = seconds / steps;
  while (steps-- > 0) {
    state.v += ((-spring.stiffness * (state.x - target) - spring.damping * state.v) / mass) * h;
    state.x += state.v * h;
  }
}

/// La soglia sotto cui una corsa lunga `distance` è ferma.
export function restPrecision(distance: number, floor = 0): number {
  return Math.max(MIN_PRECISION, Math.abs(distance) * RELATIVE_PRECISION, floor);
}

/// Ferma, oppure esplosa: parametri fuori dalla stabilità del passo danno
/// valori non finiti, e allora la corsa si chiude sul bersaglio.
export function springAtRest(state: SpringState, target: number, precision: number): boolean {
  return (
    !Number.isFinite(state.x) ||
    (Math.abs(state.x - target) < precision && Math.abs(state.v) < precision * REST_SPEED)
  );
}

export interface SpringTravel {
  from: number;
  to: number;
  /// Velocità iniziale, in unità al millisecondo.
  velocity?: number;
  /// Soglia assoluta di assestamento, se più larga di quella relativa.
  precision?: number;
}

export interface SpringSamples {
  /// Un valore ogni `period`: il primo è `from`, l'ultimo è esattamente `to`.
  values: number[];
  /// `(values.length - 1) * period`.
  duration: number;
  /// Il periodo dei campioni (ms).
  period: number;
}

/// Campiona una molla da `from` a `to` fino all'assestamento, un valore ogni
/// `period` ms (di serie `samplePeriodMs()`). Pura negli argomenti: gli
/// stessi danno gli stessi campioni. L'integrazione va sempre a `STEP_S`;
/// un campione che cade fra due passi sta sulla retta che li unisce, così
/// ogni ritmo legge la stessa traiettoria e l'assestamento si decide sui
/// campioni, come prima.
export function sampleSpring(
  spring: Spring,
  travel: SpringTravel,
  period: number = samplePeriodMs(),
): SpringSamples {
  const { from, to } = travel;
  const precision = restPrecision(to - from, travel.precision);
  const state: SpringState = { x: from, v: (travel.velocity ?? 0) * 1000 };
  const read: SpringState = { x: from, v: state.v };
  const values = [from];
  const last = Math.round(SPRING_MAX_MS / period);
  let steps = 0;
  let previousX = state.x;
  let previousV = state.v;
  for (let index = 1; index <= last; index++) {
    // In passi: il campione `index` cade dopo `due` passi interi, più una parte.
    const due = (index * period) / 1000 / STEP_S;
    while (steps < due - 1e-9) {
      previousX = state.x;
      previousV = state.v;
      advanceSpring(spring, state, to, STEP_S);
      steps++;
    }
    const part = 1 - Math.max(0, steps - due);
    read.x = previousX + (state.x - previousX) * part;
    read.v = previousV + (state.v - previousV) * part;
    if (index === last || springAtRest(read, to, precision)) {
      values.push(to);
      break;
    }
    values.push(read.x);
  }
  return { values, duration: (values.length - 1) * period, period };
}

/// La molla del livello «calmo»: stessa rigidezza, smorzamento almeno critico,
/// quindi nessun superamento. Una molla già sovrasmorzata resta com'è: calmare
/// non deve mai rendere più svelto.
export function critical(spring: Spring): Spring {
  const mass = spring.mass !== undefined && spring.mass > 0 ? spring.mass : 1;
  return { ...spring, damping: Math.max(spring.damping, 2 * Math.sqrt(spring.stiffness * mass)) };
}

/// Quanto dura l'assestamento di una corsa lunga 1, da ferma (ms). Sempre sui
/// campioni a 60 Hz: la molla calma non cambia con lo schermo.
function settleMs(spring: Spring): number {
  return sampleSpring(spring, { from: 0, to: 1 }, SAMPLE_MS).duration;
}

const calmed = new Map<string, Spring>();

/// La molla del livello «calmo» per ciò che entra ed esce: smorzamento
/// critico, e la rigidezza alzata quanto basta perché non duri più della
/// molla piena. `critical` tiene la rigidezza, e una molla critica con la
/// stessa k è più lenta di quella che oscilla: il calmo diventava un moto più
/// lungo, cioè più presente, proprio dove doveva esserlo meno. Insieme alla
/// corsa dimezzata di `animate`, la presenza nel calmo fa metà strada, senza
/// superamento e senza più tempo.
export function calmPresence(spring: Spring): Spring {
  const mass = spring.mass !== undefined && spring.mass > 0 ? spring.mass : 1;
  const key = `${spring.stiffness}/${spring.damping}/${mass}`;
  const known = calmed.get(key);
  if (known) return known;
  const budget = settleMs(spring);
  const at = (stiffness: number): Spring => ({ ...spring, stiffness, damping: 2 * Math.sqrt(stiffness * mass) });
  let low = spring.stiffness;
  let high = spring.stiffness;
  if (settleMs(at(low)) <= budget) {
    calmed.set(key, at(low));
    return at(low);
  }
  while (settleMs(at(high)) > budget && high < spring.stiffness * 64) high *= 2;
  // Venti dimezzamenti bastano a una k esatta al decimo; si arrotonda in su,
  // dalla parte che non allunga.
  for (let step = 0; step < 20; step++) {
    const middle = (low + high) / 2;
    if (settleMs(at(middle)) > budget) low = middle;
    else high = middle;
  }
  const result = at(Math.ceil(high));
  calmed.set(key, result);
  return result;
}

let tokens = new WeakMap<Element, Partial<Record<SpringName, Spring>>>();

/// Da chiamare quando cambia la pelle: i token si rileggono alla prossima corsa.
export function invalidateSpringTokens(): void {
  tokens = new WeakMap();
}

function positive(text: string): number | undefined {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/// I parametri di una molla per nome: i token numerici della pelle su `root`
/// (di serie `:root`), e per ciascuno che manca o non è un numero finito
/// positivo il valore di `SPRINGS`.
export function resolveSpring(name: SpringName, root?: Element): Spring {
  const base = SPRINGS[name];
  const element = root ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (!element || typeof getComputedStyle !== "function") return base;
  let known = tokens.get(element);
  if (!known) tokens.set(element, (known = {}));
  const cached = known[name];
  if (cached) return cached;
  const style = getComputedStyle(element);
  const stiffness = positive(style.getPropertyValue(`--spring-${name}-k`));
  const damping = positive(style.getPropertyValue(`--spring-${name}-c`));
  const spring =
    stiffness === undefined && damping === undefined
      ? base
      : { ...base, stiffness: stiffness ?? base.stiffness, damping: damping ?? base.damping };
  known[name] = spring;
  return spring;
}

/// La molla che una corsa usa davvero: per nome o per parametri, calmata se il
/// livello lo chiede. Una presenza (ciò che entra o esce) nel calmo prende
/// `calmPresence`; il resto, i FLIP e i valori vivi, `critical`.
export function springFor(spring: SpringName | Spring, calm: boolean, presence = false): Spring {
  const base = typeof spring === "string" ? resolveSpring(spring) : spring;
  if (!calm) return base;
  return presence ? calmPresence(base) : critical(base);
}
