import { defineConfig } from "vitest/config";

// La configurazione del banco dell'inchiostro (`npm run bench:ink`): prende
// soltanto i `.bench.ts` di `src/ink/`, che la suite non lancia.
export default defineConfig({
  test: {
    include: ["src/ink/**/*.bench.ts"],
    // I giri durano secondi: niente parallelismo, che falserebbe i tempi.
    fileParallelism: false,
  },
});
