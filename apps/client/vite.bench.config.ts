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
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canvasWasm } from "./build/canvas-wasm.mjs";
import { lazyEditorModules } from "./bench/warmup.mjs";

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

/// Il nonce delle pagine del banco: uno per server, come Tauri ne scrive uno
/// per ogni `<style>` della pagina che serve.
const NONCE = randomBytes(18).toString("base64");

/// La CSP dell'app vera, letta da `crates/fub-app/tauri.conf.json` e non
/// ricopiata: una copia divergerebbe, e il banco proverebbe un'altra politica.
function appCsp(): string {
  const config = JSON.parse(readFileSync(here("../../crates/fub-app/tauri.conf.json"), "utf8"));
  const csp: unknown = config?.app?.security?.csp;
  if (typeof csp !== "string" || csp.trim() === "") {
    throw new Error("tauri.conf.json non dichiara app.security.csp");
  }
  return csp;
}

/// Aggiunge una sorgente a una direttiva, come fa Tauri con i suoi nonce: se
/// la direttiva non c'è, nasce con `'self'`.
function withSource(csp: string, directive: string, source: string): string {
  const parts = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const index = parts.findIndex((part) => part.split(/\s+/)[0] === directive);
  if (index < 0) return [...parts, `${directive} 'self' ${source}`].join("; ");
  parts[index] = `${parts[index]} ${source}`;
  return parts.join("; ");
}

/// **La CSP vera, applicata al banco.**
///
/// Tauri manda la politica di `tauri.conf.json` come header di ogni pagina
/// HTML, e mette un nonce a ogni `<style>` della pagina aggiungendolo a
/// `style-src` (`set_csp` in `tauri::manager`). Qui succede lo stesso, con una
/// differenza dichiarata: anche gli `<script>` in linea e gli stili che Vite
/// inietta in sviluppo portano il nonce (`html.cspNonce`), perché nell'app
/// vera sono file del bundle (`'self'`) o script di Tauri ammessi per hash. Il
/// codice dell'app non vede la differenza: un `<style>` creato senza il nonce
/// della pagina, o un attributo `style` scritto come markup, è rifiutato qui
/// come là, e `bench/stage.mjs` fa fallire la scena alla prima violazione.
///
/// L'header va solo sulle pagine: Tauri non lo manda con gli script, e un
/// worker prende la politica dalla risposta del suo script.
function appPolicy(): Plugin {
  const nonce = `'nonce-${NONCE}'`;
  const policy = withSource(withSource(appCsp(), "script-src", nonce), "style-src", nonce);
  return {
    name: "bench:csp",
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        const writeHead = response.writeHead;
        response.writeHead = function (this: typeof response, ...args: unknown[]) {
          const type = String(response.getHeader("Content-Type") ?? "");
          if (type.startsWith("text/html")) response.setHeader("Content-Security-Policy", policy);
          return (writeHead as (...rest: unknown[]) => typeof response).apply(this, args);
        } as typeof response.writeHead;
        next();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  // Il nucleo della lavagna come nella config di sempre: la shell del banco
  // è la shell vera.
  plugins: [seamForBench(), appPolicy(), canvasWasm()],
  html: { cspNonce: NONCE },
  server: {
    // Non 1420: quella è la porta di Tauri, e un banco che gira mentre l'app è
    // aperta non deve doverne chiudere una per fotografare l'altra.
    //
    // `FUB_BENCH_PORT` la sposta per chi ha già un banco aperto da un altro
    // worktree: la porta resta stretta, cioè due banchi non si fotografano mai
    // l'un l'altro per sbaglio.
    port: Number(process.env.FUB_BENCH_PORT) || 1431,
    strictPort: true,
    // Gli editor che arrivano con un `import()` alla prima apertura si
    // trasformano all'accensione del server, non dentro l'attesa della prima
    // scena del loro formato (#395): l'elenco e il perché in `bench/warmup.mjs`.
    warmup: { clientFiles: lazyEditorModules(here(".")) },
    // Come la config di sempre: oltre al client, i modelli di «Nuovo disegno»
    // nel crate che li distribuisce.
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL("../../crates/fub-features/templates", import.meta.url)),
      ],
    },
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
