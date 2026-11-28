// Le voci della pagina «testata, proprietà, commenti, sbirciata e ispettore»
// (`docs/misure/gesti-editor/testata-commenti-ispettore.md`): `n` è la riga
// della tabella. Le voci partono dalle note della Live che le scene del banco
// già usano (`live=testata`, `proprieta`, `opzioni`, `relazioni`,
// `commenti`), aperte come le apre la scena (`openHeader`, `openComments`).
// Le righe dell'ispettore e della barra del titolo (88, 89, 91, 92,
// 106-122) sono fuori dal foglio della cornice: non hanno voce.
import { openComments, openHeader } from "../scene/gesti-scrittura.mjs";
import { pulsantiDellaScheda, riquadri, vociDelMenu } from "./letture.mjs";

export const DOC = "testata-commenti-ispettore.md";

const testata = (live, modo = "live_preview", altre) => ({ scena: (page) => openHeader(page, modo, altre), query: `live=${live}&tipi=1` });
const TESTATA = testata("testata");
const PROPRIETA = testata("proprieta");
const PROPRIETA_ALTRE = testata("proprieta", "live_preview", "more");
const OPZIONI = testata("opzioni");
const RELAZIONI = testata("relazioni");
const VUOTA = testata("testata-vuota");
const COMMENTI = { scena: (page) => openComments(page, "live_preview"), query: "live=commenti" };
/// Una nota della Live con un link a una nota che c'è, come nella pagina
/// della scrittura.
const LINK = { testo: "# Nota di prova\n\nVedi [[Benvenuto]] per cominciare.\n\nUltima riga." };

const riga = (key) => `.pane.focus .cm-fub-page-prop[data-key="${key}"]`;
const TITOLO = ".pane.focus .cm-fub-page-title";
const ICONA = ".pane.focus .cm-fub-page-icon";
const AGGIUNGI = ".pane.focus .cm-fub-page-props-add";
const ALTRE = ".pane.focus .cm-fub-page-props-more";
const FATTI = ".pane.focus .note-facts";

/// Il titolo e la sua scritta di segnaposto, l'icona, le proprietà in vista.
function laTestata(page) {
  return page.evaluate(() => {
    const vista = (s) => [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
    const t = vista(".pane.focus .cm-fub-page-title");
    const f = document.activeElement;
    const props = [...document.querySelectorAll(".pane.focus .cm-fub-page-prop")]
      .filter((p) => p.getClientRects().length > 0)
      .map((p) => `${p.dataset.key}=${(p.querySelector(".cm-fub-page-prop-value")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}`);
    return {
      titolo: t ? (t.value ?? t.textContent) : null,
      segnaposto: t ? t.getAttribute("placeholder") : null,
      fuoco: f ? `${f.tagName.toLowerCase()}.${[...f.classList].slice(0, 2).join(".")} «${f.getAttribute("aria-label") ?? ""}» ${f.value !== undefined ? `= «${String(f.value).slice(0, 30)}»` : ""}` : null,
      icona: vista(".pane.focus .cm-fub-page-icon")?.getAttribute("aria-label") ?? null,
      linguetta: document.querySelector(".tab.active, [role=tab][aria-selected=true]")?.textContent?.trim().slice(0, 30) ?? null,
      props,
    };
  });
}
/// Il pannello dell'icona: schede, figure ed emoji in vista.
function ilPannelloIcona(page) {
  return page.evaluate(() => {
    const p = [...document.querySelectorAll(".cm-fub-page-picker")].find((e) => e.getClientRects().length > 0);
    if (!p) return "nessun pannello";
    const visibili = (s) => [...p.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0);
    return {
      schede: visibili("[role=tab]").map((e) => e.textContent.trim()),
      figure: visibili(".cm-fub-page-figures .cm-fub-page-emoji-choice").length,
      emoji: visibili(".cm-fub-page-emoji:not(.cm-fub-page-figures) .cm-fub-page-emoji-choice").map((e) => e.textContent).slice(0, 8),
      pulsanti: visibili(".cm-fub-page-tool").map((e) => e.textContent.trim()),
    };
  });
}
/// Il riquadro del commento aperto: i campi, i pulsanti e se sono attivi.
function ilCommento(page) {
  return page.evaluate(() => {
    const p = [...document.querySelectorAll(".cm-fub-comment-popover")].find((e) => e.getClientRects().length > 0);
    if (!p) return "nessun riquadro";
    return {
      nome: !!p.querySelector(".cm-fub-comment-name"),
      messaggi: [...p.querySelectorAll(".cm-fub-comment-message")].map((m) => m.textContent.replace(/\s+/g, " ").trim().slice(0, 60)),
      pulsanti: [...p.querySelectorAll("button")].filter((b) => b.getClientRects().length > 0).map((b) => `${b.getAttribute("aria-label") ?? b.textContent.trim()}${b.disabled ? " (spento)" : ""}`),
      segni: document.querySelectorAll(".pane.focus .cm-fub-comment-range").length,
      bolle: document.querySelectorAll(".pane.focus .cm-fub-comment-bubble").length,
    };
  });
}
/// I dati della nota sotto la testata, e se ognuno è un'azione.
function iFatti(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".pane.focus .note-facts > *")].map((e) => `${e.tagName.toLowerCase()}: ${e.textContent.trim().slice(0, 30)}`),
  );
}

