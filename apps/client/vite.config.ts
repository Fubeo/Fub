import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const CHUNK_BUDGET = 500_000;
// Il parser upstream arriva già precompilato: resta separato e solo lazy.
const MERMAID_PARSER_BUDGET = 700_000;

/// Il CSS senza i commenti; un `/*` dentro una stringa resta. Le regole sono
/// le stesse: il sanitizer e il browser i commenti li saltano comunque.
function withoutComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
}

// Config allineata a Tauri: porta fissa 1420, niente clear screen.
export default defineConfig({
  clearScreen: false,
  plugins: [{
    // La pelle composta arriva come testo (`?raw`), e Vite non minimizza il
    // testo: un terzo erano commenti, che documentano i pezzi ma nel bundle
    // pesano come regole. Nella build si tolgono; in sviluppo e al banco la
    // pelle resta quella scritta.
    name: "skin-without-comments",
    apply: "build",
    transform(code, id) {
      if (!/\/src\/theme\/scrittoio\/skin\.css\?raw$/.test(id)) return null;
      const match = /^export default (".*");?\s*$/s.exec(code);
      if (!match) this.error(`${id}: il testo della pelle non ha più la forma di \`?raw\``);
      return { code: `export default ${JSON.stringify(withoutComments(JSON.parse(match[1]!) as string))};`, map: null };
    },
  }, {
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
        // Vero se dal chunk `from` si arriva, per import statici, a un chunk
        // che si chiama `name`.
        const reaches = (from: string, name: string): boolean => {
          const seen = new Set<string>();
          const walk = (fileName: string): boolean => {
            const chunk = bundle[fileName];
            if (seen.has(fileName) || chunk?.type !== "chunk") return false;
            seen.add(fileName);
            return chunk.imports.some((dependency) => {
              const next = bundle[dependency];
              return (next?.type === "chunk" && next.name === name) || walk(dependency);
            });
          };
          return walk(from);
        };
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
          // I chunk dei disegni stanno sotto la superficie: lei li importa, e
          // nessuno di loro la importa, nemmeno attraverso un altro. Un ciclo
          // fra chunk si carica, ma l'ordine in cui i moduli partono non è più
          // quello del codice.
          if (chunk.name.startsWith("drawing-") && reaches(chunk.fileName, "surface")) {
            this.error(`${chunk.fileName}: un chunk dei disegni non importa la superficie`);
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
    fs: {
      // I modelli di «Nuovo disegno» stanno nel crate che li distribuisce, e
      // la galleria ne mostra le anteprime: oltre al client, il server serve
      // quella cartella e nient'altro del repository.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL("../../crates/fub-features/templates", import.meta.url)),
        // Sotto Vitest, anche gli altri disegni del corpus che
        // `src/editors/spatial/corpus-open.test.ts` apre: quelli di altri
        // programmi e l'icona del clipper. Il server di sviluppo non li serve.
        ...(process.env.VITEST
          ? [
              fileURLToPath(new URL("../../crates/fub-scene/tests/corpus", import.meta.url)),
              fileURLToPath(new URL("../clipper/icons", import.meta.url)),
            ]
          : []),
      ],
    },
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
          // L'indice dei linguaggi dei blocchi di codice è una libreria a sé:
          // una tabella di import differiti, che cambia con le sue versioni e
          // non con la shell.
          if (/\/node_modules\/@codemirror\/language-data\//.test(id)) return "editor-languages";
          if (/\/node_modules\/@lezer\/(common|lr|highlight)\//.test(id)) return "parser-runtime";
          if (/\/node_modules\/(@codemirror\/lang-|@lezer\/)(markdown|html|css|javascript)\//.test(id)) {
            return "markdown-grammar";
          }
          // Il sanificatore del CSS dei temi, con PostCSS: lo usano il caricatore
          // dei temi e gli snippet, non l'editor dei documenti. Cambia col
          // vocabolario della pelle, e da solo non pesa sul chunk dei documenti.
          if (/\/src\/ui\/sanitize-css\.ts$|\/node_modules\/(postcss|nanoid|picocolors|source-map-js)\//.test(id)) return "css-sanitizer";
          // Il foglio di calcolo: il motore della griglia, la cartella, la
          // pittura delle celle e i suoi oggetti. Cambia col foglio, non con
          // la shell; la barra multifunzione e le finestre restano differite.
          if (/\/src\/editors\/grid\/[^/]+\.ts$/.test(id)) return "grid-editor";
          // Scrittura, il nucleo del testo ricco, con ProseMirror: la usano
          // i documenti e il testo dei disegni, che la carica dopo il
          // montaggio. Da sola non pesa sul primo disegno e resta in cache
          // fra i due editor.
          if (/\/src\/scrittura\/|\/node_modules\/prosemirror-/.test(id)) return "scrittura";
          // Il formato dei disegni e la sua pittura: il modello, la lettura,
          // le operazioni e il tratto a mano libera. Cambiano col formato, non
          // con l'editor che ci lavora sopra, e non dipendono da lui.
          if (/\/src\/editors\/spatial\/(scene\/|painter\/|ink\/|number\.ts$)|\/node_modules\/perfect-freehand\//.test(id)) {
            return "drawing-scene";
          }
          // La geometria dei disegni senza DOM: i nodi dei tracciati, la
          // spina dei tratti, le forme e il loro riconoscimento, le aree
          // booleane, lo scostamento, la semplificazione, la Curvatura, i
          // tagli e il profilo dello spessore variabile. Dipendono soltanto
          // dal formato, e gli strumenti dell'editor le usano.
          if (/\/src\/editors\/spatial\/tools\/(nodes|spine|fit|shapes|recognize|boolean|offset|simplify|curvature|cut|profile)\.ts$/.test(id)) {
            return "drawing-geometry";
          }
          // I fogli di stile dei disegni: leggerli, la loro cascata e lo stile
          // che resta a ciò che un comando sposta. Seguono CSS, non l'editor
          // che li chiama, e dipendono soltanto dal formato.
          if (/\/src\/editors\/spatial\/tools\/(stylesheet|selectors|cascade|styled)\.ts$/.test(id)) {
            return "drawing-styles";
          }
          // I comandi dei disegni senza DOM: l'indice degli oggetti che gli
          // strumenti toccano, con la parte che se ne vede, e ciò che fa di
          // una scelta dei passi sul documento: disporre, il contorno,
          // l'aspetto, i tracciati, le trasformazioni, le booleane, i tagli,
          // lo spessore variabile, i livelli, la selezione avanzata, il gruppo
          // di un ricalco, il testo a pezzi del campo in cui si scrive, i suoi
          // a capo con la misura dei caratteri, il testo su tracciato, le
          // tavole, i campioni, le sfumature, le punte delle linee, il
          // ritaglio delle immagini, le maschere, gli effetti, le campiture,
          // i motivi, i connettori e le etichette nelle forme, con ciò che
          // il seguito delle une e degli altri ha in comune, le ripetizioni
          // e la simmetria della penna.
          // Con loro ciò che i pannelli leggono senza DOM: copiare e
          // incollare, la cronologia, il controllo dell'accessibilità e la
          // descrizione del disegno, gli attributi e le misure con le unità,
          // le scelte dell'export.
          // E gli aiuti degli strumenti senza DOM: la cornice di
          // trasformazione, le forme coi parametri, il contagocce, le guide
          // intelligenti e la griglia; le librerie di simboli, i nodi di
          // Bézier, dove va la barra della selezione e l'ordine cambiato.
          // Dipendono dal formato e dalla geometria, e l'editor li chiama.
          if (/\/src\/editors\/spatial\/(tools\/(hit|clips|edit|palette|arrange|outline|transform|topath|look|apply|inkshape|paths|width|combine|nodable|scissors|builder|place|layers|selecting|naming|trace-ops|rich|wrap|measure|text-path|boards|swatches|gradients|tips|crop|masks|effects|hatches|patterns|connectors|connector-ops|connector-copies|label-hosts|labels|follow|repeat-ops|symmetry|clipboard|history|audit|attributes|quantity|export-plan|frame|reshape|eyedropper|guides|grid|symbol-library|symbol-libraries|bezier|bar|order-changes)|describe)\.ts$/.test(id)) {
            return "drawing-commands";
          }
          // I pannelli dei disegni: le proprietà coi loro campi e coi colori
          // del documento, la sfumatura, la campitura, gli effetti e il
          // connettore, gli oggetti, le tavole, la cronologia, l'accessibilità,
          // l'ispettore degli attributi, la finestra «Esporta», le forme e i
          // simboli, con la finestra dell'aggiornamento di un simbolo, la
          // finestra di «Rendi modificabile», le finestre «Penna e dita»,
          // «Personalizza la barra…» e «Guide», il menu radiale, la nota di
          // un'annotazione, i suggerimenti sotto il foglio e il campo dove si
          // scrive un testo;
          // con loro le finestre a moduli e l'elenco dei tasti, che soltanto
          // i disegni aprono.
          // Sono DOM attorno al foglio, che l'editor e la superficie montano e
          // che leggono i comandi; non dipendono dall'editor, e cambiano con
          // la loro interfaccia.
          if (/\/src\/editors\/spatial\/tools\/(properties|swatches-panel|gradient-panel|hatch-panel|effects-panel|connector-panel|objects|boards-panel|history-panel|accessibility-panel|inspector|export-dialog|library-panel|symbols-panel|symbol-update-dialog|editable-dialog|fields|touch-dialog|toolbar-dialog|guide-dialog|radial|note|suggestions|text-field)\.ts$/.test(id) || /\/src\/ui\/form-dialog\.ts$/.test(id)) {
            return "drawing-panels";
          }
          // Le cromature dell'editor e i suoi installatori più grossi: si
          // chiamano soltanto al montaggio, nessuno lavora mentre il modulo si
          // valuta, e da soli tengono `surface` sotto la soglia.
          if (/\/src\/editors\/spatial\/tools\/editor\/(chrome\/[a-z-]+|curvature-tool|image-commands|selection-commands|tree)\.ts$/.test(id)) {
            return "drawing-editor-parts";
          }
          // I controlli del kit che le superfici condividono: il selettore e il
          // pozzo del colore, il campo numerico con le unità, la scelta del
          // carattere, la colonna degli strumenti e la barra delle opzioni. Li
          // usano il disegno e, domani, i documenti e il foglio: non sono
          // dell'editor che li monta.
          if (/\/src\/kit\/(color\/|number-field\.ts$|quantity\.ts$|font-picker\.ts$|tool-rail\.ts$|options-bar\.ts$)/.test(id)) {
            return "kit-controls";
          }
          // La pelle composta è testo, come il catalogo delle stringhe: cresce
          // con ogni superficie, e dentro la serie ne consumava tutto il
          // margine. La leggono la serie e la finestra del documento.
          if (/\/src\/theme\/scrittoio\/skin\.css\?raw$/.test(id)) return "theme-skin";
          // La serie che la shell monta: ricetta, fogli, pelle, e i conti del
          // colore che la ricetta usa.
          if (/\/src\/theme\/(scrittoio\/|contrast(?:-fixture)?\.ts$|oklch\.ts$)/.test(id)) {
            return "theme-series";
          }
          // Il catalogo delle stringhe è testo, cresce con ogni superficie e
          // lo leggono tutte le finestre: senza un nome suo finisce nel chunk
          // condiviso più grosso e ne consuma il margine a ogni frase nuova.
          if (/\/src\/i18n\/catalog\.ts$/.test(id)) return "shell-strings";
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
