// Il **secondo ingresso** della shell: la stessa `index.html`, la stessa
// `main.ts`, un altro di là dal confine (§31.1).
//
// # Perché una config e non una seconda shell
//
// Ciò che il banco fotografa dev'essere la shell vera, o le baseline provano
// qualcos'altro. Quindi non c'è nessuna copia di `index.html` e nessun secondo
// punto di montaggio: c'è questa config, che sostituisce **due moduli** — la
// porta del kernel e quella del sistema operativo, cioè esattamente la cucitura
// che il §1.3 ha ridotto a due file — e per il resto è la config di sempre.
//
// La conseguenza che conta: **nessuna riga di `src/` sa che il banco esiste**.
// Niente `if (banco)`, niente variabile d'ambiente letta da un pannello, e il
// presidio «`@tauri-apps` solo nella cucitura» resta verde perché non è cambiato
// nulla da guardare.
//
// # Perché un plugin e non `resolve.alias`
//
// Un alias fa il suo lavoro sulla **stringa** che si importa, e quella stringa
// qui è relativa: `./host/ipc` da `main.ts`, `../host/ipc` da un pannello, e
// domani `../../host/ipc` da un modulo più in fondo. Ce ne sono tredici, e una
// regexp che le copra tutte è una regexp che il prossimo file mette alla prova.
// `resolveId` risolve prima e confronta dopo: la domanda diventa «questo import,
// dovunque stia, finisce sul file della cucitura?», che è la domanda vera e non
// ha una profondità.
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/// I due moduli della cucitura, e con cosa il banco li sostituisce.
const REPLACEMENTS: Record<string, string> = {
  [here("./src/host/ipc.ts")]: here("./bench/fake-ipc.ts"),
  [here("./src/host/dialog.ts")]: here("./bench/fake-dialog.ts"),
};

/// Gli ingressi che esportano `startup`: la pagina che ne carica uno riceve
/// l'ascoltatore del montaggio.
const SHELL_ENTRIES = [
  "/src/main.ts",
  "/src/entrypoints/mobile-main.ts",
  "/src/shells/scrittoio/document/entry.ts",
];

function seamForBench(): Plugin {
  return {
    name: "bench:seam",
    // `pre`: prima del risolutore di Vite, o l'import è già diventato un id
    // e non c'è più niente da sostituire.
    enforce: "pre",
    async resolveId(source, importer, options) {
      // Chi sostituisce non si sostituisce da sé: senza questa riga, il
      // `../src/host/finto` di `ipc-finto.ts` — che di `ipc` importa solo un
      // tipo — non darebbe fastidio, ma un domani un import vero sì, e sarebbe
      // un ciclo scoperto guardando una pagina bianca.
      if (importer && Object.values(REPLACEMENTS).includes(importer)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return REPLACEMENTS[resolved.id] ?? null;
    },

    // **Quando la shell ha finito di montarsi**, detto alla pagina.
    //
    // Un fotografo che non lo sappia ha due strade e sono tutte e due sbagliate:
    // dormire un tempo a caso — cioè un banco che ogni tanto fotografa metà
    // montaggio, che è il modo in cui un banco visivo si spegne da solo —
    // oppure aspettare un elemento a caso, che vuol dire una condizione diversa
    // per ogni scena e nessuna che valga per la prossima.
    //
    // La risposta c'era già: `main.ts` **esporta** `startup`, e il commento che lo
    // esporta dice esattamente perché — «senza questa riga l'avvio non è
    // osservabile». Qui la si osserva. Il secondo `import` dello stesso modulo
    // non lo esegue una seconda volta: ESM restituisce l'istanza che c'è già,
    // quindi questo è un ascoltatore, non un secondo avvio.
    //
    // Sta nella config del banco e non in `index.html` perché `index.html` è
    // della shell: il banco non ci mette dentro niente che l'app debba portarsi.
    //
    // Gli ingressi sono tre, uno per pagina: la finestra principale, il
    // telefono e la finestra documento. Esportano tutti la stessa promessa.
    transformIndexHtml(html) {
      const entry = SHELL_ENTRIES.find((candidate) => html.includes(candidate));
      if (!entry) return html;
      return html.replace(
        "</body>",
        `  <script type="module">
      import { startup } from "${entry}";
      await startup;
      document.documentElement.dataset.bench = "ready";
    </script>
  </body>`,
      );
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [seamForBench()],
  server: {
    // Non 1420: quella è la porta di Tauri, e un banco che gira mentre l'app è
    // aperta non deve doverne chiudere una per fotografare l'altra.
    //
    // `FUB_BENCH_PORT` la sposta per chi ha già un banco aperto da un altro
    // worktree: la porta resta stretta, cioè due banchi non si fotografano mai
    // l'un l'altro per sbaglio.
    port: Number(process.env.FUB_BENCH_PORT) || 1431,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist-bench",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        shell: here("./index.html"),
        mobile: here("./mobile.html"),
        document: here("./document.html"),
        catalogo: here("./bench/catalog.html"),
        kit: here("./bench/kit.html"),
      },
    },
  },
});
