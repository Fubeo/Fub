// **La forma degli esiti del fotografo, dal lato dei tipi.**
//
// Come `motion-rules.d.mts`: `photos-outcomes.mjs` gira in Node, il suo
// presidio (`photos-outcomes.test.ts`) è un `.ts`, e da questo lato del
// confine la forma va dichiarata.

export declare const OUTCOMES: Readonly<{
  equal: "uguale";
  changed: "cambiata";
  withoutBaseline: "senza baseline";
  written: "scritta";
  unstable: "instabile";
  recovered: "instabile ma ripresa";
}>;

export type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES];

export interface PhotoRow {
  scene: { id: string };
  light: string;
  name: string;
  outcome: Outcome;
  reason?: string;
  different?: number;
  totale?: number;
  first?: { outcome: Outcome; reason: string | null; different: number };
}

export interface UnstableEntry {
  scena: string;
  luce: string;
  foto: string;
  primo: { esito: Outcome; motivo: string | null; pixel: number };
}

export declare function needsSecondShot(row: PhotoRow, options: { update: boolean }): boolean;
export declare function combineShots(first: PhotoRow, second: PhotoRow): PhotoRow;
export declare function failures(report: readonly PhotoRow[]): number;
export declare function unstableRecord(report: readonly PhotoRow[]): UnstableEntry[];
export declare function verifySummary(
  report: readonly PhotoRow[],
  options: { updateHint: string },
): { lines: string[]; exitCode: 0 | 1 };
export declare function stepSummary(report: readonly PhotoRow[]): string;
