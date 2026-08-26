import { defineConfig } from "vitest/config";

// Config allineata a Tauri: porta fissa 1420, niente clear screen.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
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
