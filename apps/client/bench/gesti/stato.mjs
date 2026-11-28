// **Lo stato dell'editor letto da una sonda dei gesti**, prima e dopo il gesto.
//
// Un gesto si giudica dallo stato d'arrivo, non dal codice: il testo della
// nota col cursore, chi ha il fuoco, che cosa si è aperto o chiuso (menu,
// pannelli, avvisi), quanti blocchi sono scelti. Le funzioni `…NellaPagina`
// girano nel browser e non chiudono su niente di Node; le altre le chiamano.

/// Che cosa può essere «qualcosa che si apre»: menu, elenchi, finestre,
/// avvisi, suggerimenti di CodeMirror, pannelli della Live. Si guarda ciò che
/// compare o sparisce rispetto a prima del gesto, quindi una regola larga non
/// fa rumore: conta la differenza.
const APRIBILI = [
  "[role=menu]",
  "[role=listbox]",
  "[role=dialog]",
  "[role=alertdialog]",
  "[role=tooltip]",
  ".toast",
  ".cm-tooltip",
  ".slash-panel",
  ".selection-bubble",
  ".palette-box",
  ".cm-fub-block-menu",
  ".cm-fub-block-popover",
  "[class*='popover']",
  "[class*='-menu']",
  "[class*='-panel']",
  "[class*='-pop']",
].join(",");

/// Segna gli elementi apribili già visibili: la foto «dopo» li confronta.
export function segnaNellaPagina(selettori) {
  const visibile = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const prima = new Set();
  for (const el of document.querySelectorAll(selettori)) if (visibile(el)) prima.add(el);
  globalThis.__sondaPrima = prima;
}

/// La foto dello stato. `radice` è il riquadro a fuoco.
export async function fotoNellaPagina(selettori) {
  const corto = (s, n = 120) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const visibile = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const chi = (el) => {
    if (!el || el === document.body) return "pagina";
    if (el.closest(".cm-content")) return "testo della nota";
    const cls = [...el.classList].slice(0, 2).join(".");
    const nome =
      el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("title") ?? corto(el.textContent, 40);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${nome ? ` «${corto(nome, 50)}»` : ""}`;
  };
  const out = { testo: null, fuoco: chi(document.activeElement), aperti: [], chiusi: [], avvisi: [], blocchiScelti: 0 };
  const cm = document.querySelector(".pane.focus .pane-editor .cm-editor");
  if (cm) {
    const { findTextEditor } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditor(cm.parentElement);
    if (view) {
      const doc = view.state.doc.toString();
      const { from, to, head, empty } = view.state.selection.main;
      out.testo = empty
        ? `${doc.slice(0, head)}|${doc.slice(head)}`
        : `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
      out.doc = doc;
      out.da = from;
      out.a = to;
      out.selezioni = view.state.selection.ranges.length;
    }
    out.blocchiScelti = cm.querySelectorAll(".cm-fub-block-selected").length;
  }
  const prima = globalThis.__sondaPrima ?? new Set();
  const ora = [...document.querySelectorAll(selettori)].filter(visibile);
  const esterni = (els) => els.filter((el) => !els.some((altro) => altro !== el && altro.contains(el)));
  out.aperti = esterni(ora.filter((el) => !prima.has(el))).map((el) => `${chi(el).split(" «")[0]}: ${corto(el.innerText || el.textContent, 160)}`);
  out.chiusi = esterni([...prima].filter((el) => !ora.includes(el))).map((el) => chi(el).split(" «")[0]);
  out.avvisi = [...document.querySelectorAll(".toast")].filter(visibile).map((t) => corto(t.innerText, 140));
  return out;
}

/// Segna lo stato di partenza.
export async function segna(page) {
  await page.evaluate(segnaNellaPagina, APRIBILI);
}

/// Legge lo stato d'arrivo.
export async function foto(page) {
  return page.evaluate(fotoNellaPagina, APRIBILI);
}

/// Che cosa è cambiato nel testo fra due stati: il tratto diverso, con un po'
/// di contesto attorno. `null` se il testo è lo stesso.
export function cambio(prima, dopo, contesto = 12) {
  if (prima == null || dopo == null || prima === dopo) return null;
  let i = 0;
  while (i < prima.length && i < dopo.length && prima[i] === dopo[i]) i++;
  let j = 0;
  while (j < prima.length - i && j < dopo.length - i && prima[prima.length - 1 - j] === dopo[dopo.length - 1 - j]) j++;
  const da = Math.max(0, i - contesto);
  const v = (s) => s.replace(/\n/g, "⏎");
  const tolto = prima.slice(da, prima.length - j + Math.min(contesto, j));
  const messo = dopo.slice(da, dopo.length - j + Math.min(contesto, j));
  const taglia = (s) => (s.length > 220 ? `${s.slice(0, 110)}…${s.slice(-100)}` : s);
  return `«${taglia(v(tolto))}» → «${taglia(v(messo))}»`;
}

/// Lo stato in una riga per il referto: il cambio del testo rispetto a
/// `prima`, il testo vicino al cursore o la selezione, il fuoco, ciò che si è
/// aperto e chiuso, gli avvisi e i blocchi scelti.
export function riassunto(stato, prima = null, attorno = 30) {
  const parti = [];
  if (stato.testo !== null) {
    const c = cambio(prima?.doc, stato.doc);
    parti.push(c ? `testo: ${c}` : "testo uguale");
    const v = (s) => s.replace(/\n/g, "⏎");
    if (stato.da === stato.a) {
      parti.push(`cursore: «${v(stato.doc.slice(Math.max(0, stato.da - attorno), stato.da))}|${v(stato.doc.slice(stato.da, stato.da + attorno))}»`);
    } else {
      const s = stato.doc.slice(stato.da, stato.a);
      parti.push(`scelto: «${v(s.length > 80 ? `${s.slice(0, 40)}…${s.slice(-30)}` : s)}» (${s.length} car.)`);
    }
  }
  parti.push(`fuoco: ${stato.fuoco}`);
  if (stato.aperti.length) parti.push(`aperti: ${stato.aperti.join(" ‖ ")}`);
  if (stato.chiusi.length) parti.push(`chiusi: ${stato.chiusi.join(", ")}`);
  if (stato.avvisi.length) parti.push(`avvisi: ${stato.avvisi.join(" ‖ ")}`);
  if (stato.blocchiScelti) parti.push(`blocchi scelti: ${stato.blocchiScelti}`);
  if (stato.selezioni > 1) parti.push(`selezioni: ${stato.selezioni}`);
  if (stato.extra !== undefined) parti.push(`letto: ${JSON.stringify(stato.extra)}`);
  return parti.join(" · ");
}
