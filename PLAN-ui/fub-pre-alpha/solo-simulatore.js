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
html[data-sim-tocco], html[data-sim-tocco] :where(*) { touch-action: pan-y pinch-zoom; -webkit-touch-callout: none; }
html[data-sim-tocco] :is([role="grid"], [role="application"]), html[data-sim-tocco] :is([role="grid"], [role="application"]) :where(*) { touch-action: auto; }
`;
  // Sul telefono la strisciata orizzontale è un gesto di Fub (cassetto,
  // ispettore, indietro): senza «pan-y» il browser la prende per sé e manda
  // pointercancel. Vale su ogni contenitore che scorre (touch-action non si
  // eredita oltre), tranne griglia e lavagna, che si muovono in tutte e due
  // le direzioni. Il guscio mobile vero fa lo stesso (DECISIONS, gesti).

  // ── Che cosa apre che cosa ─────────────────────────────────────────────────
  const MODI = { Live: "nota-riposo", Blocchi: "nota-blocchi", Sorgente: "nota-sorgente", Lettura: "nota-lettura" };
  const MODO_DI = { "nota-riposo": "Live", nota: "Live", barra: "Live", conflitto: "Live", "nota-blocchi": "Blocchi", "nota-sorgente": "Sorgente", "nota-lettura": "Lettura" };
  const SCHEDE_IMPOSTAZIONI = { settings: "aspetto", components: "componenti", shortcuts: "g2-imp-tasti", vault: "impostazioni-vault", about: "imp-info-prealpha" };
  const SEZIONI = { aspetto: "aspetto", editor: "g2-imp-editor", vault: "g2-imp-vault", diagnostica: "g2-imp-diagnostica", profili: "g2-imp-profili", fub: "g2-imp-info" };
  // Le righe di Aspetto che cambiano davvero lo schermo (D12 = B).
  const PREF = {
    "appearance.contrast": "contrast",
    "appearance.density": "density",
    "appearance.accent": "accent",
    "appearance.body": "body",
    "appearance.line-height": "lineHeight",
    "appearance.measure": "measure",
    "appearance.font": "font",
    "chrome.compactness": "compactness",
    "appearance.zoom": "zoom",
  };
  const ISPETTORE = { outline: "g2-ispettore-0", backlinks: "g2-ispettore-1", properties: "g2-ispettore-2", history: "g2-ispettore-3" };
  const TAB_FOGLIO = { Home: "foglio", Inserisci: "g2-foglio-tab-inserisci", "Layout di pagina": "g2-foglio-tab-layout", Formule: "g2-foglio-tab-formule", Dati: "g2-foglio-tab-dati", Revisione: "g2-foglio-tab-revisione", Visualizza: "g2-foglio-tab-visualizza", "Struttura tabella": "g2-foglio-ribbon-table" };
  const TAB_DOC = { Home: "documento", Inserisci: "g2-doc-tab-inserisci", Disegna: "g2-doc-tab-disegna", Layout: "g2-doc-tab-layout", Revisione: "g2-doc-tab-revisione", Visualizza: "g2-doc-tab-visualizza" };
  const NUOVO_TIPO = {
    Nota: ["nota-riposo", "Nasce una nota nuova e si apre."],
    Documento: ["documento", "Nasce un documento .docx nuovo e si apre."],
    Foglio: ["foglio-vuoto", "Nasce un foglio .xlsx nuovo, vuoto."],
    Disegno: ["disegno-vuoto", "Nasce un disegno .svg nuovo, vuoto."],
    Lavagna: ["lav-vuota", "Nasce una lavagna .canvas nuova, vuota."],
    Cartella: ["g2-rinomina", "Nasce una cartella: si scrive subito il suo nome."],
  };
  // Gli strumenti del disegno: K5 (oggi), la banda B e la banda A (D5).
  const ATTREZZI = [[/select|selezion/i, "select"], [/hand|mano/i, "hand"], [/eraser|gomma/i, "eraser"], [/rect|rettangol|shape|forma/i, "rect"], [/text|testo/i, "text"], [/pen|penna|matita/i, "pen"]];
  const DIS_K5 = { select: "disegno-selezione", hand: "g2-disegno-mano", pen: "g2-disegno-penna", eraser: "g2-disegno-gomma", rect: "g2-disegno-rettangolo", text: "disegno-a-testo" };
  const DIS_B = { select: "dis-b-pronto", hand: "dis-b-mano", pen: "dis-b-penna", eraser: "dis-b-gomma", rect: "dis-b-rettangolo", text: "dis-b-testo" };
  const DIS_A = { select: "disegno-a-pronto", text: "disegno-a-testo" };
  // I comandi dell'avvio rapido che hanno una schermata.
  const COMANDI = [
    [/^Passa a Live/, "nota-riposo"],
    [/^Passa a Blocchi/, "nota-blocchi"],
    [/^Passa a Sorgente/, "nota-sorgente"],
    [/^Alterna Lettura/, "nota-lettura"],
    [/^Crea una nota/, "file-nuovo-tipo"],
    [/^Rinomina/, "g2-rinomina"],
    [/^(Apri le )?Impostazioni/, "aspetto"],
    [/^(Mostra il )?[Gg]rafo/, "grafo"],
    [/^Cerca nel vault/, "ricerca"],
    [/^Dividi|^Apri a lato/, "g2-due-riquadri"],
    [/^(Sposta nel cestino|Elimina)/, "g2-conferma"],
    [/^Concentrazione|^Modo concentrazione/, "concentrazione"],
  ];
  const LAV_ATTREZZI ={ select: "lav-impianto", pen: "lav-penna", highlighter: "lav-evidenziatore", eraser: "lav-gomma", lasso: "lav-lazo", text: "lav-scrive", connect: "lav-filo-nuovo" };
  const FOGLIO = /^(foglio|celle-|caricamento$|errore$|molti$|g2-foglio|g3-foglio|tel-foglio|g2-tel-foglio|t-foglio)/;
  const DOC = /^(documento|sola-lettura|g2-doc|g3-doc|tel-doc|g2-tel-doc)/;
  const LAV_NUOVA = /^lav-(impianto|vuota|sel-|scrive|filo-nuovo|penna|evidenziatore|gomma|lazo|estratti|codice-)/;
  const CONFLITTO = /^(conflitto$|g2-conflitto-lettura$|g4-conflitto-)/;
  const NOTA = /^(nota|barra$|live-tabella$|blocchi-menu$|slash|schede$|concentrazione$|icone|g2-filo-titoli$|g2-ispettore-|g2-due-riquadri$|g2-live-lettura$|conflitto$)/;
  // I controlli: lo stesso elenco dell'inventario (inventario-clic.mjs).
  const CONTROLLI = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=switch], [role=checkbox], [role=option], [role=treeitem], [role=link], [role=gridcell], [role=columnheader], [role=slider], [role=spinbutton], [contenteditable=true], [tabindex="0"]';
  const NATIVI = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea, summary, [contenteditable="true"], [contenteditable=""]';
  const RUOLI = '[role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=switch], [role=checkbox], [role=treeitem], [role=gridcell], [role=link]';
  // Le zone: un controllo senza regola sua dice in che parte sta e chi la
  // costruisce, invece di un avviso qualunque.
  const ZONE = [
    [/^grid-/, "il foglio", "applica il comando alle celle scelte, o apre il suo menu"],
    [/^rich-/, "il documento", "applica il comando al testo scelto, o apre il suo menu"],
    [/^kit-ribbon/, (g) => (g === "Documento" ? "il documento" : "il foglio"), "applica il comando, o apre il suo menu"],
    [/^lav-|^canvas-/, "la lavagna", "agisce sulla lavagna"],
    [/^draw-|kit-color-well/, "il disegno", "cambia il disegno"],
    [/media-pdf|document-surface-viewer/, "il visore PDF", "muove, ingrandisce o cerca nel PDF"],
    [/^photo-|^craft-|^zoom-/, "il visore", "agisce sull'immagine"],
    [/^graph-/, "il grafo", "muove o filtra il grafo"],
    [/^search-/, "la ricerca", "affina la ricerca"],
    [/^settings-|^setting-|^components-|^prefs-|^theme|^dev-/, "le Impostazioni", "cambia l'impostazione e la salva"],
    [/^slash-/, "il menu «/»", "inserisce il blocco"],
    [/format-bar/, "la barra di formattazione", "formatta il testo scelto"],
    [/^cm-/, "l'editor di testo", "agisce sul testo"],
    [/^inspector|^ui-(list|tree)-item/, "l'ispettore", "mostra o cambia il pannello"],
    [/onboarding|^avvio-/, "il benvenuto", "porta al passo dopo"],
    [/^rail-|^tab-|^pane-|^status-|^sheet-|^kit-/, "la cornice", "fa la sua azione"],
  ];
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const decodifica = (id) => id.split("-").map((h) => String.fromCharCode(parseInt(h, 16))).join("");

  function aggancia(doc, api) {
    const win = doc.defaultView;
    const livello = () => api.scelto.moto;
    const larga = () => api.scelto.larghezza;
    const stato = () => api.scelto.stato;
    const info = () => api.statoDi(stato()) ?? {};
    const gruppo = () => info().g ?? "";
    const tel = () => larga() === "tel" || gruppo() === "Telefono";
    let aperto = null; // { el, tipo, chiudi }
    let slash = null; // { el, filtro }
    let detto = false; // l'avviso sui collegamenti, una volta sola

    // La cattura da cui prendere un pezzo, alla larghezza scelta.
    const capPer = (id) => {
      const s = api.statoDi(id);
      if (!s) return id;
      if (larga() === "700" && s.w700?.cap) return s.w700.cap;
      if (larga() === "tel" && s.tel?.cap) return s.tel.cap;
      return s.cap ?? id;
    };
    const pz = (id, sel) => api.pezzo(doc, capPer(id), sel) ?? api.pezzo(doc, api.statoDi(id)?.cap ?? id, sel);

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
    // La modalità attuale: quella dello stato, o quella scritta nella barra.
    const modoDi = () => {
      if (MODO_DI[stato()]) return MODO_DI[stato()];
      const m = /Modalità: (\w+)/.exec(doc.querySelector("#status-mode, .pane-mode-current")?.getAttribute("aria-label") ?? doc.querySelector("#status-mode, .pane-mode-current")?.textContent ?? "");
      return m && MODI[m[1]] ? m[1] : null;
    };
    function menuModi() {
      const modo = modoDi();
      if (!modo) {
        api.avviso("Nel simulatore il menu delle modalità cambia la nota «Benvenuto»: apri «Nota in Live» per provarlo.");
        return;
      }
      const el = pz("nota", "#context-menu");
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
    // Un menu di contesto (pz-menu-*) posato in un punto, con la testa che
    // nomina ciò che si è toccato, come fa ui/menu.ts.
    function menuPer(base, t, x, y) {
      const el = api.pezzo(doc, base, "#context-menu");
      if (!el) return false;
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
        posa(n, x, y);
      }, { fuoco: '[role="menuitem"]' });
      return true;
    }
    // Il tasto destro: il menu giusto per ciò che sta sotto il puntatore.
    function menuDestro(e) {
      const t = e.target;
      let base = null;
      if (t.closest(".cm-content")) base = t.closest(".cm-link, .cm-fub-link, a") ? "pz-menu-link" : "pz-menu-testo";
      else if (t.closest('li[role="treeitem"]')) base = t.closest('li[role="treeitem"]').hasAttribute("aria-expanded") ? "pz-menu-cartella" : "pz-menu-albero";
      else if (t.closest('.tab[role="tab"]')) base = "pz-menu-scheda";
      if (!base) return false;
      e.preventDefault();
      return menuPer(base, t, e.clientX, e.clientY);
    }
    // L'avvio rapido: il pezzo di «Avvio rapido: le note» (o i comandi).
    function lanciatore(comandi = false) {
      const el = (tel() ? pz("tel-lanciatore", ".launcher-layer") : null) ?? pz(comandi ? "palette" : "palette-file", ".launcher-layer");
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
    // Una riga dell'avvio rapido: la nota che nomina, o una spiegazione.
    function rigaLanciatore(r) {
      const titolo = norm(r.querySelector(".launcher-row-title")?.textContent ?? r.textContent);
      const cmd = COMANDI.find(([re]) => re.test(titolo));
      if (cmd) return R.vai(cmd[1], { nota: cmd[2] });
      const path =Object.keys(api.dati().fileStato).find((p) => p.split("/").pop().replace(/\.\w+$/, "") === titolo);
      if (path) return R.vai(api.dati().fileStato[path]);
      return R.spiega(`«${titolo}»: nel prodotto parte o si apre; nel simulatore non ha una schermata sua.`);
    }
    const apriRiga = (r) => rigaLanciatore(r).fai();
    // «/»: il pezzo di «/: il menu dei blocchi», sotto il cursore.
    function apriSlash() {
      const ed = doc.activeElement?.closest(".cm-editor") ?? doc.querySelector(".pane.focus .cm-editor");
      if (!ed) return;
      const sel = doc.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const el = pz("slash", ".slash-panel");
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
      const el = pz("salvataggio", ".kit-popover");
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
      const el = pz("avvisi", "#notify-panel");
      if (!el || !vecchio) return api.avviso("Gli avvisi si aprono sotto la campanella; in questa foto il pannello non c'è.");
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
        if (e && e.target.closest("ul") !== li.parentElement && e.target.closest('li[role="treeitem"]') !== li) return;
        if (li.getAttribute("aria-expanded") === "true") {
          if (li._chiusa) li.replaceWith(li._chiusa);
          else li.setAttribute("aria-expanded", "false");
          return;
        }
        const base = api.dati().cartelle[path];
        const aperta = base && api.catturaDoc(base)?.querySelector(`li[data-path="${CSS.escape(path)}"]`);
        if (!aperta) {
          li.setAttribute("aria-expanded", "true");
          return api.avviso(`«${path}»: nessuna foto la mostra aperta; nel prodotto si vedono i file dentro.`);
        }
        const nuova = doc.importNode(aperta, true);
        for (const s of nuova.querySelectorAll('[aria-selected="true"]')) s.setAttribute("aria-selected", "false");
        nuova._chiusa = li;
        li.replaceWith(nuova);
        return;
      }
      const s = api.dati().fileStato[path];
      if (s) api.vai(s);
      else api.avviso(`«${path}» non ha una schermata nel simulatore: nel prodotto si apre nel suo editor.`);
    }
    function statoScheda(tab) {
      let path = "";
      try {
        path = JSON.parse(tab.getAttribute("data-key") ?? "{}").doc ?? "";
      } catch {}
      return api.dati().fileStato[path] ?? null;
    }
    function filtraAlbero(q) {
      q = q.trim().toLowerCase();
      const radice = doc.querySelector('[role="tree"]');
      if (!radice) return;
      const tutti = [...radice.querySelectorAll('li[role="treeitem"]')].reverse();
      for (const li of tutti) {
        const nome = (li.getAttribute("data-path") ?? li.textContent).split("/").pop().toLowerCase();
        const figli = [...li.querySelectorAll('li[role="treeitem"]')];
        li.hidden = q !== "" && !nome.includes(q) && !figli.some((f) => !f.hidden);
      }
      if (q && tutti.every((li) => li.hidden)) api.avviso("Nessuna nota passa il filtro: nel prodotto l'albero lo dice al posto delle righe.");
    }
    function filtraSpazio(chip) {
      const on = chip.getAttribute("aria-pressed") !== "true";
      for (const c of doc.querySelectorAll(".space-chip")) c.setAttribute("aria-pressed", String(c === chip && on));
      const nome = norm(chip.textContent);
      const radice = doc.querySelector('[role="tree"]');
      const cima = radice ? [...radice.querySelectorAll('li[role="treeitem"]')].filter((li) => !li.parentElement.closest('li[role="treeitem"]')) : [];
      let visti = 0;
      for (const li of cima) {
        const p = li.getAttribute("data-path") ?? "";
        li.hidden = on && p !== nome && !p.startsWith(`${nome}/`);
        if (!li.hidden) visti += 1;
      }
      if (on && !visti) {
        for (const li of cima) li.hidden = false;
        api.avviso(`Lo spazio «${nome}» mostra solo la sua cartella; in questa foto la cartella non c'è.`);
      }
    }
    function scorriA(testo) {
      const riga = [...doc.querySelectorAll(".cm-line")].find((l) => norm(l.textContent).replace(/^#+\s*/, "") === testo || norm(l.textContent).endsWith(testo));
      if (riga) riga.scrollIntoView({ block: "center" });
      else api.avviso(`«${testo}»: nel prodotto il testo scorre al titolo.`);
    }
    function nascondi(el) {
      if (el) esci(el, livello(), () => (el.hidden = true));
    }
    // Apre o chiude una colonna laterale come desktop-shell.ts: sopra la
    // soglia (960 px la sinistra, 1200 la destra) la colonna e il suo
    // divisore; sotto, il cassetto con il velo.
    function cassetto(lato, apri) {
      const pan = doc.getElementById(lato);
      const lay = doc.getElementById("layout");
      if (!pan || !lay) return;
      const comp = doc.defaultView.innerWidth < (lato === "sidebar" ? 960 : 1200);
      if (comp) {
        lay.classList.toggle(`drawer-${lato}-open`, apri);
        const velo = doc.getElementById(`${lato}-scrim`);
        if (velo) velo.hidden = !apri;
      }
      pan.hidden = !apri;
      const div = doc.getElementById(`divider-${lato}`);
      if (div) div.hidden = !apri || comp;
    }

    // ── Aspetto: le scelte cambiano davvero lo schermo (D12 = B) ────────────
    function chiaveDi(el) {
      if (el.closest(".prefs-space-step")) return "chrome.compactness";
      if (el.closest(".prefs-swatch, .prefs-hue")) return "appearance.accent";
      if (el.matches("#prefs-zoom-range")) return "appearance.zoom";
      const k = el.closest("[data-setting-key]")?.dataset.settingKey;
      return k && (PREF[k] || k === "appearance.theme" || k === "appearance.motion") ? k : null;
    }
    function segnaRadio(opt) {
      const g = opt.closest('[role="radiogroup"]') ?? opt.parentElement;
      for (const b of g.querySelectorAll('[role="radio"]')) {
        const on = b === opt;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      }
    }
    // Rimette i controlli di Aspetto sulle scelte fatte. Senza «forza» tocca
    // solo le scelte cambiate: il resto lo mostra già la foto.
    function allinea(forza = false) {
      const att = doc.activeElement;
      const def = (k) => forza || api.prefs[k] !== undefined;
      const radio = (key, prova) => {
        const r = doc.querySelector(`[data-setting-key="${key}"]`);
        if (!r) return;
        for (const b of r.querySelectorAll('[role="radio"]')) {
          const on = prova(b);
          b.setAttribute("aria-checked", String(on));
          b.tabIndex = on ? 0 : -1;
        }
      };
      radio("appearance.theme", (b) => (b.dataset.choice ?? "") === (api.prefs.theme === "system" ? "" : api.scelto.luce));
      radio("appearance.motion", (b) => (b.dataset.choice ?? "") === ({ pieno: "", calmo: "calm", ridotto: "reduced" }[api.scelto.moto] ?? ""));
      if (def("contrast")) radio("appearance.contrast", (b) => (b.dataset.choice ?? "") === (api.prefs.contrast === "system" ? "" : api.val("contrast")));
      if (def("density")) radio("appearance.density", (b) => b.dataset.choice === api.val("density"));
      if (def("font")) radio("appearance.font", (b) => b.dataset.value === api.val("font"));
      if (def("compactness")) radio("chrome.compactness", (b) => Number(b.dataset.step) === Number(api.val("compactness")));
      if (def("accent")) {
        const h = Number(api.val("accent"));
        const c = api.temi().campioni.find((k) => k.hue === h);
        radio("appearance.accent", (b) => b.dataset.accent === (c ? c.id : "custom"));
        const hue = doc.getElementById("prefs-accent-hue");
        if (hue && hue !== att) hue.value = String(h);
      }
      for (const [key, campo] of Object.entries(PREF)) {
        const v = api.val(campo);
        if (!def(campo) || typeof v !== "number") continue;
        for (const id of [`setting-${key}`, `setting-${key}-range`]) {
          const i = doc.getElementById(id);
          if (i && i !== att) i.value = String(key === "appearance.zoom" ? v / 100 : v);
        }
      }
      if (def("zoom")) {
        const z = doc.getElementById("prefs-zoom-range");
        if (z && z !== att) z.value = String(api.val("zoom"));
        z?.setAttribute("aria-valuetext", `${api.val("zoom")}%`);
      }
    }
    function azzera(key, bottone) {
      if (PREF[key]) api.imposta(PREF[key], null);
      else if (key === "appearance.theme") api.imposta("theme", null);
      else if (key === "appearance.motion") return api.moto("pieno");
      else {
        // Una riga che il simulatore non segue: torna ai valori della foto.
        for (const i of bottone.closest("[data-setting-key]")?.querySelectorAll("input") ?? []) {
          i.value = i.defaultValue;
          i.checked = i.defaultChecked;
        }
        return;
      }
      allinea(true);
    }
    function inputAspetto(t) {
      const m = /^setting-(.+?)(-range)?$/.exec(t.id ?? "");
      if (m) {
        const gemello = doc.getElementById(m[2] ? `setting-${m[1]}` : `setting-${m[1]}-range`);
        if (gemello) gemello.value = t.value;
      }
      const key = t.matches("#prefs-zoom-range") ? "appearance.zoom" : t.matches("#prefs-accent-hue") ? "appearance.accent" : m?.[1];
      if (!key || !PREF[key]) return;
      let v = Number(t.value);
      if (!Number.isFinite(v) || t.value === "") return;
      if (t.min !== "" && v < Number(t.min)) v = Number(t.min);
      if (t.max !== "" && v > Number(t.max)) v = Number(t.max);
      if (key === "appearance.zoom" && !t.matches("#prefs-zoom-range")) v = Math.round(v * 100);
      api.imposta(PREF[key], v);
      allinea();
    }
    function soloModificate(b) {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      let visti = 0;
      for (const r of doc.querySelectorAll("[data-setting-key]")) {
        const k = r.dataset.settingKey;
        const mod = (PREF[k] && api.prefs[PREF[k]] !== undefined) || (k === "appearance.theme" && api.prefs.theme !== undefined) || (k === "appearance.motion" && api.scelto.moto !== "pieno");
        r.hidden = on && !mod;
        if (!r.hidden) visti += 1;
      }
      if (on && !visti) api.avviso("Nessuna scelta cambiata: nel prodotto la pagina lo dice al posto delle righe.");
    }
    function cercaImpostazioni(q) {
      q = q.trim().toLowerCase();
      let visti = 0;
      for (const r of doc.querySelectorAll("[data-setting-key]")) {
        r.hidden = q !== "" && !r.textContent.toLowerCase().includes(q);
        if (!r.hidden) visti += 1;
      }
      if (q && !visti) api.avviso("Nessuna impostazione con queste parole: nel prodotto la pagina lo dice al posto delle righe.");
    }

    // ── Gli esiti di un clic ────────────────────────────────────────────────
    // decidi(el) dice che cosa farà un controllo senza farlo: la prova lo
    // chiede per ogni controllo visibile di ogni stato. .fai(e) lo fa.
    function casaDi() {
      const s = stato();
      let c;
      if (/^celle-/.test(s)) c = "celle-riposo";
      else if (LAV_NUOVA.test(s)) c = "lav-impianto";
      else if (/^dis-b-/.test(s)) c = "dis-b-pronto";
      else if (/^disegno-a-/.test(s)) c = "disegno-a-pronto";
      else if (/^ricett/.test(s)) c = "ricette";
      else if (/^tema-/.test(s)) c = "aspetto";
      else if (tel()) c = "tel-nota";
      else c = { Foglio: "foglio", Documento: "documento", Disegno: "disegno", Lavagna: "lavagna", Pdf: "pdf", Componenti: "componenti" }[gruppo()] ?? "nota-riposo";
      return c === s ? "nota-riposo" : c;
    }
    const R = {
      vai(id, { nota, storia = true, prima } = {}) {
        if (!api.esiste(id)) return { esito: "vai-manca", dettaglio: id, fai: () => api.avviso(`Lo stato «${id}» non c'è nel simulatore.`) };
        if (id === stato() && !prima) return { esito: "cambia", dettaglio: `resta in ${id}`, fai: () => (chiudi(), api.avviso(nota ?? "Questa schermata è già aperta: nel prodotto il clic la lascia com'è.")) };
        return {
          esito: "vai",
          dettaglio: id,
          fai: () => {
            chiudi();
            prima?.();
            api.vai(id, { storia });
            if (nota) api.avviso(nota);
          },
        };
      },
      torna(nota) {
        return {
          esito: "torna",
          dettaglio: nota ?? "",
          fai: () => {
            chiudi();
            api.indietro(casaDi());
            if (nota) api.avviso(nota);
          },
        };
      },
      alterna: (id, o) => (stato() === id ? R.torna() : R.vai(id, o)),
      apre: (cosa, fai) => ({ esito: "apre", dettaglio: cosa, fai }),
      cambia: (cosa, fai) => ({ esito: "cambia", dettaglio: cosa, fai }),
      spiega: (t) => ({ esito: "avviso-specifico", dettaglio: t, fai: () => (chiudi(), api.avviso(t)) }),
      nativo: (cosa) => ({ esito: "nativo", dettaglio: cosa, nativo: true, fai: () => {} }),
    };
    const cand = (el) => {
      const l = [el.querySelector?.(".menu-label")?.textContent, el.getAttribute("aria-label"), el.getAttribute("data-label"), el.getAttribute("data-tooltip"), el.getAttribute("title"), el.textContent, el.getAttribute("placeholder")].map(norm).filter(Boolean);
      return [...new Set(l)];
    };
    // Il file che un testo nomina: il percorso intero più lungo, poi il nome.
    function fileDi(testo) {
      const fs = api.dati().fileStato;
      const t = norm(testo).toLowerCase();
      if (!t) return null;
      const paths = Object.keys(fs);
      const base = (p) => p.split("/").pop().replace(/\.\w+$/, "").toLowerCase();
      const lungo = (a, b) => b.length - a.length;
      const p =
        paths.filter((x) => t.includes(x.toLowerCase())).sort(lungo)[0] ??
        paths.find((x) => base(x) === t) ??
        paths.find((x) => t.startsWith(base(x))) ??
        paths.filter((x) => base(x).length > 2 && t.includes(base(x))).sort((a, b) => base(b).length - base(a).length)[0];
      return p ? fs[p] : null;
    }
    const vaiFile = (testo, perche) => {
      const s = fileDi(testo);
      return s ? R.vai(s) : R.spiega(perche ?? `«${norm(testo).slice(0, 60)}»: nel prodotto si apre; nel simulatore non ha una schermata sua.`);
    };

    function decidi(el) {
      if (!el || el.nodeType !== 1) return { esito: "nulla", dettaglio: "", fai: () => {} };
      try {
        const x = contesto(el);
        return spento(x) ?? aspetto(x) ?? perStato(x) ?? editor(x) ?? cornice(x) ?? rifiniture(x) ?? comuni(x) ?? nativo(x) ?? sulPosto(x) ?? contenitore(x) ?? zona(x) ?? generico(x);
      } catch (err) {
        return { esito: "errore", dettaglio: String(err?.message ?? err), fai: () => api.avviso(`Il simulatore ha inciampato: ${err?.message ?? err}`) };
      }
    }
    function contesto(el) {
      const n = cand(el);
      return {
        el,
        n,
        nome: n[0] ?? (el.id || el.tagName.toLowerCase()),
        st: stato(),
        g: gruppo(),
        ha: (re) => n.some((c) => re.test(c)),
        su: (sel) => el.closest(sel),
        az: el.closest("[data-action]")?.dataset.action ?? "",
        ruolo: el.getAttribute("role") ?? "",
      };
    }
    function spento({ el, nome }) {
      if (!(el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("fieldset[disabled]"))) return null;
      return { esito: "spento", dettaglio: nome, fai: () => api.avviso(`«${nome}» è spento in questo stato: nel prodotto non risponde.`) };
    }
    function aspetto(x) {
      const { el } = x;
      if (el.matches("#settings-modified")) return R.cambia("solo le scelte cambiate", () => soloModificate(el));
      if (el.matches(".settings-section-reset")) return R.vai("conferma", { nota: "Ripristinare un gruppo chiede conferma." });
      if (el.matches(".setting-reset") && el.closest("[data-setting-key]")) {
        const k = el.closest("[data-setting-key]").dataset.settingKey;
        return R.cambia(`azzera ${k}`, () => azzera(k, el));
      }
      const key = chiaveDi(el);
      if (!key) return null;
      if (el.matches("input, select, textarea")) return R.nativo(key);
      const opt = el.closest('[role="radio"]');
      if (!opt) return null;
      const v = opt.dataset.choice ?? opt.dataset.value ?? opt.dataset.step ?? "";
      const poi = (f) => () => {
        segnaRadio(opt);
        f();
        allinea();
      };
      if (key === "appearance.theme")
        return R.cambia("la luce", () => {
          segnaRadio(opt);
          api.imposta("theme", v === "" ? "system" : null);
          api.luce(v || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
        });
      if (key === "appearance.motion") return R.cambia("il movimento", () => api.moto({ "": "pieno", calm: "calmo", reduced: "ridotto" }[v] ?? "pieno"));
      if (key === "appearance.contrast") return R.cambia("il contrasto", poi(() => api.imposta("contrast", v === "" ? "system" : v)));
      if (key === "appearance.density") return R.cambia("la densità", poi(() => api.imposta("density", v)));
      if (key === "appearance.font") return R.cambia("il carattere", poi(() => api.imposta("font", v)));
      if (key === "chrome.compactness") return R.cambia("la compattezza", poi(() => api.imposta("compactness", Number(v))));
      if (key === "appearance.accent") {
        if (opt.dataset.accent === "custom")
          return R.cambia("la tinta su misura", () => {
            segnaRadio(opt);
            doc.getElementById("prefs-accent-hue")?.focus();
            api.avviso("Su misura: muovi la tinta qui sotto.");
          });
        const c = api.temi().campioni.find((k) => k.id === opt.dataset.accent);
        return R.cambia("l'accento", poi(() => c && api.imposta("accent", c.hue)));
      }
      return R.cambia(key, () => segnaRadio(opt));
    }

    // Le regole di uno stato preciso: i dialoghi e le loro uscite.
    function perStato(x) {
      const { el, st, az } = x;
      const ann = az === "cancel" || x.ha(/^Annulla$/);
      const conf = az === "confirm" || az === "apply";
      if (st === "conferma") {
        if (ann) return R.vai("aspetto", { storia: false });
        if (conf || x.ha(/^Ripristina/))
          return R.vai("aspetto", {
            storia: false,
            prima: () => Object.values(PREF).forEach((c) => api.imposta(c, null)),
            nota: "Il gruppo Aspetto torna come di serie.",
          });
      }
      if (st === "g2-conferma") {
        if (ann) return R.vai("nota-riposo", { storia: false });
        if (conf || x.ha(/cestino|^Elimina/i)) return R.vai("g2-cestino", { nota: "La nota va nel cestino: da lì si ripristina." });
      }
      if (CONFLITTO.test(st)) {
        const ch = el.closest("[data-choice]")?.dataset.choice;
        if (st === "g4-conflitto-confronta" && (az === "close" || x.ha(/^Chiudi/))) return R.vai("conflitto", { storia: false });
        if (/^g4-conflitto-(mio|disco)$/.test(st)) {
          if (ann) return R.vai("conflitto", { storia: false });
          if (conf || x.ha(/^(Sovrascrivi|Ricarica|Conferma|Tieni|Usa)/))
            return R.vai("nota-riposo", { storia: false, nota: st.endsWith("mio") ? "Resta la tua versione e va sul disco." : "Resta la versione del disco." });
        }
        if (st === "g4-conflitto-dopo" && x.ha(/^Scegli ora|^Risolvi/)) return R.vai("conflitto", { storia: false });
        if (ch === "mine" || x.ha(/^Tieni la mia|^La mia/)) return R.vai("g4-conflitto-mio");
        if (ch === "theirs" || x.ha(/^Tieni quella|^Ricarica dal disco|^Quella del disco/)) return R.vai("g4-conflitto-disco");
        if (ch === "later" || x.ha(/^Decidi dopo/)) return R.vai("g4-conflitto-dopo");
        if (ch === "diff" || x.ha(/^Confronta/)) return R.vai("g4-conflitto-confronta");
      }
      if (st === "g2-non-salvata") {
        if (x.ha(/^Tienila aperta/) || ann) return R.vai("g2-salvataggio-fallito", { storia: false });
        if (x.ha(/^Scarta/)) return R.vai("nota-riposo", { storia: false, nota: "Le modifiche si scartano e la linguetta si chiude." });
      }
      if (st === "g2-salvataggio-fallito" && (x.ha(/^Salva adesso|^Riprova/) || az === "retry")) return R.vai("nota-riposo", { storia: false, nota: "Il salvataggio riesce: il segno torna «Salvato»." });
      if (st === "g2-titolo-rinomina") {
        if (x.ha(/^Usa «/)) return R.vai("nota-riposo", { storia: false, nota: "Il file prende il nome del titolo." });
        if (x.ha(/^(Lascia|Tieni|No)/) || ann) return R.vai("nota-riposo", { storia: false });
      }
      if (/^(caricamento|errore|molti|g2-foglio-result-.*)$/.test(st)) {
        if (az === "close" || x.ha(/^Chiudi$/)) return R.vai("foglio", { storia: false });
        if (st === "errore" && (az === "retry" || x.ha(/^Riprova/))) return R.vai("caricamento", { storia: false });
        if (el.closest(".grid-result-ref")) return R.spiega("Nel prodotto il foglio salta alla cella del risultato e la sceglie.");
      }
      // Al telefono: il risultato di un comando e il suo errore (S286).
      if (/^t-foglio-(errore|risultato)$/.test(st)) {
        if (az === "close" || x.ha(/^Chiudi$/)) return R.vai("tel-foglio", { storia: false });
        if (st === "t-foglio-errore" && (az === "retry" || x.ha(/^Riprova/))) return R.vai("t-foglio-risultato", { storia: false, nota: "Al secondo tentativo il comando riesce." });
      }
      if (st === "g2-foglio-command-form") {
        if (ann || az === "close") return R.torna();
        if (conf || x.ha(/^(Applica|Crea|Inserisci|OK)$/)) return R.vai("g2-foglio-result-table");
      }
      if (st === "comp-permesso") {
        if (x.ha(/Installa e accendi/)) return R.vai("comp-installato", { nota: "Il componente è installato e acceso." });
        if (ann) return R.vai("componenti", { storia: false });
      }
      if (st === "g2-comp-spegni") {
        if (ann) return R.vai("componenti", { storia: false });
        if (conf || x.ha(/^Spegni/)) return R.vai("componenti", { storia: false, nota: "Il motore si spegne: i file del suo formato si aprono come testo o non si aprono." });
      }
      if (st === "dis-comp-accendi") {
        if (ann) return R.vai("dis-comp-spento", { storia: false });
        if (conf || x.ha(/^Accendi/)) return R.vai("dis-comp-acceso", { storia: false });
      }
      if (st === "tema-sostituisci") {
        if (ann) return R.vai("aspetto", { storia: false });
        if (x.ha(/^Sostituisci/)) return R.vai("tema-sostituisci-fallito", { nota: "Qui si mostra il caso che fallisce; quello riuscito torna ad Aspetto col tema nuovo." });
      }
      if (st === "tema-sostituisci-fallito" && x.ha(/^Ho capito/)) return R.vai("aspetto", { storia: false });
      if (st === "riscontri-b-apre") {
        if (ann) return R.vai("riscontri-b-menu", { storia: false });
        if (x.ha(/Apri GitHub/)) return R.spiega("Nel prodotto si apre GitHub nel browser, col modulo del problema e la versione già scritta (D9 B); il simulatore non esce dalla pagina.");
      }
      if (/^(disegno-a-fermo)$/.test(st) && (az === "retry" || x.ha(/^Riprova/))) return R.vai("disegno-a-apre", { storia: false });
      if (st === "dis-b-fermo" && (az === "retry" || x.ha(/^Riprova/))) return R.vai("dis-b-si-apre", { storia: false });
      if (st === "g2-cestino" || st === "t-cassetto-file") {
        if (x.ha(/^Svuota il cestino/)) return R.vai("g2-cestino-vuoto", { nota: "Il cestino si svuota: i file se ne vanno davvero." });
        if (x.ha(/^Ripristina/))
          return R.cambia("ripristina", () => {
            const r = el.closest("li, .ui-list-item, [role=row], [role=option]");
            if (r && r !== el) esci(r, livello(), () => r.remove());
            api.avviso("La nota torna al suo posto nell'albero.");
          });
      }
      if (st === "g2-ispettore-3") {
        if (x.ha(/^Chiudi l.anteprima/)) return R.cambia("chiude l'anteprima", () => nascondi(el.closest(".history-preview, .inspector-preview, section, aside, div")));
        if (el.closest(".ui-list-item")) return R.spiega("La versione scelta si mostra in anteprima sotto l'elenco: il testo di allora, con le differenze.");
        if (x.ha(/^Ripristina$/)) return R.spiega("La versione scelta torna a essere quella attuale; quella di adesso resta nella cronologia, così si può tornare indietro.");
        if (x.ha(/^Mostra il testo$/)) return R.spiega("Nel prodotto si vede il testo intero della versione, non solo le differenze.");
        if (x.ha(/^Copia il testo$/)) return R.spiega("Nel prodotto copia il testo della versione negli appunti.");
      }
      if (st === "file-troppo-grande" || st === "file-sconosciuto") {
        if (x.ha(/altra app/)) return R.spiega("Nel prodotto il file si apre con l'app del sistema; il simulatore non esce dalla pagina.");
        if (x.ha(/Mostra nella cartella/)) return R.spiega("Nel prodotto si apre la cartella del file nel gestore dei file.");
        if (x.ha(/sola lettura/)) return R.spiega("Nel prodotto si apre solo l'inizio del file, senza poterlo cambiare.");
      }
      if (st === "vault-irraggiungibile") {
        if (x.ha(/Scegli un altro vault/)) return R.vai("vuoto");
        if (x.ha(/^Riprova/) || az === "retry") return R.vai("avvio-attesa");
      }
      if (st === "g2-doc-prestato" && x.ha(/^Riprendi qui/)) return R.vai("documento", { nota: "Il documento torna qui; l'altra finestra lo mostra in sola lettura." });
      if (st === "mcp-riflesso") {
        if (x.ha(/^Apri$/)) return R.vai("nota-riposo", { nota: "Si apre la nota che l'assistente ha cambiato." });
        if (x.ha(/^Annulla$/)) return R.spiega("La modifica dell'assistente si annulla: la nota torna com'era.");
      }
      if (/^icone/.test(st)) {
        const tab = el.closest('[role="tab"]');
        if (tab && /emoji/i.test(tab.textContent)) return R.vai("icone-emoji", { storia: false });
        if (tab) return R.vai("icone", { storia: false });
        if (x.su(".icon-picker") && !el.matches("input")) return R.torna("L'icona scelta va sulla nota, nell'albero e nella linguetta.");
      }
      if (st === "g3-doc-chiuse" && x.su(".pane-standing-chip")) return R.vai("g3-doc-chiuse-pannello");
      if (st === "g3-doc-chiuse-pannello") {
        if (x.su(".pane-standing-chip")) return R.torna();
        if (x.ha(/^Vai a|^Mostra la prima parte/)) return R.spiega("Nel prodotto il documento scorre alla parte chiusa e la mette in evidenza.");
      }
      if (st === "g3-doc-trova") {
        if (x.ha(/Chiudi la ricerca/)) return R.vai("documento", { storia: false });
        if (x.su(".rich-find, [class*=find]") && !el.matches("input")) return R.spiega(`«${x.nome}»: trova e sostituisci lavorano sul documento vero; qui la barra resta ferma.`);
      }
      if (st === "g2-tel-doc-pannello" && x.ha(/^(Commenta|Rispondi|Risolvi|Elimina)$/)) return R.spiega(`«${x.nome}»: nel prodotto il commento si scrive, si risolve o si toglie nel pannello.`);
      if (st === "lav-vuota") {
        if (x.ha(/^Incolla$/)) return R.vai("lav-codice-riepilogo");
        if (x.ha(/^Aggiungi file/)) return R.vai("lav-estratti");
      }
      if (st === "lav-codice-riepilogo") {
        if (ann) return R.torna();
        if (x.ha(/^Incolla$/)) return R.vai("lav-sel-molte", { nota: "Le schede del codice entrano nella lavagna, scelte." });
      }
      if (st === "lav-codice-problema" && x.ha(/^Ho capito/)) return R.torna();
      return null;
    }

    // Gli editor: le linguette, gli strumenti, le celle.
    function attrezzo(s) {
      const t = [s.dataset.tools, s.dataset.tool, s.getAttribute("aria-label"), s.dataset.tooltip, s.title].filter(Boolean).join(" ");
      return ATTREZZI.find(([re]) => re.test(t))?.[1] ?? null;
    }
    function editor(x) {
      const { el, st } = x;
      if (FOGLIO.test(st)) {
        const tab = el.closest('[role="tab"]');
        if (tab) {
          const t = norm(tab.textContent);
          const k = Object.keys(TAB_FOGLIO).find((k) => t === k || t.startsWith(`${k} `));
          if (k) return R.vai(TAB_FOGLIO[k], { storia: false });
          if (t === "Note") return R.vai("g2-foglio-secondo", { storia: false });
          if (t === "Conti") return R.vai("foglio", { storia: false });
        }
        if (x.ha(/^Comandi$/)) return R.alterna("foglio-comandi");
        if (x.su(".kit-ribbon-toggle, .grid-ribbon-toggle")) return R.alterna("g2-foglio-ribbon-collapsed");
        if (el.hasAttribute("aria-expanded") && x.su(".kit-ribbon, .grid-ribbon") && x.ha(/^(Celle|Modifica|Numeri|Stili)/)) return R.alterna("g2-foglio-ribbon-open");
        const cella = el.closest('[role="gridcell"], [id^="grid-main-"]');
        if (cella) {
          if (/#DIV\/0!/.test(cella.textContent)) return R.vai("g3-foglio-errore");
          if (/^celle-/.test(st)) return st === "celle-riposo" ? R.spiega("Trascina per scegliere più celle; doppio clic per scrivere nella cella.") : R.vai("celle-riposo", { storia: false });
          if (st === "g2-foglio-selection") return R.vai("foglio-modifica", { nota: "Secondo clic: si scrive nella cella." });
          if (st === "foglio-modifica") return R.vai("g2-foglio-selection", { storia: false });
          return R.vai("g2-foglio-selection", { nota: "Doppio clic per scrivere nella cella." });
        }
        if (el.closest('[role="columnheader"], [role="rowheader"]')) return R.spiega("Nel prodotto sceglie tutta la colonna (o la riga); trascinandone il bordo si allarga, come in «Foglio: la colonna si allarga».");
        if (el.closest('[data-language="fub-formula"], .grid-formula')) return st === "g2-foglio-formula" ? R.nativo("formula") : R.vai("g2-foglio-formula");
      }
      if (DOC.test(st)) {
        const tab = el.closest('[role="tab"]');
        if (tab && tab.closest('[class*="ribbon"]')) {
          const t = norm(tab.textContent);
          const k = Object.keys(TAB_DOC).find((k) => t === k || t.startsWith(`${k} `));
          if (k) return R.vai(TAB_DOC[k], { storia: false });
        }
        if (x.ha(/^(Trova|Sostituisci)\b/)) return R.vai("g3-doc-trova");
        if (el.closest(".rich-side-open")) return tel() ? R.alterna("g2-tel-doc-pannello") : R.spiega("Nel prodotto apre o chiude il pannello dei commenti e delle revisioni, a lato.");
      }
      if (LAV_NUOVA.test(st)) {
        const s = el.closest(".kit-rail-slot[data-tool]");
        if (s) {
          if (s.dataset.tool === "hand") return R.spiega("La mano: nel prodotto si trascina la lavagna per spostare la vista.");
          const id = LAV_ATTREZZI[s.dataset.tool];
          if (id) return R.vai(id, { storia: false });
        }
        if (x.ha(/^Mostra tutta la lavagna/)) return R.vai("lav-lontano", { nota: "Da lontano la lavagna si vede tutta (la foto è quella della lavagna di oggi)." });
        if (x.ha(/^Testo$/)) return R.vai("lav-scrive");
        if (x.ha(/^File…/) || x.ha(/^Aggiungi file/)) return R.vai("lav-estratti");
        if (x.ha(/^Incolla( codice)?$/)) return R.vai("lav-codice-riepilogo");
        if (x.ha(/^Apri a lato/)) return R.vai("g2-due-riquadri");
        if (x.ha(/^Apri( Invio)?$/)) return R.vai("nota-riposo", { nota: "La scheda si apre nel suo editor." });
        if (x.ha(/^Collega/)) return R.vai("lav-filo-nuovo");
        if (x.ha(/^Altre azioni/)) return R.vai("lav-codice-menu");
        if (x.ha(/^Disegno$/)) return R.vai("lav-penna");
        if (x.ha(/^(Copia come codice|Disponi|Allinea|Colore|Raggruppa|Gruppo|Pagina web|In griglia|In riga|In colonna|Ad albero|Togli dalla lavagna)/)) return R.spiega(`«${x.nome}»: nel prodotto agisce sulle schede scelte; la foto resta questa.`);
        if (x.ha(/zoom/i)) return R.spiega("Nel prodotto lo zoom torna al 100%.");
        if (x.su(".format-bar")) return R.spiega(`«${x.nome}»: nel prodotto formatta il testo della scheda.`);
      }
      const dis = /^dis-b-/.test(st) ? DIS_B : /^disegno-a-/.test(st) ? DIS_A : /^(disegno$|disegno-selezione$|disegno-vuoto$|g2-disegno|g3-disegno)/.test(st) ? DIS_K5 : null;
      if (dis) {
        const s = el.closest("[data-slot]");
        const k = s ? attrezzo(s) ?? attrezzo(el) : null;
        if (k) {
          const id = dis[k] ?? DIS_K5[k];
          if (id) return R.vai(id, { storia: false, nota: dis[k] ? undefined : "Lo strumento è lo stesso con la banda A: la foto è quella del disegno di oggi." });
        }
        if (x.su(".status-item, .draw-zoom") && x.ha(/%$|^Zoom/)) return R.vai("g3-disegno-zoom");
      }
      if (x.su(".media-pdf, .document-surface-viewer, [class*=pdf-bar], [class*=pdf-toolbar]")) {
        const tt = x.n.join(" ");
        if (/Miniature/i.test(tt)) return R.alterna("g2-pdf-miniature");
        if (/Due pagine|Doppia pagina|affiancat/i.test(tt)) return R.alterna("g2-pdf-due");
        if (/Colori scuri|scur/i.test(tt)) return R.alterna("g2-pdf-scuro");
        if (/^Pagina 3\b/.test(x.nome)) return R.vai("pdf-pagina3");
        if (!el.matches("input")) return R.spiega(`«${x.nome}»: nel prodotto muove, ingrandisce o gira il PDF; la foto resta questa.`);
      }
      if (x.su(".craft-ask-answer, .craft-ask")) {
        if (x.ha(/^Sì, accendi/)) return st === "craft" ? R.vai("craft-prepara") : R.spiega("Il motore si accende e si prepara (lo stato «craft-prepara»).");
        if (x.ha(/^No/)) return R.vai("craft-spente");
      }
      if (/^(componenti|comp-|g2-comp|dis-comp|craft-spente|nuovo-vault)/.test(st)) {
        if (x.ha(/^Scegli file/)) return R.vai("comp-permesso");
        if (x.ha(/^Disinstalla/)) return R.vai("componenti", { nota: "Il componente si toglie dall'elenco." });
        if (x.ha(/^(Riavvia|Aggiorna)/)) return R.vai("comp-installato", { nota: x.ha(/^Aggiorna/) ? "Il componente è aggiornato." : "Il componente ripartito." });
        const sw = el.closest('[role="switch"]');
        if (sw) {
          const acceso = sw.checked ?? sw.getAttribute("aria-checked") === "true";
          if (st === "componenti" && acceso && /motore-documenti|motore-fogli|xlsx/.test(sw.id)) return R.vai("g2-comp-spegni");
          if (st === "dis-comp-spento" && !acceso) return R.vai("dis-comp-accendi");
          if (st === "dis-comp-acceso" && acceso) return R.vai("dis-comp-spento", { nota: "Il motore del disegno si spegne." });
        }
      }
      const th = el.closest("[data-theme-id]");
      if (th)
        return R.cambia(`il tema ${th.dataset.themeId}`, () => {
          segnaRadio(th);
          const id = th.dataset.themeId === "fub.scrittoio" ? null : th.dataset.themeId;
          api.imposta("tema", id);
          const l = th.dataset.themeLight;
          const fisso = info().tema && info().tema !== id;
          if (l && l !== api.scelto.luce) api.luce(l);
          api.avviso(fisso ? "In questo stato il tema è quello della foto; il tema scelto vale negli altri stati." : `Anteprima del tema «${norm(th.textContent) || th.dataset.themeId}».`);
        });
      const dev = el.closest("[data-dev-action]")?.dataset.devAction;
      if (dev === "install") return R.vai("tema-installa");
      if (dev === "link") return R.vai("tema-collegato");
      if (dev === "catalog") return R.vai("tema-tutti-componenti");
      const dt = el.closest('[id^="dev-tab-"]');
      if (dt) {
        const id = `tema-tutti-${dt.id.slice(8)}`;
        return api.esiste(id) ? R.vai(id, { storia: false }) : R.spiega("Il kit dei componenti: nel prodotto la scheda mostra ogni pezzo del kit con i suoi stati.");
      }
      if (/^tema-/.test(st) || x.g === "Temi") {
        if (x.ha(/^Scollega/)) return R.vai("tema-sviluppo", { nota: "La cartella è scollegata: il tema torna quello di prima." });
        if (x.ha(/^Annulla anteprima/)) return R.vai("aspetto", { prima: () => api.imposta("tema", null) });
        if (x.ha(/^Applica tema/)) return R.spiega("Il tema resta applicato: vale in tutte le schermate.");
        if (x.ha(/^Copia/)) return R.spiega("Nel prodotto copia il testo negli appunti.");
      }
      return null;
    }

    // La cornice: barra in alto, colonna, linguette, ispettore, menu.
    function cornice(x) {
      const { el, st } = x;
      if (el.closest("#brand-menu")) return /^(g2-menu|riscontri-a|riscontri-b-menu)$/.test(st) ? R.torna() : R.vai("g2-menu");
      if (el.closest("#vault-chip")) return R.alterna("g2-vault");
      if (el.closest("#activity-button")) return R.alterna("g2-attivita");
      if (el.closest("#activity-close")) return R.torna();
      if (el.closest("#toggle-inspector")) return R.alterna("g2-ispettore-chiuso");
      if (el.closest("#nav-back")) return R.torna();
      if (el.closest("#nav-forward")) return R.spiega("Avanti rifà il passo appena tornato indietro; il simulatore tiene solo la strada all'indietro.");
      if (el.closest('[id^="win-"]')) return R.spiega("I bottoni della finestra (riduci, ingrandisci, chiudi) parlano col sistema: nel simulatore non fanno niente.");
      if (el.closest("#open-help")) return R.spiega("L'aiuto apre la guida nel vault; il simulatore non ne ha una schermata.");
      if (el.closest("#toggle-light")) return R.cambia("la luce", () => api.luce(api.scelto.luce === "dark" ? "light" : "dark"));
      if (el.closest("#open-settings")) return R.vai("aspetto");
      if (el.closest("#settings-close")) return R.torna();
      if (el.closest("#pill, #open-palette, #command-search")) return R.apre("l'avvio rapido", () => lanciatore());
      if (el.closest("#notify-button")) return R.apre("gli avvisi", () => avvisi());
      if (el.closest("#new-note, .tab-new")) return R.vai("file-nuovo-tipo");
      if (el.closest(".sheet-grip")) return R.torna();
      const rail = el.closest(".rail-btn");
      if (rail) {
        const nome = `${rail.getAttribute("aria-label") ?? ""} ${rail.dataset.label ?? ""}`;
        // L'icona del pannello già davanti chiude la colonna, e la riapre
        // (panels/rail.ts, railClick); sotto i 960 px apre il cassetto.
        const sb = doc.getElementById("sidebar");
        if (!tel() && sb && rail.dataset.panel && !rail.matches(".rail-btn-main") && rail.getAttribute("aria-pressed") === "true") {
          const apri = sb.hidden;
          return R.cambia(apri ? "apre la colonna" : "chiude la colonna", () => cassetto("sidebar", apri));
        }
        if (/albero del vault|rail\.notes/.test(nome)) return tel() ? R.alterna("tel-cassetto") : R.vai("nota-riposo");
        if (/ricerca nel vault|rail\.search/.test(nome)) return R.vai("ricerca");
        if (/Grafo/.test(nome)) return R.vai("grafo");
        if (/Cestino/.test(nome)) return R.vai(tel() ? "t-cassetto-file" : "g2-cestino");
        if (rail.matches(".rail-btn-inspector")) return R.alterna("tel-ispettore");
        if (rail.matches(".rail-btn-manage")) return R.spiega("Qui si scelgono i pannelli della colonna e il loro ordine; il simulatore non ne ha una foto.");
        if (/Tag/.test(nome)) return R.spiega("I tag aprono il loro elenco nella colonna; il simulatore non ne ha una foto.");
        if (/Aiuto/.test(nome)) return R.spiega("L'aiuto apre la guida nel vault; il simulatore non ne ha una schermata.");
        return R.spiega(`«${x.nome}»: nel prodotto apre il suo pannello nella colonna; il simulatore non ne ha una foto.`);
      }
      if (x.ha(/^Ordina le note/)) return R.spiega("Nel prodotto apre le scelte dell'ordine dell'albero; il simulatore non ne ha una foto.");
      const chip = el.closest(".space-chip");
      if (chip) {
        if (/add|new/.test(chip.className) || x.ha(/^\+|Aggiungi|Nuovo spazio/)) return R.spiega("Qui nasce uno spazio nuovo: una cartella in cima all'albero.");
        return R.cambia("filtra l'albero", () => filtraSpazio(chip));
      }
      const li = el.closest('li[role="treeitem"]');
      if (li) {
        const path = li.getAttribute("data-path") ?? "";
        if (li.hasAttribute("aria-expanded")) return R.cambia(`la cartella ${path}`, (e) => albero(li, e));
        const s = api.dati().fileStato[path];
        return s ? R.vai(s) : R.spiega(`«${path}» non ha una schermata nel simulatore: nel prodotto si apre nel suo editor.`);
      }
      if (el.closest(".tab-close")) return chiudiScheda(el.closest(".tab"));
      if (el.closest("[data-tab-menu]")) {
        const tab = el.closest(".tab") ?? doc.querySelector('.tab[role="tab"][aria-selected="true"]');
        const r = el.getBoundingClientRect();
        return R.apre("il menu della linguetta", () => menuPer("pz-menu-scheda", tab ?? el, r.left, r.bottom + 4));
      }
      const tab = el.closest('.tab[role="tab"]');
      if (tab) {
        const s = statoScheda(tab);
        return s ? R.vai(s) : R.spiega(`La linguetta «${norm(tab.textContent)}» non ha una schermata nel simulatore.`);
      }
      const save = el.closest(".sheet-save");
      if (save) {
        const ds = save.dataset.state;
        if (ds === "fallito" && st !== "g2-salvataggio-fallito") return R.vai("g2-salvataggio-fallito");
        if (ds === "conflitto" && !CONFLITTO.test(st)) return R.vai("conflitto");
        return R.apre("il foglietto del salvataggio", () => salvataggio(save));
      }
      if (el.closest(".sheet-title") && !el.matches(NATIVI)) return R.vai("g2-titolo-rinomina");
      if (el.closest("[data-pane-menu]")) return R.alterna("g2-menu-riquadro");
      if (el.closest("#status-mode, .pane-mode-current")) return modoDi() ? R.apre("il menu delle modalità", () => menuModi()) : R.spiega(`«${x.nome}»: nel prodotto apre le modalità di questo editor; il simulatore ha la foto del menu solo per le note.`);
      const it = el.closest('[id^="inspector-tab-"]');
      if (it) {
        const pid = decodifica(it.id.slice("inspector-tab-".length));
        if (it.getAttribute("aria-selected") === "true") return R.spiega(`Il pannello «${x.nome}» è già aperto.`);
        if (pid === "rich.side.comments" && tel()) return R.vai("g2-tel-doc-pannello");
        if (ISPETTORE[pid] && tel()) return R.vai("tel-ispettore");
        if (ISPETTORE[pid] && NOTA.test(st)) return R.vai(ISPETTORE[pid], { storia: false });
        if (ISPETTORE[pid] && x.g !== "Disegno" && x.g !== "Documento") return R.vai(ISPETTORE[pid], { nota: "Il pannello si apre: la foto è quella della nota «Benvenuto»." });
        if (pid === "draw.layers") return R.vai("g3-disegno-livelli", { storia: false });
        return R.spiega(`Il pannello «${x.nome}» dell'ispettore: nel prodotto si apre qui; il simulatore non ne ha una foto in questo stato.`);
      }
      const voce = el.closest(".ui-list-item, .ui-tree-item");
      if (voce && voce.closest('[class*="inspector"], #right-pane')) {
        const aperto = doc.querySelector('[id^="inspector-tab-"][aria-selected="true"]');
        const pid = aperto ? decodifica(aperto.id.slice("inspector-tab-".length)) : "";
        if (x.ha(/^Collega$/)) return R.spiega("Collega: la menzione diventa un collegamento [[…]] nella nota che la contiene.");
        if (voce.matches(".ui-tree-item") || pid === "outline") return R.cambia("scorre al titolo", () => scorriA(norm(voce.querySelector(".ui-tree-label, .ui-tree-item-label")?.textContent ?? voce.textContent)));
        if (pid !== "history") return vaiFile(voce.textContent);
      }
      if (el.closest(".cm-fub-heading-pill-button")) return R.spiega("Il segno del titolo: nel prodotto apre la scelta del livello, da 1 a 6.");
      const stb = el.closest(".settings-tab[data-tab]");
      if (stb) {
        const id = SCHEDE_IMPOSTAZIONI[stb.dataset.tab];
        return id ? R.vai(id, { storia: false }) : R.spiega(`«${x.nome}»: questa scheda non ha una schermata nel simulatore.`);
      }
      const toc = el.closest(".toc-link, .settings-toc a");
      if (toc) {
        const h = toc.getAttribute("href") ?? "";
        const dest = h.startsWith("#") && h.length > 1 ? doc.getElementById(decodeURIComponent(h.slice(1))) : null;
        if (dest) return R.cambia("scorre alla sezione", () => dest.scrollIntoView({ block: "start" }));
        const k = Object.keys(SEZIONI).find((k) => `${h} ${x.nome}`.toLowerCase().includes(k));
        return k ? R.vai(SEZIONI[k], { storia: false }) : R.spiega(`«${x.nome}»: la pagina scorre alla sezione.`);
      }
      if (el.closest("#onboarding-create")) return R.vai("nuovo-vault");
      if (el.closest("#onboarding-open")) return R.spiega("Nel prodotto si apre la finestra del sistema per scegliere una cartella.");
      if (el.closest("#onboarding-settings")) return R.vai("aspetto");
      if (el.closest("#onboarding-profile-continue")) return R.vai("nota-riposo");
      if (el.closest("#avvio-riprova")) return R.vai("avvio-attesa");
      if (el.closest("#avvio-altro-vault")) return R.vai("vuoto");
      if (el.closest("#avvio-copia")) return R.spiega("Nel prodotto copia la diagnosi negli appunti.");
      if (x.su('[id^="onboarding"], [class*="onboarding"]')) {
        if (x.ha(/Apri la demo|Vault del banco/)) return R.vai("nota-riposo");
        if (x.ha(/^Appunti/)) return R.vai("avvio-attesa");
        if (!el.matches(NATIVI)) return R.spiega(`«${x.nome}»: nel prodotto porta al passo dopo del benvenuto; il simulatore non ne ha una foto.`);
      }
      const mi = el.closest('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]');
      if (mi) return voceMenu(x, mi);
      const layer = el.closest(".launcher-layer");
      if (layer) {
        if (el.closest(".launcher-veil")) return R.torna();
        const lt = el.closest('.kit-tab[role="tab"]');
        if (lt) return R.vai(/Comandi/.test(lt.textContent) ? "palette" : "palette-file", { storia: false });
        const r = el.closest(".launcher-row, [id^='kit-item-']");
        if (r) return rigaLanciatore(r);
      }
      const sr = el.closest(".search-result");
      if (sr) return vaiFile(sr.textContent);
      const gl = el.closest(".graph-list-open");
      if (gl) return vaiFile(gl.closest("li, [role=row], .graph-list-item")?.textContent ?? gl.textContent);
      const wl = el.closest("a.wikilink, .cm-fub-link, [data-wikilink-page]");
      if (wl) return vaiFile(wl.getAttribute("data-wikilink-page") ?? wl.textContent);
      return null;
    }
    function chiudiScheda(tab) {
      const ds = doc.querySelector(".sheet-save")?.dataset.state ?? "salvato";
      const attiva = !tab || tab.getAttribute("aria-selected") === "true";
      if (attiva && ds !== "salvato") return R.vai("g2-non-salvata");
      if (!attiva) return R.cambia("chiude la linguetta", () => esci(tab, livello(), () => tab.remove()));
      const altra = [...doc.querySelectorAll('.tab[role="tab"]')].find((t) => t !== tab && statoScheda(t) && statoScheda(t) !== stato());
      if (altra) return R.vai(statoScheda(altra), { nota: "La linguetta si chiude: resta aperta quella vicina." });
      return R.spiega("Chiusa l'ultima linguetta, il riquadro resta vuoto; il simulatore non ne ha una foto qui.");
    }
    function chiudeMenu(nome) {
      return {
        esito: "menu",
        dettaglio: nome,
        fai: () => {
          if (aperto) chiudi();
          else api.indietro(casaDi());
          api.avviso(`«${nome}»: nel prodotto fa la sua cosa; nel simulatore il menu si chiude.`);
        },
      };
    }
    function voceMenu(x, mi) {
      const st = x.st;
      const nome = norm(mi.querySelector(".menu-label")?.textContent ?? x.nome);
      if (/^app-menu-\d/.test(mi.id)) return R.spiega(`Il menu «${nome}» si apre al suo posto; il simulatore ha fotografato solo «File».`);
      if (st === "file-nuovo-tipo") {
        if (/da un modello/.test(nome)) return R.spiega("Nel prodotto si sceglie un modello dalla cartella dei modelli; il simulatore non ne ha una foto.");
        const k = Object.keys(NUOVO_TIPO).find((k) => nome.startsWith(k));
        if (k) return R.vai(NUOVO_TIPO[k][0], { storia: false, nota: NUOVO_TIPO[k][1] });
      }
      if (st === "g2-vault") {
        if (/Vault del banco/.test(nome)) return R.torna();
        if (/^Appunti/.test(nome)) return R.vai("avvio-attesa", { nota: "Si apre il vault «Appunti»." });
      }
      if (mi.getAttribute("role") === "menuitemradio" && MODI[nome]) return R.vai(MODI[nome], { storia: false });
      if (/^Impostazioni/.test(nome)) return R.vai("aspetto");
      if (/^Nuova nota$/.test(nome)) return R.vai("nota-riposo", { nota: "Nasce una nota nuova e si apre." });
      if (/^Nuov[oa]( file)?…$/.test(nome)) return R.vai("file-nuovo-tipo");
      if (/^(Dividi a destra|Dividi in basso|Apri a lato)/.test(nome)) return R.vai("g2-due-riquadri");
      if (/^Chiudi il riquadro/.test(nome)) return st === "g2-due-riquadri" ? R.vai("nota-riposo", { storia: false }) : R.spiega("Con un riquadro solo non c'è niente da chiudere.");
      if (/^Rinomina/.test(nome)) return R.vai("g2-rinomina");
      if (/^(Elimina|Sposta nel cestino)/.test(nome)) return R.vai("g2-conferma");
      if (/^Apri vault/.test(nome)) return R.spiega("Nel prodotto si apre la finestra del sistema per scegliere un vault.");
      if (/^Segnala un problema/.test(nome)) return st === "riscontri-b-menu" ? R.vai("riscontri-b-apre") : R.spiega("Con la scelta A la voce apre subito GitHub nel browser, con la versione già scritta (D9).");
      if (st === "foglio-comandi" || st === "foglio-comandi-cerca") {
        if (/^Struttura tabella/.test(nome)) return R.vai("g2-foglio-commands-table");
        return R.spiega(`«${nome}»: nel prodotto il comando agisce sulle celle scelte, o apre il suo sottomenu; la foto resta questa.`);
      }
      if (/^Salva/.test(nome)) return R.spiega("Nel prodotto salva subito: il segno in alto torna «Salvato».");
      if (/^Cerca/.test(nome)) return R.vai("ricerca");
      return chiudeMenu(nome);
    }
    const nomeStato = (id) => api.statoDi(id)?.nome ?? id;
    const ZOOM_FOTO = { out: "allontana la foto", in: "avvicina la foto", fit: "adatta la foto alla finestra", actual: "mostra la foto a grandezza reale", rotate: "gira la foto di 90°", backdrop: "cambia lo sfondo dietro la foto: scacchiera, chiaro o scuro" };
    // Le rifiniture: controlli frequenti che meritano una frase o una
    // schermata loro, invece della frase della zona.
    function rifiniture(x) {
      const { el, st } = x;
      const tocb = el.closest(".settings-toc-link");
      if (tocb) {
        const dest = tocb.dataset.target && doc.getElementById(tocb.dataset.target);
        // Come jumpTo di panels/settings.ts: scorre, dà il fuoco al titolo e
        // segna la voce dell'indice.
        if (dest)
          return R.cambia("scorre alla sezione", () => {
            dest.scrollIntoView({ block: "start" });
            dest.querySelector(".settings-section-title")?.focus({ preventScroll: true });
            for (const l of doc.querySelectorAll(".settings-toc-link[data-target]")) {
              if (l === tocb) l.setAttribute("aria-current", "true");
              else l.removeAttribute("aria-current");
            }
          });
        if (/App esterne/.test(x.nome)) return R.vai("g2-app-esterne", { storia: false });
        const k = Object.keys(SEZIONI).find((k) => `${tocb.dataset.target ?? ""} ${x.nome}`.toLowerCase().includes(k));
        if (k) return R.vai(SEZIONI[k], { storia: false });
        return R.spiega(`«${x.nome}»: la pagina scorre alla sezione; in questa foto la sezione non c'è.`);
      }
      if (el.matches("#notify-clear"))
        return R.cambia("cancella gli avvisi", () => {
          for (const n of doc.querySelectorAll('#notify-panel [role="listitem"], #notify-panel .notify-item, #notify-panel .notify-row')) n.remove();
          api.avviso("Gli avvisi si cancellano.");
        });
      if (el.closest(".launcher-panel")) return R.vai("g2-due-riquadri", { nota: "La nota si apre nel riquadro a lato." });
      if (st === "g2-attivita" && x.ha(/^Annulla$/)) return R.spiega("Nel prodotto il lavoro si ferma e lascia l'elenco; quello già fatto resta.");
      if (x.ha(/^Sì, accendi/)) return R.spiega(`I motori si accendono e si preparano: lo mostra lo stato «${nomeStato("craft-prepara")}».`);
      if (x.ha(/^No, lasciale spente/)) return R.cambia("chiude la domanda", () => nascondi(el.closest('[role="status"], [role="alert"], [class*="banner"], [class*="notice"], [class*="ask"]') ?? el.parentElement));
      if (x.ha(/^Collega$/) && x.su('#right-pane, [class*="inspector"]')) return R.spiega("Collega: la menzione diventa un collegamento [[…]] nella nota che la contiene.");
      if (el.closest(".sheet-thread-item")) return R.cambia("scorre al titolo", () => scorriA(x.nome));
      const ca = el.closest("[data-canvas-action]")?.dataset.canvasAction;
      if (ca === "add-text") return R.vai("lav-scrive", { nota: "Nasce una scheda di testo (la foto è della lavagna nuova)." });
      if (ca === "add-file") return R.vai("lav-estratti");
      if (ca === "fit") return R.vai("lav-lontano");
      if (ca) return R.spiega(`«${x.nome}»: nel prodotto la scheda nasce al centro della vista.`);
      if (el.closest(".canvas-connect")) return R.vai("lav-filo");
      if (el.closest(".canvas-file-link")) return vaiFile(el.textContent);
      if (el.closest(".canvas-convert-note")) return R.spiega("La scheda di testo diventa una nota vera nel vault, e la scheda la mostra.");
      if (st === "lav-estratti") {
        if (x.ha(/^Prendi \d+ pagine/)) return R.vai("lav-sel-molte", { nota: "Le pagine scelte entrano nella lavagna, una scheda ciascuna." });
        if (x.ha(/^Tutto il file/)) return R.vai("lav-sel-una", { nota: "Il file entra come una scheda sola." });
      }
      const si = el.closest("[data-surface-item], #status-standing, .pane-standing-chip");
      if (si) {
        const k = si.dataset.surfaceItem ?? "standing";
        if (k === "zoom") return R.spiega("Lo zoom: nel prodotto un clic torna al 100%; Ctrl con la rotella avvicina o allontana.");
        if (k === "words") return R.spiega("Il conteggio: nel prodotto apre parole, caratteri e paragrafi, del testo scelto o di tutto il file.");
        return R.spiega(`«${x.nome}»: nel prodotto apre il foglietto che spiega lo stato e che cosa si può fare.`);
      }
      if (el.closest(".kit-ribbon-toggle, .rich-ribbon-toggle")) return R.spiega(`La barra multifunzione si riduce alle sole linguette, come nel foglio («${nomeStato("g2-foglio-ribbon-collapsed")}»).`);
      if (el.closest(".kit-options-more")) return R.spiega("«…»: le opzioni dello strumento che non stanno nella barra; nel prodotto si aprono in un foglietto.");
      if (el.closest(".draw-export")) return R.spiega("Nel prodotto apre le scelte dell'esportazione del disegno.");
      const pt = el.closest(".cm-fub-page-tool");
      if (pt) return /icona/i.test(x.nome) ? R.vai("icone") : R.spiega(`«${x.nome}»: nel prodotto cambia la testa della pagina.`);
      if (el.closest(".cm-fub-block-add")) return R.spiega("Sotto nasce un blocco vuoto, e si apre il menu «/».");
      if (el.closest(".cm-fub-block-grip")) return st === "blocchi-menu" ? R.vai("nota-blocchi", { storia: false }) : R.vai("blocchi-menu");
      if (el.closest(".cm-fub-code-lang")) return R.spiega("Nel prodotto si sceglie la lingua del codice, che ne cambia i colori.");
      if (el.closest(".cm-fub-code-copy")) return R.spiega("Nel prodotto copia il codice negli appunti.");
      if (el.matches("button[data-section]") && el.closest('[class*="slash"]'))
        return R.cambia("la sezione del menu «/»", () => {
          for (const b of el.parentElement.querySelectorAll("button[data-section]")) b.classList.toggle("is-current", b === el);
          const g = el.closest('[class*="slash-panel"]')?.querySelector(`.slash-group[data-section="${el.dataset.section}"]`);
          if (g) g.scrollIntoView({ block: "start" });
          else api.avviso(`«${x.nome}»: il menu scorre ai blocchi di questa sezione.`);
        });
      if (x.ha(/^Nascondi dal menu/)) return R.spiega("Nel prodotto il blocco esce dai suggeriti del menu «/».");
      const za = el.closest("[data-zoom-action]")?.dataset.zoomAction;
      if (za && ZOOM_FOTO[za]) return R.spiega(`Nel prodotto ${ZOOM_FOTO[za]}.`);
      if (el.closest(".craft-xmp-tag")) return R.vai("ricerca", { nota: `La ricerca del tag ${x.nome}.` });
      if (el.closest(".photo-data-open")) return R.spiega("Si apre il file .xmp accanto alla foto, come testo.");
      if (/^(craft|g2-craft)/.test(st) && x.ha(/^Apri le impostazioni/)) return R.vai("componenti");
      if (x.su(".graph-panel-toggle")) return R.spiega("Si aprono le impostazioni del grafo: forze, filtri e colori.");
      if (x.su(".graph-zoom-button")) return R.spiega(`«${x.nome}»: nel prodotto la vista del grafo si avvicina, si allontana o inquadra tutto.`);
      if (x.ha(/^Solo attorno a/)) return R.spiega("Il grafo mostra solo la nota e i suoi vicini.");
      if (el.closest(".search-more")) return R.spiega("Nel prodotto apre le azioni sui risultati: copia l'elenco, apri tutti, sostituisci.");
      if (el.closest(".rich-side-quote")) return R.spiega("Il documento scorre al passo commentato e lo evidenzia.");
      if (/^tema-tutti/.test(st) && el.closest(".kit-button")) return R.spiega("È un campione del kit: mostra il pezzo nei suoi stati, non fa niente.");
      if (/-reset$/.test(el.id)) return R.spiega("Il campo del tema torna al valore di serie.");
      if (st === "impostazioni-vault" && x.ha(/^(Rinomina|Dimentica|Apri)$/)) return R.spiega(`«${x.nome}»: nel prodotto agisce sul vault dell'elenco; i file non si toccano.`);
      if (x.ha(/^Copia il motivo/)) return R.spiega("Nel prodotto copia negli appunti il motivo del guasto.");
      if (x.ha(/^Vedi cosa cambia/)) return R.spiega("Si apre l'elenco delle novità e dei permessi che cambiano con la versione nuova.");
      if (x.ha(/^Cerca nel catalogo/)) return R.spiega("Nel prodotto apre il catalogo dei componenti firmati; il simulatore non ne ha una foto.");
      if (x.ha(/^Controlla aggiornamenti/)) return R.spiega("Nel prodotto cerca una versione nuova e dice se c'è.");
      return null;
    }
    // Le regole che valgono ovunque: chiudere un avviso, i bottoni dei dialoghi.
    function comuni(x) {
      const { el, az } = x;
      if (el.closest(".toast-close")) return R.cambia("chiude l'avviso", () => nascondi(el.closest(".toast")));
      if (el.matches(".link-button") && x.ha(/^Chiudi$/)) return R.cambia("chiude la striscia", () => nascondi(el.closest('.banner, [role="status"], [role="alert"], [class*="banner"], [class*="notice"]') ?? el.parentElement));
      if (az === "cancel" || az === "close") return R.torna();
      if (az === "confirm" || az === "apply") return R.torna("Fatto: nel prodotto la scelta si applica.");
      if (az === "retry") return R.spiega("Nel prodotto riprova subito.");
      if (az === "copy") return R.spiega("Nel prodotto copia negli appunti.");
      return null;
    }
    function nativo(x) {
      const { el } = x;
      const a = el.closest("a[href]");
      if (a) {
        const h = a.getAttribute("href");
        if (h.startsWith("#") && h.length > 1) {
          const dest = doc.getElementById(decodeURIComponent(h.slice(1)));
          if (dest) return R.cambia("scorre al punto", () => dest.scrollIntoView({ block: "start" }));
        }
        if (/^https?:/.test(h)) return R.spiega(`Il collegamento apre ${new URL(h).host} nel browser; il simulatore non esce dalla pagina.`);
        return vaiFile(a.textContent);
      }
      if (el.matches(NATIVI)) return R.nativo(el.tagName.toLowerCase());
      return null;
    }
    // Le cose che si possono fare sul posto: acceso/spento, una scelta, una scheda.
    function sulPosto(x) {
      const { el, ruolo } = x;
      if (ruolo === "switch" || ruolo === "checkbox" || ruolo === "menuitemcheckbox") return R.cambia("acceso/spento", () => el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")));
      if (ruolo === "radio") return R.cambia("la scelta", () => segnaRadio(el));
      if (ruolo === "option") {
        return R.cambia("la scelta", () => {
          for (const o of el.closest('[role="listbox"]')?.querySelectorAll('[role="option"]') ?? []) o.setAttribute("aria-selected", String(o === el));
        });
      }
      if (ruolo === "tab" && el.closest('[role="tablist"]')) {
        if (el.getAttribute("aria-selected") === "true") return R.cambia("la scheda è già aperta", () => {});
        return R.cambia("la scheda", () => {
          const lista = el.parentElement?.getAttribute("role") === "tablist" ? el.parentElement : el.closest('[role="tablist"]');
          for (const b of lista.querySelectorAll('[role="tab"]')) {
            if (b.closest('[role="tablist"]') !== lista) continue;
            b.setAttribute("aria-selected", String(b === el));
            b.tabIndex = b === el ? 0 : -1;
          }
          const ind = lista.querySelector(":scope > .kit-tab-indicator");
          if (ind) {
            ind.style.left = `${el.offsetLeft}px`;
            ind.style.width = `${el.offsetWidth}px`;
          }
          api.avviso(`«${norm(el.textContent)}»: la scheda si sceglie; il contenuto sotto resta quello della foto.`);
        });
      }
      if (el.hasAttribute("aria-pressed")) return R.cambia("premuto/non premuto", () => el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")));
      const ctl = el.getAttribute("aria-controls");
      if (el.hasAttribute("aria-expanded") && ctl && doc.getElementById(ctl)) {
        return R.cambia("apre/chiude", () => {
          const su = el.getAttribute("aria-expanded") !== "true";
          el.setAttribute("aria-expanded", String(su));
          doc.getElementById(ctl).hidden = !su;
        });
      }
      return null;
    }
    // Un contenitore che prende il fuoco (per scorrere da tastiera) non è un bottone.
    function contenitore(x) {
      const { el, ruolo } = x;
      if (/^(document|grid|treegrid|application|textbox|region|list|listbox|tree|log|tabpanel|toolbar|group|dialog|alertdialog|main|navigation|complementary|presentation|none|img|figure|article|feed|status|alert|separator|menu|menubar|tablist|radiogroup|row|rowgroup|table)$/.test(ruolo)) return R.nativo("prende il fuoco");
      if (el.matches(".cm-scroller")) return R.nativo("scorre");
      if (!ruolo && !el.matches("button, a[href]") && el.getAttribute("tabindex") === "0") return R.nativo("prende il fuoco");
      return null;
    }
    function zona(x) {
      for (let n = x.el, i = 0; n && n.nodeType === 1 && i < 13; n = n.parentElement, i += 1) {
        const tok = [...n.classList, n.id].filter(Boolean);
        for (const [re, chi, frase] of ZONE) {
          if (!tok.some((t) => re.test(t))) continue;
          const nome = typeof chi === "function" ? chi(x.g) : chi;
          const task = info().task?.length ? ` (${info().task.join(", ")})` : "";
          const testo = `«${x.nome}» (${nome}): nel prodotto ${frase}. Questa schermata è una foto: il simulatore non la rifà; la costruisce il piano${task}.`;
          return { esito: "zona", dettaglio: nome, fai: () => api.avviso(testo) };
        }
      }
      return null;
    }
    function generico(x) {
      const r = (window.SIM_ECCEZIONI ?? []).find((r) => (!r.stati || r.stati.includes(x.st)) && ((r.sel && x.el.matches(r.sel)) || (r.testo && x.n.includes(r.testo))));
      if (r) return { esito: "eccezione", dettaglio: r.perche, fai: () => api.avviso(`«${x.nome}»: ${r.perche}`) };
      return { esito: "avviso-generico", dettaglio: x.nome, fai: () => api.avviso(`«${x.nome}»: nel prodotto fa la sua cosa; il simulatore non ne ha una schermata.`) };
    }
    doc.__simDecidi = decidi;

    allinea();

    // ── Gli ascolti ─────────────────────────────────────────────────────────
    let inghiotti = false; // il clic che segue un gesto del telefono
    doc.addEventListener("click", (e) => {
      if (inghiotti) {
        inghiotti = false;
        e.preventDefault();
        return;
      }
      const t = e.target;
      if (aperto && !aperto.el.contains(t)) {
        const tipo = aperto.tipo;
        chiudi();
        if (tipo !== "slash") {
          e.preventDefault();
          return;
        }
      }
      if (aperto?.tipo === "lanciatore") {
        e.preventDefault();
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
        e.preventDefault();
        const radio = t.closest('[role="menuitemradio"]');
        if (radio) {
          const id = MODI[radio.querySelector(".menu-label")?.textContent ?? ""];
          chiudi();
          if (id && id !== stato()) api.vai(id);
          return;
        }
        const voce = t.closest('[role="menuitem"], [role="menuitemcheckbox"]');
        if (!voce) return;
        const d = decidi(voce);
        if (d.esito === "torna") return chiudi();
        return d.fai(e);
      }
      if (aperto) {
        // dentro il foglietto o gli avvisi
        const c = t.closest(CONTROLLI);
        if (!c) return;
        if (c.matches("#notify-clear")) {
          for (const n of aperto.el.querySelectorAll('[role="listitem"], .notify-item, .notify-row')) n.remove();
          return api.avviso("Gli avvisi si cancellano.");
        }
        const d = decidi(c);
        if (!d.nativo) e.preventDefault();
        if (d.esito === "torna") return chiudi();
        return d.fai(e);
      }
      // I collegamenti nel testo: il client li segue con Ctrl+clic (⌘ sul Mac).
      const wl = t.closest("[data-wikilink-page], .cm-fub-link");
      if (wl && t.closest(".cm-content")) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          return vaiFile(wl.getAttribute("data-wikilink-page") ?? wl.textContent).fai(e);
        }
        if (!detto) {
          detto = true;
          api.avviso("Il collegamento si segue con Ctrl+clic (⌘+clic sul Mac): un clic semplice mette il cursore nel testo.");
        }
        return;
      }
      // Il velo di un dialogo: il clic nato e finito sul velo chiude il dialogo
      // senza scegliere, come kit/dialog.ts (finish(dismissValue)).
      if (t.classList?.contains("kit-dialog-scrim")) {
        e.preventDefault();
        return R.torna("Il clic fuori dal dialogo lo chiude senza scegliere, come Annulla.").fai(e);
      }
      // Il velo del cassetto laterale (sotto i 960 px) lo chiude.
      if (t.matches?.(".drawer-scrim")) {
        e.preventDefault();
        return cassetto(t.dataset.drawerScrim === "inspector" ? "inspector" : "sidebar", false);
      }
      // Il velo delle impostazioni le chiude, come × (preferences/scrim.ts:
      // il clic nato e finito sul velo fa clic su #settings-close).
      if (t.classList?.contains("settings-scrim")) {
        e.preventDefault();
        return R.torna("Il clic sul velo chiude le impostazioni, come ×.").fai(e);
      }
      const ctrl = t.closest(CONTROLLI);
      if (!ctrl) return;
      const d = decidi(ctrl);
      if (!d.nativo) e.preventDefault();
      d.fai(e);
    });
    doc.addEventListener("dblclick", (e) => {
      const c = e.target.closest?.('[role="gridcell"], [id^="grid-main-"]');
      if (!c) return;
      if (/^celle-/.test(stato())) return api.vai("celle-editor");
      if (FOGLIO.test(stato()) && stato() !== "foglio-modifica") return api.vai("foglio-modifica");
    });
    doc.addEventListener("contextmenu", menuDestro);
    doc.addEventListener("focusin", (e) => {
      if (e.target.closest?.(".cm-content")) doc.documentElement.setAttribute("data-sim-scrive", "");
    });
    // Uno strato fermo (un menu, un dialogo, l'avvio rapido) visibile nella foto.
    const fermo = () => [...doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], .launcher-layer, .context-menu, .kit-popover, .modale')].some((n) => !n.hidden && n.getClientRects().length > 0);
    doc.addEventListener("keydown", (e) => {
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target;
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
        if (/^(Impostazioni|Temi)$/.test(gruppo()) || fermo()) {
          e.preventDefault();
          return api.indietro(casaDi());
        }
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
      // L'avvio rapido: quello aperto dal simulatore o quello fermo nella foto.
      const lista = aperto?.tipo === "lanciatore" ? aperto.el : !aperto ? doc.querySelector(".launcher-layer") : null;
      if (lista && (k === "ArrowDown" || k === "ArrowUp" || k === "Enter")) {
        const vis = [...lista.querySelectorAll(".launcher-row")].filter((r) => !r.hidden);
        const i = vis.findIndex((r) => r.getAttribute("aria-selected") === "true");
        if (k === "Enter") {
          if (!vis[i]) return;
          e.preventDefault();
          return apriRiga(vis[i]);
        }
        e.preventDefault();
        return evidenzia(lista, vis[(i + (k === "ArrowDown" ? 1 : -1) + vis.length) % vis.length]);
      }
      if (aperto?.tipo === "lanciatore") return;
      if (k === "Enter" && !mod && !e.shiftKey && t.closest?.(".cm-content")) return aCapo(e);
      if (k === "/" && !mod && t.closest?.(".cm-content")) {
        const sel = doc.getSelection();
        const n = sel.anchorNode;
        const prima = n && n.nodeType === 3 ? n.textContent.slice(0, sel.anchorOffset) : "";
        if (prima === "" || /\s$/.test(prima)) setTimeout(apriSlash, 0);
      }
      if ((k === "Enter" || k === " ") && t.matches?.("#status-mode, .pane-mode-current")) {
        e.preventDefault();
        return menuModi();
      }
      if (k === "ArrowUp" && t.matches?.("#status-mode")) {
        e.preventDefault();
        return menuModi();
      }
      if (k === "Enter" && t.matches?.("input")) {
        const v = t.value.trim();
        if (t.matches("#components-find")) return api.vai("g2-comp-cerca");
        const nome = `${t.getAttribute("aria-label") ?? ""} ${t.placeholder ?? ""}`;
        if (/Cerca nel PDF/i.test(nome) && v) {
          const testo = [...doc.querySelectorAll(".media-pdf-page")].map((p) => p.textContent).join(" ").toLowerCase();
          return api.vai(testo.includes(v.toLowerCase()) ? "g2-pdf-cerca" : "g2-pdf-nessuno");
        }
        if (/^Pagina|pagina/.test(nome) && t.closest(".media-pdf, .document-surface-viewer, [class*=pdf]")) {
          if (v === "3") return api.vai("pdf-pagina3");
          return api.avviso(`Nel prodotto il PDF salta a pagina ${v}; il simulatore ha la foto di pagina 3.`);
        }
        return;
      }
      // Invio e spazio su un controllo che non è un bottone vero.
      if ((k === "Enter" || k === " ") && !mod && t.matches?.(RUOLI) && !t.matches("button, a[href], input, select, textarea, summary")) {
        e.preventDefault();
        t.click();
      }
    });
    doc.addEventListener("input", (e) => {
      const t = e.target;
      if (aperto?.tipo === "lanciatore" && t.matches(".launcher-input")) return filtraLanciatore(aperto.el);
      if (!aperto && t.matches?.(".launcher-input") && t.closest(".launcher-layer")) return filtraLanciatore(t.closest(".launcher-layer"));
      if (t.matches?.("#kit-field-1")) return filtraAlbero(t.value);
      if (t.matches?.("#settings-search")) return cercaImpostazioni(t.value);
      if (t.matches?.('[id^="setting-"], #prefs-zoom-range, #prefs-accent-hue')) return inputAspetto(t);
    });

    // ── I gesti del telefono (provvisori, come il telaio A: D1) ─────────────
    // Strisciare da destra a sinistra o al contrario apre i cassetti, dal bordo
    // si torna indietro, la pressione lunga apre il menu del tocco.
    let gesto = null;
    const CASSETTI = new Set(["tel-cassetto", "t-cassetto-file", "g2-stretta-cassetto"]);
    doc.documentElement.toggleAttribute("data-sim-tocco", tel());
    doc.addEventListener("pointerdown", (e) => {
      if (!tel() || e.button !== 0) return;
      if (e.target.closest?.('[role="application"], [role="grid"], input, textarea, select')) return;
      const g = { x: e.clientX, y: e.clientY, t: e.target, mosso: false, timer: 0 };
      // I tempi vanno sulla finestra del simulatore: lo schermo è un iframe
      // senza «allow-scripts», e lì setTimeout non scatta mai.
      g.timer = window.setTimeout(() => {
        if (gesto !== g || g.mosso) return;
        gesto = null;
        inghiotti = true;
        if (menuDestro({ target: g.t, clientX: g.x, clientY: g.y, preventDefault() {} })) api.avviso("Pressione lunga: il menu del tocco.");
        else inghiotti = false;
      }, 500);
      gesto = g;
    });
    doc.addEventListener("pointermove", (e) => {
      if (gesto && Math.hypot(e.clientX - gesto.x, e.clientY - gesto.y) > 10) gesto.mosso = true;
    });
    const fineGesto = (e) => {
      const g = gesto;
      gesto = null;
      if (!g) return;
      window.clearTimeout(g.timer);
      if (e.type !== "pointerup") return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      // Sul testo vale lo stesso: al tocco una strisciata non sceglie testo
      // (serve la pressione lunga), quindi apre il cassetto come altrove.
      if (Math.abs(dx) < 60 || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
      inghiotti = true;
      window.setTimeout(() => (inghiotti = false), 400);
      const w = win.innerWidth;
      const st = stato();
      if (g.x < 24 || g.x > w - 24) {
        api.avviso("Dal bordo: indietro.");
        return api.indietro(casaDi());
      }
      if ((CASSETTI.has(st) && dx < 0) || (st === "tel-ispettore" && dx > 0)) {
        api.avviso("Il cassetto si chiude.");
        return api.indietro(casaDi());
      }
      if (dx > 0) {
        api.avviso("Da sinistra: il cassetto dei file.");
        return api.vai("tel-cassetto");
      }
      api.avviso("Da destra: l'ispettore.");
      return api.vai("tel-ispettore");
    };
    doc.addEventListener("pointerup", fineGesto);
    doc.addEventListener("pointercancel", fineGesto);
  }

  window.SIM_INTERAZIONI = { aggancia, css };
})();
