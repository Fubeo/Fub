// Le frasi degli errori delle formule (`math/errors.ts`), in un chunk col suo
// nome: arrivano con un `import()` da `math.ts` dopo una formula sbagliata.
export { diagnose, explain, problemSentence } from "./math/errors";
