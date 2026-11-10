// La storia dei salti della vista di una lavagna (T56, B4 di `lavagna.md`):
// Indietro e Avanti ricordano i salti (Maiusc+1, Maiusc+2, 0, un clic nel
// navigatore, e poi un link o un risultato di ricerca), non ogni piccolo
// spostamento a mano. Sta solo in memoria, per la lavagna aperta: non va nel
// file e non nello stato di vista (T36).
//
// È una storia come quella del browser: un salto dopo un Indietro perde
// l'Avanti di prima, e la pila tiene al più `CANVAS_JUMP_LIMIT` salti, i più
// vecchi cadono. Qui non c'è né la tela né il DOM: solo la pila.

/** La camera della tela: dove sta la lavagna (`x`, `y`) e quanto è grande (`zoom`). */
export interface JumpCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Un salto: la camera prima e la camera dopo. */
interface CanvasJump {
  readonly from: JumpCamera;
  readonly to: JumpCamera;
}

/** I salti che si ricordano per lavagna (T56). */
export const CANVAS_JUMP_LIMIT = 50;

function copyOf(camera: JumpCamera): JumpCamera {
  return { x: camera.x, y: camera.y, zoom: camera.zoom };
}

export class CanvasJumps {
  readonly #jumps: CanvasJump[] = [];
  /** Quanti salti sono «fatti»: `#jumps[#at]` è il primo che Avanti rifà. */
  #at = 0;

  /**
   * Un salto appena fatto da `from` a `to`. Una camera copiata, così che chi
   * la muove dopo non cambi la storia. L'Avanti di prima si perde.
   */
  record(from: JumpCamera, to: JumpCamera): void {
    this.#jumps.length = this.#at;
    this.#jumps.push({ from: copyOf(from), to: copyOf(to) });
    if (this.#jumps.length > CANVAS_JUMP_LIMIT) this.#jumps.shift();
    this.#at = this.#jumps.length;
  }

  /** Indietro di un salto: la camera di prima, o `null` se non c'è niente a cui tornare. */
  back(): JumpCamera | null {
    if (this.#at === 0) return null;
    this.#at -= 1;
    return copyOf(this.#jumps[this.#at]!.from);
  }

  /** Avanti di un salto: la camera dopo, o `null` se è già l'ultimo. */
  forward(): JumpCamera | null {
    if (this.#at >= this.#jumps.length) return null;
    const jump = this.#jumps[this.#at]!;
    this.#at += 1;
    return copyOf(jump.to);
  }
}
