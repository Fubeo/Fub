import { describe, expect, it } from "vitest";
import { pointerSample, pointerTypeOf, type PointerSample } from "./input/pointer";
import { pressureCurve, validCurve } from "./input/pressure";
import { classifyPointer } from "./input/roles";
import { Session, type CancelReason, type Effect } from "./input/session";
import { Stabilizer, type StabilizerConfig } from "./input/stabilizer";
import { anglesFromTilt, penAngles, reportsTilt } from "./input/tilt";
import type { InkSample } from "./sample";
// La fixture è generata dal nucleo Rust — vedi `crates/fub-ink/tests/ts_mirror.rs`.
import cases from "./__fixtures__/ink-samples.json";

// L'altra metà del presidio del **nucleo dell'inchiostro** (la prima è
// `crates/fub-ink/tests/ts_mirror.rs`). Il percorso caldo del tratto gira qui,
// evento per evento, e il nucleo è scritto due volte: la fixture porta la
// risposta di Rust caso per caso e la copia TypeScript deve dare la stessa.
//
// Il legame è nei due versi:
//
// - una regola cambiata in Rust rende stantia la fixture (rosso di là);
//   rigenerarla (`UPDATE_MIRROR=1 cargo test -p fub-ink --test ts_mirror`)
//   sposta il rosso qui, dove la gemella non è ancora d'accordo;
// - una chiave della fixture senza handler qui, o un handler senza chiave, è
//   rosso: una regola non può entrare da un lato e restare non rispecchiata.
//
// I numeri si confrontano a 1e-9: `powf` di Rust e `**` di V8 possono differire
// dell'ultimo bit, e nient'altro deve differire.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = Record<string, Json>;

const fixture = cases as unknown as Record<string, Case[]>;

const EPSILON = 1e-9;

/// Un numero come lo scrive la fixture: JSON non scrive `NaN` né l'infinito, e
/// la fixture li scrive come testo.
function num(value: Json | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  throw new TypeError(`non è un numero: ${JSON.stringify(value)}`);
}

/// Il campo `key` di `c` come numero, o `undefined` se manca.
function optNum(c: Case, key: string): number | undefined {
  const value = c[key];
  return value === undefined || value === null ? undefined : num(value);
}

/// Il confronto della fixture: stessa forma, stesse chiavi, numeri entro
/// `EPSILON`. Una chiave `undefined` in `actual` conta come presente: un campione
/// con `p: undefined` non è un campione senza `p`.
function differences(actual: unknown, expected: Json, path = "$"): string[] {
  if (typeof expected === "number") {
    if (typeof actual !== "number") return [`${path}: atteso ${expected}, trovato ${JSON.stringify(actual)}`];
    return Math.abs(actual - expected) <= EPSILON ? [] : [`${path}: atteso ${expected}, trovato ${actual}`];
  }
  if (expected === null || typeof expected === "boolean" || typeof expected === "string") {
    // Un numero non finito la fixture lo scrive come testo.
    if (typeof expected === "string" && typeof actual === "number" && !Number.isFinite(actual)) {
      return String(actual) === expected ? [] : [`${path}: atteso ${expected}, trovato ${actual}`];
    }
    return actual === expected ? [] : [`${path}: atteso ${JSON.stringify(expected)}, trovato ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: atteso un elenco, trovato ${JSON.stringify(actual)}`];
    if (actual.length !== expected.length) return [`${path}: ${expected.length} elementi attesi, ${actual.length} trovati`];
    return expected.flatMap((item, i) => differences(actual[i], item, `${path}[${i}]`));
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    return [`${path}: atteso un oggetto, trovato ${JSON.stringify(actual)}`];
  }
  const found = Object.keys(actual).sort();
  const wanted = Object.keys(expected).sort();
  if (found.join() !== wanted.join()) return [`${path}: chiavi attese ${wanted.join()}, trovate ${found.join()}`];
  return wanted.flatMap((key) => differences((actual as Record<string, unknown>)[key], expected[key]!, `${path}.${key}`));
}

