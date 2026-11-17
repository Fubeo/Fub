// Il registratore di un riquadro (`recorder-surface.ts`) con il deposito che
// lo salva da un crash (`recorder-store.ts`): il pezzo che il controllo dei
// documenti carica con un `import()` quando lo si apre, fuori dal chunk che
// apre una nota. Un modulo solo, e quindi un chunk solo.
export { createViewStateCrashDeposit } from "./recorder-store";
export { mountRecorderSurface } from "./recorder-surface";
