// **La forma delle regole del moto, dal lato dei tipi.**
//
// Come `scene.d.mts`: `motion-rules.mjs` gira in Node, il suo presidio
// (`motion.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata. Che non menta lo verifica il test, che di ogni coreografia
// controlla a mano id, titolo, gesti e sorgenti.

/// Un gesto o un riconoscimento: riceve la pagina di Playwright, che da questo
/// lato del confine non ha un tipo.
export type Gesture = (page: unknown) => Promise<unknown>;
export type Check = (page: unknown) => Promise<boolean>;

export interface Choreography {
  /// L'id, che è anche il nome dei file del referto.
  id: string;
  /// Che cosa si muove, per chi legge il referto.
  title: string;
  /// I file che fanno partire queste corse, dalla radice del client.
  sources: readonly string[];
  /// L'id della scena di `SCENE` da cui si parte.
  scene: string;
  /// I gesti in più che servono prima di misurare.
  setup?: Gesture;
  /// Il gesto; `null` se la corsa parte al montaggio (`mount`).
  act: Gesture | null;
  /// Come si riconosce che il movimento è partito, dove un'attesa lo separa
  /// dal gesto.
  started?: Check;
  /// Come si riconosce lo stato d'arrivo.
  arrived: Check;
  /// Il gesto che disfa; `null` se non ce n'è uno.
  undo: Gesture | null;
  /// Come si riconosce che l'inversione è partita.
  reversing?: Check;
  /// Come si riconosce che si è tornati.
  returned?: Check;
  /// Perché non c'è un gesto che disfa.
  irreversible?: string;
  /// Lo stato d'arrivo dura finché il puntatore resta dov'è.
  holds?: boolean;
  /// Ciò che un valore a molla sposta scrivendo in linea.
  track?: readonly string[];
  /// Oggi non passa da `moto`.
  still?: boolean;
  /// Parte al montaggio, senza un gesto.
  mount?: boolean;
  /// Il gesto che disfa è un'uscita: vale la regola 5.
  exit?: boolean;
}

export interface Uncovered {
  source: string;
  reason: string;
}

export interface InlineEntry {
  path: string;
  property: string;
  value: string;
}

export interface Box {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
}

export interface Jump {
  key: string;
  px: number | null;
  opacity: number | null;
  nearest: string | null;
}

export declare const ALLOWED: readonly string[];
export declare const EXIT_LIMIT_MS: number;
export declare function longExits(
  runs: readonly { target: string; pseudo?: string; duration: number; delay: number }[],
  limit?: number,
): { target: string; length: number }[];
export declare const CONTINUITY: { readonly px: number; readonly opacity: number };
export declare const CHOREOGRAPHIES: readonly Choreography[];
export declare const UNCOVERED: readonly Uncovered[];
export declare function cssName(name: string): string;
export declare function family(name: string): "allowed" | "paint" | "layout";
export declare function foreignProperties(names: readonly string[]): string[];
export declare function foreignInKeyframes(keyframes: readonly object[]): string[];
export declare function residue(
  moving: readonly InlineEntry[],
  still: readonly InlineEntry[],
): (InlineEntry & { still: string | null })[];
export declare function jumps(
  before: readonly Box[],
  after: readonly Box[],
  tolerance?: { px: number; opacity: number },
): Jump[];
export declare function midpoint(lengths: readonly number[], fallback?: number): number;
