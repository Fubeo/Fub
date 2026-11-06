// Sonda usa-e-getta: il DOM nuovo che i task del piano Scrittoio 2 faranno
// costruire al codice, applicato a una scena del banco per fotografarla.
// Ogni funzione corrisponde a un task (scritto nel commento) e usa soltanto
// classi, attributi e stringhe che quel task introduce.

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** T-banda: `#status-mode` diventa un bottone con icona, nome e freccia. */
export async function banda(page, { stato }) {
  await page.evaluate(async (mode) => {
    const { icon } = await import("/src/ui/icons.ts");
    const old = document.getElementById("status-mode");
    // Dove la banda oggi non mostra la modalità, non la mostra neanche il bottone.
    if (!old || old.hidden) return;
    const names = { live: "Live", blocks: "Blocchi", source: "Sorgente", reading: "Lettura", page: "Pagina", writing: "Scrittura" };
    const names2 = { board: "Lavagna", drawing: "Disegno" };
    Object.assign(names, names2);
    // Il documento ha le sue figure delle modalità (editors/rich/icons.ts).
    const docx = mode === "page" || mode === "writing";
    const icons = docx
      ? { page: "rc-mode-page", writing: "rc-mode-writing", reading: "rc-mode-reading" }
      : { live: "pen", blocks: "blocks", source: "code", reading: "eye", board: "layout-dashboard", drawing: "pen" };
    const b = document.createElement("button");
    b.type = "button";
    b.id = "status-mode";
    b.className = "status-item status-item--button status-mode";
    b.setAttribute("aria-haspopup", "menu");
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-label", `Modalità: ${names[mode]}`);
    b.innerHTML = `${icon(icons[mode])}<span class="status-mode-name">${names[mode]}</span><span class="status-mode-arrow" aria-hidden="true">${icon("chevron-up")}</span>`;
    old.replaceWith(b);
  }, stato.modo ?? "live");
}

/** T-banda: il menu delle modalità, aperto dalla banda, col menu standard. */
export async function menuModi(page, { stato }) {
  await page.evaluate(async (docx) => {
    const { showContextMenu } = await import("/src/ui/menu.ts");
    const { displayBinding } = await import("/src/ui/commands.ts");
    const b = document.getElementById("status-mode");
    b.setAttribute("aria-expanded", "true");
    const items = docx
      ? [
          { label: "Pagina", icon: "rc-mode-page", choice: "radio", checked: true },
          { label: "Scrittura", icon: "rc-mode-writing", choice: "radio", checked: false },
          { label: "Lettura", icon: "rc-mode-reading", choice: "radio", checked: false, separator: true, hint: displayBinding("Mod-e") },
        ]
      : [
          { label: "Live", icon: "pen", choice: "radio", checked: true },
          { label: "Blocchi", icon: "blocks", choice: "radio", checked: false, hint: displayBinding("Mod-Shift-b") },
          { label: "Sorgente", icon: "code", choice: "radio", checked: false },
          { label: "Lettura", icon: "eye", choice: "radio", checked: false, separator: true, hint: displayBinding("Mod-e") },
        ];
    showContextMenu(b, items, { label: "Modalità del riquadro" });
  }, stato.modo === "page");
  await page.waitForSelector(".context-menu, [role=menu]");
  await settle(page);
}

/** T-pillola: senza un comando in corso la pillola invita, non ripete la scheda. */
export async function pillola(page) {
  await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    const title = document.getElementById("pill-title");
    if (!title) return;
    title.textContent = "Cerca o esegui un comando";
    title.closest(".pill")?.setAttribute("data-empty", "");
    title.closest(".pill")?.setAttribute("aria-label", "Cerca o esegui un comando");
    const i = document.getElementById("pill-icon");
    if (i) i.innerHTML = icon("search");
  });
}

