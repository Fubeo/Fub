// Le voci del banco delle animazioni dell'editor (`bench/conformita/animazioni.mjs`).
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
//
// # La forma di una voce
//
// Una voce è un gesto e gli elementi che si muovono per lui:
//
// - `id`: parole minuscole e punti (`maniglie.presa-passaggio`);
// - `stati` (facoltativo): di base le due luci a 1280 px (`STATI` di
//   `comuni.mjs`);
// - `contesto` (facoltativo): la traduzione dei token, come per i pezzi
//   (`documento` dentro la pagina);
// - `prototipo` e `app`: `prepara(page)` porta al punto di partenza a tempo
//   vero (per l'app dopo la scena `app.scena` di `bench/scene.mjs`);
//   `gesto(page)` è il gesto che si misura, a tempo fermo; `attende`
//   (facoltativo) un selettore da aspettare dopo il gesto, nella pagina intera;
// - `elementi`: `{ id, prototipo, app, proprieta, corsa? }`. I selettori del
//   prototipo stanno dentro `#win`, quelli dell'app nella pagina; `proprieta`
//   fra `geometria` (il riquadro, trasformazioni comprese: dice traslazione e
//   scala senza chiedere come sono scritte), `opacity` e i colori lunghi
//   (`background-color`, `color`…). `corsa: true` per un elemento che parte da
//   dove l'ha lasciato il gesto (un blocco trascinato): se ne confronta il
//   progresso, non lo scarto di partenza.
//
// Una riga dell'inventario delle animazioni diventa una voce: «elemento» dà gli
// elementi, «causa» il gesto, «proprietà» le proprietà; «da → a», durata,
// ritardo, curva e moto ridotto li misura il banco (`docs/development/
// visual-bench.md`, «Le animazioni»).
import { passo } from "./comuni.mjs";

const MANIGLIA_APP = '.pane.focus .pane-editor .cm-fub-block-handles[data-active="true"] .cm-fub-block-grip';
/// Le righe del documento nell'app: CodeMirror le rifà dopo una modifica, e
/// la riga si ritrova per il suo testo.
const RIGA_APP = ".pane.focus .pane-editor .cm-content > .cm-line";

export const ANIMAZIONI = [
  /// Il puntatore che arriva sulla presa della maniglia: il fondo e
  /// l'inchiostro passano al velo d'accento (una transizione CSS di 120 ms), e
  /// gli occhi si ingrandiscono del 12 % con un piccolo rimbalzo (160 ms,
  /// `cubic-bezier(0.3, 1.5, 0.5, 1)`). Prototipo righe 854–857; app
  /// `skin/document.css`, la presa dei Blocchi. Si parte col puntatore già
  /// sul blocco (le maniglie accese), non nell'angolo: lì le maniglie si
  /// spengono.
  {
    id: "maniglie.presa-passaggio",
    contesto: "documento",
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Al passaggio");
        await page.waitForSelector("#win #gutter.on");
        await page.hover('#win .blk[data-id="punto"]');
        await page.waitForSelector("#win #gutter.on");
      },
      gesto: (page) => page.hover("#win #g-grip"),
    },
    app: {
      scena: "blocchi-01-passaggio",
      gesto: (page) => page.hover(MANIGLIA_APP),
    },
    elementi: [
      { id: "presa", prototipo: "#g-grip", app: MANIGLIA_APP, proprieta: ["background-color", "color"] },
      { id: "occhi", prototipo: "#g-grip svg.ea", app: `${MANIGLIA_APP} .cm-fub-block-grip-eyes svg`, proprieta: ["geometria"] },
    ],
  },
  /// Il tasto destro su una selezione: il menu nasce dal punto del clic
  /// (scala 0,94 → 1 e opacità), poi le parti arrivano una dopo l'altra dal
  /// basso, 15 ms fra l'una e l'altra; l'icona della testata ha un suo piccolo
  /// salto. Prototipo righe 1277–1298 (`cxin`, `cxrow`, `cxpop`); app
  /// `ui/menu-enter.ts`, `enterAtPoint`. Si parte dalla selezione già fatta e dal
  /// menu chiuso con Esc: la copia del prototipo che svanisce (`.pop.cx.out`,
  /// tolta dal suo `onfinish`) se n'è già andata.
  {
    id: "menu.entrata-selezione",
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il tasto destro");
        await page.waitForSelector("#win .pop.cx .m-tiles");
        await page.keyboard.press("Escape");
        // Il menu si nasconde (`hidden`), la copia che svanisce se ne va.
        await page.waitForFunction(() => !document.querySelector("#win .pop.cx:not([hidden])"));
        // Il passo apre il menu da sé su una selezione sotto la piega: la si
        // porta in vista, che il puntatore ci possa arrivare.
        await page.evaluate(() => getSelection().anchorNode.parentElement.scrollIntoView({ block: "center" }));
      },
      gesto: (page) => tastoDestroSullaSelezione(page),
      attende: "#win .pop.cx:not(.out) .m-tiles",
    },
    app: {
      scena: "menu-selezione",
      prepara: async (page) => {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("#context-menu"));
      },
      gesto: (page) => tastoDestroSullaSelezione(page),
      attende: "#context-menu .menu-clipboard",
    },
    elementi: [
      { id: "menu", prototipo: ".pop.cx:not(.out)", app: "#context-menu", proprieta: ["geometria", "opacity"] },
      { id: "testata", prototipo: ".pop.cx:not(.out) .m.fresh > .m-head", app: "#context-menu > .menu-head", proprieta: ["geometria", "opacity"] },
      { id: "testata-icona", prototipo: ".pop.cx:not(.out) .m-head .ic", app: "#context-menu > .menu-head > svg", proprieta: ["geometria", "opacity"] },
      { id: "appunti", prototipo: ".pop.cx:not(.out) .m.fresh > .m-tiles", app: "#context-menu > .menu-clipboard", proprieta: ["geometria", "opacity"] },
      { id: "voce-1", prototipo: ".pop.cx:not(.out) .m-l > :nth-child(1)", app: "#context-menu .menu-items > :nth-child(2)", proprieta: ["geometria", "opacity"] },
      { id: "voce-2", prototipo: ".pop.cx:not(.out) .m-l > :nth-child(2)", app: "#context-menu .menu-items > :nth-child(3)", proprieta: ["geometria", "opacity"] },
      { id: "piede", prototipo: ".pop.cx:not(.out) .m.fresh > .m-find", app: "#context-menu > .menu-foot", proprieta: ["geometria", "opacity"] },
    ],
  },
  /// La posa di un blocco trascinato un posto più giù: il blocco scende dal
  /// punto in cui era in mano al suo posto nuovo e il vicino sale nel posto
  /// lasciato, 340 ms con `cubic-bezier(0.22, 1.12, 0.36, 1)` (un piccolo
  /// oltre). Prototipo `endDrag`, righe 3011–3017; app
  /// `blocks/motion.ts`, `SETTLE_MS` e `SETTLE_EASING`. Il trascinamento si
  /// fa a tempo vero e si aspetta che il blocco in mano raggiunga il
  /// puntatore; il gesto misurato è il rilascio. Il blocco parte da dove l'ha
  /// lasciato la mano, che non è un punto del disegno: `corsa: true`.
  {
    id: "blocchi.posa-trascinato",
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.evaluate(() => document.querySelector('#win .blk[data-id="task1"]').scrollIntoView({ block: "center" }));
        await trascinaDiUnPosto(page, {
          riga: '#win .blk[data-id="task1"]',
          testo: null,
          presa: "#win #g-grip",
          vicino: '#win .blk[data-id="task2"]',
          inMano: "#win .lift.up",
        });
      },
      gesto: (page) => page.mouse.up(),
    },
    app: {
      scena: "blocchi-01-passaggio",
      prepara: (page) =>
        trascinaDiUnPosto(page, {
          riga: RIGA_APP,
          testo: "Prenotare",
          presa: MANIGLIA_APP,
          vicino: RIGA_APP,
          testoVicino: "Comprare i biglietti",
          inMano: ".cm-fub-block-lift",
        }),
      gesto: (page) => page.mouse.up(),
    },
    elementi: [
      { id: "blocco", prototipo: '.blk[data-id="task1"]', app: { css: RIGA_APP, testo: "Prenotare" }, proprieta: ["geometria"], corsa: true },
      { id: "vicino", prototipo: '.blk[data-id="task2"]', app: { css: RIGA_APP, testo: "Comprare i biglietti" }, proprieta: ["geometria"] },
    ],
  },
];

