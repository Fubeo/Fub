// Il modulo virtuale del plugin `build/canvas-wasm.mjs`: il nucleo della
// lavagna compilato dai sorgenti di adesso. In sviluppo e nella build i byte
// vengono dall'URL dell'asset, sotto Vitest dal file che cargo ha appena fatto.
declare module "virtual:fub-canvas-wasm" {
  /** I primi 16 caratteri esadecimali dello SHA-256 del modulo. */
  export const canvasWasmHash: string;
  /** I byte del modulo `.wasm`. */
  export function loadCanvasWasm(): Promise<BufferSource>;
}