/** T-cassetto: testata con due bottoni a icona, filtro con lente, «Tutte le note N». */
export async function cassetto(page) {
  // I conti veri: si apre ogni cartella, si contano le voci dirette, si richiude.
  const folders = await page.$$eval('#file-list > li[role="treeitem"][aria-expanded]', (els) => els.map((e) => e.dataset.path));
  const counts = {};
  for (const path of folders) {
    const row = `#file-list li[role="treeitem"][data-path="${path}"] > .tree-row.folder`;
    const open = await page.$eval(`#file-list li[data-path="${path}"]`, (e) => e.getAttribute("aria-expanded") === "true");
    if (open) {
      counts[path] = await page.$$eval(`#file-list li[data-path="${path}"] > ul > li`, (els) => els.length);
      continue;
    }
    // Un clic da script: con le preferenze aperte l'albero sta sotto il foglio.
    await page.$eval(row, (el) => el.click());
    await page.waitForFunction((p) => document.querySelector(`#file-list li[data-path="${p}"]`)?.getAttribute("aria-expanded") === "true", path);
    await settle(page);
    counts[path] = await page.$$eval(`#file-list li[data-path="${path}"] > ul > li`, (els) => els.length);
    await page.$eval(row, (el) => el.click());
    await page.waitForFunction((p) => document.querySelector(`#file-list li[data-path="${p}"]`)?.getAttribute("aria-expanded") === "false", path);
  }
  await page.evaluate(async (counts) => {
    const { icon } = await import("/src/ui/icons.ts");
    const add = document.getElementById("new-note");
    if (add) {
      const box = document.createElement("span");
      box.className = "panel-title-actions";
      box.innerHTML =
        `<button type="button" class="icon-button" aria-label="Ordina le note" aria-haspopup="menu">${icon("sort")}</button>` +
        `<button type="button" id="new-note" class="icon-button" aria-label="Nuova nota" data-i18n-label="explorer.new">${icon("compose")}</button>`;
      add.replaceWith(box);
    }
    const fieldBox = document.querySelector(".explorer-filter .kit-field-box");
    if (fieldBox && !fieldBox.querySelector(".kit-field-icon")) {
      const lens = document.createElement("span");
      lens.className = "kit-field-icon";
      lens.setAttribute("aria-hidden", "true");
      lens.innerHTML = icon("search");
      fieldBox.prepend(lens);
    }
    for (const row of document.querySelectorAll("#pinned-list .tree-row")) {
      row.classList.remove("no-icon");
      const pin = document.createElement("span");
      pin.className = "row-icon row-pin";
      pin.setAttribute("aria-hidden", "true");
      pin.innerHTML = icon("pin");
      row.prepend(pin);
    }
    const list = document.getElementById("file-list");
    if (list && !document.getElementById("all-title")) {
      const head = document.createElement("div");
      head.className = "panel-title";
      head.id = "all-title";
      head.setAttribute("role", "heading");
      head.setAttribute("aria-level", "2");
      const total = 1 + Object.values(counts).reduce((a, b) => a + b, 0);
      head.innerHTML = `<span data-i18n="explorer.all">Tutte le note</span><span class="panel-count" aria-label="${total} elementi">${total}</span>`;
      list.before(head);
    }
    for (const [path, n] of Object.entries(counts)) {
      const row = document.querySelector(`#file-list li[data-path="${path}"] > .tree-row.folder`);
      if (!row || row.querySelector(".row-count")) continue;
      const c = document.createElement("span");
      c.className = "row-count";
      c.setAttribute("aria-hidden", "true");
      c.textContent = String(n);
      row.append(c);
    }
  }, counts);
}

/** T-schede: anche una nota porta la sua icona nella scheda. */
export async function schede(page) {
  await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    for (const name of document.querySelectorAll(".tab .tab-name")) {
      if (name.querySelector(".tab-format, .tab-page-icon")) continue;
      const tpl = document.createElement("template");
      tpl.innerHTML = icon("notes");
      const svg = tpl.content.firstElementChild;
      svg.classList.add("tab-format");
      name.prepend(svg);
    }
  });
}

/** T-testata: «Vault del banco / Guida / Benvenuto», con la cartella in testa. */
export async function testata(page) {
  await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    for (const title of document.querySelectorAll(".pane-toolbar .sheet-title")) {
      const path = title.dataset.path ?? "";
      const parts = path.split("/");
      const file = parts.pop() ?? "";
      const name = file.endsWith(".md") ? file.slice(0, -3) : file;
      let html = `${icon("folder")}<span data-folder="">Vault del banco</span>`;
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        html += `<span class="crumb-sep" aria-hidden="true">/</span><span data-folder="${acc}">${part}</span>`;
      }
      html += `<span class="crumb-sep" aria-hidden="true">/</span><span class="crumb-name">${name}</span>`;
      title.innerHTML = html;
    }
    for (const b of document.querySelectorAll("[data-pane-menu]")) b.innerHTML = icon("dots");
  });
}

