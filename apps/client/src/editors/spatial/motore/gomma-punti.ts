// La Gomma dei punti (K6 T12, giro 2): il trascinamento raccoglie il tratto
// nella scena e, al rilascio, manda UN solo `addon.pathtools.erase` al motore,
// con i punti e la selezione. Il motore non sente ogni movimento: il segno del
// tratto mentre si trascina è solo disegno locale, che Esc o uno strumento
// diverso tolgono senza chiamare niente.
//
// - **Un tratto, una chiamata.** `lancia` prende i punti del rilascio. Con meno
//   di due punti distinti (un clic senza movimento) non chiama niente: il clic
//   non cancella nulla, e non dice nulla.
// - **Una alla volta.** Le chiamate partono in fila: la seconda parte quando la
//   prima è applicata, così il suo esito non vede una copia vecchia e la
//   selezione è quella di dopo.
// - **Il diametro di serie.** Il valore non porta `diameter`: il motore usa il
//   suo, come nel suo menu.
// - **Chiuso, non risponde più.** Dopo `chiudi` una chiamata in volo non applica
//   il suo esito: chi l'ha lanciata non c'è più.

import type { DrawingOutcome } from "../../../host/contract";
import type { Point } from "../scene/matrix";
import type { Elem } from "../scene/serialize";
import type { ArgomentiRifiutati, RispostaMotore, SessioneMotore } from "./sessione";

/// Il nome dello strumento nella colonna (`completo/colonna.ts`, `motore:…`).
export const STRUMENTO_GOMMA_PUNTI = "anchorEraserBrush";
/// Il comando del motore (la riga `addon.pathtools.erase` della mappa).
export const COMANDO_GOMMA_PUNTI = "addon.pathtools.erase";

/// Sotto questa distanza (pt) un punto è lo stesso del precedente.
const DISTANZA_MINIMA = 0.001;
/// Tre decimali bastano per la scena, e tengono il comando corto.
const DECIMALI = 1000;

/// Le frasi che la gomma dice a chi disegna, con la sua chiave di strings.
export type FraseGomma = "draw.gomma_punti.scegli" | "draw.gomma_punti.vuota" | "draw.gomma_punti.assente";

/// Il tratto pulito: senza punti non finiti, senza ripetuti; `null` se restano
/// meno di due punti distinti (un clic senza movimento).
export function tratto(punti: readonly Point[]): Point[] | null {
  const pulito: Point[] = [];
  for (const p of punti) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const ultimo = pulito[pulito.length - 1];
    if (ultimo !== undefined && Math.hypot(p[0] - ultimo[0], p[1] - ultimo[1]) < DISTANZA_MINIMA) continue;
    pulito.push([p[0], p[1]]);
  }
  return pulito.length >= 2 ? pulito : null;
}

/// Il `value` del comando: i punti in coordinate di scena, arrotondati.
export function valoreGomma(punti: readonly Point[]): { points: [number, number][] } {
  return { points: punti.map((p): [number, number] => [Math.round(p[0] * DECIMALI) / DECIMALI, Math.round(p[1] * DECIMALI) / DECIMALI]) };
}

/// Il segno del tratto mentre si trascina: una linea tratteggiata, nella scena.
export function segnoDelTratto(punti: readonly Point[]): Elem {
  const d = punti.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  return { tag: "path", attrs: { d, fill: "none", stroke: "#888888", "stroke-width": "1", "stroke-dasharray": "4 3" } };
}

/// Ciò che la coda chiede a chi la usa.
export interface GommaPuntiDipendenze {
  /// La sessione del motore, pronta; `null` se il motore non c'è o non risponde.
  readonly sessione: () => Promise<SessioneMotore | null>;
  /// La selezione adesso, come id del motore.
  readonly selezione: () => readonly string[];
  /// Applica l'esito del comando (operazioni, selezione, rifiuto).
  readonly esito: (esito: DrawingOutcome) => void;
  /// Dice una frase a chi disegna.
  readonly dici: (frase: FraseGomma) => void;
  /// Dice la frase del motore che ha rifiutato gli argomenti del comando:
  /// non è cambiato niente, e il motore resta pronto per il colpo dopo.
  readonly rifiutati: (rifiutati: ArgomentiRifiutati) => void;
}

/// La coda dei tratti della gomma: un comando alla volta, uno per tratto.
export class CodaGommaPunti {
  private coda: Promise<void> = Promise.resolve();
  private aperta = true;

  constructor(private readonly dip: GommaPuntiDipendenze) {}

  /// Accoda il tratto `punti` del trascinamento appena rilasciato.
  lancia(punti: readonly Point[]): void {
    const pulito = tratto(punti);
    if (pulito === null || !this.aperta) return;
    this.coda = this.coda.then(() => this.esegui(pulito)).catch(() => this.dici("draw.gomma_punti.assente"));
  }

  /// Chiude la coda: le chiamate in volo non applicano più il loro esito.
  chiudi(): void {
    this.aperta = false;
  }

  private dici(frase: FraseGomma): void {
    if (this.aperta) this.dip.dici(frase);
  }

  private async esegui(punti: Point[]): Promise<void> {
    if (!this.aperta) return;
    const selezione = [...this.dip.selezione()];
    if (selezione.length === 0) {
      this.dici("draw.gomma_punti.scegli");
      return;
    }
    const sessione = await this.dip.sessione();
    if (sessione === null || !this.aperta) {
      this.dici("draw.gomma_punti.assente");
      return;
    }
    const risposta: RispostaMotore = await sessione.comando({
      id: COMANDO_GOMMA_PUNTI,
      selection: selezione,
      value: valoreGomma(punti),
      preview: false,
    });
    if (!this.aperta) return;
    if (risposta !== null && "kind" in risposta && risposta.kind === "argomenti") {
      this.dip.rifiutati(risposta);
      return;
    }
    if (risposta === null || "kind" in risposta) {
      this.dici("draw.gomma_punti.assente");
      return;
    }
    this.dip.esito(risposta);
  }
}
