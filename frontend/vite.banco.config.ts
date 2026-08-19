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

const qui = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/// I due moduli della cucitura, e con cosa il banco li sostituisce.
const SOSTITUZIONI: Record<string, string> = {
  [qui("./src/host/ipc.ts")]: qui("./banco/ipc-finto.ts"),
  [qui("./src/host/dialog.ts")]: qui("./banco/dialog-finto.ts"),
};

function cucituraDelBanco(): Plugin {
  return {
    name: "banco:cucitura",
    // `pre`: prima del risolutore di Vite, o l'import è già diventato un id
    // e non c'è più niente da sostituire.
    enforce: "pre",
    async resolveId(sorgente, chiamante, opzioni) {
      // Chi sostituisce non si sostituisce da sé: senza questa riga, il
      // `../src/host/finto` di `ipc-finto.ts` — che di `ipc` importa solo un
      // tipo — non darebbe fastidio, ma un domani un import vero sì, e sarebbe
      // un ciclo scoperto guardando una pagina bianca.
      if (chiamante && Object.values(SOSTITUZIONI).includes(chiamante)) return null;
      const risolto = await this.resolve(sorgente, chiamante, { ...opzioni, skipSelf: true });
      if (!risolto) return null;
      return SOSTITUZIONI[risolto.id] ?? null;
    },

    // **Quando la shell ha finito di montarsi**, detto alla pagina.
    //
    // Un fotografo che non lo sappia ha due strade e sono tutte e due sbagliate:
    // dormire un tempo a caso — cioè un banco che ogni tanto fotografa metà
    // montaggio, che è il modo in cui un banco visivo si spegne da solo —
    // oppure aspettare un elemento a caso, che vuol dire una condizione diversa
    // per ogni scena e nessuna che valga per la prossima.
    //
    // La risposta c'era già: `main.ts` **esporta** `avvio`, e il commento che lo
    // esporta dice esattamente perché — «senza questa riga l'avvio non è
    // osservabile». Qui la si osserva. Il secondo `import` dello stesso modulo
    // non lo esegue una seconda volta: ESM restituisce l'istanza che c'è già,
    // quindi questo è un ascoltatore, non un secondo avvio.
    //
    // Sta nella config del banco e non in `index.html` perché `index.html` è
    // della shell: il banco non ci mette dentro niente che l'app debba portarsi.
    transformIndexHtml(html) {
      if (!html.includes("/src/main.ts")) return html;
      return html.replace(
        "</body>",
        `  <script type="module">
      import { avvio } from "/src/main.ts";
      await avvio;
      document.documentElement.dataset.banco = "pronto";
    </script>
  </body>`,
      );
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [cucituraDelBanco()],
  server: {
    // Non 1420: quella è la porta di Tauri, e un banco che gira mentre l'app è
    // aperta non deve doverne chiudere una per fotografare l'altra.
    port: 1431,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist-banco",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        shell: qui("./index.html"),
        catalogo: qui("./banco/catalogo.html"),
      },
    },
  },
});