/** T-ispettore: «Segue la nota», righe della struttura alte una riga, «In entrata». */
export async function ispettore(page) {
  await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    const follows = document.querySelector(".inspector-follows");
    if (follows && follows.dataset.state === "doc") follows.textContent = "Segue la nota";
    // node.ts: gli stili in linea passano a structure.css.
    for (const el of document.querySelectorAll(".ui-tree-label, .ui-list-item, .ui-tree-label > span")) el.removeAttribute("style");
    const tree = document.querySelector("#view-panel-outline .declared-view > .ui-tree");
    if (!tree || tree.closest(".ui-stack")) return;
    const rows = [
      ["Guida/Sintassi di Fub.md", "Sintassi di Fub", "Guida", "notes"],
      ["Progetti/Il banco che vede.md", "Il banco che vede", "Progetti", "notes"],
      ["Diario/2026-08-19.md", "2026-08-19", "Diario", "notes"],
    ];
    const stack = document.createElement("div");
    stack.className = "ui-stack";
    stack.dataset.dir = "column";
    tree.replaceWith(stack);
    stack.append(tree);
    const sec = document.createElement("details");
    sec.className = "ui-section";
    sec.dataset.key = "outline-incoming";
    sec.open = true;
    sec.innerHTML =
      `<summary>In entrata · ${rows.length}</summary><div class="ui-children"><div class="ui-list" role="list">` +
      rows
        .map(
          ([doc, title, where, ic]) =>
            `<div class="ui-list-item clickable" role="listitem" tabindex="0" data-activatable="sì" draggable="true" title="${doc}">` +
            `<span class="ui-list-item-icon" aria-hidden="true">${icon(ic)}</span>` +
            `<div class="ui-list-item-title">${title}</div><div class="ui-list-item-subtitle">${where}</div></div>`,
        )
        .join("") +
      `</div></div>`;
    stack.append(sec);
  });
}

/** T-riga-dati: la riga dei dati sotto il titolo (widget di blocco in Live). */
export async function datiNota(page, { inserisci }) {
  const html = await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    return (
      `<div class="note-facts" contenteditable="false" role="group" aria-label="Dati della nota">` +
      `<span class="note-fact">${icon("clock")}<span>Modificata 2 ore fa</span></span>` +
      `<span class="note-fact">${icon("backlink")}<span>3 collegamenti</span></span>` +
      `<span class="note-fact note-fact-tags"><span class="note-tag">#tema</span><span class="note-tag">#banco</span></span>` +
      `</div>`
    );
  });
  inserisci({ sel: ".pane.focus .cm-content .cm-fub-h1-line", where: "afterend", html });
  inserisci({ sel: ".pane.focus .markdown-rendered h1", where: "afterend", html });
}

/** Il banco: niente avvisi a comparsa nella foto. */
export async function senzaAvvisi(page) {
  await page.evaluate(() => {
    for (const t of document.querySelectorAll(".toast, .toasts > *")) t.remove();
  });
}

/** Le note nuove insieme, nell'ordine dei task. */
export async function nota(page, ctx) {
  await banda(page, ctx);
  await pillola(page, ctx);
  await cassetto(page, ctx);
  await schede(page, ctx);
  await testata(page, ctx);
  await ispettore(page, ctx);
  await datiNota(page, ctx);
  await senzaAvvisi(page, ctx);
  await page.mouse.move(660, 790);
}

/** T-cornice: la shell nuova attorno a qualunque editor. */
export async function cornice(page, ctx) {
  await pillola(page, ctx);
  await cassetto(page, ctx);
  await schede(page, ctx);
  await testata(page, ctx);
  await ispettore(page, ctx);
  await senzaAvvisi(page, ctx);
}

/** Alla fine: il puntatore lontano dai pulsanti. */
export async function via(page) {
  await page.mouse.move(660, 790);
}

/**
 * T-barra-serie: il kit mette `kit-ribbon` sulla radice e `kit-ribbon-<parte>`
 * accanto a `<prefisso>-<parte>` su ogni pezzo che costruisce. I pezzi propri di
 * un editor (galleria, tavolozza, campione) non prendono la classe del kit.
 */
export async function kitRibbon(page) {
  // Lo stato a cui porta T20/T21: ogni pezzo della barra ha la classe del kit;
  // le regole generiche di `.grid-ribbon-*` e `.rich-ribbon-*` non ci sono più
  // (qui: il pezzo perde la classe col prefisso). Restano le classi dei pezzi
  // di un editor e, nei fogli, quelle di «Comandi».
  await page.evaluate(() => {
    const parts = ["head", "quick", "tabs", "toggle", "panels", "panel", "toolbar", "group", "group-label", "group-body", "group-toggle", "stack", "row", "item", "button", "small", "large", "split", "split-large", "arrow", "label", "chevron", "glyph", "select", "input", "field", "field-label", "check", "keytip", "contextual", "color-bar"];
    const keep = new Set(["popover", "popup-group", "mini"]);
    for (const prefix of ["grid-ribbon", "rich-ribbon"]) {
      for (const root of document.querySelectorAll("." + prefix)) {
        root.classList.add("kit-ribbon");
        root.classList.remove(prefix);
      }
      for (const part of parts) {
        if (keep.has(part)) continue;
        for (const el of document.querySelectorAll("." + prefix + "-" + part)) {
          el.classList.add("kit-ribbon-" + part);
          const inQuick = prefix === "grid-ribbon" && (part === "quick" || el.closest(".grid-ribbon-quick"));
          if (!inQuick) el.classList.remove(prefix + "-" + part);
        }
      }
    }
  });
  // La barra si rimisura (ResizeObserver) con le regole nuove.
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width - 1, height: vp.height });
  await settle(page);
  await page.setViewportSize(vp);
  await settle(page);
  await page.evaluate(() => {
    for (const tabs of document.querySelectorAll(".kit-ribbon-tabs")) {
      const sel = tabs.querySelector('.kit-tab[aria-selected="true"]');
      const ind = tabs.querySelector(".kit-tab-indicator");
      if (sel && ind) {
        ind.style.left = sel.offsetLeft + "px";
        ind.style.width = sel.offsetWidth + "px";
      }
    }
  });
  await settle(page);
}