function expectSame(actual: unknown, expected: Json): void {
  expect(differences(actual, expected)).toEqual([]);
}

/// Un evento come lo scrive la fixture: un campo al valore di un dispositivo
/// senza sensori non c'è, e qui si rimette.
function pointerOf(event: Json): PointerSample {
  const c = event as Case;
  const tilt: Partial<PointerSample> = {
    ...(optNum(c, "tiltX") === undefined ? {} : { tiltX: optNum(c, "tiltX")! }),
    ...(optNum(c, "tiltY") === undefined ? {} : { tiltY: optNum(c, "tiltY")! }),
    ...(optNum(c, "altitudeAngle") === undefined ? {} : { altitudeAngle: optNum(c, "altitudeAngle")! }),
    ...(optNum(c, "azimuthAngle") === undefined ? {} : { azimuthAngle: optNum(c, "azimuthAngle")! }),
  };
  return pointerSample({
    pointerId: num(c.pointerId),
    pointerType: pointerTypeOf(String(c.pointerType)),
    x: num(c.x),
    y: num(c.y),
    timeStamp: num(c.timeStamp),
    ...(c.pressure === undefined ? {} : { pressure: num(c.pressure) }),
    ...tilt,
    ...(c.twist === undefined ? {} : { twist: num(c.twist) }),
    ...(c.buttons === undefined ? {} : { buttons: num(c.buttons) }),
    ...(c.button === undefined ? {} : { button: num(c.button) }),
    ...(c.turn === undefined ? {} : { turn: num(c.turn) }),
    ...(c.scale === undefined ? {} : { scale: num(c.scale) }),
  });
}

function stabilizerOf(config: Json): StabilizerConfig {
  const c = config as Case;
  return {
    amount: num(c.amount),
    pulledString: c.pulledString === true,
    catchUp: c.catchUp === true,
    catchUpOnEnd: c.catchUpOnEnd === true,
  };
}

function sampleOf(json: Json): InkSample {
  const c = json as Case;
  const p = optNum(c, "p");
  const a = optNum(c, "a");
  const base = { x: num(c.x), y: num(c.y), t: num(c.t) };
  const withP = p === undefined ? base : { ...base, p };
  return a === undefined ? withP : { ...withP, a, z: num(c.z) };
}

/// Lo scenario di `c` su una sessione nuova: gli effetti e lo stato dopo ogni
/// evento, nella forma della fixture.
function replay(c: Case): { effects: Effect[]; roles: Record<string, string | null>; drawing: boolean; penSeen: boolean }[] {
  const config = c.config as Case;
  const curve = config.curve === null ? null : (config.curve as Case);
  const session = new Session({
    touch: config.touch as "auto" | "ink" | "navigate",
    maxSamples: num(config.maxSamples),
    curve: curve === null ? null : pressureCurve({ soft: num(curve.soft), min: num(curve.min), full: num(curve.full) }),
    stabilizer: stabilizerOf(config.stabilizer!),
  });
  const wanted = c.out as Case[];
  return (c.steps as Case[]).map((step, i) => {
    let effects: Effect[] = [];
    switch (step.op) {
      case "down":
        effects = session.pointerDown(pointerOf(step.event!));
        break;
      case "move":
        effects = session.pointerMove(
          (step.coalesced as Json[]).map(pointerOf),
          pointerOf(step.event!),
          (step.predicted as Json[]).map(pointerOf),
        );
        break;
      case "up":
        effects = session.pointerUp(pointerOf(step.event!));
        break;
      case "pointercancel":
        effects = session.pointerCancel(num(step.pointer));
        break;
      case "lostcapture":
        effects = session.lostCapture(num(step.pointer));
        break;
      case "leave":
        session.pointerLeave(num(step.pointer), pointerTypeOf(String(step.pointerType)));
        break;
      case "interrupt":
        effects = session.interrupt(step.reason as CancelReason);
        break;
      case "cancel":
        effects = session.cancel();
        break;
      case "destroy":
        effects = session.destroy();
        break;
      case "touch":
        session.setTouchPolicy(step.policy as "auto" | "ink" | "navigate");
        break;
      default:
        throw new Error(`evento sconosciuto: ${String(step.op)}`);
    }
    // I ruoli che la fixture guarda, per ogni puntatore che nomina.
    const roles: Record<string, string | null> = {};
    for (const id of Object.keys(wanted[i]!.roles as Case)) roles[id] = session.roleOf(Number(id));
    return { effects, roles, drawing: session.drawing, penSeen: session.penSeen };
  });
}

