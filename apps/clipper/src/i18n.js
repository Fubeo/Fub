/* Fub Clipper — i18n.js
 * Extension-local IT/EN dictionaries (classic script, no imports). The main
 * app catalogs live in apps/client/src/i18n/strings.ts (FrontendIntegration
 * owns them); this file is the clipper-side twin so the extension works
 * standalone. t(key, enFallback): ?lang=it|en override, else
 * navigator.language, else English. setLang(lang) switches at runtime.
 * applyStatic() fills [data-i18n] elements. UMD.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubI18n = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STRINGS = {
    "popup.title": { it: "Ritaglia in Fub", en: "Clip to Fub" },
    "popup.capture": { it: "Acquisizione", en: "Capture" },
    "popup.capture.article": { it: "Articolo (lettore)", en: "Article (reader)" },
    "popup.capture.selection": { it: "Selezione", en: "Selection" },
    "popup.capture.highlights": { it: "Evidenziazioni", en: "Highlights" },
    "popup.template": { it: "Modello", en: "Template" },
    "popup.template.default": { it: "Ritaglio predefinito", en: "Default clip" },
    "popup.template.hint": { it: "Importa/esporta i modelli nelle Opzioni.", en: "Import/export templates in Options." },
    "popup.title.label": { it: "Titolo", en: "Title" },
    "popup.mode": { it: "Modalità destinazione", en: "Destination mode" },
    "popup.mode.create": { it: "Nuova nota", en: "New note" },
    "popup.mode.append": { it: "Accoda alla nota", en: "Append to note" },
    "popup.mode.prepend": { it: "Preponi alla nota", en: "Prepend to note" },
    "popup.mode.daily": { it: "Nota giornaliera", en: "Daily note" },
    "popup.vault": { it: "Vault (facoltativo, confermato nell'app)", en: "Vault (optional, confirmed in app)" },
    "popup.folder": { it: "Cartella (facoltativa, relativa)", en: "Folder (optional, relative)" },
    "popup.note": { it: "Nota (facoltativa, percorso relativo)", en: "Note (optional, relative path)" },
    "popup.preview": { it: "Anteprima (Markdown)", en: "Preview (Markdown)" },
    "popup.images": { it: "Immagini", en: "Images" },
    "popup.images.none": { it: "Nessuna immagine trovata.", en: "No images found." },
    "popup.images.attach": { it: "Allega le immagini selezionate al vault abbinato (solo canale nativo, dopo consenso esplicito all'origine; nessun download automatico)", en: "Attach checked images to the paired vault (native channel only, after explicit origin grant; never fetch automatically)" },
    "popup.images.attached": { it: "allegati", en: "attached" },
    "popup.images.attach.needs_native": { it: "Immagini non scaricate né allegate: serve prima un'acquisizione nativa abbinata riuscita.", en: "Images were not fetched or attached: a paired native capture must succeed first." },
    "popup.highlights.persist": { it: "Salva le evidenziazioni per questa pagina (disattivato in partenza; ripristino quando riapri il clipper)", en: "Save highlights for this page (off by default; restored when you reopen the clipper)" },
    "popup.highlights.clear": { it: "Cancella le evidenziazioni salvate di questa pagina", en: "Clear this page's saved highlights" },
    "popup.highlights.export": { it: "Esporta evidenziazioni salvate", en: "Export saved highlights" },
    "popup.highlights.saved": { it: "Evidenziazioni salvate in locale per questa pagina.", en: "Highlights saved locally for this page." },
    "popup.highlights.cleared": { it: "Evidenziazioni cancellate per questa pagina.", en: "Highlights cleared for this page." },
    "popup.highlights.removed": { it: "Evidenziazioni salvate rimosse per questa pagina.", en: "Saved highlights removed for this page." },
    "popup.highlights.failed": { it: "Impossibile salvare o cancellare le evidenziazioni nello storage dell'estensione.", en: "Could not save or clear highlights in extension storage." },
    "popup.highlight.persisted": { it: "Evidenziazione salvata in locale anche dopo il ricaricamento.", en: "Highlight saved locally when this page reloads." },
    "popup.send": { it: "Invia a Fub", en: "Send to Fub" },
    "popup.copy": { it: "Copia JSON file", en: "Copy file JSON" },
    "popup.menu.page": { it: "Ritaglia la pagina in Fub", en: "Clip page to Fub" },
    "popup.menu.selection": { it: "Ritaglia la selezione in Fub", en: "Clip selection to Fub" },
    "popup.menu.highlight": { it: "Evidenzia la selezione (Fub)", en: "Highlight selection (Fub)" },
    "popup.transport.uri": { it: "Importazione NON autenticata: l'app Fub si è aperta — conferma vault e destinazione lì. Stesso nonce, puoi riprovare.", en: "UNAUTHENTICATED import: Fub app opened — confirm vault + destination there. Same nonce, safe to retry." },
    "popup.transport.file": { it: "Salvato — esegui `fub-cli capture --file <it>`. Stesso nonce, puoi riprovare.", en: "Saved — run `fub-cli capture --file <it>`. Same nonce, safe to retry." },
    "popup.pairing.required": { it: "Abbinamento richiesto: esegui `fub-cli pair --extension-id <id>` e riprova con lo stesso nonce.", en: "Needs pairing: run `fub-cli pair --extension-id <id>` first, then retry with the same nonce." },
    "popup.ai.title": { it: "Assistente (opt-in, disattivato in partenza)", en: "Assistant (opt-in, off by default)" },
    "popup.ai.disabled": { it: "Assistente disabilitato. Attivalo nelle Opzioni; nulla viene inviato finché non vedi l'anteprima e premi Chiedi.", en: "Assistant disabled. Enable it in Options; nothing is sent anywhere until you preview and press Ask." },
    "popup.trigger.nomatch": { it: "Il trigger del modello non corrisponde a questa pagina — mostro l'acquisizione grezza.", en: "Template trigger does not match this page — showing raw capture." },
    "popup.nodes": { it: "nodo/i", en: "node(s)" },
    "popup.structured": { it: "strutturati", en: "structured" },
    "popup.notes": { it: "note di acquisizione", en: "capture notes" },
    "popup.images.started": { it: "Download immagini avviato per", en: "Image download started for" },
    "popup.images.files": { it: "file", en: "file(s)" },
    "popup.images.save": { it: "Salva", en: "Save" },
    "popup.copied": { it: "file .fubcapture.json copiato", en: "Copied .fubcapture.json" },
    "popup.chars": { it: "caratteri", en: "chars" },
    "popup.reader": { it: "lettore", en: "reader" },
    "popup.highlight.marked": { it: "Evidenziazione marcata in questa pagina (persa al ricaricamento — acquisiscila ora con Invia o Copia).", en: "Highlight marked in this page (lost on reload — capture it with Send or Copy now)." },
    "popup.highlight.none": { it: "Nessuna selezione da evidenziare.", en: "No selection to highlight." },
    "popup.highlight.blocked": { it: "impossibile evidenziare in questa pagina", en: "cannot highlight on this page" },
    "popup.read.blocked": { it: "impossibile leggere questa pagina (lo script di contenuto è bloccato qui)", en: "could not read this page (the content script is blocked here)" },
    "popup.tab.none": { it: "nessuna scheda attiva", en: "no active tab" },
    "popup.capture.empty": { it: "nulla ancora acquisito", en: "nothing captured yet" },
    "popup.clipboard.refused": { it: "appunti rifiutati", en: "clipboard refused" },
    "popup.convert.invalid": { it: "conversione non valida", en: "invalid conversion" },
    "popup.template.invalid": { it: "modello non valido", en: "invalid template" },
    "popup.ai.local": { it: "Locale", en: "Local" },
    "popup.ai.remote": { it: "Remoto", en: "Remote" },
    "popup.ai.leaves": { it: "Il contesto LASCIERÀ il dispositivo su Chiedi — l'anteprima mostra esattamente cosa.", en: "Context WILL leave the device on Ask — preview shows exactly what." },
    "popup.ai.stays": { it: "Resta su localhost. Prima l'anteprima, poi Chiedi.", en: "Stays on localhost. Preview first, then Ask." },
    "popup.ai.ask": { it: "Chiedi", en: "Ask" },
    "popup.ai.result": { it: "Risultato (non scrive mai da solo — copia ciò che vuoi)", en: "Result (never writes automatically — copy what you want)" },
    "options.title": { it: "Fub Clipper — Opzioni", en: "Fub Clipper — Options" },
    "options.templates": { it: "Modelli", en: "Templates" },
    "options.templates.hint": { it: "Importa/esporta i modelli come JSON. I modelli portano trigger, modalità, variabili, filtri e logica limitata — mai JavaScript arbitrario.", en: "Import/export templates as JSON. Templates carry triggers, target mode, variables, filters and bounded logic — never arbitrary JavaScript." },
    "options.selectors": { it: "Selettori", en: "Selectors" },
    "options.selectors.hint": { it: "Fino a 16 selettori CSS catturati con ogni ritaglio. I selettori non validi sono segnalati, mai eseguiti come codice.", en: "Up to 16 custom CSS selectors captured with every clip. Invalid selectors are reported, never executed as code." },
    "options.ai": { it: "Assistente (opt-in)", en: "Assistant (opt-in)" },
    "options.origins": { it: "Origini consentite", en: "Allowed origins" },
    "options.origins.hint": { it: "Provider e host immagini richiedono il tuo consenso esplicito (una per riga, https://host/ — il loopback non ne ha bisogno). Le richieste verso origini non elencate sono rifiutate prima di ogni chiamata, e optional_host_permissions rispecchia questa lista così il browser chiede prima.", en: "Provider and image hosts need your explicit origin grant (one per line, https://host/ — loopback needs none). Requests to unlisted origins are refused before any network call, and optional_host_permissions mirrors this list so the browser asks first." },
    "options.origins.hint.short": { it: "Opzioni > Origini", en: "Options > Origins" },
    "options.origins.provider": { it: "Origini provider (una per riga, https; il loopback non richiede consenso)", en: "Provider origins (one per line, https; loopback needs no grant)" },
    "options.origins.save": { it: "Salva origini", en: "Save origins" },
    "options.origins.saved": { it: "Origini salvate. Richiedi il permesso browser per rispecchiarle.", en: "Origins saved. Request browser permission to mirror them." },
    "options.templates.json": { it: "modelli: JSON non valido", en: "templates: invalid JSON" },
    "options.templates.array": { it: "modelli: deve essere un array JSON", en: "templates: must be a JSON array" },
    "options.templates.saved": { it: "Modelli salvati.", en: "Templates saved." },
    "options.templates.imported": { it: "Importati — premi Convalida e salva.", en: "Imported — press Validate & save." },
    "options.selectors.json": { it: "selettori: JSON non valido", en: "selectors: invalid JSON" },
    "options.selectors.max": { it: "selettori: massimo 16 voci", en: "selectors: max 16 entries" },
    "options.selectors.required": { it: "selettore richiesto", en: "selector required" },
    "options.selectors.invalid": { it: "selettore CSS non valido", en: "invalid CSS selector" },
    "options.selectors.saved": { it: "Selettori salvati.", en: "Selectors saved." },
    "options.perms.disabled": { it: "assistente disabilitato: nessuna origine provider necessaria.", en: "assistant disabled: no provider origin needed." },
    "options.key.forgotten": { it: "Chiave API dimenticata.", en: "API key forgotten." },
    "options.storage.none": { it: "nessuno storage di estensione in questo contesto", en: "no extension storage in this context" },
    "errors.unavailable": { it: "Non disponibile", en: "Unavailable" },
    "errors.not_found": { it: "Non trovato", en: "Not found" },
    "errors.conflict": { it: "Conflitto", en: "Conflict" },
    "errors.bad_args": { it: "Richiesta non valida", en: "Bad request" },
    "errors.needs_pairing": { it: "Richiede abbinamento", en: "Needs pairing" },
    "errors.denied": { it: "Negato", en: "Denied" },
    "popup.highlight": { it: "Evidenzia selezione", en: "Highlight selection" },
    "popup.transport.native.ok": { it: "Inviato via host nativo abbinato. Stesso nonce, puoi riprovare.", en: "Sent via paired native host. Same nonce, safe to retry." },
    "options.ai.https": { it: "assistente: la base remota deve essere https://", en: "assistant: remote base URL must be https://" },
    "options.ai.saved": { it: "Impostazioni assistente salvate.", en: "Assistant settings saved." },
    "options.ai.invalid": { it: "controlla le base URL", en: "check base URLs" },
    "options.ai.preview": { it: "Mostra anteprima", en: "Preview request" },
    "options.origins.images": { it: "Origini immagini (download espliciti)", en: "Image origins (explicit downloads)" },
    "options.origins.request": { it: "Richiedi permesso browser", en: "Request browser permission" },
    "options.perms": { it: "Stato permessi", en: "Permission state" },
    "options.perms.granted": { it: "Permesso browser concesso.", en: "Browser permission granted." },
    "options.perms.declined": { it: "Permesso browser rifiutato — le richieste restano bloccate.", en: "Browser permission declined — requests stay refused." },
    "options.perms.unavailable": { it: "API permessi non disponibile qui", en: "permissions API unavailable here" }
  };

  var lang = null;

  function detect() {
    try {
      var q = typeof location !== "undefined" && location.search ? location.search : "";
      var m = /[?&]lang=(it|en)\b/.exec(q);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    try {
      var n = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
      if (/^it\b/i.test(n)) return "it";
    } catch (e2) { /* ignore */ }
    return "en";
  }

  function current() {
    if (!lang) lang = detect();
    return lang;
  }

  function setLang(l) {
    lang = l === "it" ? "it" : "en";
    try {
      if (typeof document !== "undefined") document.documentElement.lang = lang;
    } catch (e) { /* ignore */ }
    return lang;
  }

  function t(key, fallback) {
    var e = STRINGS[key];
    if (!e) return fallback !== undefined ? fallback : key;
    var l = current();
    return e[l] !== undefined ? e[l] : (fallback !== undefined ? fallback : e.en);
  }

  function applyStatic() {
    // Elements with data-i18n="key" get their text from the dictionary.
    try {
      if (typeof document === "undefined") return;
      var els = document.querySelectorAll("[data-i18n]");
      for (var i = 0; i < els.length; i++) {
        var k = els[i].getAttribute("data-i18n");
        if (k && STRINGS[k]) els[i].textContent = t(k, els[i].textContent);
      }
      document.documentElement.lang = current();
    } catch (e) { /* ignore */ }
  }

  return {
    STRINGS: STRINGS,
    current: current,
    setLang: setLang,
    t: t,
    applyStatic: applyStatic
  };
});