/**
 * T-testata-file: niente gettone del formato; «Si scrive», lo stato normale,
 * passa nella banda a voce bassa; gli altri stati restano nella testata.
 */
export async function testataFile(page) {
  await page.evaluate(() => {
    for (const f of document.querySelectorAll(".pane-format")) f.remove();
    const standing = document.querySelector('.pane.focus .pane-standing[data-standing="writes"], .pane-standing[data-standing="writes"]');
    const mode = document.getElementById("status-mode");
    if (standing && mode) {
      standing.hidden = true;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "status-item status-item--button status-standing";
      b.dataset.surfaceItem = "standing";
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-label", "Stato del documento: Si scrive");
      b.innerHTML = '<span class="status-standing-mark" aria-hidden="true"></span><span>Si scrive</span>';
      mode.before(b);
    }
  });
}

/**
 * T-pdf: la barra del PDF nella forma di serie. Le figure nuove le registra
 * `editors/media/icons.ts` con `registerIcon`; «Pagina N di M» va nella banda
 * come voce della superficie; «Apri con un'altra app» e «Copia il link alla
 * pagina» vanno in «…».
 */
export async function pdfBarra(page) {
  await page.evaluate(async () => {
    const { icon, registerIcon } = await import("/src/ui/icons.ts");
    const draw = {
      "media-page-previous": ["M15 6l-6 6 6 6"],
      "media-page-next": ["M9 6l6 6-6 6"],
      "media-thumbnails": ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
      "media-fit-width": ["M3 12h18", "M7 8l-4 4 4 4", "M17 8l4 4-4 4"],
      "media-two-pages": ["M3 5h8v14H3z", "M13 5h8v14h-8z"],
      "media-dark-pages": ["M12 3a9 9 0 1 0 0 18z", "M12 3a9 9 0 0 1 0 18"],
    };
    for (const [name, paths] of Object.entries(draw)) {
      try { registerIcon(name, paths); } catch {}
    }
    const bar = document.querySelector(".media-pdf-toolbar");
    if (!bar) return;
    const buttons = [...bar.querySelectorAll(":scope > button")];
    const by = (text) => buttons.find((b) => b.textContent.trim() === text);
    const iconButton = (b, name, label) => {
      if (!b) return null;
      b.setAttribute("aria-label", label);
      b.dataset.tooltip = label;
      b.innerHTML = icon(name);
      return b;
    };
    const group = (...els) => {
      const g = document.createElement("span");
      g.className = "media-pdf-group";
      g.setAttribute("role", "group");
      g.append(...els.filter(Boolean));
      return g;
    };
    const prev = iconButton(by("‹"), "media-page-previous", "Pagina precedente");
    const next = iconButton(by("›"), "media-page-next", "Pagina successiva");
    const thumbs = iconButton(by("Miniature"), "media-thumbnails", "Miniature");
    const fit = iconButton(by("Adatta alla larghezza"), "media-fit-width", "Adatta alla larghezza");
    const two = iconButton(by("Due pagine"), "media-two-pages", "Due pagine");
    const dark = iconButton(by("Colori scuri"), "media-dark-pages", "Colori scuri");
    for (const t of ["Apri con un'altra app", "Copia il link alla pagina"]) by(t)?.remove();
    const input = bar.querySelector(":scope > input");
    const outline = bar.querySelector(":scope > select");
    const search = document.createElement("span");
    search.className = "media-pdf-search";
    search.innerHTML = icon("search");
    if (input) search.append(input);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "kit-options-more";
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-label", "Altre azioni del PDF");
    more.innerHTML = icon("dots");
    bar.replaceChildren(group(prev, next), group(thumbs), outline ?? "", search, group(fit, two, dark), more);
    if (!outline) bar.querySelector(":scope > :empty:not(span, button)")?.remove();
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Strumenti del PDF");
    const status = document.querySelector(".media-pdf > p[role=status]");
    const end = document.getElementById("status-mode");
    if (status && end) {
      const item = document.createElement("span");
      item.className = "status-item";
      item.dataset.surfaceItem = "page";
      item.textContent = status.textContent;
      end.before(item);
      status.classList.add("sr-only");
    }
  });
}

