// Le voci della pagina «scrittura, «/», «@», link e barra di formato»
// (`docs/misure/gesti-editor/scrittura.md`): `n` è la riga della tabella.
// Quasi ogni voce parte dalla stessa nota, dalla riga vuota sotto il primo
// paragrafo, come la misura del 2026-11-21.
import { pulsantiDellaBarra, pulsantiDellaMinibarra, pulsantiDellaScheda, riquadri, vociDelMenu, vociDelPannello } from "./letture.mjs";

export const DOC = "scrittura.md";

/// La nota: `riga` è il testo della riga di lavoro, col cursore `§` (o una
/// selezione fra due `§`).
function nota(riga = "§") {
  return { testo: `# Nota di prova\n\nIl primo paragrafo parla di Lisbona.\n\n${riga}\n\nUltima riga.` };
}
const VUOTA = nota();
const COMPLETA = { ...nota(), query: "toolbar=completa" };
const SCELTA = nota("Uno §due§ tre.");

/// Scrive `testo` nella riga vuota e preme i tasti dopo; `pausa` lascia al
/// completamento il tempo di chiedere le note al finto.
const scrive = (testo, ...tasti) => scriveDopo(150, testo, ...tasti);
const scriveDopo = (pausa, testo, ...tasti) => async (page, h) => {
  await h.scrivi(testo);
  await page.waitForTimeout(pausa);
  if (tasti.length) await h.tasti(...tasti);
};

/// Clic sul pulsante della barra di formato con questo nome (l'inizio
/// dell'`aria-label`).
async function barra(page, h, nome) {
  await page.locator(`.pane.focus [class*=format-bar] button[aria-label^="${nome}"]`).first().click({ timeout: 3_000 });
  await h.fotogrammi();
}
async function bolla(page, h, nome) {
  await page.locator(`.selection-bubble button[aria-label^="${nome}"]`).first().click({ timeout: 3_000 });
  await h.fotogrammi();
}

/// Un comando del «/»: scrive `/testo`, aspetta il pannello, preme Invio.
const slash = (n, testo, leggi) => ({ n, titolo: `«/${testo}» e Invio`, partenza: VUOTA, gesto: scrive(`/${testo}`, "Enter"), ...(leggi ? { leggi } : {}) });
/// Una regola di scrittura a inizio riga, poi la parola «Titolo».
const regola = (n, segno) => ({ n, titolo: `«${segno}» a inizio riga`, partenza: VUOTA, gesto: scrive(`${segno}Titolo`) });
const ctrlAlt = (n, cifra, riga = "Testo§") => ({ n, titolo: `Ctrl Alt ${cifra}`, partenza: nota(riga), gesto: (p, h) => h.tasti(`Control+Alt+${cifra}`) });
const quando = (n, testo) => ({ n, titolo: `«@${testo}»`, partenza: VUOTA, gesto: scrive(`@${testo}`), leggi: vociDelPannello });