// La testata c'è due volte nel riquadro (una copia larga zero): ogni clic va
// sulla copia che si vede.
const vista = (page, sel) => page.locator(`${sel} >> visible=true`).first();
const clic = async (page, h, sel, opzioni) => {
  await vista(page, sel).click({ timeout: 3_000, ...opzioni });
  await h.fotogrammi();
};
const fuoco = async (page, h, sel, ...tasti) => {
  await vista(page, sel).focus();
  await h.tasti(...tasti);
};
/// Clic su una voce (menuitem, opzione, pulsante) di un riquadro aperto.
const voceIn = async (page, h, testo, dove = "[role=menu], [role=listbox], .cm-fub-page-popover, [class*=popover], [class*=-pop]") => {
  await page.locator(`:is(${dove}) :is([role^=menuitem], [role=option], button)`).filter({ hasText: testo }).first().click({ timeout: 3_000 });
  await h.fotogrammi();
};
const titolo = async (page, h) => {
  const b = await vista(page, TITOLO).boundingBox();
  await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2);
  await h.tasti("End");
};
const menuStato = (page, h) => clic(page, h, `${riga("stato")} .cm-fub-page-prop-key`);
const dataAperta = (page, h) => clic(page, h, `${riga("scadenza")} .cm-fub-page-prop-value`);
const dataVoce = async (page, h, testo) => {
  await dataAperta(page, h);
  await page.locator(".cm-fub-prop-date button").filter({ hasText: testo }).first().click({ timeout: 3_000 });
  await h.fotogrammi();
};
/// Il primo commento: sceglie «inaugurazione», Ctrl Alt M, e se l'app chiede
/// il nome lo scrive; poi il testo del commento, se c'è.
const componi = (testo) => async (page, h) => {
  await h.clic("inaugurazione", 0, { clickCount: 2 });
  await h.tasti("Control+Alt+m");
  await page.locator(".cm-fub-comment-popover .cm-fub-comment-composer").waitFor({ timeout: 3_000 });
  if (await page.locator(".cm-fub-comment-name input").count()) await page.locator(".cm-fub-comment-name input").fill("Prova");
  await page.locator(".cm-fub-comment-input").click();
  if (testo) await h.scrivi(testo);
};
const discussione = async (page, h) => {
  await clic(page, h, ".pane.focus .cm-fub-comment-bubble");
  await page.locator(".cm-fub-comment-popover .cm-fub-comment-message").first().waitFor({ timeout: 3_000 });
};
const azione = async (page, h, nome) => {
  await page.locator(".cm-fub-comment-popover button").filter({ hasText: nome }).first().click({ timeout: 3_000 });
  await h.fotogrammi();
};
const sbirciata = async (page, h) => {
  await h.tasti("Escape");
  await page.keyboard.down("Alt");
  await h.clic("Benvenuto", 3);
  await page.keyboard.up("Alt");
  await page.locator(".note-peek").waitFor({ timeout: 3_000 });
};

