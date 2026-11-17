// Il riquadro che modifica una formula (`math/editor.ts`) con la sua
// tavolozza (`math/palette.ts`): il pezzo che `math-live.ts` carica con un
// `import()`, perché serve soltanto quando si tocca una formula e non
// all'apertura di una nota. Un modulo solo, e quindi un chunk solo.
export { MathEditor } from "./math/editor";
export { attachPalette } from "./math/palette";