export const VOCI = [
  { n: 1, titolo: "«/» in riga vuota", partenza: VUOTA, gesto: scrive("/"), leggi: vociDelPannello },
  { n: 2, titolo: "«/» dopo uno spazio", partenza: VUOTA, gesto: scrive("Uno /"), leggi: vociDelPannello },
  { n: 3, titolo: "«/» attaccato a una parola", partenza: VUOTA, gesto: scrive("a/"), leggi: vociDelPannello },
  { n: 4, titolo: "«/tit» filtra", partenza: VUOTA, gesto: scrive("/tit"), leggi: vociDelPannello },
  { n: 5, titolo: "Esc sul «/»", partenza: VUOTA, gesto: scrive("/", "Escape") },
  { n: 6, titolo: "Freccia giù due volte nel «/»", partenza: VUOTA, gesto: scrive("/", "ArrowDown", "ArrowDown"), leggi: vociDelPannello },
  { n: 7, titolo: "Freccia destra due volte nel «/»", partenza: VUOTA, gesto: scrive("/", "ArrowRight", "ArrowRight"), leggi: vociDelPannello },
  { n: 8, titolo: "Tab nel «/»", partenza: VUOTA, gesto: scrive("/", "Tab"), leggi: vociDelPannello },
  {
    n: 9, titolo: "Mouse su una voce del «/»", partenza: VUOTA,
    gesto: async (page, h) => { await h.scrivi("/"); await page.locator(".slash-panel [role=option]").nth(8).hover(); await h.fotogrammi(); },
    leggi: vociDelPannello,
  },
  {
    n: 10, titolo: "Clic su «Citazione» nel «/»", partenza: VUOTA,
    gesto: async (page, h) => { await h.scrivi("/"); await page.locator(".slash-panel [role=option]").filter({ hasText: "Citazione" }).first().click(); await h.fotogrammi(); },
  },
  slash(11, "titolo 2"),
  slash(12, "qwerty"),
  slash(13, "persona", vociDelPannello),
  slash(14, "domani"),
  slash(15, "separatore"),
  slash(16, "tabella"),
  slash(17, "tab 3x4"),
  slash(18, "riquadro", vociDelPannello),
  slash(19, "compito"),
  slash(20, "elenco puntato"),
  slash(21, "codice", vociDelPannello),
  slash(22, "formula"),
  { n: 23, titolo: "«/formula in riga»", partenza: VUOTA, gesto: scrive("/formula in riga"), leggi: vociDelPannello },
  slash(24, "link"),
  { n: 25, titolo: "«/base» (con la Base nel banco)", partenza: { ...VUOTA, query: "base=nota" }, gesto: scrive("/base"), leggi: vociDelPannello },
  slash(26, "colonne"),
  slash(27, "diagramma", vociDelPannello),
  slash(28, "ripiegabile"),
  slash(29, "citazione"),
  slash(30, "titolo 3"),
  slash(31, "data", vociDelPannello),
  { n: 32, titolo: "Le tessere del «/»", partenza: VUOTA, gesto: scrive("/"), leggi: (page) => page.evaluate(() => [...document.querySelectorAll(".slash-panel [class*=tile] , .slash-panel [class*=quick] [role=option]")].map((e) => e.textContent.trim()).slice(0, 10)) },
  regola(33, "# "),
  regola(34, "## "),
  regola(35, "### "),
  regola(36, "- "),
  regola(37, "- [ ] "),
  regola(38, "[] "),
  regola(39, "> "),
  regola(40, "1. "),
  { n: 41, titolo: "«$» a inizio riga", partenza: VUOTA, gesto: scrive("$") },
  { n: 42, titolo: "Invio a fine paragrafo, poi «Due»", partenza: nota("Uno§"), gesto: async (p, h) => { await h.tasti("Enter"); await h.scrivi("Due"); } },
  { n: 43, titolo: "Invio a metà paragrafo", partenza: nota("Uno §due"), gesto: (p, h) => h.tasti("Enter") },
  { n: 44, titolo: "Invio in un elenco puntato", partenza: nota("- uno§"), gesto: (p, h) => h.tasti("Enter") },
  { n: 45, titolo: "Invio su una voce vuota di elenco", partenza: nota("- uno\n- §"), gesto: (p, h) => h.tasti("Enter") },
  { n: 46, titolo: "Invio in un compito", partenza: nota("- [ ] uno§"), gesto: (p, h) => h.tasti("Enter") },
  { n: 47, titolo: "Ctrl Invio sul compito", partenza: nota("- [ ] uno§"), gesto: (p, h) => h.tasti("Control+Enter") },
  { n: 48, titolo: "Backspace in testa a un titolo", partenza: nota("## §Titolo"), gesto: (p, h) => h.tasti("Backspace") },
  { n: 49, titolo: "Backspace in testa a un paragrafo", partenza: nota("Uno\n\n§Due"), gesto: (p, h) => h.tasti("Backspace") },
  { n: 50, titolo: "Backspace su una riga vuota", partenza: VUOTA, gesto: (p, h) => h.tasti("Backspace") },
  { n: 51, titolo: "Tab in un elenco", partenza: nota("- uno\n- due§"), gesto: (p, h) => h.tasti("Tab") },
  ctrlAlt(52, 0, "## Testo§"),
  ctrlAlt(53, 2),
  ctrlAlt(54, 1),
  ctrlAlt(55, 3),
  ctrlAlt(56, 4),
  ctrlAlt(57, 5),
  ctrlAlt(58, 6),
  ctrlAlt(59, 7),
  ctrlAlt(60, 8),
  { n: 61, titolo: "Ctrl B sulla parola scelta", partenza: SCELTA, gesto: (p, h) => h.tasti("Control+b") },
  { n: 62, titolo: "Ctrl I", partenza: SCELTA, gesto: (p, h) => h.tasti("Control+i") },
  { n: 63, titolo: "Ctrl U", partenza: SCELTA, gesto: (p, h) => h.tasti("Control+u") },
  { n: 64, titolo: "Ctrl Maiusc X", partenza: SCELTA, gesto: (p, h) => h.tasti("Control+Shift+x") },
  { n: 65, titolo: "Ctrl K con testo scelto", partenza: SCELTA, gesto: (p, h) => h.tasti("Control+k") },
  { n: 66, titolo: "Ctrl K senza testo scelto", partenza: VUOTA, gesto: (p, h) => h.tasti("Control+k") },
  { n: 67, titolo: "«Uno», poi Ctrl Z", partenza: VUOTA, gesto: async (page, h) => { await h.scrivi("Uno"); await page.waitForTimeout(600); await h.tasti("Control+z"); } },
  { n: 68, titolo: "«Uno», Ctrl Z, Ctrl Y", partenza: VUOTA, gesto: async (page, h) => { await h.scrivi("Uno"); await page.waitForTimeout(600); await h.tasti("Control+z", "Control+y"); } },
  { n: 69, titolo: "Ctrl Maiusc 8", partenza: nota("Testo§"), gesto: (p, h) => h.tasti("Control+Shift+8") },
  { n: 70, titolo: "Ctrl Maiusc 7", partenza: nota("Testo§"), gesto: (p, h) => h.tasti("Control+Shift+7") },
  { n: 71, titolo: "La minibarra sulla selezione", partenza: SCELTA, gesto: (p, h) => h.fotogrammi(4), leggi: pulsantiDellaMinibarra },
  { n: 72, titolo: "Minibarra: grassetto", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Grassetto") },
  { n: 73, titolo: "Minibarra: corsivo", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Corsivo") },
  { n: 74, titolo: "Minibarra: sottolineato", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Sottolineato") },
  { n: 75, titolo: "Minibarra: barrato", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Barrato") },
  { n: 76, titolo: "Minibarra: codice in riga", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Codice in riga") },
  { n: 77, titolo: "Minibarra: collega", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Collega") },
  { n: 78, titolo: "Minibarra: colore", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Colore") },
  { n: 79, titolo: "Minibarra: Trasforma", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Trasforma"), leggi: vociDelMenu },
  { n: 80, titolo: "Minibarra: commenta", partenza: SCELTA, gesto: (p, h) => bolla(p, h, "Commenta") },
  { n: 81, titolo: "Selezione tolta", partenza: SCELTA, gesto: (p, h) => h.tasti("ArrowRight") },
  { n: 82, titolo: "Pannello del link: un indirizzo https", partenza: SCELTA, gesto: async (page, h) => { await h.tasti("Control+k"); await h.scrivi("https://esempio.it"); await h.tasti("Enter"); } },
  {
    n: 83, titolo: "Pannello del link: clic su una nota proposta", partenza: SCELTA,
    gesto: async (page, h) => { await h.tasti("Control+k"); await h.scrivi("Benv"); await page.waitForTimeout(500); await page.locator(".md-link-dialog-surface").getByText("Benvenuto", { exact: false }).last().click({ timeout: 3_000 }); await h.fotogrammi(); },
  },
  { n: "83b", titolo: "Pannello del link: «Benv» e Invio", partenza: SCELTA, gesto: async (page, h) => { await h.tasti("Control+k"); await h.scrivi("Benv"); await page.waitForTimeout(500); await h.tasti("Enter"); } },
  { n: 84, titolo: "Pannello del link: Esc", partenza: SCELTA, gesto: async (page, h) => { await h.tasti("Control+k"); await h.tasti("Escape"); } },
  { n: 85, titolo: "Pannello del link: «sint»", partenza: SCELTA, gesto: async (page, h) => { await h.tasti("Control+k"); await h.scrivi("sint"); await page.waitForTimeout(300); }, leggi: vociDelPannello },
  {
    n: 86, titolo: "Pannello del link: Annulla", partenza: SCELTA,
    gesto: async (page, h) => { await h.tasti("Control+k"); await page.locator("[role=dialog] button").filter({ hasText: "Annulla" }).first().click({ timeout: 3_000 }); await h.fotogrammi(); },
  },
  { n: 87, titolo: "Alt Invio su un link", partenza: nota("Vedi [[Ben§venuto]]."), gesto: (p, h) => h.tasti("Alt+Enter"), attesa: 700, leggi: riquadri },
  { n: 88, titolo: "Alt clic su un link", partenza: nota("Vedi [[Benvenuto]]."), gesto: async (page, h) => { await h.tasti("Escape"); await page.keyboard.down("Alt"); await h.clic("Benvenuto", 3); await page.keyboard.up("Alt"); }, attesa: 700, leggi: riquadri },
  {
    n: 89, titolo: "Ctrl sopra un link", partenza: nota("Vedi [[Benvenuto]]."),
    gesto: async (page, h) => { await page.keyboard.down("Control"); await h.passa("Benvenuto", 3); await page.waitForTimeout(700); },
    leggi: async (page) => { const pulsanti = await pulsantiDellaScheda(page); await page.keyboard.up("Control"); return pulsanti; },
  },
  { n: 90, titolo: "«[[»", partenza: VUOTA, gesto: scrive("[["), leggi: vociDelPannello },
  { n: 91, titolo: "«[[bib»", partenza: VUOTA, gesto: scriveDopo(700, "[[bib"), leggi: vociDelPannello },
  { n: 92, titolo: "«[[» e Invio", partenza: VUOTA, gesto: scriveDopo(700, "[[", "Enter") },
  {
    n: 93, titolo: "«[[» e clic su una nota", partenza: VUOTA,
    gesto: async (page, h) => { await h.scrivi("[["); await page.locator(".cm-tooltip-autocomplete [role=option], .slash-panel [role=option]").first().click({ timeout: 3_000 }); await h.fotogrammi(); },
  },
  { n: 94, titolo: "«[[Zeta»", partenza: VUOTA, gesto: scrive("[[Zeta"), leggi: vociDelPannello },
  { n: 95, titolo: "«[[Zeta» e Invio", partenza: VUOTA, gesto: scriveDopo(700, "[[Zeta", "Enter") },
  { n: 96, titolo: "«[[^^»", partenza: VUOTA, gesto: scrive("[[^^"), leggi: vociDelPannello },
  { n: 97, titolo: "«[[^^tema»", partenza: VUOTA, gesto: scrive("[[^^tema"), leggi: vociDelPannello },
  { n: 98, titolo: "«[[#»", partenza: VUOTA, gesto: scrive("[[#"), leggi: vociDelPannello },
  { n: 99, titolo: "Esc sul «[[»", partenza: VUOTA, gesto: scrive("[[", "Escape") },
  { n: 100, titolo: "«@» in riga vuota", partenza: VUOTA, gesto: scrive("@"), leggi: vociDelPannello },
  { n: 101, titolo: "«@» dopo uno spazio", partenza: VUOTA, gesto: scrive("Uno @"), leggi: vociDelPannello },
  { n: 102, titolo: "«mail@»", partenza: VUOTA, gesto: scrive("mail@"), leggi: vociDelPannello },
  { n: 103, titolo: "«@an»", partenza: VUOTA, gesto: scrive("@an"), leggi: vociDelPannello },
  { n: 104, titolo: "«@an» e Invio", partenza: VUOTA, gesto: scrive("@an", "Enter") },
  { n: 106, titolo: "«@domani» e Invio", partenza: VUOTA, gesto: scrive("@domani", "Enter") },
  { n: 107, titolo: "«@domani» in un compito", partenza: nota("- [ ] Fare la spesa §"), gesto: scrive("@domani", "Enter") },
  { n: 108, titolo: "«@Zeta» e Invio", partenza: VUOTA, gesto: scrive("@Zeta", "Enter") },
  { n: 109, titolo: "Esc sul «@»", partenza: VUOTA, gesto: scrive("@", "Escape") },
  quando(110, "venerdì"),
  quando(111, "20 marzo"),
  quando(112, "fra due settimane"),
  quando(113, "oggi"),
  quando(114, "20/3"),
  quando(115, "2027-03-20"),
  quando(116, "prossimo martedì"),
  { n: 117, titolo: "Barra: annulla", partenza: VUOTA, gesto: async (page, h) => { await h.scrivi("Uno"); await page.waitForTimeout(600); await barra(page, h, "Annulla"); } },
  { n: 118, titolo: "Barra: ripeti", partenza: VUOTA, gesto: async (page, h) => { await h.scrivi("Uno"); await page.waitForTimeout(600); await barra(page, h, "Annulla"); await barra(page, h, "Ripeti"); } },
  { n: 119, titolo: "Barra: stile del blocco", partenza: nota("Testo§"), gesto: (p, h) => barra(p, h, "Stile del blocco"), leggi: vociDelMenu },
  { n: 120, titolo: "Barra: stile → Titolo 2", partenza: nota("Testo§"), gesto: async (page, h) => { await barra(page, h, "Stile del blocco"); await h.voce("Titolo 2"); } },
  { n: 121, titolo: "Barra: grassetto con testo scelto", partenza: SCELTA, gesto: (p, h) => barra(p, h, "Grassetto") },
  { n: 122, titolo: "Barra: grassetto senza testo scelto", partenza: VUOTA, gesto: (p, h) => barra(p, h, "Grassetto") },
  { n: 123, titolo: "Barra: corsivo con testo scelto", partenza: SCELTA, gesto: (p, h) => barra(p, h, "Corsivo") },
  { n: 124, titolo: "Barra completa: c'è il barrato?", partenza: COMPLETA, gesto: (p, h) => h.fotogrammi(), leggi: pulsantiDellaBarra },
  { n: 125, titolo: "Barra completa: codice", partenza: { ...SCELTA, query: "toolbar=completa" }, gesto: (p, h) => barra(p, h, "Codice") },
  { n: 126, titolo: "Barra: link senza testo scelto", partenza: nota("Uno pa§rola tre."), gesto: (p, h) => barra(p, h, "Link") },
  { n: 127, titolo: "Barra: link con testo scelto", partenza: SCELTA, gesto: (p, h) => barra(p, h, "Link") },
  { n: 128, titolo: "Barra: elenco puntato", partenza: nota("Testo§"), gesto: (p, h) => barra(p, h, "Elenco puntato") },
  { n: 129, titolo: "Barra: elenco di attività", partenza: nota("Testo§"), gesto: (p, h) => barra(p, h, "Elenco di attività") },
  { n: 130, titolo: "Barra completa: citazione", partenza: { ...nota("Testo§"), query: "toolbar=completa" }, gesto: (p, h) => barra(p, h, "Citazione") },
  { n: 131, titolo: "Barra completa: tabella, da «Altri strumenti»", partenza: COMPLETA, gesto: async (page, h) => { await barra(page, h, "Altri strumenti"); await h.voce("Tabella"); } },
  { n: 132, titolo: "Barra: Inserisci", partenza: VUOTA, gesto: (p, h) => barra(p, h, "Inserisci"), leggi: vociDelPannello },
  { n: 133, titolo: "Barra: Inserisci → Titolo 2", partenza: VUOTA, gesto: async (page, h) => { await barra(page, h, "Inserisci"); await h.scrivi("Titolo 2"); await page.waitForTimeout(200); await h.tasti("Enter"); } },
  {
    n: 134, titolo: "Barra del compito: Scadenza", partenza: nota("- [ ] Fare la spesa§"),
    gesto: async (page, h) => { await barra(page, h, "Scadenza"); },
    leggi: pulsantiDellaBarra,
  },
  { n: 135, titolo: "Barra del compito: Promemoria", partenza: nota("- [ ] Fare la spesa§"), gesto: (p, h) => barra(p, h, "Promemoria") },
  { n: 136, titolo: "Barra del riquadro: tipo", partenza: nota("> [!note]\n> Testo§"), gesto: (p, h) => barra(p, h, "Note"), leggi: vociDelMenu },
  { n: 137, titolo: "Barra del riquadro: Ripiegabile", partenza: nota("> [!note]\n> Testo§"), gesto: (p, h) => barra(p, h, "Ripiegabile") },
  { n: 138, titolo: "Barra della tabella: Riga", partenza: nota("| A | B |\n| --- | --- |\n| 2 | x§ |\n| 1 | y |"), gesto: (p, h) => barra(p, h, "Riga") },
  { n: 139, titolo: "Barra della tabella: Ordina", partenza: nota("| A | B |\n| --- | --- |\n| 2 | x§ |\n| 1 | y |"), gesto: (p, h) => barra(p, h, "Ordina"), leggi: vociDelMenu },
  { n: 140, titolo: "Barra della Base: A tutta pagina", partenza: { ...nota("![[Opere.base#Tabella]]§"), query: "base=nota" }, gesto: async (page, h) => { await page.waitForTimeout(800); await barra(page, h, "A tutta pagina"); }, attesa: 700, leggi: riquadri },
  { n: "140b", titolo: "Barra della Base: i pulsanti", partenza: { ...nota("![[Opere.base#Tabella]]§"), query: "base=nota" }, gesto: (page) => page.waitForTimeout(800), leggi: pulsantiDellaBarra },
  { n: 141, titolo: "Barra del foglio (scheda viva): «Altri strumenti»", partenza: { ...nota("![[Conti.xlsx#Conti!A1:C4]]§"), query: "workbook=1" }, gesto: async (page, h) => { await page.waitForTimeout(800); await barra(page, h, "Altri strumenti"); }, leggi: vociDelMenu },
  { n: 142, titolo: "Barra della trasclusione", partenza: nota("![[Benvenuto]]§"), gesto: (page) => page.waitForTimeout(800), leggi: pulsantiDellaBarra },
  { n: "142b", titolo: "Barra della trasclusione: Apri l'origine", partenza: nota("![[Benvenuto]]§"), gesto: async (page, h) => { await page.waitForTimeout(800); await barra(page, h, "Apri l"); }, attesa: 700, leggi: riquadri },
  { n: 148, titolo: "Ctrl E", partenza: VUOTA, gesto: (p, h) => h.tasti("Control+e"), leggi: (page) => page.evaluate(() => document.querySelector(".pane.focus .pane-editor")?.className ?? null) },
  { n: 149, titolo: "Esc seleziona il blocco", partenza: nota("Testo§"), gesto: (p, h) => h.tasti("Escape") },
  { n: 150, titolo: "Avviso dopo un inserimento dal «/»", partenza: VUOTA, gesto: scrive("/compito", "Enter") },
];
