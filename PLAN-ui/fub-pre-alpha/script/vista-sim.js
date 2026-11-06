// solo simulatore: la vista del simulatore v2 di Fub pre-alpha.
//
// Niente di questo file va nel codice. Prende uno stato dell'elenco
// (sim-stati.js), ne monta la cattura (sim-dati-*.js) in un iframe senza
// script, ci mette sopra il CSS nuovo dove andrà nel codice (i <style
// data-destinazione> in testa alla pagina), poi le toppe (il DOM nuovo dei
// <template data-toppa>), gli strati (le pagine dei piani dentro la cornice) e
// le scelte di Aspetto (D12 = B). Le interazioni stanno in solo-simulatore.js.
(() => {
  "use strict";
  const STATI = window.SIM_STATI;
  const GRUPPI = window.SIM_GRUPPI;
  const SCENARI = window.SIM_SCENARI;
  const PEZZI = window.SIM_PEZZI;
  const PIANI = window.SIM_PIANI;
  const $ = (id) => document.getElementById(id);
  const frame = $("sim-schermo");
  const gemelloFrame = $("sim-gemello");
  const box = $("sim-box");
  const per = new Map(STATI.map((s) => [s.id, s]));
  const pianoDi = new Map(PIANI.map((p) => [p.id, p]));
  let dati = null;
  const testi = [];
  const fontUrl = new Map();
  const scelto = { stato: "nota-riposo", luce: "light", larghezza: "piena", moto: "pieno", fuoco: false, segna: false, scenario: "", passo: 0 };
  // Le scelte di Aspetto: solo quelle toccate; le altre sono quelle di serie.
  let prefs = {};
  const storia = [];
  let giro = 0; // ogni mostra() ha il suo numero: un caricamento vecchio non scrive sul nuovo

  // ── I dati ────────────────────────────────────────────────────────────────
  const tok = (s, kind) => s.split(kind === "h" ? /(?<=>)/ : /(?<=})/);
  function testo(i) {
    if (testi[i] !== undefined) return testi[i];
    const t = dati.texts[i];
    if (typeof t === "string") return (testi[i] = t);
    const a = tok(testo(t.b), t.k);
    let out = "";
    let pos = 0;
    for (const [s, n, ins] of t.p) {
      out += a.slice(pos, s).join("") + ins;
      pos = s + n;
    }
    return (testi[i] = out + a.slice(pos).join(""));
  }
  const bytes = (b64) => {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
  };
  async function carica() {
    const parti = window.SIM_DATI_PARTI ?? [];
    const stream = new Blob(parti.map(bytes)).stream().pipeThrough(new DecompressionStream("gzip"));
    dati = JSON.parse(await new Response(stream).text());
    for (const [name, b] of dati.fonts) {
      const u = bytes(b);
      fontUrl.set(name, URL.createObjectURL(new Blob([u], { type: "font/woff2" })));
      if (name.startsWith("hanken")) {
        const face = new FontFace("Hanken Grotesk Variable", u.buffer, { weight: "100 900", style: name.endsWith("italic") ? "italic" : "normal" });
        document.fonts.add(face);
        face.load().catch(() => {});
      }
    }
  }
  const conFont = (css) => css.replace(/\/fonts\/([\w-]+)\.woff2/g, (m, n) => fontUrl.get(n) ?? m);
  // Le pagine dei piani prendono i caratteri da Google Fonts, e le loro foto
  // approvate li hanno. Senza rete (il banco, una rete che li blocca) uno
  // strato cadrebbe sul carattere di sistema: le stesse famiglie si rimandano
  // ai file del client impacchettati qui (Hanken e Newsreader variabili).
  function caratteriPiano(css) {
    return css.replace(/@font-face\s*{[^}]*}/g, (rule) => {
      if (!rule.includes("fonts.gstatic.com")) return rule;
      const fam = /font-family:\s*['"]?([^;'"]+)['"]?\s*;/.exec(rule)?.[1];
      const it = /font-style:\s*italic/.test(rule) ? "italic" : "normal";
      const w = /font-weight:\s*(\d+)/.exec(rule)?.[1] ?? "400";
      const scelte = {
        "Hanken Grotesk": [`hanken-grotesk-latin-wght-${it}`],
        Newsreader: [`newsreader-latin-opsz-${it}`],
        "IBM Plex Mono": [`ibm-plex-mono-latin-${w}-${it}`, `ibm-plex-mono-latin-400-${it}`, "ibm-plex-mono-latin-400-normal"],
      }[fam] ?? [];
      const u = scelte.map((n) => fontUrl.get(n)).find(Boolean);
      return u ? rule.replace(/src:[^;]*;/, `src: url(${u}) format("woff2");`) : rule;
    });
  }
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const attr = (pairs) => pairs.map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  const stile = (css, label, media = "") => `<style data-proto="${esc(label)}"${media ? ` media="${esc(media)}"` : ""}>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  const blocco = (sel) => [...document.querySelectorAll(sel)].map((s) => s.textContent).join("\n");
  const statoDi = (id) => per.get(id);
  const capDi = (id, luce) => dati.caps[`${id}-${luce}`];

  // ── Aspetto (D12 = B) ─────────────────────────────────────────────────────
  // Le stesse variabili che scrive theme/theme.ts (preferenceTokens) e le
  // stesse tavolozze della ricetta (temi-sim.mjs le calcola dal client).
  const PILE = {
    newsreader: '"Newsreader Variable", Georgia, "Times New Roman", serif',
    hanken: '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    literata: '"Literata Variable", Georgia, "Times New Roman", serif',
    inter: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  };
  // I valori di serie sono quelli del codice (series.ts, letti da temi-sim.mjs)
  // con le due correzioni di S2 T11 (blocchi/01-series.css: corpo 18, misura 58),
  // che lo schermo già mostra col blocco nuovo:serie.
  const SERIE_S2 = { body: 18, measure: 58 };
  const serie = () => ({ ...dati.temi.predefiniti, ...SERIE_S2, contrast: "normal", zoom: 100, tema: null });
  const val = (k) => (prefs[k] !== undefined ? prefs[k] : serie()[k]);
  const contrasto = () => (val("contrast") === "high" ? "high" : "normal");
  const temaDi = (s) => (s?.tema ?? val("tema")) || null;
  // Lo spazio dell'interfaccia viene da measures.ts del client delle catture
  // (ispettore da 300 a 260). S2 T9 porta la riga a `["inspector-w", 264, 216]`:
  // il simulatore ricalcola quel token ai passi 1–4 come chromeMeasure(), e lo
  // corregge anche nello stile fub:preferenze delle catture prese a un passo.
  const ISPETTORE_S2 = [264, 216];
  const ispettoreS2 = (passo) => `${Math.round(ISPETTORE_S2[0] + ((ISPETTORE_S2[1] - ISPETTORE_S2[0]) * passo) / 4)}px`;
  const compattezzaS2 = (passo) => (passo > 0 ? { ...dati.temi.compattezza[passo], "inspector-w": ispettoreS2(passo) } : {});
  function preferenzeS2(css) {
    const vecchi = dati.temi.compattezza.map((t) => t["inspector-w"]);
    return css.replace(/--inspector-w:\s*(\d+px);/, (m, px) => {
      const passo = vecchi.indexOf(px);
      return passo > 0 ? `--inspector-w: ${ispettoreS2(passo)};` : m;
    });
  }
  function cssAspetto(luce) {
    const T = dati.temi;
    const v = {};
    const metti = (o) => Object.entries(o ?? {}).forEach(([k, x]) => (v[k.startsWith("--") ? k : `--${k}`] = x));
    if (prefs.density !== undefined && prefs.density !== "comfortable") metti(T.densita[prefs.density]);
    if (prefs.compactness !== undefined) metti(compattezzaS2(prefs.compactness));
    if (prefs.accent !== undefined) {
      const h = ((Math.round(prefs.accent / 5) * 5) % 360 + 360) % 360;
      metti(T.accenti[`${luce}:${contrasto()}:${h}`]);
    }
    if (prefs.body !== undefined) v["--text-reading"] = `${prefs.body}px`;
    if (prefs.lineHeight !== undefined) v["--leading-relaxed"] = String(prefs.lineHeight);
    if (prefs.measure !== undefined) v["--content-width"] = `${prefs.measure}ch`;
    if (prefs.font !== undefined) v["--font-reading"] = PILE[prefs.font] ?? PILE.newsreader;
    const righe = Object.entries(v).map(([k, x]) => `${k}: ${x};`);
    if (prefs.zoom !== undefined && prefs.zoom !== 100) righe.push(`zoom: ${prefs.zoom / 100};`);
    return righe.length ? `:root { ${righe.join(" ")} }` : "";
  }
  const cssTema = (tema, luce) => (tema && !(tema === "carta" && luce === "dark") ? blocco(`style[data-posto="tema"][data-tema="${tema}"]`) : "");
  // Le scelte cambiano lo schermo senza ricaricarlo (il cursore dello
  // scorrimento resta dov'è); la luce invece cambia cattura e ricarica.
  function applicaAspetto(doc, luce = scelto.luce, s = statoDi(scelto.stato)) {
    if (!doc) return;
    const set = (label, text) => {
      const st = doc.querySelector(`style[data-proto="${label}"]`);
      if (st && st.textContent !== text) st.textContent = text;
    };
    set("solo-simulatore:aspetto", cssAspetto(luce));
    set("solo-simulatore:tema", cssTema(temaDi(s), luce));
    const foglio = doc.querySelector('style[data-proto="fub:foglio"]');
    if (foglio) {
      foglio.__serie ??= foglio.textContent;
      set("fub:foglio", contrasto() === "high" ? dati.temi.fogli[luce].high : foglio.__serie);
    }
    doc.documentElement.setAttribute("data-contrast", contrasto());
    if (temaDi(s)) doc.documentElement.setAttribute("data-sim-tema", temaDi(s));
    else doc.documentElement.removeAttribute("data-sim-tema");
  }

  // ── Il documento dello schermo ────────────────────────────────────────────
  const VISTA_CSS = `
