// Il worker del ricalco: tiene l'immagine che riceve, e risponde alle
// richieste della pagina una alla volta, col loro numero (vedi
// `trace-runner.ts`). Una richiesta che non riesce, o che arriva prima
// dell'immagine, torna fallita.

import { presetSettings, trace, type Raster } from "./trace";
import type { TraceAnswer, TraceMessage } from "./trace-runner";

interface WorkerScope {
  onmessage: ((event: MessageEvent<TraceMessage>) => void) | null;
  postMessage(answer: TraceAnswer): void;
}

const scope = self as unknown as WorkerScope;
let raster: Raster | null = null;

scope.onmessage = ({ data }) => {
  if (data.kind === "image") {
    raster = data.raster;
    return;
  }
  if (raster === null) {
    scope.postMessage({ id: data.id, failed: true });
    return;
  }
  try {
    if (data.kind === "settings") scope.postMessage({ id: data.id, settings: presetSettings(data.preset, raster) });
    else scope.postMessage({ id: data.id, traced: trace(raster, data.settings) });
  } catch {
    scope.postMessage({ id: data.id, failed: true });
  }
};
