// I chunk del Disegno completo e i loro confini (piano K6, T5;
// `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// `src/editors/spatial/completo/` è fatto di pezzi che arrivano solo quando
// servono: l'ingresso (`drawing-completo`), l'indice dei comandi
// (`drawing-indice`) e un chunk per famiglia (`drawing-fam-<id>`). I nomi
// cominciano con `drawing-`, così `NOT_AT_STARTUP` di `vite.config.ts` li
// tiene fuori dall'avvio e `switchable-chunks.json` li elenca.
//
// Qui la regola di `manualChunks` e due confini che la build controlla:
// - fuori da `completo/` si arriva al Completo solo con un `import()` di
//   `completo/index.ts`: un import statico, o di un altro file, ne porterebbe
//   un pezzo dove non deve stare;
// - una famiglia importa solo i suoi file (e, per i soli tipi, il resto del
//   Completo): mai quelli di un'altra famiglia, e nessuno importa una
//   famiglia staticamente, fuori da lei.
// E, dopo i chunk, che ogni modulo del Completo sia nel chunk della sua regola.

/** Il percorso di un modulo dentro `completo/`, senza la query; `null` fuori. */
export function completoPath(id) {
  const match = /\/src\/editors\/spatial\/completo\/([^?]*)/.exec(id.replaceAll("\\", "/"));
  return match ? match[1] : null;
}

/** La famiglia di un modulo di `completo/famiglie/<id>/`; `null` per gli altri. */
export function familyOf(id) {
  const rel = completoPath(id);
  const match = rel === null ? null : /^famiglie\/([a-z0-9-]+)\//.exec(rel);
  return match ? match[1] : null;
}

/** Il chunk di un modulo del Completo; `undefined` per i moduli fuori. */
export function completoChunk(id) {
  const rel = completoPath(id);
  if (rel === null) return undefined;
  if (/^indice(\.ts|\.generated\.json)$/.test(rel)) return "drawing-indice";
  const family = familyOf(id);
  if (family) return `drawing-fam-${family}`;
  return "drawing-completo";
}

/** Vero per l'ingresso del Completo, l'unico che si importa da fuori. */
const isEntry = (id) => completoPath(id) === "index.ts";

/**
 * Gli import che rompono i confini del Completo, uno per riga. `modules`
 * sono i moduli del grafo, con gli import statici e quelli con `import()`
 * (la forma di `getModuleInfo` di Rollup).
 *
 * @param {Iterable<{ id: string, importedIds: readonly string[], dynamicallyImportedIds: readonly string[] }>} modules
 * @returns {string[]}
 */
export function completoImportProblems(modules) {
  const problems = [];
  for (const module of modules) {
    const inside = completoPath(module.id) !== null;
    const family = familyOf(module.id);
    const imports = [
      ...module.importedIds.map((target) => [target, false]),
      ...module.dynamicallyImportedIds.map((target) => [target, true]),
    ];
    for (const [target, dynamic] of imports) {
      if (completoPath(target) === null) continue;
      if (!inside) {
        if (!dynamic || !isEntry(target)) {
          problems.push(`${module.id} importa ${dynamic ? "con import()" : "staticamente"} ${target}: fuori da completo/ si arriva al Completo solo con import() di completo/index.ts`);
        }
        continue;
      }
      const other = familyOf(target);
      if (other === null || other === family) continue;
      if (family !== null) {
        problems.push(`${module.id} importa ${target}: una famiglia non importa i file di un'altra (${family} → ${other})`);
      } else if (!dynamic) {
        problems.push(`${module.id} importa staticamente ${target}: una famiglia arriva solo con import() (carica.ts)`);
      }
    }
  }
  return problems;
}

/**
 * I moduli del Completo finiti in un chunk che non è quello della loro
 * regola, e i chunk attesi che mancano, uno per riga.
 *
 * @param {Iterable<{ name: string, modules: readonly string[] }>} chunks
 * @param {readonly string[]} families le famiglie di `completo/famiglie/`
 * @returns {string[]}
 */
export function completoChunkProblems(chunks, families) {
  const problems = [];
  const seen = new Set();
  for (const chunk of chunks) {
    for (const id of chunk.modules) {
      const expected = completoChunk(id);
      if (expected === undefined) continue;
      seen.add(chunk.name);
      if (chunk.name !== expected) problems.push(`${id} è nel chunk ${chunk.name}, non in ${expected}`);
    }
  }
  for (const name of ["drawing-completo", "drawing-indice", ...families.map((family) => `drawing-fam-${family}`)]) {
    if (!seen.has(name)) problems.push(`manca il chunk ${name}`);
  }
  return problems;
}

/**
 * Le dipendenze da precaricare per un `import()` (`build.modulePreload.
 * resolveDependencies` di Vite). Vite non precarica un chunk che non importa
 * niente, perché l'`import()` lo scarica comunque: per una famiglia del
 * Completo rende il chunk stesso, così la pagina ne ha il `modulepreload`.
 * La WebKitGTK dell'app non mette fra le risorse ciò che arriva dal
 * protocollo dell'app: il `modulepreload` è l'unica traccia che lo scenario
 * V1 del banco WebView vede di una famiglia arrivata. Gli altri `import()`
 * restano come li fa Vite.
 *
 * @param {string} filename il chunk importato, `assets/<nome>-<impronta>.js`
 * @param {string[]} deps ciò che Vite precaricherebbe
 * @returns {string[]}
 */
export function completoPreload(filename, deps) {
  const name = filename.split("/").pop() ?? "";
  return deps.length === 0 && /^drawing-fam-[a-z0-9-]+-[A-Za-z0-9_-]{8}\.js$/.test(name) ? [filename] : deps;
}

/**
 * Il plugin di Vite che ferma la build quando un confine del Completo cade.
 *
 * @param {readonly string[]} families
 */
export function completoBoundaries(families) {
  return {
    name: "completo-confini",
    apply: "build",
    buildEnd(error) {
      if (error) return;
      const modules = [...this.getModuleIds()].map((id) => this.getModuleInfo(id)).filter(Boolean);
      const problems = completoImportProblems(modules);
      if (problems.length) this.error(`i confini del Disegno completo:\n${problems.join("\n")}`);
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((chunk) => chunk.type === "chunk")
        .map((chunk) => ({ name: chunk.name, modules: Object.keys(chunk.modules) }));
      const problems = completoChunkProblems(chunks, families);
      if (problems.length) this.error(`i chunk del Disegno completo:\n${problems.join("\n")}`);
    },
  };
}