[data-sim-velo] { visibility: hidden !important; }
iframe[data-sim-strato] { position: fixed; border: 0; margin: 0; padding: 0; background: transparent; }
html[data-sim-segna] [data-sim-toppa] { outline: 2px dashed #d0367a !important; outline-offset: 2px; }
html[data-sim-segna] [data-sim-composto], html[data-sim-segna] iframe[data-sim-strato] { outline: 2px dashed #1d7a46 !important; outline-offset: -2px; }
`;
  const POSTI = { struttura: "src/theme/scrittoio/structure.css", pelle: "fub:pelle", telefono: "src/shells/scrittoio/mobile/mobile.css" };
  // Al telefono, dove la cattura non c'è, lo stato si ricompone: gli attributi
  // e il CSS del guscio mobile vengono da t-cestino, il DOM perde i cassetti.
  function cssTelefono(c, luce) {
    const tc = capDi(window.SIM_TEL_CSS, luce).c;
    const dalTel = (label) => tc.find(([l]) => l === label);
    const out = [...c];
    const kit = out.findIndex(([l]) => l === "src/kit/kit.css");
    const mob = dalTel("src/shells/mobile/mobile.css");
    if (mob && !out.some(([l]) => l === mob[0])) out.splice(kit + 1, 0, mob);
    const smob = dalTel("src/shells/scrittoio/mobile/mobile.css");
    if (smob && !out.some(([l]) => l === smob[0])) {
      const f = out.findIndex(([l]) => l.startsWith("fub:"));
      out.splice(f < 0 ? out.length : f, 0, smob);
    }
    return out;
  }
  function attrsTelefono(a, luce) {
    const ta = capDi(window.SIM_TEL_CSS, luce).a;
    const tieni = new Set(["data-theme", "data-contrast", "data-bench"]);
    return [...ta.filter(([k]) => !tieni.has(k)), ...a.filter(([k]) => tieni.has(k))];
  }
  function documento(cap, o) {
    const { luce, strato = false, tel = false, s = null } = o;
    let head = '<meta charset="utf-8">';
    let attrs = cap.a.filter(([k]) => k !== "data-motion");
    if (scelto.moto === "calmo") attrs.push(["data-motion", "calm"]);
    if (scelto.moto === "ridotto") attrs.push(["data-motion", "reduced"]);
    if (strato) {
      for (const [label, media, i] of cap.c) head += stile(caratteriPiano(conFont(testo(i))), label, media);
      return `<!doctype html><html${attr(attrs)}><head>${head}<title>${esc(cap.t)}</title></head><body${attr(cap.ba)}>${testo(cap.b)}</body></html>`;
    }
    const c = tel ? cssTelefono(cap.c, luce) : cap.c;
    if (tel) attrs = attrsTelefono(attrs, luce);
    const nuovo = (posto) => blocco(`style[data-posto="${posto}"]`);
    const messi = new Set();
    const dopo = (label) => {
      let h = "";
      if (label === POSTI.struttura) (h += stile(nuovo("struttura"), "nuovo:struttura")), messi.add("struttura");
      if (label === POSTI.pelle) (h += stile(nuovo("pelle"), "nuovo:pelle") + stile(nuovo("prealpha"), "nuovo:prealpha")), messi.add("pelle");
      if (label === POSTI.telefono) (h += stile(nuovo("telefono"), "nuovo:telefono")), messi.add("telefono");
      return h;
    };
    for (const [label, media, i] of c) {
      const text = label === "fub:foglio" && contrasto() === "high" ? dati.temi.fogli[luce].high : label === "fub:preferenze" ? preferenzeS2(testo(i)) : testo(i);
      head += stile(conFont(text), label, media) + dopo(label);
    }
    if (!messi.has("struttura")) head += stile(nuovo("struttura"), "nuovo:struttura");
    if (!messi.has("pelle")) head += stile(nuovo("pelle"), "nuovo:pelle") + stile(nuovo("prealpha"), "nuovo:prealpha");
    if (!messi.has("telefono")) head += stile(nuovo("telefono"), "nuovo:telefono");
    head += stile(nuovo("serie"), "nuovo:serie");
    head += stile(cssTema(temaDi(s), luce), "solo-simulatore:tema");
    head += stile(cssAspetto(luce), "solo-simulatore:aspetto");
    head += stile(VISTA_CSS, "solo-simulatore:vista");
    head += stile(window.SIM_INTERAZIONI?.css ?? "", "solo-simulatore");
    attrs = attrs.filter(([k]) => k !== "data-contrast");
    attrs.push(["data-contrast", contrasto()]);
    return `<!doctype html><html${attr(attrs)}><head>${head}<title>${esc(cap.t)}</title></head><body${attr(cap.ba)}>${testo(cap.b)}</body></html>`;
  }

  // Le figure del banco (canvas fotografati), gli stili in linea salvati come
  // data-proto-style e lo scorrimento tornano al loro posto.
  // filter porta la luce scura del PDF (pdf-view.ts, DARK_FILTER in linea sul canvas).
  const MISURE = ["display", "position", "top", "right", "bottom", "left", "width", "height", "min-height", "margin", "border-radius", "box-shadow", "background-color", "z-index", "pointer-events", "filter", "opacity", "transform"];
  function ripristina(doc, dentro = doc) {
    for (const el of dentro.querySelectorAll("[data-proto-style]")) el.setAttribute("style", el.getAttribute("data-proto-style"));
    if (dentro.nodeType === 1 && dentro.hasAttribute("data-proto-style")) dentro.setAttribute("style", dentro.getAttribute("data-proto-style"));
    if (dentro === doc) {
      const r = doc.documentElement;
      if (r.hasAttribute("data-proto-style")) r.setAttribute("style", r.getAttribute("data-proto-style"));
    }
    const tele = [...dentro.querySelectorAll("canvas[data-proto-src]")].map((c) => {
      const cs = doc.defaultView.getComputedStyle(c);
      const img = doc.createElement("img");
      for (const a of c.attributes) if (!["data-proto-src", "width", "height", "style"].includes(a.name)) img.setAttribute(a.name, a.value);
      if (!img.hasAttribute("aria-label")) img.alt = "";
      img.setAttribute("style", MISURE.map((k) => `${k}: ${cs.getPropertyValue(k)}`).join("; "));
      img.src = c.getAttribute("data-proto-src");
      c.replaceWith(img);
      return img.decode().catch(() => {});
    });
    scorri(dentro);
    return Promise.all(tele);
  }
  function segni(doc) {
    for (const ind of doc.querySelectorAll(".kit-tab-indicator:not([hidden])")) {
      const fila = ind.parentElement;
      const scelta = fila.querySelector(':scope > .kit-tab[aria-selected="true"]');
      if (!scelta) continue;
      if (fila.getAttribute("aria-orientation") === "vertical") {
        ind.style.top = `${scelta.offsetTop}px`;
        ind.style.height = `${scelta.offsetHeight}px`;
      } else {
        ind.style.left = `${scelta.offsetLeft}px`;
        ind.style.width = `${scelta.offsetWidth}px`;
      }
    }
  }
  function scorri(dentro) {
    for (const el of dentro.querySelectorAll("[data-proto-scroll]")) {
      const [x, y] = el.getAttribute("data-proto-scroll").split(",").map(Number);
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
  // Porta in vista a mano: scrollIntoView muoverebbe anche body, che nel
  // client non scorre mai.
  function portaInVista(el) {
    const win = el.ownerDocument.defaultView;
    for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
      const oy = win.getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) {
        p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 16;
        return;
      }
    }
  }
  const visibile = (el) => !el.disabled && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0);

  // ── Le catture come sorgente di pezzi ─────────────────────────────────────
  const parsati = new Map();
  function catturaDoc(base, luce = scelto.luce) {
    const key = `${base}-${luce}`;
    if (!parsati.has(key)) {
      const cap = dati.caps[key];
      if (!cap) return null;
      parsati.set(key, new DOMParser().parseFromString(`<!doctype html><html><body>${testo(cap.b)}</body></html>`, "text/html"));
    }
    return parsati.get(key);
  }
  function pezzo(doc, base, sel, luce = scelto.luce) {
    const src = catturaDoc(base, luce);
    const el = src?.querySelector(sel);
    if (!el) return null;
    const cap = capDi(base, luce);
    const hanno = new Set([...doc.querySelectorAll("style[data-proto]")].map((s) => s.getAttribute("data-proto")));
    const prima = doc.querySelector('style[data-proto="nuovo:serie"]');
    for (const [label, media, i] of cap.c) {
      if (!label || hanno.has(label) || !prima) continue;
      const s = doc.createElement("style");
      s.setAttribute("data-proto", label);
      if (media) s.media = media;
      s.textContent = conFont(testo(i));
      prima.before(s);
    }
    const clone = doc.importNode(el, true);
    ripristina(doc, clone);
    return clone;
  }
  const modello = (id) => document.querySelector(`#sim-toppe template[data-toppa="${CSS.escape(id)}"]`);

  // ── Le toppe ──────────────────────────────────────────────────────────────
  function setTesto(el, t) {
    const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let primo = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement?.closest("svg, style, script")) continue;
      if (!n.textContent.trim()) continue;
      if (!primo) {
        primo = n;
        n.textContent = n.textContent.replace(/\S[\s\S]*\S|\S/, t);
      } else n.textContent = "";
    }
    if (!primo) el.append(el.ownerDocument.createTextNode(t));
  }
  // Applica una toppa a `d`; rende gli elementi messi (per l'ancora) o null.
  function applicaToppa(d, t, luce, manca) {
    const tutti = [...d.querySelectorAll(t.dove)];
    if (!tutti.length) {
      manca.push(`toppa${t.html ? ` «${t.html}»` : t.da ? ` da ${t.da}` : ""}: «${t.dove}» non c'è`);
      return null;
    }
    const bers = t.tutte ? tutti : tutti.slice(0, 1);
    if (t.testi) {
      tutti.forEach((el, i) => i < t.testi.length && setTesto(el, t.testi[i]));
      return null;
    }
    const messi = [];
    for (const el of bers) {
      if (t.rimuovi) el.remove();
      else if (t.attr) for (const [k, v] of Object.entries(t.attr)) v === null ? el.removeAttribute(k) : el.setAttribute(k, v);
      else if (t.classe) for (const c of t.classe.split(/\s+/).filter(Boolean)) c[0] === "-" ? el.classList.remove(c.slice(1)) : el.classList.add(c.replace(/^\+/, ""));
      else if (t.testo !== undefined) setTesto(el, t.testo);
      else if (t.come) {
        let frag;
        if (t.html) {
          const tpl = modello(t.html);
          if (!tpl) {
            manca.push(`toppa «${t.html}»: il modello non c'è`);
            continue;
          }
          frag = d.importNode(tpl.content, true);
          for (const n of frag.children) n.setAttribute("data-sim-toppa", t.html);
        } else if (t.da) {
          const p = pezzo(d, t.da, t.sel, luce);
          if (!p) {
            manca.push(`pezzo «${t.sel}» di ${t.da}: non c'è`);
            continue;
          }
          p.setAttribute("data-sim-composto", t.da);
          frag = d.createDocumentFragment();
          frag.append(p);
        } else continue;
        const nuovi = [...frag.children];
        ripristina(d, frag);
        ({ dentro: () => el.append(frag), inizio: () => el.prepend(frag), prima: () => el.before(frag), dopo: () => el.after(frag), sostituisci: () => el.replaceWith(frag), vuota: () => el.replaceChildren(frag) })[t.come]?.();
        messi.push(...nuovi);
      }
    }
    if (t.scorri) {
      const el = messi[0] ?? (bers[0]?.isConnected ? bers[0] : null);
      if (el) portaInVista(el);
    }
    return messi;
  }
  function rettangolo(doc, sel, strati) {
    if (sel.startsWith("strato:")) {
      const ifr = strati[0];
      const el = ifr?.contentDocument?.querySelector(sel.slice(7));
      if (!el) return null;
      const a = el.getBoundingClientRect();
      const f = ifr.getBoundingClientRect();
      return { left: a.left + f.left, top: a.top + f.top, right: a.right + f.left, bottom: a.bottom + f.top, width: a.width, height: a.height };
    }
    const el = [...doc.querySelectorAll(sel)].find(visibile);
    return el ? el.getBoundingClientRect() : null;
  }
  function ancora(doc, el, a, lato) {
    const win = doc.defaultView;
    el.style.position = "fixed";
    el.style.zIndex = "60";
    el.style.margin = "0";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    const r = el.getBoundingClientRect();
    let x;
    let y;
    if (lato === "sopra") (x = a.left + a.width / 2 - r.width / 2), (y = a.top - r.height - 8);
    else if (lato === "destra") (x = a.right + 8), (y = a.top);
    else if (lato === "dentro") (x = a.left + 16), (y = a.top + 40);
    else (x = a.left), (y = a.bottom + 6);
    el.style.left = `${Math.round(Math.max(4, Math.min(x, win.innerWidth - r.width - 4)))}px`;
    el.style.top = `${Math.round(Math.max(4, Math.min(y, win.innerHeight - r.height - 4)))}px`;
  }

  // ── Gli strati: la pagina di un piano dentro la cornice ───────────────────
  function montaStrato(doc, st, luce, manca, stato) {
    const cap = capDi(st.cattura, luce);
    const win = doc.defaultView;
    let r;
    let host = null;
    if (st.sopra) r = { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
    else {
      host = [...doc.querySelectorAll(st.dove)].find(visibile);
      if (!host) {
        manca.push(`strato ${st.cattura}: «${st.dove}» non c'è`);
        return null;
      }
      const hr = host.getBoundingClientRect();
      let top = hr.top;
      let bottom = hr.bottom;
      const figli = [...host.children];
      const figlioCon = (sel) => {
        const el = sel ? host.querySelector(sel) : null;
        return el && visibile(el) ? figli.find((f) => f === el || f.contains(el)) : null;
      };
      const d = figlioCon(st.dopo);
      const p = figlioCon(st.prima);
      if (d) top = d.getBoundingClientRect().bottom;
      if (p) bottom = p.getBoundingClientRect().top;
      const da = d ? figli.indexOf(d) + 1 : 0;
      const a = p ? figli.indexOf(p) : figli.length;
      for (const f of figli.slice(da, a)) f.setAttribute("data-sim-velo", "");
      r = { left: hr.left, top, width: hr.width, height: Math.max(0, bottom - top) };
    }
    const ifr = doc.createElement("iframe");
    ifr.setAttribute("data-sim-strato", st.cattura);
    ifr.setAttribute("title", `La pagina del piano: ${st.cattura}`);
    ifr.setAttribute("sandbox", "allow-same-origin");
    ifr.style.left = `${r.left}px`;
    ifr.style.top = `${r.top}px`;
    ifr.style.width = `${r.width}px`;
    ifr.style.height = `${r.height}px`;
    ifr.style.zIndex = st.sopra ? "1000" : "5";
    ifr.style.colorScheme = luce;
    return new Promise((fatto) => {
      ifr.addEventListener("load", () => {
        const sd = ifr.contentDocument;
        if (!sd) return fatto(ifr);
        ifr.style.colorScheme = sd.defaultView.getComputedStyle(sd.documentElement).colorScheme || luce;
        Promise.all([ripristina(sd), sd.fonts.ready]).then(() => {
          segni(sd);
          const piano = pianoDi.get(stato.piano);
          const spiega = () => ({
            esito: "avviso-specifico",
            dettaglio: piano
              ? `Questa parte è la pagina del piano «${piano.nome}» (${piano.piano} ${piano.task}), fotografata: nel simulatore non si muove. La pagina viva è in piani/${piano.file}.`
              : "Questa parte è la pagina di un piano, fotografata: nel simulatore non si muove.",
          });
          sd.__simDecidi = spiega;
          sd.addEventListener("click", (e) => {
            e.preventDefault();
            api.avviso(spiega().dettaglio);
          });
          fatto(ifr);
        });
      }, { once: true });
      ifr.srcdoc = documento(cap, { luce, strato: true });
      doc.body.append(ifr);
    });
  }

  // ── Gli stati forzati (gemelli: true): :hover e compagni come attributo ───
  function forza(doc) {
    const sost = (sel) =>
      sel
        .replace(/:hover\b/g, '[data-force="hover"]')
        .replace(/:focus-visible\b/g, '[data-force="focus"]')
        .replace(/:focus(?![-\w])/g, '[data-force="focus"]')
        .replace(/:active\b/g, '[data-force="active"]');
    const giro = (lista) => {
      for (let i = 0; i < lista.cssRules.length; i += 1) {
        const r = lista.cssRules[i];
        if (r.cssRules && !(r instanceof CSSStyleRule)) {
          giro(r);
          continue;
        }
        if (!(r instanceof CSSStyleRule) || !/:(hover|focus|active)/.test(r.selectorText)) continue;
        const nuovo = sost(r.selectorText);
        if (nuovo === r.selectorText) continue;
        try {
          lista.insertRule(`${nuovo} { ${r.style.cssText} }`, i + 1);
          i += 1;
        } catch {}
      }
    };
    for (const sh of doc.styleSheets) {
      try {
        giro(sh);
      } catch {}
    }
  }

  // ── La risoluzione: che cattura, a che misura, con che cosa sopra ─────────
  function risolvi(s, larghezza) {
    if (s.telefono) return { cap: s.cap, ricomposta: null, strati: [], toppe: [], rigoroso: true };
    if (larghezza === "piena") return { cap: s.cap, ricomposta: null, strati: s.strati, toppe: s.toppe, rigoroso: true };
    const w = larghezza === "700" ? s.w700 : s.tel;
    if (w) return { cap: w.cap, ricomposta: null, strati: w.toppe ? s.strati : [], toppe: w.toppe ? s.toppe : [], rigoroso: !w.toppe, esatta: !w.toppe };
    return { cap: s.cap, ricomposta: larghezza, strati: s.strati, toppe: s.toppe, rigoroso: false };
  }
  // Ricomposta al telefono: il DOM del guscio compatto.
  function domTelefono(doc) {
    doc.getElementById("topbar")?.classList.add("topbar-compact-menu", "topbar-compact-hint", "topbar-compact-search");
    doc.getElementById("layout")?.classList.add("layout-compact");
    for (const id of ["sidebar", "right-pane"]) doc.getElementById(id)?.setAttribute("hidden", "");
    doc.getElementById("rail")?.setAttribute("data-drawer", "closed");
    for (const d of doc.querySelectorAll(".layout-divider")) d.setAttribute("hidden", "");
  }

  // Monta uno stato in un iframe; rende { doc, manca, strati }.
  function monta(ifr, s, larghezza, luce, mio) {
    const r = risolvi(s, larghezza);
    const cap = capDi(r.cap, luce);
    const v = r.ricomposta === "700" ? { w: 700, h: 800 } : r.ricomposta === "tel" ? { w: 390, h: 844 } : cap.v;
    ifr.width = String(v.w);
    ifr.height = String(v.h);
    return new Promise((fatto) => {
      ifr.onload = async () => {
        const doc = ifr.contentDocument;
        if (!doc || mio !== giro) return;
        const manca = [];
        await Promise.all([ripristina(doc), doc.fonts.ready]);
        if (mio !== giro) return;
        if (r.ricomposta === "tel") domTelefono(doc);
        // Una toppa semplice che non trova il suo posto riprova dopo quelle
        // ancorate: può toccare un pezzo che una di loro mette.
        const semplici = r.toppe.filter((t) => !t.in && !t.ancora);
        const ancorate = r.toppe.some((t) => t.ancora && !t.in);
        const dopo = [];
        for (const t of semplici) {
          const m = [];
          applicaToppa(doc, t, luce, m);
          if (m.length && ancorate) dopo.push(t);
          else manca.push(...m);
        }
        const strati = [];
        for (const st of r.strati) {
          const ifs = await montaStrato(doc, st, luce, manca, s);
          if (mio !== giro) return;
          if (ifs) strati.push(ifs);
        }
        for (const t of r.toppe.filter((t) => t.in === "strato")) {
          const sd = strati[0]?.contentDocument;
          if (sd) applicaToppa(sd, t, luce, manca);
          else manca.push(`toppa nello strato: lo strato non c'è (${t.dove})`);
        }
        for (const t of r.toppe.filter((t) => t.ancora && !t.in)) {
          const messi = applicaToppa(doc, t, luce, manca) ?? [];
          const a = rettangolo(doc, t.ancora, strati);
          if (!a) manca.push(`ancora «${t.ancora}» non c'è`);
          else for (const el of messi.slice(0, 1)) ancora(doc, el, a, t.lato);
        }
        for (const t of dopo) applicaToppa(doc, t, luce, manca);
        segni(doc);
        if (s.gemelli === true) forza(doc);
        doc.documentElement.toggleAttribute("data-sim-segna", scelto.segna);
        if (manca.length) doc.documentElement.dataset.simManca = manca.join(" | ");
        fatto({ doc, manca, strati, r, v });
      };
      ifr.srcdoc = documento(cap, { luce, tel: r.ricomposta === "tel", s });
    });
  }

  // ── La scala ──────────────────────────────────────────────────────────────
  let scalaOra = 1;
  let misura = { w: 1280, h: 800 };
  function scala(gemelli = !box.hasAttribute("data-solo")) {
    const main = box.parentElement;
    const cs = getComputedStyle(main);
    const avail = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const n = gemelli ? 2 : 1;
    const gap = gemelli ? 16 : 0;
    scalaOra = Math.min(1, (avail - gap) / (misura.w * n));
    $("sim-scala").textContent = `#sim-schermo, #sim-gemello { transform: scale(${scalaOra}); } .sim-vetro { width: ${Math.round(misura.w * scalaOra)}px; height: ${Math.round(misura.h * scalaOra)}px; }`;
  }

  // ── I messaggi e i pezzi ──────────────────────────────────────────────────
  let msgTimer = 0;
  function avviso(t) {
    $("sim-msg").textContent = t;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => ($("sim-msg").textContent = ""), 7000);
  }
  // Il DOM da copiare: senza gli attributi del banco e senza le figure in linea.
  function pulito(el) {
    const c = el.cloneNode(true);
    for (const n of [c, ...c.querySelectorAll("*")]) {
      for (const a of [...n.attributes]) if (a.name.startsWith("data-proto") || a.name.startsWith("data-sim") || a.name === "style") n.removeAttribute(a.name);
    }
    return c.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg>…</svg>").replace(/></g, ">\n<");
  }
  function segna(el) {
    const r = el.getBoundingClientRect();
    // Dentro uno strato le misure sono dello strato: si aggiunge la sua posizione.
    let f = el.ownerDocument.defaultView.frameElement;
    let off = { left: 0, top: 0 };
    if (f?.hasAttribute("data-sim-strato")) {
      off = f.getBoundingClientRect();
      f = f.ownerDocument.defaultView.frameElement;
    }
    const fr = (f ?? frame).getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const s = $("sim-segno");
    s.style.left = `${fr.left - br.left + (r.left + off.left) * scalaOra - 3}px`;
    s.style.top = `${fr.top - br.top + (r.top + off.top) * scalaOra - 3}px`;
    s.style.width = `${r.width * scalaOra + 6}px`;
    s.style.height = `${r.height * scalaOra + 6}px`;
    s.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => (s.hidden = true), 2200);
  }
  function rigaPezzo(ul, { nome, come, task, dest, el, link }) {
    const li = document.createElement("li");
    const testa = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = nome;
    const c = document.createElement("span");
    c.className = "sim-come";
    c.dataset.come = come;
    c.textContent = come;
    testa.append(b, " ", c);
    if (task) {
      const t = document.createElement("span");
      t.className = "sim-task";
      t.textContent = task;
      testa.append(" ", t);
    }
    const azioni = document.createElement("span");
    const indica = document.createElement("button");
    indica.type = "button";
    indica.textContent = "Indica";
    indica.addEventListener("click", () => segna(el));
    azioni.append(indica);
    const pre = document.createElement("pre");
    pre.hidden = true;
    if (!link) {
      const mostraDom = document.createElement("button");
      mostraDom.type = "button";
      mostraDom.textContent = "DOM";
      mostraDom.setAttribute("aria-expanded", "false");
      mostraDom.addEventListener("click", () => {
        pre.hidden = !pre.hidden;
        mostraDom.setAttribute("aria-expanded", String(!pre.hidden));
        if (!pre.hidden) pre.textContent = pulito(el);
      });
      azioni.append(" ", mostraDom);
    }
    const d = document.createElement("span");
    d.className = "sim-dest";
    if (link) {
      const a = document.createElement("a");
      a.href = link;
      a.textContent = dest;
      d.append(a);
    } else d.textContent = dest;
    li.append(testa, azioni, d, pre);
    ul.append(li);
  }
  function aggiornaPezzi(doc, strati) {
    const ul = $("sim-pezzi");
    ul.replaceChildren();
    for (const el of doc.querySelectorAll("[data-sim-toppa]")) {
      const tpl = modello(el.getAttribute("data-sim-toppa"));
      const commento = tpl ? [...tpl.content.childNodes].find((n) => n.nodeType === 8)?.textContent.trim().replace(/^→\s*/, "") ?? "" : "";
      // Il commento è «→ destinazione; task»: il task dopo l'ultimo «; ».
      const i = commento.lastIndexOf("; ");
      const dest = i < 0 ? commento : commento.slice(0, i);
      const task = i < 0 ? "" : commento.slice(i + 2);
      rigaPezzo(ul, { nome: tpl?.dataset.nome ?? el.getAttribute("data-sim-toppa"), come: "nuovo", task, dest, el });
    }
    for (const el of doc.querySelectorAll("[data-sim-composto]")) {
      rigaPezzo(ul, { nome: `Un pezzo della cattura «${el.getAttribute("data-sim-composto")}»`, come: "composto", task: "", dest: "DOM del client vero, spostato qui dal simulatore", el });
    }
    for (const ifr of strati) {
      const id = ifr.getAttribute("data-sim-strato");
      const s = statoDi(scelto.stato);
      const p = pianoDi.get(s.piano);
      rigaPezzo(ul, { nome: p ? `La pagina del piano «${p.nome}»` : `Lo strato ${id}`, come: "composto", task: p ? `${p.piano} ${p.task}` : "", dest: p ? `piani/${p.file} (${p.ok}) · scena ${id}` : id, el: ifr, link: p ? `piani/${p.file}` : null });
    }
    for (const p of PEZZI) {
      const el = [...doc.querySelectorAll(p.sel)].find(visibile);
      if (!el || el.closest("[data-sim-toppa]")) continue;
      rigaPezzo(ul, { nome: p.nome, come: p.come, task: p.task, dest: `${p.dest} · ${p.sel}`, el });
    }
    $("sim-pezzi-vuoto").hidden = ul.children.length > 0;
  }

  // ── Revisione: «approvo tutto tranne S23» ─────────────────────────────────
  const CHIAVE = "fub-prealpha-sim-rivedere";
  let rivedere = new Set();
  try {
    rivedere = new Set(JSON.parse(localStorage.getItem(CHIAVE) ?? "[]"));
  } catch {}
  const salvaRivedere = () => {
    try {
      localStorage.setItem(CHIAVE, JSON.stringify([...rivedere]));
    } catch {}
  };
  const daApprovare = STATI.filter((s) => s.prov !== "cattura");
  function frase() {
    const no = daApprovare.filter((s) => rivedere.has(s.id)).sort((a, b) => a.n - b.n).map((s) => `S${s.n}`);
    return no.length ? `Approvo tutti gli stati nuovi e composti tranne ${no.join(", ")}.` : "Approvo tutti gli stati nuovi e composti.";
  }
  function aggiornaRevisione() {
    $("sim-frase").value = frase();
    for (const c of document.querySelectorAll("#sim-revisione input[type=checkbox]")) c.checked = rivedere.has(c.value);
    const b = $("sim-rivedi");
    const s = statoDi(scelto.stato);
    b.hidden = s.prov === "cattura";
    b.setAttribute("aria-pressed", String(rivedere.has(s.id)));
    $("sim-conta-rivedere").textContent = String(daApprovare.filter((x) => rivedere.has(x.id)).length);
  }
  function costruisciRevisione() {
    const ul = $("sim-revisione");
    for (const s of daApprovare) {
      const li = document.createElement("li");
      const lab = document.createElement("label");
      const c = document.createElement("input");
      c.type = "checkbox";
      c.value = s.id;
      c.addEventListener("change", () => {
        c.checked ? rivedere.add(s.id) : rivedere.delete(s.id);
        salvaRivedere();
        aggiornaRevisione();
      });
      const a = document.createElement("a");
      a.href = `#stato=${encodeURIComponent(s.id)}`;
      a.textContent = `S${s.n} · ${s.nome}`;
      const p = document.createElement("span");
      p.className = "sim-prov";
      p.dataset.prov = s.prov;
      p.textContent = s.prov === "nuova" ? "nuova" : "composta";
      lab.append(c, " da rivedere");
      li.append(a, " ", p, " ", lab);
      ul.append(li);
    }
  }

  // ── Gli scenari ───────────────────────────────────────────────────────────
  const scenario = () => SCENARI.find((x) => x.id === scelto.scenario) ?? null;
  function vaiPasso(k) {
    const sc = scenario();
    if (!sc) return;
    scelto.passo = Math.max(0, Math.min(sc.passi.length - 1, k));
    const p = sc.passi[scelto.passo];
    scelto.stato = p.stato;
    scelto.luce = p.luce ?? "light";
    scelto.larghezza = p.larghezza ?? "piena";
    prefs = { ...(p.prefs ?? {}) };
    storia.length = 0;
    sincronizza();
    mostra();
  }
  function aggiornaScenario() {
    const sc = scenario();
    $("sim-passi").hidden = !sc;
    if (!sc) return;
    const p = sc.passi[scelto.passo];
    $("sim-passo-n").textContent = `Passo ${scelto.passo + 1} di ${sc.passi.length}`;
    $("sim-passo-dice").textContent = p.dice;
    $("sim-passo-prima").disabled = scelto.passo === 0;
    $("sim-passo-dopo").disabled = scelto.passo === sc.passi.length - 1;
    $("sim-passo-fuori").hidden = p.stato === scelto.stato;
  }

  // ── L'API per solo-simulatore.js ──────────────────────────────────────────
  let docOra = null;
  const api = {
    get scelto() {
      return scelto;
    },
    get prefs() {
      return prefs;
    },
    val,
    serie,
    temi: () => dati.temi,
    dati: () => dati,
    statoDi,
    esiste: (id) => per.has(id),
    vai(id, { storia: tieni = true } = {}) {
      if (!per.has(id)) return avviso(`Lo stato «${id}» non c'è nel simulatore.`);
      if (tieni && id !== scelto.stato) storia.push(scelto.stato);
      scelto.stato = id;
      sincronizza();
      mostra();
    },
    // Senza storia si torna alla «casa» dello stato (il foglio per un dialogo
    // del foglio), non sempre alla nota.
    // La storia può tenere lo stato di adesso (un cambio di indirizzo, un
    // selettore): si salta, così Indietro porta sempre altrove.
    indietro(casa) {
      let id = storia.pop();
      while (id === scelto.stato) id = storia.pop();
      if (id === undefined) id = casa ?? "nota-riposo";
      if (id === scelto.stato) return avviso("Indietro: in questa strada non c'è un passo prima di questo.");
      api.vai(id, { storia: false });
    },
    luce(l) {
      scelto.luce = l;
      sincronizza();
      mostra();
    },
    moto(m) {
      scelto.moto = m;
      sincronizza();
      mostra();
    },
    // Una scelta di Aspetto: cambia lo schermo sul posto, e resta per gli altri stati.
    imposta(k, v) {
      if (v === undefined || v === null || v === serie()[k]) delete prefs[k];
      else prefs[k] = v;
      applicaAspetto(docOra);
      scriviIndirizzo();
    },
    ridisegna: () => mostra(),
    pezzo: (doc, base, sel) => pezzo(doc, base, sel),
    catturaDoc,
    avviso,
  };

  // ── Mostrare uno stato ────────────────────────────────────────────────────
  function sincronizza() {
    $("sim-stato").value = scelto.stato;
    $(scelto.luce === "dark" ? "luce-notte" : "luce-giorno").checked = true;
    $(`larghezza-${scelto.larghezza}`).checked = true;
    $(`moto-${scelto.moto}`).checked = true;
    $("sim-scenario").value = scelto.scenario;
  }
  function scriviIndirizzo() {
    const q = new URLSearchParams({ stato: scelto.stato, luce: scelto.luce, larghezza: scelto.larghezza, moto: scelto.moto });
    if (scelto.scenario) q.set("scenario", scelto.scenario), q.set("passo", String(scelto.passo + 1));
    for (const [k, v] of Object.entries(prefs)) q.set(`p.${k}`, String(v));
    try {
      history.replaceState(null, "", `#${q}`);
    } catch {}
  }
  function didascalia(s, ris) {
    $("sim-numero").textContent = `S${s.n}`;
    $("sim-nome").textContent = s.nome;
    const pv = $("sim-provenienza");
    pv.dataset.prov = s.prov;
    pv.textContent = { cattura: "cattura del client", composta: "composta da catture", nuova: "nuova · da approvare" }[s.prov];
    $("sim-dice").textContent = s.dice;
    $("sim-perche").hidden = !s.perche;
    $("sim-perche").textContent = s.perche ?? "";
    $("sim-task").textContent = s.task.join(", ");
    const p = pianoDi.get(s.piano);
    $("sim-piano").hidden = !p;
    if (p) {
      const a = $("sim-piano-link");
      a.href = `piani/${p.file}`;
      a.textContent = `${p.nome} (${p.piano} ${p.task}, ${p.ok})`;
    }
    const v = $("sim-vicino");
    const parti = [];
    if (ris.ricomposta === "700") parti.push("A 700 px questo stato non ha una foto sua: è la cattura piena rimessa in 700 px, col CSS vero (le classi che il JavaScript del client mette alle misure strette non ci sono).");
    if (ris.ricomposta === "tel") parti.push("Al telefono questo stato non ha una foto sua: è ricomposto col guscio mobile (frame A, provvisorio, D1).");
    if (temaDi(s) === "carta" && scelto.luce === "dark") parti.push("«Carta» ha solo il chiaro: di notte si vede la serie (D17 A).");
    v.replaceChildren(...parti.map((t) => Object.assign(document.createElement("span"), { textContent: `${t} ` })));
    if (ris.ricomposta && s.vicino && per.has(s.vicino)) {
      const a = document.createElement("a");
      a.href = `#stato=${encodeURIComponent(s.vicino)}&larghezza=tel&luce=${scelto.luce}`;
      a.textContent = `La foto vera più vicina: «${statoDi(s.vicino).nome}».`;
      v.append(a);
    }
    v.hidden = !v.childNodes.length;
  }
  async function mostra() {
    if (!dati) return;
    const mio = ++giro;
    const s = statoDi(scelto.stato);
    if (s.telefono) scelto.larghezza = "tel";
    $("larghezza-piena").disabled = s.telefono;
    $("larghezza-700").disabled = s.telefono;
    document.documentElement.setAttribute("data-theme", scelto.luce);
    delete box.dataset.pronto;
    delete box.dataset.manca;
    $("sim-segno").hidden = true;
    sincronizza();
    const ris = risolvi(s, scelto.larghezza);
    const cap = capDi(ris.cap, scelto.luce);
    misura = ris.ricomposta === "700" ? { w: 700, h: 800 } : ris.ricomposta === "tel" ? { w: 390, h: 844 } : cap.v;
    const gem = Array.isArray(s.gemelli) && scelto.larghezza === "piena" ? statoDi(s.gemelli[0]) : null;
    box.toggleAttribute("data-solo", !gem);
    $("sim-fig-b").hidden = !gem;
    $("sim-cap-a").hidden = !gem;
    if (gem) {
      $("sim-cap-a").textContent = `A · S${s.n} · ${s.nome}`;
      $("sim-cap-b").textContent = `B · S${gem.n} · ${gem.nome} (clic per aprirlo)`;
    }
    scala(!!gem);
    didascalia(s, ris);
    aggiornaScenario();
    aggiornaRevisione();
    scriviIndirizzo();
    const [a, b] = await Promise.all([monta(frame, s, scelto.larghezza, scelto.luce, mio), gem ? monta(gemelloFrame, gem, "piena", scelto.luce, mio) : null]);
    if (mio !== giro || !a) return;
    docOra = a.doc;
    applicaAspetto(a.doc, scelto.luce, s);
    window.SIM_INTERAZIONI?.aggancia(a.doc, api);
    if (b) {
      applicaAspetto(b.doc, scelto.luce, gem);
      b.doc.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.vai(gem.id);
      }, true);
      b.doc.__simDecidi = () => ({ esito: "vai", dettaglio: gem.id });
    }
    const manca = [...a.manca, ...(b?.manca ?? [])];
    if (manca.length) {
      box.dataset.manca = manca.join(" | ");
      if (a.r.rigoroso) console.error(`[sim] ${s.id} ${scelto.larghezza} ${scelto.luce}: ${box.dataset.manca}`);
    }
    $("sim-manca").hidden = !manca.length || a.r.rigoroso === false;
    $("sim-manca").textContent = manca.length ? `Il simulatore non ha trovato: ${manca.join("; ")}.` : "";
    requestAnimationFrame(() => {
      if (mio !== giro) return;
      metti_fuoco(a.doc, a.strati);
      aggiornaPezzi(a.doc, a.strati);
      box.dataset.pronto = `${s.id}--${scelto.larghezza}-${scelto.luce}`;
    });
  }
  function metti_fuoco(doc, strati) {
    if (!scelto.fuoco) return;
    const s = statoDi(scelto.stato);
    const dove = [doc, ...strati.map((f) => f.contentDocument).filter(Boolean)];
    for (const d of dove) {
      const el = [...d.querySelectorAll(s.fuoco)].find(visibile) ?? d.querySelector("[data-proto-focus]");
      if (el) {
        el.focus({ preventScroll: true, focusVisible: true });
        return;
      }
    }
  }

  // ── I comandi della pagina ────────────────────────────────────────────────
  $("sim-stato").addEventListener("change", (e) => api.vai(e.target.value));
  for (const r of document.querySelectorAll('input[name="luce"]')) r.addEventListener("change", (e) => api.luce(e.target.value));
  for (const r of document.querySelectorAll('input[name="larghezza"]')) r.addEventListener("change", (e) => ((scelto.larghezza = e.target.value), mostra()));
  for (const r of document.querySelectorAll('input[name="moto"]')) r.addEventListener("change", (e) => api.moto(e.target.value));
  $("sim-fuoco").addEventListener("click", (e) => {
    scelto.fuoco = !scelto.fuoco;
    e.currentTarget.setAttribute("aria-pressed", String(scelto.fuoco));
    if (docOra && scelto.fuoco) metti_fuoco(docOra, [...docOra.querySelectorAll("iframe[data-sim-strato]")]);
    else docOra?.activeElement?.blur?.();
  });
  $("sim-segna").addEventListener("click", (e) => {
    scelto.segna = !scelto.segna;
    e.currentTarget.setAttribute("aria-pressed", String(scelto.segna));
    docOra?.documentElement.toggleAttribute("data-sim-segna", scelto.segna);
  });
  $("sim-scenario").addEventListener("change", (e) => {
    scelto.scenario = e.target.value;
    if (scelto.scenario) vaiPasso(0);
    else (aggiornaScenario(), scriviIndirizzo());
  });
  $("sim-passo-prima").addEventListener("click", () => vaiPasso(scelto.passo - 1));
  $("sim-passo-dopo").addEventListener("click", () => vaiPasso(scelto.passo + 1));
  $("sim-passo-fuori").addEventListener("click", () => vaiPasso(scelto.passo));
  $("sim-rivedi").addEventListener("click", () => {
    const id = scelto.stato;
    rivedere.has(id) ? rivedere.delete(id) : rivedere.add(id);
    salvaRivedere();
    aggiornaRevisione();
  });
  $("sim-copia").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(frase());
      avviso("Frase copiata.");
    } catch {
      $("sim-frase").select();
      avviso("Il browser non lascia copiare da qui: la frase è selezionata, Ctrl+C.");
    }
  });
  $("sim-azzera").addEventListener("click", () => {
    prefs = {};
    applicaAspetto(docOra);
    mostra();
  });
  addEventListener("resize", () => dati && scala(!box.hasAttribute("data-solo")));

  // Lo stato si legge dall'indirizzo, anche quando cambia: i link della
  // pagina e della revisione ci portano così.
  function leggi() {
    const q = new URLSearchParams(location.hash.slice(1) || location.search);
    if (q.get("stato") && per.has(q.get("stato"))) scelto.stato = q.get("stato");
    if (q.has("luce")) scelto.luce = q.get("luce") === "dark" ? "dark" : "light";
    if (["piena", "700", "tel"].includes(q.get("larghezza"))) scelto.larghezza = q.get("larghezza");
    else if (q.has("stato")) scelto.larghezza = "piena";
    if (["pieno", "calmo", "ridotto"].includes(q.get("moto"))) scelto.moto = q.get("moto");
    const sc = SCENARI.find((x) => x.id === q.get("scenario"));
    scelto.scenario = sc ? sc.id : "";
    scelto.passo = sc ? Math.max(0, Math.min(sc.passi.length - 1, Number(q.get("passo") ?? 1) - 1)) : 0;
    const np = {};
    for (const [k, v] of q) {
      if (!k.startsWith("p.")) continue;
      const n = Number(v);
      np[k.slice(2)] = v !== "" && Number.isFinite(n) ? n : v;
    }
    if ([...q.keys()].some((k) => k.startsWith("p.")) || q.has("stato")) prefs = np;
    sincronizza();
  }
  // Il menu degli stati: «S12 · nome», per gruppo, con la provenienza.
  function opzioni() {
    const sel = $("sim-stato");
    for (const [g, nome] of GRUPPI) {
      const og = document.createElement("optgroup");
      og.label = nome;
      for (const s of STATI.filter((x) => x.g === g)) {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = `S${s.n} · ${s.nome}${s.prov === "nuova" ? " ◆" : s.prov === "composta" ? " ◇" : ""}`;
        og.append(o);
      }
      sel.append(og);
    }
    const sc = $("sim-scenario");
    for (const x of SCENARI) {
      const o = document.createElement("option");
      o.value = x.id;
      o.textContent = `${x.nome} (${x.passi.length})`;
      sc.append(o);
    }
  }
  opzioni();
  costruisciRevisione();
  leggi();
  addEventListener("hashchange", () => {
    const prima = `${scelto.stato}|${scelto.luce}|${scelto.larghezza}|${scelto.moto}`;
    leggi();
    if (`${scelto.stato}|${scelto.luce}|${scelto.larghezza}|${scelto.moto}` !== prima || !docOra) mostra();
    else applicaAspetto(docOra);
  });
  carica().then(mostra, (e) => {
    $("sim-msg").textContent = `I dati del simulatore non si caricano: ${e.message}`;
  });
})();
