// Lo strato d'avvio, seconda parte: i tempi e il guasto.
//
// Gira `defer`, a pagina letta e prima dei moduli. Mette i testi salvati alla
// consegna precedente (la lingua scelta), fa entrare il marchio, mostra la
// fase quando l'attesa si allunga e disegna il guasto: uno script che non
// arriva (luce.js lo scrive su <html>), un evento `avvio:guasto` sullo
// strato, o 30 s senza che l'avvio dica `data-pronta`. La fase e il nome li
// scrive l'avvio (`data-fase`, `data-nome`); la consegna (src/avvio/) toglie
// lo strato, e da quel momento qui non resta acceso niente: ogni giro guarda
// `isConnected`. Mai `innerHTML`: i testi vanno come `textContent`. Il test è
// src/avvio/stati.test.ts.
(function () {
  "use strict";
  var avvio = document.querySelector(".avvio");
  if (!avvio) return;
  var root = document.documentElement;

  /** I tempi, contati da `performance.now()` della pagina. */
  var MARCHIO = 120;
  var MARCHIO_AL_PIU = 1000;
  var ATTESA = 2000;
  var LENTO = 10000;
  var GUASTO = 30000;

  /// L'italiano di serie, lo stesso di src/i18n/catalog.ts: vale finché la
  /// consegna non ha salvato i testi della lingua scelta.
  var DI_SERIE = {
    "app.avvio.annuncio": "Fub si sta avviando",
    "app.avvio.pagina": "Carico Fub…",
    "app.avvio.finestra": "Preparo la finestra…",
    "app.avvio.vault": "Apro «{name}»…",
    "app.avvio.lento": "Ci vuole più del solito.",
    "app.avvio.guasto": "Fub non è partito",
    "app.avvio.motivo.script": "Una parte di Fub non si è caricata ({src}).",
    "app.avvio.motivo.tempo": "Nessuna risposta da 30 secondi durante {phase}.",
    "app.avvio.copia": "Copia i dettagli",
    "app.avvio.copiato": "Dettagli copiati",
    "app.avvio.senza_js": "Fub ha bisogno di JavaScript per partire.",
    "app.avvio.regione": "Avvio di Fub",
    "app.retry": "Riprova",
    "app.startup_phase.page": "il caricamento della pagina",
    "app.startup_phase.shell": "l'avvio della finestra",
    "app.startup_phase.vault": "l'apertura del vault"
  };
  /// Le fasi dello strato, con la fase di state/startup-timing.ts che le dice.
  var FASI = { pagina: "page", finestra: "shell", vault: "vault" };

  var salvati = {};
  try {
    var cache = JSON.parse(window.localStorage.getItem("fub.avvio") || "null");
    if (cache && cache.v === 1 && cache.testi && typeof cache.testi === "object") salvati = cache.testi;
  } catch (errore) {
    salvati = {};
  }
  function modello(chiave) {
    var salvato = Object.prototype.hasOwnProperty.call(salvati, chiave) ? salvati[chiave] : null;
    return typeof salvato === "string" ? salvato : DI_SERIE[chiave] || "";
  }
  function testo(chiave, valori) {
    return modello(chiave).replace(/\{(\w+)\}/g, function (intero, nome) {
      return valori && Object.prototype.hasOwnProperty.call(valori, nome) ? String(valori[nome]) : intero;
    });
  }

  var fase = avvio.querySelector(".avvio-fase");
  var titolo = avvio.querySelector(".avvio-titolo");
  var motivo = avvio.querySelector(".avvio-motivo");
  var riprova = avvio.querySelector("#avvio-riprova");
  var copia = avvio.querySelector("#avvio-copia");
  var annuncio = avvio.querySelector(".avvio-annuncio");

  // I testi salvati sopra quelli scritti nell'HTML, che sono l'italiano.
  var nominati = avvio.querySelectorAll("[data-i18n]");
  for (var i = 0; i < nominati.length; i++) {
    var chiave = nominati[i].getAttribute("data-i18n");
    if (typeof salvati[chiave] === "string") nominati[i].textContent = salvati[chiave];
  }

  function adesso() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : 0;
  }
  function faseOra() {
    var scritta = avvio.getAttribute("data-fase");
    return Object.prototype.hasOwnProperty.call(FASI, scritta) ? scritta : "pagina";
  }

  /// La riga della fase: tre span, il nome in quello di mezzo, che il CSS
  /// taglia con l'ellissi mentre le virgolette restano.
  function disegnaFase() {
    if (!fase) return;
    var ora = faseOra();
    var parti = [testo("app.avvio." + ora), "", ""];
    if (ora === "vault") {
      var forma = modello("app.avvio.vault");
      var posto = forma.indexOf("{name}");
      if (posto >= 0) parti = [forma.slice(0, posto), avvio.getAttribute("data-nome") || "", forma.slice(posto + 6)];
    }
    var span = fase.children;
    for (var j = 0; j < span.length && j < 3; j++) span[j].textContent = parti[j];
  }

  var timer = [];
  var osservatore = null;
  var marchioEntrato = false;
  var guastoDetto = false;
  var tempi = { marchio: -1, guasto: -1 };

  function spegni() {
    for (var k = 0; k < timer.length; k++) window.clearTimeout(timer[k]);
    timer = [];
    if (osservatore) osservatore.disconnect();
    osservatore = null;
  }
  /** Lo strato c'è ancora? Se no si spegne tutto. */
  function vivo() {
    if (avvio.isConnected) return true;
    spegni();
    return false;
  }
  function a(momento, fare) {
    timer.push(window.setTimeout(function () {
      if (vivo()) fare();
    }, Math.max(0, momento - adesso())));
  }
  function stato(nuovo) {
    if (!guastoDetto) avvio.setAttribute("data-stato", nuovo);
  }

  function entraMarchio() {
    if (marchioEntrato || !vivo()) return;
    marchioEntrato = true;
    tempi.marchio = Math.round(adesso());
    avvio.setAttribute("data-marchio", "");
    avvio.setAttribute("data-marchio-da", String(tempi.marchio));
    if (annuncio && !guastoDetto) annuncio.textContent = testo("app.avvio.annuncio");
  }

  function dettagli(perche) {
    return [
      "motivo: " + perche,
      "fase: " + faseOra(),
      "userAgent: " + (navigator.userAgent || ""),
      "tempi: marchio " + tempi.marchio + " ms, guasto " + tempi.guasto + " ms, adesso " + Math.round(adesso()) + " ms"
    ].join("\n");
  }

  function guasto(perche) {
    if (!vivo()) return;
    entraMarchio();
    guastoDetto = true;
    tempi.guasto = Math.round(adesso());
    avvio.setAttribute("data-stato", "guasto");
    if (motivo) motivo.textContent = perche;
    if (copia) {
      copia.hidden = !(navigator.clipboard && typeof navigator.clipboard.writeText === "function");
      copia.textContent = testo("app.avvio.copia");
      copia.onclick = function () {
        navigator.clipboard.writeText(dettagli(perche)).then(function () {
          if (avvio.isConnected) copia.textContent = testo("app.avvio.copiato");
        }, function () {});
      };
    }
    if (annuncio) annuncio.textContent = (titolo ? titolo.textContent : "") + " " + perche;
    if (riprova) riprova.focus();
  }

  if (riprova) {
    riprova.addEventListener("click", function () {
      window.location.reload();
    });
  }
  avvio.addEventListener("avvio:guasto", function (evento) {
    var detto = evento && evento.detail && evento.detail.motivo;
    guasto(typeof detto === "string" ? detto : String(detto == null ? "" : detto));
  });

  function scriptMancato() {
    var src = root.getAttribute("data-avvio-script");
    if (src && !guastoDetto) guasto(testo("app.avvio.motivo.script", { src: src }));
  }

  // La fase e il nome li scrive l'avvio; lo script mancante luce.js. La
  // consegna toglie gli attributi di <html>: è lì che l'osservatore si spegne.
  if (typeof window.MutationObserver === "function") {
    osservatore = new window.MutationObserver(function () {
      if (!vivo()) return;
      disegnaFase();
      scriptMancato();
    });
    osservatore.observe(root, { attributes: true, attributeFilter: ["data-avvio-script", "data-avvio-luce"] });
    osservatore.observe(avvio, { attributes: true, attributeFilter: ["data-fase", "data-nome"] });
  }

  // Il marchio entra a 120 ms se il suo carattere è pronto, se no appena lo è,
  // e al più tardi a 1 s: con `font-display: block` prima si vedrebbe la
  // piastrella senza la effe.
  var carattere = true;
  try {
    if (document.fonts && typeof document.fonts.load === "function") {
      carattere = false;
      document.fonts.load('italic 500 38px "Avvio Newsreader"', "f").then(function () {
        carattere = true;
        if (adesso() >= MARCHIO) entraMarchio();
      }, function () {
        carattere = true;
      });
    }
  } catch (errore) {
    carattere = true;
  }

  disegnaFase();
  scriptMancato();
  a(MARCHIO, function () {
    if (carattere) entraMarchio();
  });
  a(MARCHIO_AL_PIU, entraMarchio);
  a(ATTESA, function () {
    stato("attesa");
  });
  a(LENTO, function () {
    stato("lento");
  });
  a(GUASTO, function () {
    if (avvio.hasAttribute("data-pronta") || guastoDetto) return;
    guasto(testo("app.avvio.motivo.tempo", { phase: testo("app.startup_phase." + FASI[faseOra()]) }));
  });
})();