/** Sonda: stampa le misure di alcuni elementi (solo per controllo). */
export async function misura(page, { stato }) {
  const out = await page.evaluate((sels) => {
    const r = {};
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)].slice(0, 4);
      r[s] = els.map((e) => {
        const b = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} mh=${cs.minHeight} fw=${cs.fontWeight}`;
      });
    }
    return r;
  }, stato.misura ?? []);
  console.log(JSON.stringify(out, null, 1));
}

/**
 * T-icone: il selettore dell'icona offre le figure monocrome del set
 * (`fub:<nome>`) accanto alle emoji, che restano una scelta piena. Due
 * sezioni col loro titolo; il campo e «Senza icona» restano.
 */
export async function icone(page) {
  await page.evaluate(async () => {
    const { pickIcon } = await import("/src/ui/menu.ts");
    const { icon } = await import("/src/ui/icons.ts");
    const row = document.querySelector('#file-list li[data-path="Guida"] > .tree-row');
    const r = row?.getBoundingClientRect() ?? { left: 120, bottom: 400 };
    pickIcon(new MouseEvent("contextmenu", { clientX: r.left + 40, clientY: r.bottom + 4 }), () => {});
    const pop = document.getElementById("icon-picker");
    const emoji = pop?.querySelector(".icon-grid");
    if (!pop || !emoji) return;
    // Quella scelta ora, per Guida: una figura o un'emoji.
    const chosen = row?.querySelector(".row-icon");
    const chosenFigure = !!chosen?.querySelector("svg");
    if (!chosenFigure && chosen?.textContent) {
      for (const b of emoji.querySelectorAll("button")) if (b.textContent === chosen.textContent.trim()) b.setAttribute("aria-pressed", "true");
    }
    const figures = [
      ["vault", "Cartella"], ["notes", "Nota"], ["book", "Libro"], ["calendar", "Calendario"], ["home", "Casa"],
      ["star", "Stella"], ["flag", "Bandiera"], ["bulb", "Idea"], ["inbox", "In arrivo"], ["archive", "Archivio"],
      ["image", "Immagine"], ["heart", "Cuore"], ["briefcase", "Lavoro"], ["people", "Persone"], ["music", "Musica"],
    ];
    const head = (key, text, id) => {
      const h = document.createElement("div");
      h.className = "icon-picker-title";
      h.id = id;
      h.dataset.i18n = key;
      h.textContent = text;
      return h;
    };
    const grid = document.createElement("div");
    grid.className = "icon-grid icon-grid--figures";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", "icon-picker-figures");
    for (const [name, label] of figures) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.dataset.icon = `fub:${name}`;
      b.innerHTML = icon(name);
      if (name === "book" && chosenFigure) b.setAttribute("aria-pressed", "true");
      grid.append(b);
    }
    emoji.setAttribute("role", "group");
    emoji.setAttribute("aria-labelledby", "icon-picker-emoji");
    emoji.before(head("icons.figures", "Figure", "icon-picker-figures"), grid, head("icons.emoji", "Emoji", "icon-picker-emoji"));
    pop.querySelector("input")?.blur();
    grid.querySelector("button")?.focus();
  });
  await settle(page);
}

/** T-kit-bar: ogni barra in una fila prende le classi del kit (`kit-bar`,
 *  `kit-bar-group`, `kit-bar-button`, `kit-bar-field`) e perde le sue regole
 *  vecchie nella pelle, come farà il task. La pelle sta tutta in un `<style>`
 *  generato: se ne riscrive il testo, togliendo i selettori vecchi uno per uno
 *  (una lista che ne tiene altri resta, senza quelli). */
export async function kitBar(page) {
  await page.evaluate(() => {
    const skin = [...document.querySelectorAll("style")].find((s) => s.textContent.startsWith("/* La pelle della serie Scrittoio"));
    const drop = [
      /^\.format-bar(:not\(\[hidden\]\))?$/,
      /^\.format-bar-group(:last-of-type)?$/,
      /^\.format-bar-(button|menu)(?![\w-])/,
      /^\.draw-header$/,
      /^\.media-pdf-toolbar(\s*>\s*(button|input|select)\b.*)?$/,
    ];
    // Le regole del disegno valgono anche per la sua colonna: restano, ma non
    // per i pulsanti che ora sono del kit.
    const scope = [
      [/^\.draw-button(?![\w-])/, ".draw-button:not(.kit-bar-button)"],
      [/^\.draw-group$/, ".draw-group:not(.kit-bar-group)"],
    ];
    const skipString = (css, j) => {
      const q = css[j];
      for (j += 1; j < css.length; j += 1) {
        if (css[j] === "\\") j += 1;
        else if (css[j] === q) return j;
      }
      return j;
    };
    const blockEnd = (css, open) => {
      let depth = 0;
      for (let j = open; j < css.length; j += 1) {
        const c = css[j];
        if (c === '"' || c === "'") j = skipString(css, j);
        else if (c === "/" && css[j + 1] === "*") j = css.indexOf("*/", j + 2) + 1;
        else if (c === "{") depth += 1;
        else if (c === "}" && --depth === 0) return j;
      }
      return css.length - 1;
    };
    const splitTop = (s) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let j = 0; j < s.length; j += 1) {
        const c = s[j];
        if (c === '"' || c === "'") j = skipString(s, j);
        else if (c === "(" || c === "[") depth += 1;
        else if (c === ")" || c === "]") depth -= 1;
        else if (c === "," && depth === 0) {
          parts.push(s.slice(start, j));
          start = j + 1;
        }
      }
      parts.push(s.slice(start));
      return parts;
    };
    const rewrite = (css) => {
      let out = "";
      let i = 0;
      while (i < css.length) {
        const ws = /^\s+/.exec(css.slice(i, i + 64));
        if (ws) {
          out += ws[0];
          i += ws[0].length;
          continue;
        }
        if (css.startsWith("/*", i)) {
          const j = css.indexOf("*/", i + 2) + 2;
          out += css.slice(i, j);
          i = j;
          continue;
        }
        let j = i;
        let paren = 0;
        for (; j < css.length; j += 1) {
          const c = css[j];
          if (c === '"' || c === "'") j = skipString(css, j);
          else if (c === "(") paren += 1;
          else if (c === ")") paren -= 1;
          else if (paren === 0 && (c === "{" || c === ";")) break;
        }
        if (j >= css.length) {
          out += css.slice(i);
          break;
        }
        const prelude = css.slice(i, j);
        if (css[j] === ";") {
          out += css.slice(i, j + 1);
          i = j + 1;
          continue;
        }
        const end = blockEnd(css, j);
        const body = css.slice(j + 1, end);
        const head = prelude.trim();
        if (head.startsWith("@")) {
          if (/^@(media|supports|container|layer|scope)\b/.test(head)) {
            const inner = rewrite(body);
            if (inner.replace(/\/\*[\s\S]*?\*\//g, "").trim()) out += `${prelude}{${inner}}`;
          } else out += `${prelude}{${body}}`;
        } else {
          const kept = [];
          for (let sel of splitTop(prelude).map((s) => s.trim()).filter(Boolean)) {
            if (drop.some((r) => r.test(sel))) continue;
            for (const [r, w] of scope) sel = sel.replace(r, w);
            kept.push(sel);
          }
          if (kept.length) out += `${kept.join(",\n")} {${body}}`;
        }
        i = end + 1;
      }
      return out;
    };
    if (skin) skin.textContent = rewrite(skin.textContent);

    const add = (sel, cls) => document.querySelectorAll(sel).forEach((e) => e.classList.add(cls));
    for (const bar of document.querySelectorAll(".format-bar")) {
      if (!bar.closest(".selection-bubble, .context-strip")) bar.classList.add("kit-bar");
    }
    add(".format-bar-group", "kit-bar-group");
    add(".format-bar-button, .format-bar-menu", "kit-bar-button");
    add(".draw-header", "kit-bar");
    add(".draw-header .draw-group", "kit-bar-group");
    add(".draw-header .draw-button", "kit-bar-button");
    add(".media-pdf-toolbar", "kit-bar");
    add(".media-pdf-group", "kit-bar-group");
    add(".media-pdf-toolbar button:not(.kit-options-more)", "kit-bar-button");
    add(".media-pdf-toolbar input, .media-pdf-toolbar select", "kit-bar-field");
  });
}

/** T2 + T3: il bottone della modalità porta l'icona e il nome (T2) ed è figlio
 *  del foglio, dopo la barra di formato (T3). Lo spostamento nel DOM avviene
 *  soltanto nella copia (`data-proto-sposta`, vedi `cattura.mjs`): la pagina
 *  viva resta del controllore. */
export async function modo(page) {
  await page.evaluate(async () => {
    const { icon } = await import("/src/ui/icons.ts");
    const icons = { live_preview: "pen", blocks: "blocks", source: "code", reading: "eye", canvas: "layout-dashboard", draw: "pen", read: "eye" };
    const docx = { document: "rc-mode-page", writing: "rc-mode-writing", reading: "rc-mode-reading" };
    for (const b of document.querySelectorAll(".pane-toolbar > .pane-mode-current")) {
      const pane = b.closest(".pane");
      const mode = pane?.querySelector(".pane-toolbar > .segmented > [aria-pressed='true']")?.dataset.mode ?? "";
      const rich = !!pane?.querySelector(".rich-surface");
      const name = (b.textContent ?? "").trim();
      b.innerHTML = `${icon((rich ? docx[mode] : icons[mode]) ?? "pen")}<span class="pane-mode-name">${name}</span>`;
      b.setAttribute("data-proto-sposta", "");
    }
  });
}

/** Il telefono a riposo: il testo non ha il fuoco, la barra di formato non c'è. */
export async function sfoca(page) {
  await page.evaluate(() => {
    const a = document.activeElement;
    if (a instanceof HTMLElement) a.blur();
  });
  await page.waitForFunction(() => !document.querySelector(".pane.focus .cm-focused"));
  await settle(page);
}

// ── Pre-alpha (pianificatore di Fub pre-alpha, usa e getta) ────────────────
// La stessa nota in un'altra modalità: si preme il segmento vero della testata
// (nascosto dal CSS nuovo, quindi un clic da script), poi la cornice di
// Scrittoio 2 come per «nota». `stato.modoNota`: live_preview | blocks | source | reading.
export async function notaIn(page, ctx) {
  const mode = ctx.stato.modoNota;
  await page.evaluate((m) => {
    const b = document.querySelector(`.pane.focus .pane-toolbar .segmented [data-mode="${m}"]`);
    if (!b) throw new Error("segmento mancante: " + m);
    b.click();
  }, mode);
  await page.waitForFunction((m) => document.querySelector(`.pane.focus .pane-toolbar .segmented [data-mode="${m}"]`)?.getAttribute("aria-pressed") === "true", mode);
  await settle(page);
  await page.waitForTimeout(250);
  await nota(page, ctx);
}

// Il conflitto: lo stesso DOM di `drawConflict` (panels/document.ts) e lo stato
// «Cambiato su disco» nella testata. Il banco non ha una scena che lo provochi.
export async function conflitto(page) {
  await page.evaluate(() => {
    const pane = document.querySelector(".pane.focus");
    const toolbar = pane?.querySelector(":scope > .pane-toolbar");
    let box = [...(pane?.children ?? [])].find((el) => el.tagName === "DIV" && el.hidden && !el.className);
    if (!box) {
      box = document.createElement("div");
      (pane.querySelector(":scope > .format-bar") ?? toolbar).after(box);
    }
    box.hidden = false;
    box.className = "conflict-banner";
    box.setAttribute("data-banner", "document.conflict.body");
    box.setAttribute("role", "alert");
    box.innerHTML =
      '<strong>Conflitto su Benvenuto</strong>' +
      '<p data-doc="Benvenuto.md">Il file è cambiato su disco. Scegli quale testo tenere: nessuna scelta è automatica.</p>' +
      '<div class="conflict-actions"><button type="button">Confronta</button>' +
      '<button type="button" class="primary" data-choice="mine">Mantieni il mio testo</button>' +
      '<button type="button" data-choice="theirs">Usa la versione su disco</button>' +
      '<button type="button" class="link-button">Decidi dopo</button></div>';
    for (const s of document.querySelectorAll(".sheet-save")) {
      const label = s.querySelector("span:last-child") ?? s;
      if (label.textContent?.includes("Salvato")) label.textContent = "Cambiato su disco";
      s.setAttribute("data-state", "conflitto");
      s.setAttribute("aria-label", "Stato del salvataggio: Cambiato su disco");
    }
  });
  await settle(page);
}

/** Il menu «Comandi» dei fogli aperto DOPO la barra del kit (che rimisura la
 * finestra e così chiude il menu aperto dalla scena). Solo pre-alpha. */
async function apriMenuComandi(page, path = []) {
  await page.keyboard.press("Escape");
  await page.click(".pane.focus .grid-ribbon-quick .grid-ribbon-button");
  await page.waitForSelector("#context-menu .menu-items [role^=menuitem]");
  for (const label of path) {
    const row = page.locator(".context-menu .menu-items [role^=menuitem]", { has: page.locator(".menu-label", { hasText: new RegExp(`^${label}$`) }) }).last();
    await row.click();
    await page.waitForSelector(`.context-submenu[aria-label="${label}"]`);
  }
  await settle(page);
}
export async function apriComandi(page) {
  await apriMenuComandi(page, ["Home", "Carattere"]);
}
export async function apriComandiCerca(page) {
  await apriMenuComandi(page);
  await page.keyboard.type("zzqx");
  await page.waitForSelector("#context-menu .menu-empty");
  await settle(page);
}

/** La cornice senza togliere gli avvisi a comparsa: per lo stato «toast». Solo pre-alpha. */
export async function corniceConAvvisi(page, ctx) {
  await pillola(page, ctx);
  await cassetto(page, ctx);
  await schede(page, ctx);
  await testata(page, ctx);
  await ispettore(page, ctx);
}

// ── Secondo giro ───────────────────────────────────────────────────────────
/** Clic dati dallo stato (`stato.clicca`: selettori Playwright), dopo gli altri
 * mods: una scheda della barra, uno strumento, un foglio. Solo pre-alpha. */
export async function clicca(page, { stato }) {
  for (const sel of stato.clicca ?? []) {
    await page.click(sel);
    await page.waitForTimeout(350);
  }
  await settle(page);
}

/** Tasti dati dallo stato (`stato.tasti`), dopo gli altri mods. Solo pre-alpha. */
export async function tasti(page, { stato }) {
  for (const k of stato.tasti ?? []) {
    if (k.length > 1 && /^[A-Z]/.test(k)) await page.keyboard.press(k);
    else await page.keyboard.type(k);
    await page.waitForTimeout(150);
  }
  await settle(page);
}

// ── Quarto giro: gli esiti del conflitto, col codice vero ──────────────────
// Il banner del conflitto è disegnato da `conflitto` (il banco non ha una scena
// che lo provochi). Gli esiti invece si fanno coi moduli veri del client: il
// confronto è `openCompare` (ui/compare.ts), la conferma è `confirm`
// (platform/confirm.ts) col presentatore della shell, le stringhe sono quelle
// del catalogo. Nessun DOM scritto a mano, tranne il banner ridotto, che copia
// riga per riga il ramo «rimandato» di `drawConflict`.
async function righeNota(page) {
  return page.evaluate(() => [...document.querySelectorAll(".pane.focus .cm-line")].map((l) => l.textContent ?? "").slice(0, 14));
}
/** «Confronta»: il diff per righe fra il disco e il mio testo. */
export async function confronta(page) {
  const righe = await righeNota(page);
  await page.evaluate(async (righe) => {
    const { openCompare } = await import("/src/ui/compare.ts");
    const { t } = await import("/src/i18n/strings.ts");
    const mio = [...righe];
    mio.splice(Math.min(3, mio.length), 0, "Ho aggiunto questa riga stamattina, prima di uscire.");
    const disco = [...righe];
    disco.splice(Math.min(3, disco.length), 0, "Riga scritta dal telefono, arrivata adesso.");
    openCompare(t("document.conflict.compare_title", { doc: "Benvenuto" }), disco.join("\n"), mio.join("\n"));
  }, righe);
  await page.waitForSelector(".modale .compare-box");
  await page.waitForTimeout(400);
  await settle(page);
}
// La conferma: `platform/confirm` importato da qui è un'altra istanza del modulo
// (senza il presentatore dichiarato), così si chiama `openDialog` del kit con
// gli stessi argomenti di `present` in shells/scrittoio/confirm.ts.
async function chiedi(page, choice) {
  await page.evaluate(async (choice) => {
    const { openDialog } = await import("/src/kit/index.ts");
    const { t } = await import("/src/i18n/strings.ts");
    const current = "Benvenuto.md";
    const ok = t(choice === "mine" ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs");
    const detail = t(choice === "mine" ? "commands.doc.conflict.mine.desc" : "commands.doc.conflict.theirs.desc");
    const { openLifetime } = await import("/src/ui/lifetime.ts");
    const danger = choice === "theirs";
    openDialog({
      lifetime: openLifetime(),
      title: t("document.conflict.title", { doc: current }),
      description: `${ok}\n${current}\n${detail}`,
      actions: [
        { id: "cancel", label: t("app.cancel"), value: false, autofocus: danger },
        { id: "confirm", label: ok, kind: danger ? "danger" : "primary", value: true },
      ],
      dismissValue: false,
    });
  }, choice);
  await page.waitForSelector(".kit-dialog");
  await page.waitForTimeout(400);
  await settle(page);
}
/** «Mantieni il mio testo»: la conferma prima di scrivere. */
export async function confermaMio(page) {
  await chiedi(page, "mine");
}
/** «Usa la versione su disco»: la conferma, col tono del pericolo. */
export async function confermaDisco(page) {
  await chiedi(page, "theirs");
}
/** «Decidi dopo»: il banner ridotto a una riga, come in `drawConflict`. */
export async function conflittoDopo(page) {
  await page.evaluate(async () => {
    const { t } = await import("/src/i18n/strings.ts");
    const box = document.querySelector(".pane.focus .conflict-banner");
    box.dataset.collapsed = "";
    box.setAttribute("role", "status");
    const line = document.createElement("span");
    line.textContent = t("document.conflict.pending", { doc: "Benvenuto" });
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "link-button";
    reopen.textContent = t("document.conflict.resume");
    box.replaceChildren(line, reopen);
  });
  await settle(page);
}
