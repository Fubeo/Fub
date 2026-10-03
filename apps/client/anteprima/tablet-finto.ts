// Solo nel ramo d'anteprima: un tablet finto per la sessione live.
//
// Nel browser non c'è `fub-live`, e il tablet vero (FD-305) non esiste ancora.
// Questo fa la sua parte contro l'host finto: qualche secondo dopo «Avvia la
// sessione live», mentre il QR è a vista, si collega, manda la sua vista e
// disegna tre tratti come li manderebbe il tablet, l'inchiostro effimero a 240
// campioni al secondo e poi il commit. Così si vede tutto il lato del PC:
// l'indicatore, l'inchiostro che arriva prima del commit, «Segui il tablet» e
// l'annulla del PC sul tratto del tablet.

import type { LiveEvent, LiveStart, LiveView } from "../src/host/contract";
import { formatBrush, PF1_DEFAULTS } from "../src/editors/spatial/ink/brush";
import { quantizeInk } from "../src/editors/spatial/ink/sample";
import { strokeElem } from "../src/editors/spatial/tools/edit";

type Emit = (session: string, events: LiveEvent[]) => void;

/// Quanto aspetta il tablet prima di «inquadrare» il QR.
const JOIN_AFTER_MS = 5000;
/// La pausa fra un tratto e l'altro.
const PAUSE_MS = 1800;
const RATE_HZ = 240;
const BRUSH = { ...PF1_DEFAULTS, size: 8, sim: false };
const COLORS = ["#202020", "#0072B2", "#D55E00"];

/// Un tratto come funzione del tempo: `u` va da 0 a 1 sulla sua durata, nel
/// riquadro del disegno.
interface Gesture {
  readonly ms: number;
  at(u: number, box: Box): [x: number, y: number, p: number];
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const GESTURES: readonly Gesture[] = [
  // Un'onda d'erba sotto la casa.
  {
    ms: 900,
    at: (u, b) => [b.x + b.w * (0.08 + 0.84 * u), b.y + b.h * (0.9 - 0.025 * Math.sin(u * Math.PI * 9)), 0.35 + 0.4 * Math.sin(u * Math.PI)],
  },
  // Una nuvola: un anello che si sposta.
  {
    ms: 1100,
    at: (u, b) => {
      const a = u * Math.PI * 6;
      return [b.x + b.w * (0.12 + 0.18 * u + 0.05 * Math.cos(a)), b.y + b.h * (0.16 + 0.05 * Math.sin(a)), 0.3 + 0.35 * u];
    },
  },
  // Un raggio di sole che si allunga.
  {
    ms: 500,
    at: (u, b) => [b.x + b.w * (0.72 - 0.08 * u), b.y + b.h * (0.32 + 0.1 * u), 0.7 - 0.5 * u],
  },
];

/// Il primo livello senza `transform` della sorgente, e il riquadro del
/// `viewBox`: il tablet disegna lì, in coordinate che sono già del livello.
function target(text: string): { layer: string; box: Box } | null {
  let layer: string | null = null;
  for (const [tag] of text.matchAll(/<g\b[^>]*>/g)) {
    if (!/\bfub:layer="/.test(tag) || /\btransform="/.test(tag)) continue;
    layer = /\bid="([^"]+)"/.exec(tag)?.[1] ?? null;
    if (layer !== null) break;
  }
  if (layer === null) return null;
  const view = /\bviewBox="([^"]+)"/.exec(text)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const box = view?.length === 4 && view.every(Number.isFinite) && view[2]! > 0 && view[3]! > 0
    ? { x: view[0]!, y: view[1]!, w: view[2]!, h: view[3]! }
    : { x: 0, y: 0, w: 800, h: 600 };
  return { layer, box };
}

const randomId = (): string => `o${Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, "0")}`;
const now = (): number => performance.timeOrigin + performance.now();

/// Il tablet di una sessione; `stop` lo ferma quando la sessione finisce.
export function tabletFinto(emit: Emit, session: string, start: LiveStart): { stop(): void } {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const later = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) run();
    }, ms);
    timers.add(timer);
  };
  const stop = (): void => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const send = (...events: LiveEvent[]): void => {
    if (stopped) return;
    // La sessione chiusa dal PC, o una sequenza che l'host rifiuta: il tablet
    // tace, come quello vero quando la connessione cade.
    try {
      emit(session, events);
    } catch (error) {
      console.warn("tablet finto:", error);
      stop();
    }
  };

  const where = target(start.snapshot.text);
  later(JOIN_AFTER_MS, () => {
    send(
      {
        t: "writerConnected",
        writer: "1",
        device: { name: "Tablet finto dell'anteprima", kind: "tablet" },
        caps: { pressure: true, tilt: false, coalesced: true, predicted: false },
        resumed: false,
      },
      { t: "clock", offsetMs: 0, rttMs: 6 },
    );
    if (where === null) return;
    const { box } = where;
    const view = (zoom: number, cx: number, cy: number): LiveView => {
      const w = box.w / zoom;
      const h = box.h / zoom;
      return { x: cx - w / 2, y: cy - h / 2, scale: zoom, w, h };
    };
    send({ t: "view", ...view(1, box.x + box.w / 2, box.y + box.h / 2) });
    let c = 0;
    const draw = (index: number): void => {
      const gesture = GESTURES[index];
      if (gesture === undefined) {
        // Alla fine il tablet torna a guardare tutto il foglio, e resta
        // collegato in silenzio.
        send({ t: "view", ...view(1, box.x + box.w / 2, box.y + box.h / 2) });
        return;
      }
      const [x0, y0] = gesture.at(0, box);
      // Il tablet si avvicina a ciò che disegna: con «Segui il tablet» acceso
      // il PC lo segue.
      send({ t: "view", ...view(1.6, x0, y0) });
      const s = randomId();
      const color = COLORS[index % COLORS.length]!;
      send({ t: "inkBegin", s, layer: where.layer, tool: "pen", fill: color, fillOpacity: 1, brush: formatBrush(BRUSH) });
      const began = now();
      const total = Math.max(2, Math.round((gesture.ms * RATE_HZ) / 1000));
      const samples: [number, number, number, number][] = [];
      let sent = 0;
      const tick = (): void => {
        const due = Math.min(total, Math.floor(((now() - began) * RATE_HZ) / 1000) + 1);
        while (samples.length < due) {
          const i = samples.length;
          const [x, y, p] = gesture.at(i / (total - 1), box);
          samples.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.min(1, Math.max(0.05, p)), began + (i * 1000) / RATE_HZ]);
        }
        if (samples.length > sent) {
          send({ t: "inkPoints", s, pts: samples.slice(sent) });
          sent = samples.length;
        }
        if (samples.length < total) {
          later(16, tick);
          return;
        }
        send({ t: "inkEnd", s });
        const ink = quantizeInk(samples.map(([x, y, p, t]) => ({ x, y, p, t: t - samples[0]![3] })));
        const elem = strokeElem(s, color, BRUSH, ink, null);
        later(40, () => {
          c += 1;
          send({ t: "commit", writer: "1", c: String(c), ops: [{ op: "add", parent: where.layer, pos: { last: true }, elem }] });
          later(PAUSE_MS, () => draw(index + 1));
        });
      };
      tick();
    };
    later(1200, () => draw(0));
  });
  return { stop };
}