/// Di quanto il puntatore va oltre il centro del vicino (px): abbastanza da
/// cambiare posto, e da lasciare il blocco in mano lontano dal suo posto nuovo
/// (il prototipo ve lo accosta entro 36 px, la calamita), perché la posa abbia
/// una corsa da misurare; non tanto da superare anche il blocco dopo.
const MOLTO = 14;

/// Prende un blocco per la maniglia e lo porta oltre il centro del vicino di
/// sotto, a tempo vero, senza lasciarlo: prima il puntatore sulla riga e
/// l'attesa che la maniglia le arrivi accanto (si sposta un fotogramma dopo),
/// poi i 4 px che fanno partire il trascinamento, poi la discesa. Finisce
/// quando il blocco in mano ha raggiunto il puntatore.
async function trascinaDiUnPosto(page, { riga, testo, presa, vicino, testoVicino = null, inMano }) {
  const scatola = (css, t) =>
    page.evaluate(
      ([c, x]) => {
        const el = [...document.querySelectorAll(c)].find((e) => e.getClientRects().length > 0 && (!x || e.textContent.includes(x)));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      [css, t],
    );
  const r = await scatola(riga, testo);
  const v = await scatola(vicino, testoVicino);
  if (!r || !v) throw new Error("manca la riga da trascinare o il suo vicino");
  await page.mouse.move(r.x + Math.min(r.w / 2, 120), r.y + r.h / 2);
  await page.waitForFunction(
    ([p, y0, y1]) => {
      const g = [...document.querySelectorAll(p)].find((e) => e.getClientRects().length > 0);
      if (!g) return false;
      const b = g.getBoundingClientRect();
      return b.top + b.height / 2 >= y0 && b.top + b.height / 2 <= y1;
    },
    [presa, r.y, r.y + r.h],
  );
  const g = await scatola(presa, null);
  const x = g.x + g.w / 2;
  const y = g.y + g.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 4 });
  await page.mouse.move(x, y + (v.y + v.h / 2) - (r.y + r.h / 2) + MOLTO, { steps: 12 });
  await page.waitForSelector(inMano);
  // Il blocco in mano insegue il puntatore per qualche fotogramma.
  await page.waitForTimeout(600);
}

/// Il tasto destro al centro della selezione di adesso: lo stesso gesto dai
/// due lati, dove la selezione è.
async function tastoDestroSullaSelezione(page) {
  const punto = await page.evaluate(() => {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0).getClientRects()[0];
    return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
  });
  if (!punto) throw new Error("manca la selezione su cui premere il tasto destro");
  await page.mouse.click(punto[0], punto[1], { button: "right" });
}

/// Le differenze vere trovate dal banco e non ancora corrette (la forma in
/// `confronto-animazioni.mjs`, `copertureAnimazioni`). Oggi nessuna.
export const DA_COPRIRE_ANIMAZIONI = [];
