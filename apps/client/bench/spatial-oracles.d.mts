// I tipi di `spatial-oracles.mjs`, per `spatial-fixture.test.ts`: i `.mjs` del
// banco restano fuori dal controllo dei tipi, e il test verifica i valori.

export interface SpatialOracle {
  readonly objects: number;
  readonly layers: number;
  readonly samples: number;
  readonly bytes: number;
  readonly digest: string;
}

export declare const SPATIAL_ORACLES: Readonly<Record<"sparse" | "dense" | "ink", SpatialOracle>>;

export declare const SPATIAL_BUDGETS: Readonly<{
  inkMs: number;
  commitMs: number;
  openMs: number;
  navigationFrameMs: number;
  navigationLongTasks: number;
  memoryRatio: number;
}>;
