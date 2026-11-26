// I cicli statici fra chunk. Un chunk che importa staticamente un altro chunk
// che, per qualche strada, importa lui viene eseguito prima di finire di
// caricare quello che gli serve: un valore letto al caricamento (un
// `new Set(...)` al primo livello) è ancora non inizializzato e il modulo si
// rompe, e con lui l'avvio. È successo fra le Impostazioni e `search`:
// la build era verde e l'app diceva «Fub non è partito».
//
// La build si ferma a ogni ciclo che non sta in `KNOWN_CYCLES`: si scioglie
// mettendo il modulo condiviso in un chunk chiuso verso il basso (regola in
// `manualChunks` di `vite.config.ts`).

/// I cicli che c'erano già quando il controllo è nato, provati innocui
/// all'avvio dell'app vera: nessuno dei due chunk legge l'altro al
/// caricamento. Nomi dei chunk, in ordine alfabetico.
export const KNOWN_CYCLES = [
  ["drawing-scene", "outline"],
  ["formula", "grid-editor"],
  ["markdown-render", "ui-views"],
];

/**
 * I gruppi di chunk legati da un ciclo di import statici (componenti
 * fortemente connesse con più di un chunk), ognuno coi nomi in ordine.
 * @param {Map<string, string[]>} imports file del chunk → file che importa
 * @param {(file: string) => string} nameOf il nome di un chunk dal suo file
 * @returns {string[][]}
 */
export function chunkCycles(imports, nameOf = (file) => file) {
  let next = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const visit = (file) => {
    index.set(file, next);
    low.set(file, next++);
    stack.push(file);
    onStack.add(file);
    for (const dependency of imports.get(file) ?? []) {
      if (!imports.has(dependency)) continue;
      if (!index.has(dependency)) {
        visit(dependency);
        low.set(file, Math.min(low.get(file), low.get(dependency)));
      } else if (onStack.has(dependency)) {
        low.set(file, Math.min(low.get(file), index.get(dependency)));
      }
    }
    if (low.get(file) !== index.get(file)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(nameOf(member));
    } while (member !== file);
    if (group.length > 1) cycles.push(group.sort());
  };
  for (const file of imports.keys()) if (!index.has(file)) visit(file);
  return cycles;
}

/** I cicli che non stanno fra quelli noti. */
export function newChunkCycles(cycles, known = KNOWN_CYCLES) {
  const allowed = new Set(known.map((group) => [...group].sort().join(" ↔ ")));
  return cycles.filter((group) => !allowed.has(group.join(" ↔ ")));
}
