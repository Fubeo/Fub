// Il Pennello tondo (K6 T12, giro 2): il trascinamento raccoglie il tratto nella scena e, al rilascio,
// manda UN solo `path.blob` al motore, con i punti e il colore corrente. Come la Gomma dei punti: niente
// motore a ogni movimento, e il segno mentre si trascina è solo disegno locale.
//
// - **Un colpo, un comando.** `lancia` prende i punti del rilascio. Un clic (un punto solo) è un tondo: il
//   motore lo dipinge come un colpo di pennello fermo. Senza punti non chiama niente.
// - **Il colore è quello di adesso**, preso all'inizio del colpo; il motore lo mette nel suo tratto.
// - **Il diametro** non si manda: vale quello di serie del motore (10 pt), perché Fub non ha ancora un
//   pannello del pennello.
// - **Una alla volta.** Come la gomma: la seconda chiamata parte quando la prima è applicata; dopo `chiudi`
//   non parte né si applica più niente.
// - **Non tiene il motore pronto da sé.** La scelta del tracciato non serve: il colpo non ha una selezione.

import type { DrawingOutcome } from "../../../host/contract";
import type { Point } from "../scene/matrix";
import type { Elem } from "../scene/serialize";
import type { MotoreAssente, SessioneMotore } from "./sessione";

/// Lo strumento del motore del pennello tondo (la sua riga della mappa è `blobBrush`).
export const STRUMENTO_PENNELLO = "blobBrush";
/// Il comando del motore (la riga `path.blob` della mappa).
export const COMANDO_PENNELLO = "path.blob";

const DISTANZA_MINIMA = 0.001;
const DECIMALI = 1000;

/// Le frasi del pennello con la loro chiave di strings.
export type FrasePennello = "draw.pennello.assente";

/// Il tratto pulito: senza punti non finiti e senza ripetuti; `null` senza nessun punto (un colpo
/// fermo resta un punto solo: è un tondo).
export function colpo(punti: readonly Point[]): Point[] | null {
  const pulito: Point[] = [];
  for (const p of punti) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const ultimo = pulito[pulito.length - 1];
    if (ultimo !== undefined && Math.hypot(p[0] - ultimo[0], p[1] - ultimo[1]) < DISTANZA_MINIMA) continue;
    pulito.push([p[0], p[1]]);
  }
  return pulito.length > 0 ? pulito : null;
}

/// Il `value` del comando: i punti in coordinate di scena, arrotondati, e il colore.
export function valorePennello(punti: readonly Point[], colore: string): { points: [number, number][]; color: string } {
  return {
    points: punti.map((p): [number, number] => [Math.round(p[0] * DECIMALI) / DECIMALI, Math.round(p[1] * DECIMALI) / DECIMALI]),
    color: colore,
  };
}

/// Il segno del colpo mentre si trascina: una linea tratteggiata col colore del colpo, nella scena.
export function segnoDelColpo(punti: readonly Point[], colore: string): Elem {
  const d = punti.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  return { tag: "path", attrs: { d, fill: "none", stroke: colore, "stroke-width": "1", "stroke-dasharray": "4 3" } };
}

/// Ciò che la coda chiede a chi la usa.
export interface PennelloDipendenze {
  /// La sessione del motore, pronta; `null` se il motore non c'è o non risponde.
  readonly sessione: () => Promise<SessioneMotore | null>;
  /// Applica l'esito del comando (operazioni, selezione, rifiuto).
  readonly esito: (esito: DrawingOutcome) => void;
  /// Dice una frase a chi disegna.
  readonly dici: (frase: FrasePennello) => void;
}

/// La coda dei colpi del pennello: un comando alla volta, uno per colpo.
export class CodaPennello {
  private coda: Promise<void> = Promise.resolve();
  private aperta = true;

  constructor(private readonly dip: PennelloDipendenze) {}

  /// Accoda il colpo `punti` col colore `colore`, appena rilasciato.
  lancia(punti: readonly Point[], colore: string): void {
    const pulito = colpo(punti);
    if (pulito === null || !this.aperta) return;
    this.coda = this.coda.then(() => this.esegui(pulito, colore)).catch(() => this.dici("draw.pennello.assente"));
  }

  /// Chiude la coda: le chiamate in volo non applicano più il loro esito.
  chiudi(): void {
    this.aperta = false;
  }

  private dici(frase: FrasePennello): void {
    if (this.aperta) this.dip.dici(frase);
  }

  private async esegui(punti: Point[], colore: string): Promise<void> {
    if (!this.aperta) return;
    const sessione = await this.dip.sessione();
    if (sessione === null || !this.aperta) {
      this.dici("draw.pennello.assente");
      return;
    }
    const risposta: DrawingOutcome | MotoreAssente | null = await sessione.comando({
      id: COMANDO_PENNELLO,
      selection: [],
      value: valorePennello(punti, colore),
      preview: false,
    });
    if (!this.aperta) return;
    if (risposta === null || "kind" in risposta) {
      this.dici("draw.pennello.assente");
      return;
    }
    this.dip.esito(risposta);
  }
}