/// Per ogni regola: come si passano gli input della fixture alla gemella TS e
/// che cosa se ne confronta con `out`.
///
/// Le chiavi di questa mappa e quelle della fixture devono coincidere
/// **esattamente** — è il test qui sotto, ed è ciò che impedisce a una regola
/// nuova di restare presidiata da un lato solo.
const HANDLERS: Record<string, (c: Case) => unknown> = {
  // Il ciclo di vita completo, evento per evento.
  scenario: replay,
  // Chi disegna e chi è il palmo.
  role: (c) =>
    classifyPointer(
      { pointerType: String(c.pointerType), button: num(c.button) },
      {
        touch: c.touch as "auto" | "ink" | "navigate",
        penSeen: c.penSeen === true,
        penNear: c.penNear === true,
        touchesDown: num(c.touchesDown),
      },
    ),
  // La curva della pressione.
  pen_curve: (c) => pressureCurve({ soft: num(c.soft), min: num(c.min), full: num(c.full) })(num(c.pressure)),
  pen_curve_valid: (c) => validCurve({ soft: num(c.soft), min: num(c.min), full: num(c.full) }) !== null,
  // L'inclinazione della penna.
  tilt_angles: (c) => anglesFromTilt(num(c.tiltX), num(c.tiltY)),
  pen_angles: (c) => penAngles(tiltSource(c)),
  reports_tilt: (c) => reportsTilt(tiltSource(c)),
  // Lo stabilizzatore del tratto, da solo.
  stabilizer: (c) => {
    const stabilizer = new Stabilizer(stabilizerOf(c.config!), num(c.zoom));
    const out: InkSample[] = [];
    for (const point of c.points as Json[]) stabilizer.push(sampleOf(point), out);
    stabilizer.finish(out);
    return out;
  },
};

/// L'inclinazione di un caso: `null` è un campo che il dispositivo non dà.
function tiltSource(c: Case): { tiltX?: number; tiltY?: number; altitudeAngle?: number; azimuthAngle?: number } {
  const tiltX = optNum(c, "tiltX");
  const tiltY = optNum(c, "tiltY");
  const altitudeAngle = optNum(c, "altitude");
  const azimuthAngle = optNum(c, "azimuth");
  return {
    ...(tiltX === undefined ? {} : { tiltX }),
    ...(tiltY === undefined ? {} : { tiltY }),
    ...(altitudeAngle === undefined ? {} : { altitudeAngle }),
    ...(azimuthAngle === undefined ? {} : { azimuthAngle }),
  };
}

describe("il nucleo dell'inchiostro è lo stesso in Rust e in TypeScript", () => {
  it("ogni regola della fixture ha il suo handler, e viceversa", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(Object.keys(fixture).sort());
  });

  it("la fixture non è vuota: ogni regola ha dei casi", () => {
    for (const [rule, list] of Object.entries(fixture)) {
      expect(list.length, rule).toBeGreaterThan(0);
    }
  });

  for (const [rule, handler] of Object.entries(HANDLERS)) {
    describe(rule, () => {
      const list = fixture[rule] ?? [];
      list.forEach((c, index) => {
        const label = typeof c.name === "string" ? c.name : `caso ${index}`;
        it(label, () => {
          const actual = handler(c);
          expectSame(actual, c.out!);
        });
      });
    });
  }
});