export const VOCI = [
  // Il titolo e l'icona.
  { n: 1, titolo: "Clic sul titolo e scrittura", partenza: TESTATA, gesto: async (page, h) => { await titolo(page, h); await h.scrivi("Z"); }, leggi: laTestata },
  { n: 2, titolo: "Invio nel titolo cambiato", partenza: TESTATA, gesto: async (page, h) => { await titolo(page, h); await h.scrivi("Z"); await h.tasti("Enter"); }, attesa: 700, leggi: laTestata },
  { n: 3, titolo: "Freccia giù nel titolo", partenza: TESTATA, gesto: async (page, h) => { await titolo(page, h); await h.tasti("ArrowDown"); }, leggi: laTestata },
  { n: 4, titolo: "Titolo svuotato", partenza: TESTATA, gesto: async (page, h) => { await titolo(page, h); await h.tasti("Control+a", "Backspace"); }, leggi: laTestata },
  { n: 5, titolo: "Titolo in Lettura", partenza: testata("testata", "reading"), gesto: async (page, h) => { await page.locator('.pane.focus[data-mode="reading"] .cm-fub-page-title').first().click(); await h.scrivi("Z"); }, leggi: laTestata },
  { n: 6, titolo: "Clic sull'icona", partenza: TESTATA, gesto: (page, h) => clic(page, h, ICONA), leggi: ilPannelloIcona },
  { n: 7, titolo: "Icona: Tab e Invio", partenza: TESTATA, gesto: (page, h) => fuoco(page, h, ICONA, "Enter") },
  { n: 8, titolo: "Scheda Emoji del pannello", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await page.waitForTimeout(300); }, leggi: ilPannelloIcona },
  { n: 9, titolo: "Ricerca dell'icona: «casa»", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await h.scrivi("casa"); await page.waitForTimeout(400); }, leggi: ilPannelloIcona },
  { n: 10, titolo: "Clic su una figura", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await clic(page, h, ".cm-fub-page-figures .cm-fub-page-emoji-choice"); }, leggi: laTestata },
  { n: 11, titolo: "Clic su un'emoji", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await page.waitForTimeout(300); await clic(page, h, ".cm-fub-page-emoji:not(.cm-fub-page-figures) .cm-fub-page-emoji-choice"); }, leggi: laTestata },
  { n: 12, titolo: "Togli l'icona", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await clic(page, h, ".cm-fub-page-picker > .cm-fub-page-tool"); }, leggi: laTestata },
  { n: 13, titolo: "Esc chiude il pannello dell'icona", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await h.tasti("Escape"); } },
  { n: 14, titolo: "Clic fuori dal pannello dell'icona", partenza: TESTATA, gesto: async (page, h) => { await clic(page, h, ICONA); await h.clic("Cose da fare", 2); } },
  { n: 15, titolo: "Nota senza icona: «Aggiungi un'icona»", partenza: VUOTA, gesto: (page, h) => clic(page, h, ".pane.focus .cm-fub-page-tool:has-text(\"Aggiungi un'icona\")"), leggi: ilPannelloIcona },
  // Il menu della proprietà.
  { n: 16, titolo: "Clic sul nome di una proprietà", partenza: PROPRIETA, gesto: menuStato, leggi: vociDelMenu },
  { n: 17, titolo: "Menu: Rinomina", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await voceIn(page, h, "Rinomina"); } },
  { n: 18, titolo: "Menu: Tipo", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await voceIn(page, h, "Tipo"); }, leggi: vociDelMenu },
  { n: 19, titolo: "Menu Tipo: Numero", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await voceIn(page, h, "Tipo"); await voceIn(page, h, "Numero"); }, attesa: 600 },
  { n: 20, titolo: "Menu: Togli dall'evidenza", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await voceIn(page, h, "evidenza"); }, attesa: 600, leggi: laTestata },
  { n: 21, titolo: "Menu: Togli dalla nota", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await voceIn(page, h, "Togli dalla nota"); }, attesa: 600, leggi: laTestata },
  { n: 22, titolo: "Menu: freccia giù e Invio", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await h.tasti("ArrowDown", "Enter"); }, leggi: vociDelMenu },
  { n: 23, titolo: "Menu Tipo: freccia sinistra", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await h.tasti("ArrowDown", "Enter", "ArrowLeft"); }, leggi: vociDelMenu },
  { n: 24, titolo: "Menu: Esc", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await h.tasti("Escape"); } },
  { n: 25, titolo: "Menu: scrivere", partenza: PROPRIETA, gesto: async (page, h) => { await menuStato(page, h); await h.scrivi("ti"); }, leggi: vociDelMenu },
  { n: 26, titolo: "Nome della proprietà: Tab, poi Invio", partenza: PROPRIETA, gesto: (page, h) => fuoco(page, h, `${riga("stato")} .cm-fub-page-prop-key`, "Enter"), leggi: vociDelMenu },
  // «Aggiungi una proprietà».
  { n: 27, titolo: "Clic su «Aggiungi una proprietà»", partenza: PROPRIETA, gesto: (page, h) => clic(page, h, AGGIUNGI), leggi: vociDelMenu },
  { n: "27b", titolo: "«Aggiungi una proprietà» nella nota senza proprietà", partenza: VUOTA, gesto: (page, h) => clic(page, h, AGGIUNGI), leggi: vociDelMenu },
  { n: 28, titolo: "«Aggiungi»: Tab e Invio", partenza: PROPRIETA, gesto: (page, h) => fuoco(page, h, AGGIUNGI, "Enter"), leggi: vociDelMenu },
  { n: 29, titolo: "«Aggiungi»: scrivere un nome", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, AGGIUNGI); await h.scrivi("Autore"); }, leggi: vociDelMenu },
  { n: 30, titolo: "«Aggiungi»: nome e tipo Testo", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, AGGIUNGI); await h.scrivi("Autore"); await voceIn(page, h, "Testo"); }, leggi: laTestata },
  { n: 31, titolo: "«Aggiungi»: una proprietà suggerita", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, AGGIUNGI); await page.locator("[role=menu] [role^=menuitem]").nth(1).click({ timeout: 3_000 }); await h.fotogrammi(); }, leggi: laTestata },
  { n: 32, titolo: "«Aggiungi»: Esc", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, AGGIUNGI); await h.tasti("Escape"); } },
  { n: 33, titolo: "«Aggiungi»: tipo Numero", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, AGGIUNGI); await h.scrivi("Pagine"); await voceIn(page, h, "Numero"); }, leggi: laTestata },
  { n: 34, titolo: "«Altre N proprietà»: apre e chiude", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, ALTRE); await clic(page, h, ALTRE); }, leggi: (page) => page.locator(ALTRE).getAttribute("aria-expanded") },
  // Stato, Data, Persone, Relazione.
  { n: 35, titolo: "Stato: clic sul valore", partenza: OPZIONI, gesto: (page, h) => clic(page, h, `${riga("stato")} .cm-fub-page-prop-value`), leggi: vociDelMenu },
  { n: 36, titolo: "Stato: «fa»", partenza: OPZIONI, gesto: async (page, h) => { await clic(page, h, `${riga("stato")} .cm-fub-page-prop-value`); await h.scrivi("fa"); } },
  { n: 37, titolo: "Stato: scegliere un'opzione del gruppo Fatto", partenza: OPZIONI, gesto: async (page, h) => { await clic(page, h, `${riga("stato")} .cm-fub-page-prop-value`); await voceIn(page, h, "Arrivata"); }, leggi: laTestata },
  { n: 38, titolo: "Stato: «Crea» un'opzione", partenza: OPZIONI, gesto: async (page, h) => { await clic(page, h, `${riga("stato")} .cm-fub-page-prop-value`); await h.scrivi("Bloccato"); await clic(page, h, ".cm-fub-prop-create"); }, attesa: 600 },
  { n: 39, titolo: "Data: clic sul valore", partenza: PROPRIETA, gesto: dataAperta, leggi: (page) => page.locator(".cm-fub-prop-date button").allInnerTexts() },
  { n: 40, titolo: "Data: «venerdì» e Invio", partenza: PROPRIETA, gesto: async (page, h) => { await dataAperta(page, h); await page.locator(".cm-fub-prop-date input").first().fill("venerdì"); await h.tasti("Enter"); }, attesa: 500, leggi: laTestata },
  { n: 41, titolo: "Data: testo non valido", partenza: PROPRIETA, gesto: async (page, h) => { await dataAperta(page, h); await page.locator(".cm-fub-prop-date input").first().fill("zzz"); }, leggi: (page) => page.locator(".cm-fub-prop-date input").first().evaluate((e) => `${getComputedStyle(e).color} ${e.getAttribute("aria-invalid")}`) },
  { n: 42, titolo: "Data: scelta rapida «Domani»", partenza: PROPRIETA, gesto: (page, h) => dataVoce(page, h, "Domani"), attesa: 500, leggi: laTestata },
  { n: 43, titolo: "Data: mese successivo", partenza: PROPRIETA, gesto: async (page, h) => { await dataAperta(page, h); await clic(page, h, ".cm-fub-prop-date-nav button >> nth=-1"); }, leggi: (page) => page.locator(".cm-fub-prop-date-head").first().innerText().catch(() => "nessuna testata") },
  { n: 44, titolo: "Data: clic su un giorno", partenza: PROPRIETA, gesto: async (page, h) => { await dataAperta(page, h); await page.locator(".cm-fub-prop-date-day").filter({ hasText: /^15$/ }).first().click(); await h.fotogrammi(); }, attesa: 500, leggi: laTestata },
  { n: 45, titolo: "Data: «Togli la data»", partenza: PROPRIETA, gesto: (page, h) => dataVoce(page, h, "Togli"), attesa: 500, leggi: laTestata },
  { n: 46, titolo: "Data: «Aggiungi l'ora»", partenza: PROPRIETA, gesto: (page, h) => dataVoce(page, h, "ora"), leggi: (page) => page.locator(".cm-fub-prop-date button").allInnerTexts() },
  { n: 47, titolo: "Data: Esc", partenza: PROPRIETA, gesto: async (page, h) => { await dataAperta(page, h); await h.tasti("Escape"); }, leggi: laTestata },
  { n: 48, titolo: "Persone: clic sul valore", partenza: PROPRIETA, gesto: (page, h) => clic(page, h, `${riga("persone")} .cm-fub-page-prop-value`), leggi: vociDelMenu },
  { n: 49, titolo: "Persone: clic su una persona", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, `${riga("persone")} .cm-fub-page-prop-value`); await clic(page, h, ".cm-fub-prop-people [role=option]"); }, leggi: laTestata },
  { n: 50, titolo: "Persone: «ma»", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, `${riga("persone")} .cm-fub-page-prop-value`); await h.scrivi("ma"); } },
  { n: 51, titolo: "Persone: «Chiara Neri» e Invio", partenza: PROPRIETA, gesto: async (page, h) => { await clic(page, h, `${riga("persone")} .cm-fub-page-prop-value`); await h.scrivi("Chiara Neri"); await h.tasti("Enter"); }, attesa: 500, leggi: laTestata },
  { n: 52, titolo: "Relazione: clic sul nome nel valore", partenza: RELAZIONI, gesto: (page, h) => clic(page, h, `${riga("libri")} .cm-fub-page-prop-value`), attesa: 600, leggi: riquadri },
  { n: 53, titolo: "Relazione: spuntare una nota", partenza: RELAZIONI, gesto: async (page, h) => { const b = await page.locator(`${riga("libri")} .cm-fub-page-prop-value`).boundingBox(); await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2); await clic(page, h, ".cm-fub-prop-relation [role=option]:not(.cm-fub-prop-group) >> nth=2"); }, leggi: laTestata },
  { n: 54, titolo: "Relazione: clic su «Dune»", partenza: RELAZIONI, gesto: (page, h) => clic(page, h, `${riga("libri")} .cm-fub-page-prop-value :text("Dune")`), attesa: 600, leggi: riquadri },
  // Numero, Testo, Casella, URL, Etichette, Selezione.
  { n: 55, titolo: "Numero: clic sul valore", partenza: PROPRIETA_ALTRE, gesto: (page, h) => clic(page, h, `${riga("budget")} .cm-fub-page-prop-value`) },
  { n: 56, titolo: "Numero: 5000 e Invio", partenza: PROPRIETA_ALTRE, gesto: async (page, h) => { await clic(page, h, `${riga("budget")} .cm-fub-page-prop-value`); await h.tasti("Control+a"); await h.scrivi("5000"); await h.tasti("Enter"); }, leggi: laTestata },
  { n: 57, titolo: "Numero: Esc", partenza: PROPRIETA_ALTRE, gesto: async (page, h) => { await clic(page, h, `${riga("budget")} .cm-fub-page-prop-value`); await h.scrivi("12"); await h.tasti("Escape"); }, leggi: laTestata },
  { n: 58, titolo: "Numero: «abc» e Invio", partenza: PROPRIETA_ALTRE, gesto: async (page, h) => { await clic(page, h, `${riga("budget")} .cm-fub-page-prop-value`); await h.tasti("Control+a"); await h.scrivi("abc"); await h.tasti("Enter"); }, attesa: 500, leggi: laTestata },
  { n: 59, titolo: "Testo: clic sul valore", partenza: PROPRIETA, gesto: (page, h) => clic(page, h, `${riga("tipo")} .cm-fub-page-prop-value`), leggi: laTestata },
  { n: 60, titolo: "Testo: Tab sul valore e Invio", partenza: PROPRIETA, gesto: (page, h) => fuoco(page, h, `${riga("tipo")} .cm-fub-page-prop-value`, "Enter"), leggi: laTestata },
  { n: 61, titolo: "Casella: clic sul valore", partenza: PROPRIETA_ALTRE, gesto: (page, h) => clic(page, h, `${riga("fatto")} .cm-fub-page-prop-value`), attesa: 500, leggi: laTestata },
  { n: 62, titolo: "URL: clic sul valore", partenza: OPZIONI, gesto: (page, h) => clic(page, h, `${riga("sito")} .cm-fub-page-prop-value`), attesa: 500, leggi: riquadri },
  { n: 63, titolo: "Etichette: clic sul valore", partenza: testata("testata", "live_preview", "more"), gesto: (page, h) => clic(page, h, `${riga("tags")} .cm-fub-page-prop-value`), leggi: laTestata },
  { n: 64, titolo: "Selezione: clic sul valore", partenza: OPZIONI, gesto: (page, h) => clic(page, h, `${riga("sala")} .cm-fub-page-prop-value`), leggi: vociDelMenu },
  { n: 65, titolo: "Selezione: «Media»", partenza: OPZIONI, gesto: async (page, h) => { await clic(page, h, `${riga("sala")} .cm-fub-page-prop-value`); await h.scrivi("Media"); } },
  // La riga dei dati.
  { n: 66, titolo: "«Modificata …» nei dati", partenza: TESTATA, gesto: (page, h) => clic(page, h, `${FATTI} > .note-fact:not([role])`), attesa: 500, leggi: iFatti },
  { n: 67, titolo: "«N collegamenti» nei dati", partenza: TESTATA, gesto: (page, h) => clic(page, h, `${FATTI} :text("collegamenti")`), attesa: 500, leggi: (page) => page.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.textContent?.trim() ?? null) },
  { n: 68, titolo: "«N commenti» nei dati", partenza: COMMENTI, gesto: (page) => page.waitForTimeout(100), leggi: iFatti },
  { n: 69, titolo: "Clic su un'etichetta nei dati", partenza: TESTATA, gesto: (page, h) => clic(page, h, `${FATTI} .note-tag`), attesa: 500 },
  { n: 70, titolo: "Tab e Invio su «N collegamenti»", partenza: TESTATA, gesto: (page, h) => fuoco(page, h, `${FATTI} .note-fact[role=button]`, "Enter"), attesa: 500, leggi: iFatti },
  { n: 71, titolo: "Tab e Invio su un'etichetta", partenza: TESTATA, gesto: (page, h) => fuoco(page, h, `${FATTI} .note-tag`, "Enter"), attesa: 500 },
  // I commenti.
  { n: 72, titolo: "Testo scelto e Ctrl Alt M", partenza: COMMENTI, gesto: async (page, h) => { await h.clic("inaugurazione", 0, { clickCount: 2 }); await h.tasti("Control+Alt+m"); }, leggi: ilCommento },
  { n: 73, titolo: "Ctrl Alt M col cursore nel blocco", partenza: COMMENTI, gesto: async (page, h) => { await h.clic("inaugurazione", 3); await h.tasti("Control+Alt+m"); }, leggi: ilCommento },
  { n: 74, titolo: "Commento: Ctrl Invio", partenza: COMMENTI, gesto: async (page, h) => { await componi("Da confermare")(page, h); await h.tasti("Control+Enter"); }, attesa: 500, leggi: ilCommento },
  { n: 75, titolo: "Commento: Invio", partenza: COMMENTI, gesto: async (page, h) => { await componi("Da confermare")(page, h); await h.tasti("Enter"); }, leggi: (page) => page.locator(".cm-fub-comment-input").inputValue().catch(() => "nessun campo") },
  { n: 76, titolo: "Commento: «Commenta»", partenza: COMMENTI, gesto: async (page, h) => { await componi("Da confermare")(page, h); await clic(page, h, ".cm-fub-comment-send"); }, attesa: 500, leggi: ilCommento },
  { n: 77, titolo: "Commento vuoto: «Commenta»", partenza: COMMENTI, gesto: componi(""), leggi: ilCommento },
  { n: 78, titolo: "Commento: Esc", partenza: COMMENTI, gesto: async (page, h) => { await componi("Da confermare")(page, h); await h.tasti("Escape"); }, leggi: ilCommento },
  { n: 79, titolo: "Commento: clic fuori", partenza: COMMENTI, gesto: async (page, h) => { await componi("Da confermare")(page, h); await h.clic("allestimento", 2); }, leggi: ilCommento },
  { n: 80, titolo: "Clic sul segno nel testo", partenza: COMMENTI, gesto: (page, h) => clic(page, h, ".pane.focus :is(.cm-fub-comment-range, .cm-fub-comment-sign)"), leggi: ilCommento },
  { n: 81, titolo: "Clic sulla bolla nel margine", partenza: COMMENTI, gesto: discussione, leggi: ilCommento },
  { n: 82, titolo: "Discussione: risposta con Ctrl Invio", partenza: COMMENTI, gesto: async (page, h) => { await discussione(page, h); await page.locator(".cm-fub-comment-popover .cm-fub-comment-input").click(); await h.scrivi("Va bene"); await h.tasti("Control+Enter"); }, attesa: 500, leggi: ilCommento },
  { n: 83, titolo: "Discussione: «Rispondi»", partenza: COMMENTI, gesto: async (page, h) => { await discussione(page, h); await page.locator(".cm-fub-comment-popover .cm-fub-comment-input").click(); await h.scrivi("Va bene"); await clic(page, h, ".cm-fub-comment-popover .cm-fub-comment-send"); }, attesa: 500, leggi: ilCommento },
  { n: 84, titolo: "Discussione: Risolvi", partenza: COMMENTI, gesto: async (page, h) => { await discussione(page, h); await azione(page, h, "Risolvi"); }, attesa: 500, leggi: ilCommento },
  { n: 85, titolo: "Risolta: Annulla", partenza: COMMENTI, gesto: async (page, h) => { await discussione(page, h); await azione(page, h, "Risolvi"); await clic(page, h, ".toast button:has-text(\"Annulla\")"); }, attesa: 500, leggi: ilCommento },
  { n: 86, titolo: "Discussione: Elimina", partenza: COMMENTI, gesto: async (page, h) => { await discussione(page, h); await azione(page, h, "Elimina"); }, attesa: 500, leggi: ilCommento },
  { n: 87, titolo: "Discussione: «Link»", partenza: COMMENTI, gesto: discussione, leggi: ilCommento },
  { n: 90, titolo: "Tasto destro su un commento", partenza: COMMENTI, gesto: (page, h) => h.clic("Museo Rossi", 2, { button: "right" }), leggi: vociDelMenu },
  // I link e la sbirciata.
  { n: 93, titolo: "Clic semplice su un link", partenza: LINK, gesto: async (page, h) => { await h.tasti("Escape"); await h.clic("Benvenuto", 3); }, attesa: 600, leggi: riquadri },
  { n: 94, titolo: "Ctrl clic su un link", partenza: LINK, gesto: async (page, h) => { await h.tasti("Escape"); await page.keyboard.down("Control"); await h.clic("Benvenuto", 3); await page.keyboard.up("Control"); }, attesa: 700, leggi: riquadri },
  { n: 95, titolo: "Alt clic su un link: la sbirciata", partenza: LINK, gesto: sbirciata, leggi: riquadri },
  { n: 96, titolo: "Sbirciata: «Apri qui»", partenza: LINK, gesto: async (page, h) => { await sbirciata(page, h); await clic(page, h, ".note-peek button:has-text(\"Apri qui\")"); }, attesa: 700, leggi: riquadri },
  { n: 97, titolo: "Sbirciata: «A lato»", partenza: LINK, gesto: async (page, h) => { await sbirciata(page, h); await clic(page, h, ".note-peek button:has-text(\"A lato\")"); }, attesa: 700, leggi: riquadri },
  { n: 98, titolo: "Sbirciata: la X", partenza: LINK, gesto: async (page, h) => { await sbirciata(page, h); await clic(page, h, ".note-peek button[aria-label^=\"Chiudi\"]"); }, attesa: 500, leggi: riquadri },
  { n: 99, titolo: "Sbirciata: Esc", partenza: LINK, gesto: async (page, h) => { await sbirciata(page, h); await h.tasti("Escape"); }, attesa: 500, leggi: riquadri },
  { n: 100, titolo: "Passaggio su un link, senza Ctrl", partenza: LINK, gesto: async (page, h) => { await h.tasti("Escape"); await h.passa("Benvenuto", 3); await page.waitForTimeout(900); }, leggi: pulsantiDellaScheda },
  {
    n: 101, titolo: "Ctrl tenuto sopra un link", partenza: LINK,
    gesto: async (page, h) => { await h.tasti("Escape"); await page.keyboard.down("Control"); await h.passa("Benvenuto", 3); await page.waitForTimeout(700); },
    leggi: async (page) => { const p = await pulsantiDellaScheda(page); await page.keyboard.up("Control"); return p; },
  },
  { n: 102, titolo: "Lettura: passaggio su un link", partenza: { ...LINK, modo: "reading" }, gesto: async (page) => { await page.locator('.pane.focus[data-mode="reading"] .markdown-rendered :text("Benvenuto")').first().hover(); await page.waitForTimeout(900); }, leggi: pulsantiDellaScheda },
  { n: 103, titolo: "Esc chiude la scheda del link", partenza: LINK, gesto: async (page, h) => { await h.tasti("Escape"); await h.passa("Benvenuto", 3); await page.waitForTimeout(900); await h.tasti("Escape"); await page.waitForTimeout(300); }, leggi: pulsantiDellaScheda },
  { n: 104, titolo: "Tasto destro su un link", partenza: LINK, gesto: async (page, h) => { await h.tasti("Escape"); await h.clic("Benvenuto", 3, { button: "right" }); }, leggi: vociDelMenu },
];
