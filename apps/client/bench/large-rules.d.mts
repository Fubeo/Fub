// **La forma delle regole dei passi ripetuti, dal lato dei tipi.**
//
// Come `motion-rules.d.mts`: `large-rules.mjs` gira in Node, il suo presidio
// (`large-rules.test.ts`) è un `.ts`, e da questo lato del confine la forma va
// dichiarata.

export declare const REPEATS: number;

export declare function median(values: readonly number[]): number;

export interface Judged {
  medianMs: number;
  samplesMs: number[];
  limitsMs: number[];
  pass: boolean;
}

export declare function judgeSamples(samples: readonly number[], limits: number | readonly number[]): Judged;
