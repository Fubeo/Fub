import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const CHUNK_BUDGET = 500_000;
// Il parser upstream arriva già precompilato: resta separato e solo lazy.
const MERMAID_PARSER_BUDGET = 700_000;

// Config allineata a Tauri: porta fissa 1420, niente clear screen.
export default defineConfig({
  clearScreen: false,
  plugins: [{
    name: "bundle-size-budgets",
    apply: "build",
    generateBundle: {
      // Dopo la riscrittura degli import e dei preload di Vite: byte finali.
      order: "post",
      handler(_options, bundle) {
        const eager = new Set<string>();
        const visit = (name: string): void => {
          const chunk = bundle[name];
          if (eager.has(name) || chunk?.type !== "chunk") return;
          eager.add(name);
          for (const dependency of chunk.imports) visit(dependency);
        };
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === "chunk" && chunk.isEntry) visit(chunk.fileName);
        }
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk") continue;
          const modules = Object.keys(chunk.modules);
          let parserModules = 0;
          for (const id of modules) {
            if (id.includes("/node_modules/@mermaid-js/parser/")) parserModules++;
          }
          const parser = parserModules > 0 && parserModules === modules.length;
          if (parserModules > 0 && eager.has(chunk.fileName)) {
            this.error(`${chunk.fileName}: il parser Mermaid deve restare fuori dal caricamento iniziale`);
          }
          const limit = parser ? MERMAID_PARSER_BUDGET : CHUNK_BUDGET;
          const bytes = Buffer.byteLength(chunk.code, "utf8");
          if (bytes > limit) {
            this.error(`${chunk.fileName}: ${bytes} byte superano il budget di ${limit} byte`);
          }
        }
      },
    },
  }],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
    // L'avviso generico copre il tetto massimo; il plugin applica anche
    // il limite ordinario più stretto e vieta il parser nel percorso eager.
    chunkSizeWarningLimit: MERMAID_PARSER_BUDGET / 1000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        document: fileURLToPath(new URL("./document.html", import.meta.url)),
        mobile: fileURLToPath(new URL("./mobile.html", import.meta.url)),
      },
      output: {
        // Confini riusabili, non fasce di byte. I linguaggi e i diagrammi
        // opzionali restano separati: non finiscono nel runtime iniziale.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/node_modules\/@codemirror\/(state|view|language|commands|autocomplete|search|lint)\//.test(id)) {
            return "editor-runtime";
          }
          // Vim è una libreria a sé, grossa e con un'altra cadenza: da sola
          // resta in cache quando cambia la shell, e non gonfia il chunk
          // condiviso dalle tre finestre.
          if (/\/node_modules\/@replit\/codemirror-vim(-core)?\//.test(id)) return "editor-vim";
          if (/\/node_modules\/@lezer\/(common|lr|highlight)\//.test(id)) return "parser-runtime";
          if (/\/node_modules\/(@codemirror\/lang-|@lezer\/)(markdown|html|css|javascript)\//.test(id)) {
            return "markdown-grammar";
          }
          if (/\/src\/theme\/(serie\/|contrast(?:-fixture)?\.ts$|oklch\.ts$)/.test(id)) {
            return "theme-series";
          }
          if (/\/node_modules\/postcss\//.test(id)) return "theme-parser";
          if (/\/node_modules\/@tauri-apps\//.test(id)) return "host-bridge";
          if (/\/node_modules\/(d3-(selection|transition|shape|color|dispatch|ease|interpolate|timer|array|path)|dagre-d3-es|roughjs|dompurify|lodash-es|es-toolkit|marked|khroma)\//.test(id)) {
            return "diagram-runtime";
          }
        },
      },
    },
  },
  test: {
    // Vitest, per difetto, **non** processa i CSS: ogni `import` di un foglio
    // di stile diventa la stringa vuota, `?raw` compreso. Andrebbe benissimo
    // finché nessuno li legge — ma il presidio di `hidden`
    // (`src/ui/hidden.test.ts`) legge `style.css` come testo, e con i CSS
    // svuotati passerebbe **a vuoto**: cercherebbe una regola dentro una
    // stringa di zero caratteri, non la troverebbe mai, e non lo direbbe a
    // nessuno. Un presidio che non può fallire è peggio di nessun presidio.
    css: true,
    // In che lingua gira la suite, e perché la domanda esiste: sta scritto in
    // `src/test-setup.ts`. In breve: `t()` risolve su `navigator.language`, e
    // senza questa riga i presidi che guardano del testo passerebbero o
    // fallirebbero a seconda del locale della macchina che li lancia.
    setupFiles: ["./src/test-setup.ts"],
  },
});
