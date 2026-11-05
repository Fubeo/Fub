// solo simulatore: le interazioni finte di Fub pre-alpha.
//
// Niente di questo file va nel codice. Fa sembrare vivo uno schermo che è una
// fotografia: un clic cambia cattura, un menu è il pezzo di un'altra cattura
// messo sopra, «/» e il tasto destro aprono il pezzo giusto. Le coreografie di
// entrata e uscita copiano quelle del prodotto (ui/motion.ts, moto/spring.ts)
// perché i tre livelli del movimento si vedano come saranno.
(() => {
  "use strict";

  // ── Il moto: le stesse costanti e la stessa molla di moto/spring.ts ────────
  const DURATION = { state: 90, swap: 140, short: 220, large: 360, scene: 560 };
  const SPRINGS = { snap: { stiffness: 560, damping: 38 }, soft: { stiffness: 300, damping: 30 } };
  const SAMPLE_MS = 1000 / 60;
  const STEP_S = 1 / 480;
  function advance(sp, st, target, seconds) {
    let steps = Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
    const h = seconds / steps;
    while (steps-- > 0) {
      st.v += (-sp.stiffness * (st.x - target) - sp.damping * st.v) * h;
      st.x += st.v * h;
    }
  }
  function sample(sp) {
    const st = { x: 0, v: 0 };
    const values = [0];
    const precision = 0.001;
    for (let i = 1; i <= 120; i += 1) {
      advance(sp, st, 1, SAMPLE_MS / 1000);
      if (i === 120 || (Math.abs(st.x - 1) < precision && Math.abs(st.v) < precision * 20)) {
        values.push(1);
        break;
      }
      values.push(st.x);
    }
    return values;
  }
  const settle = (sp) => (sample(sp).length - 1) * SAMPLE_MS;
  const calmCache = new Map();
  // moto/spring.ts calmPresence: smorzamento critico, rigidezza alzata quanto
  // basta per non durare più della molla piena.
  function calmPresence(sp) {
    const key = `${sp.stiffness}/${sp.damping}`;
    if (calmCache.has(key)) return calmCache.get(key);
    const budget = settle(sp);
    const at = (k) => ({ stiffness: k, damping: 2 * Math.sqrt(k) });
    let low = sp.stiffness;
    let high = sp.stiffness;
    if (settle(at(low)) <= budget) return calmCache.set(key, at(low)).get(key);
    while (settle(at(high)) > budget && high < sp.stiffness * 64) high *= 2;
    for (let i = 0; i < 20; i += 1) {
      const mid = (low + high) / 2;
      if (settle(at(mid)) > budget) low = mid;
      else high = mid;
    }
    return calmCache.set(key, at(Math.ceil(high))).get(key);
  }
  const REST = { x: 0, y: 0, scale: 1, opacity: 1 };
  const pose = (p) => ({ ...REST, ...p });
  const frame = (p) => ({ opacity: Math.max(0, Math.min(1, p.opacity)), transform: `translate(${p.x}px, ${p.y}px) scale(${p.scale})` });
  const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale + (b.scale - a.scale) * t, opacity: a.opacity + (b.opacity - a.opacity) * t });
  const halfway = (p) => ({ x: p.x / 2, y: p.y / 2, scale: 1 + (p.scale - 1) / 2, opacity: p.opacity });
  // ui/motion.ts SURFACES, nello stesso ordine.
  const FADE = { from: { opacity: 0 }, to: { opacity: 0 }, spring: "soft", leave: "swap" };
  const SURFACES = [
    [".modale", { ...FADE, part: { selector: ".palette-box", from: { y: -12 } } }],
    [".settings-panel, .icon-picker", { from: { y: 12, opacity: 0 }, to: { y: 6, scale: 0.99, opacity: 0 }, spring: "soft", leave: "swap" }],
    [".toast", { from: { y: 12, opacity: 0 }, to: { opacity: 0 }, spring: "soft", leave: "swap" }],
    [".dock-panel, .graph-panel-popover", { from: { y: -4, opacity: 0 }, to: { y: -2, scale: 0.98, opacity: 0 }, spring: "snap", leave: "swap" }],
    [".context-menu", { from: { opacity: 0 }, to: { opacity: 0 }, spring: "snap", leave: "state", enterIn: "state", reduced: "none" }],
  ];
  const motionOf = (el) => SURFACES.find(([s]) => el.matches(s))?.[1] ?? FADE;
  function corsa(el, from, to, spring, livello, presenza) {
    if (livello === "calmo") {
      spring = presenza ? calmPresence(spring) : { ...spring, damping: Math.max(spring.damping, 2 * Math.sqrt(spring.stiffness)) };
      if (presenza) from = halfway(from);
    }
    const values = sample(spring);
    el.animate(values.map((t) => frame(mix(from, to, t))), { duration: (values.length - 1) * SAMPLE_MS, easing: "linear" });
  }
  function entra(el, livello) {
    const m = motionOf(el);
    if (livello === "ridotto") {
      if ((m.reduced ?? "fade") === "fade") el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.state, easing: "linear" });
      return;
    }
    const from = pose(m.from);
    if (m.enterIn) el.animate([frame(from), frame(REST)], { duration: DURATION[m.enterIn], easing: "ease-out" });
    else corsa(el, from, REST, SPRINGS[m.spring], livello, from.opacity < 1);
    const part = m.part ? el.querySelector(m.part.selector) : null;
    if (part) corsa(part, pose(m.part.from), REST, SPRINGS[m.spring], livello, false);
  }
  // Esce lasciando un'immagine ferma che se ne va; l'elemento sparisce subito.
  function esci(el, livello, nascondi) {
    const m = motionOf(el);
    const view = el.ownerDocument.defaultView;
    const vaVia = livello !== "ridotto" || (m.reduced ?? "fade") === "fade";
    if (vaVia && el.isConnected && !el.hidden) {
      const ghost = el.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.pointerEvents = "none";
      const r = el.getBoundingClientRect();
      const cs = view.getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute") {
        ghost.style.position = "fixed";
        ghost.style.left = `${r.left}px`;
        ghost.style.top = `${r.top}px`;
        ghost.style.width = `${r.width}px`;
        ghost.style.margin = "0";
      }
      el.after(ghost);
      const to = livello === "ridotto" ? { opacity: 0, transform: "none" } : frame(pose(livello === "calmo" ? halfway(pose(m.to)) : m.to));
      const a = ghost.animate([{ opacity: 1, transform: "none" }, to], { duration: livello === "ridotto" ? DURATION.state : DURATION[m.leave], easing: "ease-in", fill: "forwards" });
      a.finished.then(() => ghost.remove(), () => ghost.remove());
    }
    nascondi();
  }

  // ── Il CSS dentro lo schermo (solo simulatore) ─────────────────────────────
  // Il cursore vero di CodeMirror lo disegna il suo JavaScript, che qui non
  // c'è: mentre si scrive si vede il cursore del contenteditable e si tolgono
  // il cursore e la selezione fotografati, che non sarebbero più al loro posto.
  const css = `
html[data-sim-scrive] .cm-content { caret-color: var(--accent, #2b56cc) !important; }
html[data-sim-scrive] .cm-cursorLayer, html[data-sim-scrive] .cm-selectionLayer { display: none !important; }
html[data-sim-scrive] .cm-line ::selection, html[data-sim-scrive] .cm-line::selection { background: var(--selection, rgb(43 86 204 / 0.25)) !important; }
`;

  // ── Che cosa apre che cosa ─────────────────────────────────────────────────
  const MODI = { Live: "nota-riposo", Blocchi: "nota-blocchi", Sorgente: "nota-sorgente", Lettura: "nota-lettura" };
  const MODO_DI = { "nota-riposo": "Live", nota: "Live", barra: "Live", conflitto: "Live", "nota-blocchi": "Blocchi", "nota-sorgente": "Sorgente", "nota-lettura": "Lettura" };
  const SCHEDE_IMPOSTAZIONI = { settings: "aspetto", components: "componenti", vault: "impostazioni-vault" };
  const IMPOSTAZIONI = new Set(["impostazioni", "aspetto", "componenti", "impostazioni-vault"]);

  function aggancia(doc, api) {
    const win = doc.defaultView;
    const livello = () => api.scelto.moto;
    const larga = () => api.scelto.larghezza;
    let aperto = null; // { el, tipo, chiudi }
    let slash = null; // { el, filtro }

    const chiudi = () => {
      if (!aperto) return;
      const a = aperto;
      aperto = null;
      slash = null;
      a.chiudi();
    };
    // Mette sopra lo schermo il pezzo di un'altra cattura.
    function apri(tipo, el, dove, { fuoco, chiudi: nascondi } = {}) {
      chiudi();
      dove(el);
      entra(el, livello());
      aperto = { el, tipo, chiudi: nascondi ?? (() => esci(el, livello(), () => el.remove())) };
      if (fuoco) (typeof fuoco === "string" ? el.querySelector(fuoco) : fuoco)?.focus({ preventScroll: true });
      return el;
    }
    const posa = (el, x, y) => {
      const w = win.innerWidth;
      const h = win.innerHeight;
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.transformOrigin = "0px 0px";
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.max(4, Math.min(x, w - r.width - 4))}px`;
      el.style.top = `${Math.max(4, Math.min(y, h - r.height - 4))}px`;
    };
    const workspace = () => doc.getElementById("workspace") ?? doc.body;

    // Il menu delle modalità: il pezzo di «Il menu delle modalità».
    function menuModi() {
      const modo = MODO_DI[api.scelto.stato];
      if (!modo) {
        api.avviso("Nel simulatore il menu delle modalità cambia la nota «Benvenuto»: apri «Nota in Live» per provarlo.");
        return;
      }
      const base = larga() === "700" ? "nota-700" : "nota";
      const el = api.pezzo(doc, base, "#context-menu");
      if (!el) return;
      for (const b of el.querySelectorAll('[role="menuitemradio"]')) {
        const on = b.querySelector(".menu-label")?.textContent === modo;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
        const check = b.querySelector(".menu-check");
        if (check) check.textContent = on ? "✓" : "";
      }
      apri("menu", el, (n) => workspace().append(n), { fuoco: '[aria-checked="true"]' });
    }
    // Il tasto destro: il menu giusto per ciò che sta sotto il puntatore.
    function menuDestro(e) {
      const t = e.target;
      let base = null;
      if (t.closest(".cm-content")) base = t.closest(".cm-link, .cm-fub-link, a") ? "pz-menu-link" : "pz-menu-testo";
      else if (t.closest('li[role="treeitem"]')) base = t.closest('li[role="treeitem"]').hasAttribute("aria-expanded") ? "pz-menu-cartella" : "pz-menu-albero";
      else if (t.closest('.tab[role="tab"]')) base = "pz-menu-scheda";
      if (!base) return;
      e.preventDefault();
      const el = api.pezzo(doc, base, "#context-menu");
      if (!el) return;
      // La testa del menu nomina ciò che si è cliccato, come fa ui/menu.ts.
      const li = t.closest('li[role="treeitem"]');
      const tab = t.closest('.tab[role="tab"]');
      const nome = li?.querySelector(".tree-label, .row-name, .row-title")?.textContent?.trim() || li?.getAttribute("data-path")?.split("/").pop()?.replace(/\.md$/, "") || tab?.textContent?.trim();
      const head = el.querySelector(".menu-head-name");
      if (head && nome) {
        head.textContent = nome;
        const kind = el.querySelector(".menu-head-kind")?.textContent ?? "";
        el.setAttribute("aria-label", kind ? `${kind} · ${nome}` : nome);
      }
      apri("menu", el, (n) => {
        workspace().append(n);
        posa(n, e.clientX, e.clientY);
      }, { fuoco: '[role="menuitem"]' });
    }
    // L'avvio rapido: il pezzo di «Avvio rapido: le note» (o i comandi).
    function lanciatore(comandi = false) {
      const tel = larga() === "tel";
      const base = tel ? "tel-lanciatore" : comandi ? (larga() === "700" ? "palette-700" : "palette") : larga() === "700" ? "palette-file-700" : "palette-file";
      const el = api.pezzo(doc, base, ".launcher-layer");
      if (!el) return;
      const input = el.querySelector(".launcher-input");
      if (input) input.value = "";
      apri("lanciatore", el, (n) => doc.body.append(n), { fuoco: ".launcher-input" });
      evidenzia(el, el.querySelector('.launcher-row[aria-selected="true"]') ?? el.querySelector(".launcher-row"));
    }
    function evidenzia(lista, item) {
      if (!item) return;
      for (const r of lista.querySelectorAll(".launcher-row")) {
        r.setAttribute("aria-selected", String(r === item));
        r.toggleAttribute("data-active", r === item);
      }
      const hl = item.parentElement.querySelector(".kit-list-highlight");
      if (hl) {
        hl.style.width = `${item.offsetWidth}px`;
        hl.style.height = `${item.offsetHeight}px`;
        hl.style.translate = `${item.offsetLeft}px ${item.offsetTop}px`;
      }
      item.scrollIntoView({ block: "nearest" });
    }
    function filtraLanciatore(el) {
      const q = el.querySelector(".launcher-input").value.trim().toLowerCase();
      const righe = [...el.querySelectorAll(".launcher-row")];
      for (const r of righe) r.hidden = q !== "" && !r.textContent.toLowerCase().includes(q);
      const prima = righe.find((r) => !r.hidden);
      if (prima) evidenzia(el, prima);
      else api.avviso("Nessuna voce: il prodotto mostra «Avvio rapido senza risultati» (lo trovi negli stati).");
    }
    function apriRiga(r) {
      const titolo = r.querySelector(".launcher-row-title")?.textContent ?? "";
      const path = Object.keys(api.dati().fileStato).find((p) => p.split("/").pop().replace(/\.\w+$/, "") === titolo);
      chiudi();
      if (path) api.vai(api.dati().fileStato[path]);
      else api.avviso(`«${titolo}»: nel prodotto parte o si apre; nel simulatore non ha una schermata sua.`);
    }
    // «/»: il pezzo di «/: il menu dei blocchi», sotto il cursore.
    function apriSlash() {
      const ed = doc.activeElement?.closest(".cm-editor") ?? doc.querySelector(".pane.focus .cm-editor");
      if (!ed) return;
      const sel = doc.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const el = api.pezzo(doc, larga() === "700" ? "slash-700" : "slash", ".slash-panel");
      if (!el || !r) return;
      apri("slash", el, (n) => {
        ed.append(n);
        n.style.position = "fixed";
        posa(n, r.left - 16, r.bottom + 6);
        n.style.transformOrigin = "16px 0px";
      });
      slash = { el, filtro: "" };
      filtraSlash();
    }
    function righeSlash() {
      return [...slash.el.querySelectorAll(".slash-row")].filter((r) => !r.hidden);
    }
    function filtraSlash() {
      const q = slash.filtro.toLowerCase();
      const righe = [...slash.el.querySelectorAll(".slash-row")];
      for (const r of righe) r.hidden = q !== "" && !r.textContent.toLowerCase().includes(q);
      for (const g of slash.el.querySelectorAll(".slash-group")) g.hidden = ![...g.querySelectorAll(".slash-row")].some((r) => !r.hidden);
      const pill = slash.el.querySelector(".slash-pill");
      if (pill) pill.hidden = q !== "";
      const query = slash.el.querySelector(".slash-query b");
      if (query) query.textContent = q;
      const vis = righeSlash();
      for (const r of righe) r.classList.toggle("is-selected", r === vis[0]);
      if (!vis.length) api.avviso("Nessun blocco con questo nome: il prodotto lo dice nel menu («/» senza risultati, negli stati).");
    }
    function muoviSlash(d) {
      const vis = righeSlash();
      const i = vis.findIndex((r) => r.classList.contains("is-selected"));
      const n = vis[(i + d + vis.length) % vis.length];
      for (const r of vis) r.classList.toggle("is-selected", r === n);
      n?.scrollIntoView({ block: "nearest" });
    }
    function scegliSlash(r = slash?.el.querySelector(".slash-row.is-selected")) {
      const nome = r?.querySelector(".slash-text")?.textContent?.trim();
      chiudi();
      if (nome) api.avviso(`«${nome}»: nel prodotto il blocco entra al posto di «/»; il simulatore non riscrive la nota.`);
    }
    // Il foglietto di «Salvato» e gli avvisi: pezzi già posati dalla cattura.
    function salvataggio(bottone) {
      const el = api.pezzo(doc, larga() === "700" ? "salvataggio-700" : "salvataggio", ".kit-popover");
      if (!el) return;
      // Sotto il bottone, allineato al suo bordo destro (data-placement="bottom").
      apri("foglietto", el, (n) => {
        doc.body.append(n);
        const b = bottone.getBoundingClientRect();
        const w = n.getBoundingClientRect().width;
        n.style.left = `${Math.max(4, b.right - w)}px`;
        n.style.top = `${b.bottom + 6}px`;
        n.style.transformOrigin = `${w - b.width / 2}px 0px`;
      }, { fuoco: el });
    }
    // Invio nel testo: una riga nuova, come la farebbe CodeMirror.
    function aCapo(e) {
      const sel = doc.getSelection();
      const riga = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest(".cm-line");
      if (!riga) return;
      e.preventDefault();
      const nuova = doc.createElement("div");
      nuova.className = "cm-line";
      nuova.append(doc.createElement("br"));
      riga.after(nuova);
      sel.collapse(nuova, 0);
    }
    function avvisi() {
      const vecchio = doc.getElementById("notify-panel");
      if (vecchio && !vecchio.hidden && aperto?.tipo === "avvisi") return chiudi();
      const el = api.pezzo(doc, larga() === "700" ? "avvisi-700" : "avvisi", "#notify-panel");
      if (!el || !vecchio) return;
      const tieni = vecchio.cloneNode(true);
      vecchio.replaceWith(el);
      el.hidden = false;
      apri("avvisi", el, () => {}, {
        fuoco: "#notify-clear",
        chiudi: () => esci(el, livello(), () => el.replaceWith(tieni)),
      });
    }
    // L'albero: un file apre la sua schermata, una cartella si apre e si chiude.
    function albero(li, e) {
      const path = li.getAttribute("data-path");
      if (li.hasAttribute("aria-expanded")) {
        if (e.target.closest("ul") !== li.parentElement && e.target.closest('li[role="treeitem"]') !== li) return;
        if (li.getAttribute("aria-expanded") === "true") {
          if (li._chiusa) li.replaceWith(li._chiusa);
          else li.setAttribute("aria-expanded", "false");
          return;
        }
        const base = api.dati().cartelle[path];
        const aperta = base && api.catturaDoc(base)?.querySelector(`li[data-path="${CSS.escape(path)}"]`);
        if (!aperta) return api.avviso(`«${path}»: nessuna cattura la mostra aperta.`);
        const nuova = doc.importNode(aperta, true);
        for (const s of nuova.querySelectorAll('[aria-selected="true"]')) s.setAttribute("aria-selected", "false");
        nuova._chiusa = li;
        li.replaceWith(nuova);
        return;
      }
      const stato = api.dati().fileStato[path];
      if (stato) api.vai(stato);
      else api.avviso(`«${path}» non ha una schermata nel simulatore: nel prodotto si apre nel suo editor.`);
    }
    function scheda(tab) {
      let path = "";
      try {
        path = JSON.parse(tab.getAttribute("data-key") ?? "{}").doc ?? "";
      } catch {}
      const stato = api.dati().fileStato[path];
      if (stato && stato !== api.scelto.stato) api.vai(stato);
      else if (!stato) api.avviso(`La linguetta «${tab.textContent.trim()}» non ha una schermata nel simulatore.`);
    }
    // Aspetto: le scelte cambiano davvero lo schermo, anche nelle altre schermate.
    function scriviPrefs() {
      const s = doc.querySelector('style[data-proto="solo-simulatore:aspetto"]');
      const p = api.prefs;
      const r = [];
      if (p.body !== 18) r.push(`--text-reading: ${p.body}px;`);
      if (p.lineHeight !== 1.65) r.push(`--leading-relaxed: ${p.lineHeight};`);
      if (p.measure !== 58) r.push(`--content-width: ${p.measure}ch;`);
      if (s) s.textContent = r.length ? `:root { ${r.join(" ")} }` : "";
      if (p.font !== "newsreader") api.ridisegna();
    }
    const CAMPI = { "appearance.body": "body", "appearance.line-height": "lineHeight", "appearance.measure": "measure" };
    function allinea() {
      const radio = (key, val) => {
        const g = doc.getElementById(`setting-${key}`);
        if (!g) return;
        for (const b of g.querySelectorAll('[role="radio"]')) {
          const on = (b.dataset.choice ?? b.dataset.value) === val;
          b.setAttribute("aria-checked", String(on));
          b.tabIndex = on ? 0 : -1;
        }
      };
      radio("appearance.theme", api.prefs.theme === "system" ? "" : api.scelto.luce);
      radio("appearance.motion", { pieno: "", calmo: "calm", ridotto: "reduced" }[api.scelto.moto]);
      for (const [key, campo] of Object.entries(CAMPI)) {
        for (const id of [`setting-${key}`, `setting-${key}-range`]) {
          const i = doc.getElementById(id);
          if (i) i.value = String(api.prefs[campo]);
        }
      }
      const font = doc.querySelector('[data-setting-key="appearance.font"]');
      if (font) for (const b of font.querySelectorAll('[role="radio"]')) b.setAttribute("aria-checked", String((b.dataset.value ?? b.dataset.choice) === api.prefs.font));
    }
    allinea();

    // ── Gli ascolti ─────────────────────────────────────────────────────────
    doc.addEventListener("click", (e) => {
      const t = e.target;
      if (aperto && !aperto.el.contains(t)) {
        const tipo = aperto.tipo;
        chiudi();
        if (tipo !== "slash") return;
      }
      if (aperto?.tipo === "lanciatore") {
        if (t.closest(".launcher-veil")) return chiudi();
        const tab = t.closest('.kit-tab[role="tab"]');
        if (tab) return lanciatore(/Comandi/.test(tab.textContent));
        const r = t.closest(".launcher-row");
        if (r) return apriRiga(r);
        return;
      }
      if (aperto?.tipo === "slash") {
        const r = t.closest(".slash-row");
        if (r) return scegliSlash(r);
        return;
      }
      if (aperto?.tipo === "menu") {
        const radio = t.closest('[role="menuitemradio"]');
        if (radio) {
          const id = MODI[radio.querySelector(".menu-label")?.textContent ?? ""];
          chiudi();
          if (id && id !== api.scelto.stato) api.vai(id);
          return;
        }
        const voce = t.closest('[role="menuitem"]');
        if (voce) {
          const nome = voce.querySelector(".menu-label")?.textContent ?? voce.textContent.trim();
          chiudi();
          api.avviso(`«${nome}»: nel prodotto fa la sua cosa; nel simulatore il menu si chiude.`);
        }
        return;
      }
      if (aperto) return;
      const li = t.closest('li[role="treeitem"]');
      if (li) return albero(li, e);
      const tab = t.closest('.tab[role="tab"]');
      if (tab && !t.closest(".tab-close")) return scheda(tab);
      if (t.closest("#status-mode, .pane-mode-current")) return menuModi();
      if (t.closest("#pill, #open-palette, #command-search")) return lanciatore();
      if (t.closest("#open-settings")) return api.vai("aspetto");
      if (t.closest("#settings-close")) return api.indietro();
      const st = t.closest(".settings-tab[data-tab]");
      if (st) {
        const id = SCHEDE_IMPOSTAZIONI[st.dataset.tab];
        if (id) return api.vai(id, { storia: false });
        return api.avviso(`«${st.textContent.trim()}»: questa scheda non ha una schermata nel simulatore.`);
      }
      if (t.closest("#toggle-light")) return api.luce(api.scelto.luce === "dark" ? "light" : "dark");
      const rail = t.closest(".rail-btn");
      if (rail) {
        const nome = rail.getAttribute("aria-label") ?? "";
        if (nome === "La ricerca nel vault") return api.vai("ricerca");
        if (nome === "Grafo") return api.vai("grafo");
        if (nome === "L'albero del vault") return api.vai("nota-riposo");
        if (nome === "Aiuto") return api.avviso("L'aiuto apre la guida nel vault; il simulatore non ne ha una schermata.");
        return api.avviso(`«${nome}»: nel simulatore non ha una schermata sua.`);
      }
      if (t.closest(".sheet-save")) return salvataggio(t.closest(".sheet-save"));
      if (t.closest("#notify-button")) return avvisi();
      if (t.closest(".conflict-actions button")) {
        const b = t.closest("button");
        api.vai("nota-riposo", { storia: false });
        return api.avviso(`«${b.textContent.trim()}»: nel prodotto la scelta si applica e il conflitto si chiude.`);
      }
      // Aspetto
      const opt = t.closest('[role="radio"]');
      if (opt) {
        const gruppo = opt.closest('[role="radiogroup"]');
        const riga = opt.closest("[data-setting-key]")?.dataset.settingKey;
        const val = opt.dataset.choice ?? opt.dataset.value ?? "";
        if (riga === "appearance.theme") {
          api.prefs.theme = val === "" ? "system" : val;
          return api.luce(val === "" ? (win.parent.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : val);
        }
        if (riga === "appearance.motion") return api.moto({ "": "pieno", calm: "calmo", reduced: "ridotto" }[val] ?? "pieno");
        if (riga === "appearance.font") {
          api.prefs.font = val;
          return api.ridisegna();
        }
        if (gruppo) for (const b of gruppo.querySelectorAll('[role="radio"]')) b.setAttribute("aria-checked", String(b === opt));
        if (riga) api.avviso(`«${riga}»: nel prodotto cambia il tema; il simulatore segna la scelta ma non ricompila i colori.`);
        return;
      }
      const sw = t.closest('[role="switch"]');
      if (sw) return sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
      const kt = t.closest('[role="tab"]');
      if (kt && kt.parentElement?.getAttribute("role") === "tablist") {
        for (const b of kt.parentElement.querySelectorAll(':scope > [role="tab"]')) {
          b.setAttribute("aria-selected", String(b === kt));
          b.tabIndex = b === kt ? 0 : -1;
        }
        const ind = kt.parentElement.querySelector(":scope > .kit-tab-indicator");
        if (ind) {
          ind.style.left = `${kt.offsetLeft}px`;
          ind.style.width = `${kt.offsetWidth}px`;
        }
        return;
      }
      if (t.closest("#brand-menu, #vault-chip, #activity-button, #toggle-inspector")) {
        return api.avviso("Questo bottone apre un menu o un pannello che il simulatore non ha fotografato.");
      }
    });
    doc.addEventListener("contextmenu", menuDestro);
    doc.addEventListener("focusin", (e) => {
      if (e.target.closest?.(".cm-content")) doc.documentElement.setAttribute("data-sim-scrive", "");
    });
    doc.addEventListener("keydown", (e) => {
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ["o", "k", "p"].includes(k.toLowerCase())) {
        e.preventDefault();
        return lanciatore(k.toLowerCase() === "p");
      }
      if (k === "Escape") {
        if (aperto) {
          e.preventDefault();
          const tipo = aperto.tipo;
          chiudi();
          if (tipo === "menu") doc.querySelector("#status-mode")?.focus({ preventScroll: true });
          return;
        }
        if (IMPOSTAZIONI.has(api.scelto.stato)) return api.indietro();
        return;
      }
      if (aperto?.tipo === "slash") {
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          return muoviSlash(k === "ArrowDown" ? 1 : -1);
        }
        if (k === "Enter" || k === "Tab") {
          e.preventDefault();
          return scegliSlash();
        }
        if (k === "Backspace") {
          if (!slash.filtro) return chiudi();
          slash.filtro = slash.filtro.slice(0, -1);
          return filtraSlash();
        }
        if (k === " ") return chiudi();
        if (k.length === 1 && !mod) {
          slash.filtro += k;
          return filtraSlash();
        }
        return;
      }
      if (aperto?.tipo === "menu") {
        const voci = [...aperto.el.querySelectorAll('[role^="menuitem"]')].filter((v) => !v.disabled);
        const i = voci.indexOf(doc.activeElement);
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          voci[(i + (k === "ArrowDown" ? 1 : -1) + voci.length) % voci.length]?.focus();
        } else if (k === "Home" || k === "End") {
          e.preventDefault();
          voci[k === "Home" ? 0 : voci.length - 1]?.focus();
        }
        return;
      }
      if (aperto?.tipo === "lanciatore") {
        const vis = [...aperto.el.querySelectorAll(".launcher-row")].filter((r) => !r.hidden);
        const i = vis.findIndex((r) => r.getAttribute("aria-selected") === "true");
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          return evidenzia(aperto.el, vis[(i + (k === "ArrowDown" ? 1 : -1) + vis.length) % vis.length]);
        }
        if (k === "Enter" && vis[i]) {
          e.preventDefault();
          return apriRiga(vis[i]);
        }
        return;
      }
      if (k === "Enter" && !mod && !e.shiftKey && e.target.closest?.(".cm-content")) return aCapo(e);
      if (k === "/" && !mod && e.target.closest?.(".cm-content")) {
        const sel = doc.getSelection();
        const n = sel.anchorNode;
        const prima = n && n.nodeType === 3 ? n.textContent.slice(0, sel.anchorOffset) : "";
        if (prima === "" || /\s$/.test(prima)) setTimeout(apriSlash, 0);
      }
      if ((k === "Enter" || k === " ") && e.target.matches?.("#status-mode, .pane-mode-current")) {
        e.preventDefault();
        return menuModi();
      }
      if (k === "ArrowUp" && e.target.matches?.("#status-mode")) {
        e.preventDefault();
        return menuModi();
      }
    });
    doc.addEventListener("input", (e) => {
      const t = e.target;
      if (aperto?.tipo === "lanciatore" && t.matches(".launcher-input")) return filtraLanciatore(aperto.el);
      const key = Object.keys(CAMPI).find((k) => t.id === `setting-${k}` || t.id === `setting-${k}-range`);
      if (key) {
        const v = Number(t.value);
        if (!Number.isFinite(v)) return;
        api.prefs[CAMPI[key]] = v;
        const gemello = doc.getElementById(t.id.endsWith("-range") ? `setting-${key}` : `setting-${key}-range`);
        if (gemello) gemello.value = t.value;
        scriviPrefs();
      }
    });
  }

  window.SIM_INTERAZIONI = { aggancia, css };
})();
