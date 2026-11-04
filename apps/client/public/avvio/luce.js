// Lo strato d'avvio, prima parte: la luce.
//
// Gira sincrono nel <head>, subito dopo lo stile in linea e prima di ogni
// modulo: decide luce, contrasto e moto con le stesse regole del tema vero
// (`effectiveTheme` ed `effectiveContrast` di src/theme/theme.ts, la
// preferenza di moto di src/theme/reduced-motion.ts) e le scrive su <html>
// come attributi propri (`data-avvio-*`, mai `data-theme`). Applica i colori
// salvati alla consegna precedente e da subito ascolta gli `error` degli
// script, così uno che non arriva diventa un guasto che si spiega.
//
// È un file e non uno script in linea perché la CSP di Tauri non permette lo
// script in linea (`script-src 'self'`). Nessun globale, nessun `import`: lo
// serve `public/` così com'è. La cache `fub.avvio` la scrive solo
// src/avvio/ alla consegna; qui si legge e basta. Il test è
// src/avvio/luce.test.ts.
(function () {
  "use strict";
  var root = document.documentElement;

  /** `localStorage` può lanciare (finestra privata, archivio negato). */
  function leggi(chiave) {
    try {
      return window.localStorage.getItem(chiave);
    } catch (errore) {
      return null;
    }
  }
  function json(testo) {
    if (typeof testo !== "string") return null;
    try {
      return JSON.parse(testo);
    } catch (errore) {
      return null;
    }
  }
  /** Come `mediaMatches` di theme.ts: senza `matchMedia` vale il ripiego. */
  function media(domanda, ripiego) {
    try {
      return window.matchMedia ? window.matchMedia(domanda).matches : ripiego;
    } catch (errore) {
      return ripiego;
    }
  }

  // Le scelte: prima la cache dello strato, se no le due cache del tema
  // (`loadCache` di theme.ts), con le loro stesse regole.
  var sceltaLuce = "";
  var sceltaContrasto = "";
  var sceltaMoto = "";
  var avvio = json(leggi("fub.avvio"));
  if (!avvio || typeof avvio !== "object" || avvio.v !== 1) avvio = null;
  if (avvio) {
    sceltaLuce = avvio.luce;
    sceltaContrasto = avvio.contrasto;
    sceltaMoto = avvio.moto;
  } else {
    var tema = leggi("fub.appearance.theme");
    var selezione = json(tema);
    if (selezione && typeof selezione === "object" && typeof selezione.id === "string" && typeof selezione.light === "string") {
      sceltaLuce = selezione.light;
    } else {
      // La cache di prima era la sola luce; «lime» era un tema scuro.
      sceltaLuce = tema === "lime" ? "dark" : tema;
    }
    var grezze = leggi("fub.appearance.preferences");
    if (grezze) {
      var preferenze = json(grezze);
      if (preferenze === null) {
        // theme.ts butta tutta la cache quando le preferenze non si leggono.
        sceltaLuce = "";
      } else if (typeof preferenze.contrast === "string") {
        sceltaContrasto = preferenze.contrast;
      }
    }
  }

  // effectiveTheme: la scelta esplicita vince, se no il sistema; senza
  // `matchMedia` la luce è scura.
  var luce = sceltaLuce === "light" || sceltaLuce === "dark"
    ? sceltaLuce
    : media("(prefers-color-scheme: dark)", true) ? "dark" : "light";
  // effectiveContrast: lo stesso, col ripiego normale.
  var contrasto = sceltaContrasto === "normal" || sceltaContrasto === "high"
    ? sceltaContrasto
    : media("(prefers-contrast: more)", false) ? "high" : "normal";
  // reducedMotion: la preferenza di Fub si somma a quella del sistema.
  var ridotto = sceltaMoto === "reduced" || media("(prefers-reduced-motion: reduce)", false);

  root.setAttribute("data-avvio-luce", luce);
  root.setAttribute("data-avvio-contrasto", contrasto);
  if (ridotto) root.setAttribute("data-avvio-moto", "ridotto");
  else root.removeAttribute("data-avvio-moto");

  // I colori della luce risolta. Un valore che non è un colore, o che potrebbe
  // uscire dalla dichiarazione, si scarta: resta quello di serie del CSS.
  var CHIAVI = ["sfondo", "testo", "tenue", "accento", "inchiostro", "bordo", "guasto", "fuoco"];
  var tavolozze = avvio && avvio.colori && typeof avvio.colori === "object" ? avvio.colori : null;
  var colori = tavolozze ? tavolozze[luce + (contrasto === "high" ? "-high" : "")] : null;
  var supporta = window.CSS && typeof window.CSS.supports === "function";
  if (colori && typeof colori === "object" && supporta) {
    for (var i = 0; i < CHIAVI.length; i++) {
      var valore = colori[CHIAVI[i]];
      if (typeof valore !== "string" || /[;{}<>]/.test(valore)) continue;
      var buono = false;
      try {
        buono = window.CSS.supports("color", valore);
      } catch (errore) {
        buono = false;
      }
      if (buono) root.style.setProperty("--avvio-" + CHIAVI[i], valore);
    }
  }

  // Uno script o un modulepreload che non arriva: il percorso su <html>, dove
  // stati.js lo trova anche se l'errore viene prima di lui. A strato tolto
  // l'ascoltatore se ne va al primo errore che vede.
  function percorso(indirizzo) {
    try {
      return new URL(indirizzo, window.location.href).pathname;
    } catch (errore) {
      return indirizzo;
    }
  }
  function mancato(evento) {
    var el = evento.target;
    if (!el || el === window || !el.tagName) return;
    var indirizzo = "";
    if (el.tagName === "SCRIPT") indirizzo = el.getAttribute("src") || "";
    else if (el.tagName === "LINK" && /(^|\s)modulepreload(\s|$)/i.test(el.getAttribute("rel") || "")) {
      indirizzo = el.getAttribute("href") || "";
    }
    if (!indirizzo) return;
    if (document.readyState !== "loading" && !document.querySelector(".avvio")) {
      window.removeEventListener("error", mancato, true);
      return;
    }
    if (!root.hasAttribute("data-avvio-script")) root.setAttribute("data-avvio-script", percorso(indirizzo));
  }
  window.addEventListener("error", mancato, true);
})();
