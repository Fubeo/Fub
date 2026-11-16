/* Fub Clipper — keystore.js
 * Dove vive la chiave dell'assistente remoto (classic script, UMD).
 *
 * Di serie la chiave sta in `storage.session`: memoria del browser, mai su
 * disco, persa alla chiusura del browser e non esposta agli script di
 * contenuto (livello d'accesso di serie, che qui non si cambia). Solo se
 * l'utente accende «Ricorda la chiave su questo dispositivo» la chiave va in
 * `storage.local`, cioè nel profilo del browser su disco.
 *
 * Regole:
 * - mai `storage.local` di nascosto: se il browser non ha `storage.session`
 *   e la scelta è «non ricordare», il salvataggio fallisce con `no_session`
 *   e la chiave resta dov'era;
 * - una chiave già in `storage.local` (versioni vecchie) resta ricordata e
 *   la scelta appare accesa: la migrazione scrive solo la preferenza;
 * - spostando la chiave da un'area all'altra si scrive prima la nuova copia
 *   e poi si toglie la vecchia, così un errore a metà non la perde;
 * - «Dimentica» la toglie da tutte e due le aree.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubKeyStore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "fub-ai-key";
  var REMEMBER = "fub-ai-key-remember";
  var MAX_KEY = 512;

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function areas(bn) {
    var st = bn && bn.storage;
    return {
      local: (st && st.local) || null,
      session: (st && st.session) || null
    };
  }

  // Chiama un metodo di un'area con le promesse (browser.*, chrome.* MV3);
  // se il metodo non ne restituisce una, ripete la chiamata con la callback
  // (chrome.* vecchi) e legge runtime.lastError. Non si passa mai la
  // callback per prima: browser.* di Firefox rifiuta un argomento in più.
  // get, set e remove sono idempotenti, la seconda chiamata non cambia nulla.
  function call(bn, area, method, arg) {
    var p;
    try { p = area[method](arg); } catch (e) { return Promise.reject(e); }
    if (p && typeof p.then === "function") return Promise.resolve(p);
    return new Promise(function (resolve, reject) {
      try {
        area[method](arg, function (value) {
          var err = bn && bn.runtime && bn.runtime.lastError;
          if (err) reject(new Error(err.message || String(err)));
          else resolve(value);
        });
      } catch (e) { reject(e); }
    });
  }

  function cleanKey(value) {
    if (typeof value !== "string") return "";
    var k = value.trim();
    if (!k) return "";
    if (k.length > MAX_KEY) throw fail("bad_args", "key too long");
    // Una chiave finisce in un'intestazione HTTP: niente controlli né spazi.
    if (/[\s\u0000-\u001f\u007f]/.test(k)) throw fail("bad_args", "key contains spaces or control characters");
    return k;
  }

  function readArea(bn, area, keys) {
    if (!area) return Promise.resolve({});
    return call(bn, area, "get", keys).then(function (got) { return got || {}; });
  }

  // Stato senza mai restituire la chiave: per le opzioni.
  function status(bn) {
    var a = areas(bn);
    return Promise.all([readArea(bn, a.local, [KEY, REMEMBER]), readArea(bn, a.session, [KEY])]).then(function (got) {
      var local = got[0], session = got[1];
      var inLocal = typeof local[KEY] === "string" && local[KEY] !== "";
      var inSession = typeof session[KEY] === "string" && session[KEY] !== "";
      var remember = local[REMEMBER] === true || inLocal;
      var migrate = inLocal && local[REMEMBER] !== true && a.local
        ? call(bn, a.local, "set", (function () { var o = {}; o[REMEMBER] = true; return o; })())
        : Promise.resolve();
      return migrate.then(function () {
        return {
          hasKey: inLocal || inSession,
          where: inLocal ? "local" : (inSession ? "session" : null),
          remember: remember,
          sessionAvailable: !!a.session
        };
      });
    });
  }

  // La chiave per una sola richiesta: prima la sessione, poi il disco.
  function read(bn) {
    var a = areas(bn);
    return readArea(bn, a.session, [KEY]).then(function (session) {
      if (typeof session[KEY] === "string" && session[KEY]) return session[KEY];
      return readArea(bn, a.local, [KEY]).then(function (local) {
        return typeof local[KEY] === "string" && local[KEY] ? local[KEY] : null;
      });
    }, function () {
      return readArea(bn, a.local, [KEY]).then(function (local) {
        return typeof local[KEY] === "string" && local[KEY] ? local[KEY] : null;
      });
    });
  }

  // opts: { key?: string (vuota = tiene quella che c'è), remember: boolean }.
  // Restituisce lo stato nuovo (senza la chiave).
  function save(bn, opts) {
    var a = areas(bn);
    if (!a.local) return Promise.reject(fail("unavailable", "no extension storage in this context"));
    var remember = !!(opts && opts.remember === true);
    var typed;
    try { typed = cleanKey(opts && opts.key); } catch (e) { return Promise.reject(e); }
    return read(bn).then(function (current) {
      var k = typed || current || "";
      var pref = {};
      pref[REMEMBER] = remember;
      if (remember) {
        var toLocal = {};
        toLocal[REMEMBER] = true;
        if (k) toLocal[KEY] = k;
        return call(bn, a.local, "set", toLocal).then(function () {
          return a.session && k ? call(bn, a.session, "remove", KEY) : undefined;
        });
      }
      if (!k) {
        return call(bn, a.local, "set", pref);
      }
      if (!a.session) {
        return Promise.reject(fail("no_session", "this browser cannot keep the key for the session only"));
      }
      var toSession = {};
      toSession[KEY] = k;
      return call(bn, a.session, "set", toSession).then(function () {
        return call(bn, a.local, "set", pref);
      }).then(function () {
        return call(bn, a.local, "remove", KEY);
      });
    }).then(function () { return status(bn); });
  }

  // Toglie la chiave da tutte e due le aree; la preferenza resta.
  function forget(bn) {
    var a = areas(bn);
    if (!a.local && !a.session) return Promise.reject(fail("unavailable", "no extension storage in this context"));
    var jobs = [];
    if (a.local) jobs.push(call(bn, a.local, "remove", KEY));
    if (a.session) jobs.push(call(bn, a.session, "remove", KEY));
    return Promise.all(jobs).then(function () { return status(bn); });
  }

  return {
    KEY: KEY,
    REMEMBER: REMEMBER,
    MAX_KEY: MAX_KEY,
    status: status,
    read: read,
    save: save,
    forget: forget
  };
});
