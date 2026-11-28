// **Gli aiuti delle sonde dei gesti**: come si apre la nota di partenza e i
// gesti che tornano (un tasto, un clic su una parola, il puntatore su un
// blocco, la maniglia). Riusano il banco: la nota della Live (`?live=sonda`,
// `bench/live-fixture.ts`) e `openLive` delle scene.
import { openLive } from "../scene/gesti-scrittura.mjs";

/// Le opzioni del banco di ogni sonda dell'editor: la barra di formato coi
/// comandi del banco (`formatbar=1`) e il menu «/» con le sue voci (`slash=1`),
/// come nelle misure del 2026-11-21.
const QUERY_DI_BASE = "formatbar=1&slash=1";

const FINESTRA = { width: 1280, height: 800 };

/// Porta la pagina allo stato di partenza di una voce.
export async function apriNota(page, base, luce, partenza) {
  await page.setViewportSize(partenza.finestra ?? FINESTRA);
  const query = partenza.scena
    ? [`light=${luce}`, partenza.query].filter(Boolean)
    : [`light=${luce}`, "live=sonda", `testo=${encodeURIComponent(partenza.testo ?? "# Nota\n\n§")}`, QUERY_DI_BASE, partenza.query].filter(Boolean);
  await page.goto(`${base}${partenza.pagina ?? "/"}?${query.join("&")}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.bench === "ready" && !document.querySelector(".avvio"), null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  if (partenza.scena) {
    await partenza.scena(page);
  } else {
    const cursore = await page.evaluate(() => globalThis.__fubLiveBench?.cursor ?? null);
    await openLive(page, [], "top", partenza.modo ?? "live_preview");
    await page.waitForFunction(() => document.getAnimations().filter((a) => a.playState === "running").length === 0, null, { timeout: 5_000 }).catch(() => undefined);
    // `openLive` mette il cursore prima che la nota abbia finito di montarsi
    // (la testata arriva dopo): lo si rimette, a nota ferma.
    if (cursore !== null) {
      await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
        const { cursor, head } = globalThis.__fubLiveBench;
        view.dispatch({ selection: { anchor: cursor, head: head ?? cursor }, scrollIntoView: true });
        view.focus();
      });
    }
  }
  await page.mouse.move(0, 0);
  await fotogrammi(page);
}

export function fotogrammi(page, n = 2) {
  return page.evaluate((k) => new Promise((r) => {
    const passo = (i) => (i === 0 ? r() : requestAnimationFrame(() => passo(i - 1)));
    passo(k);
  }), n);
}

/// Il punto dello schermo del carattere `k` dopo l'inizio di `testo` (la
/// prima volta che compare) nella nota a fuoco.
async function punto(page, testo, k = 0) {
  const p = await page.evaluate(async ({ testo, k }) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    const i = view.state.doc.toString().indexOf(testo);
    if (i === -1) return null;
    const c = view.coordsAtPos(i + k, 1) ?? view.coordsAtPos(i + k, -1);
    return c ? { x: (c.left + c.right) / 2 + 1, y: (c.top + c.bottom) / 2 } : null;
  }, { testo, k });
  if (!p) throw new Error(`«${testo}» non è visibile nella nota`);
  return p;
}

/// Gli aiuti di una voce, legati alla sua pagina.
export function aiuti(page) {
  const h = {
    page,
    fotogrammi: (n) => fotogrammi(page, n),
    tasti: async (...tasti) => {
      for (const t of tasti) await page.keyboard.press(t);
      await fotogrammi(page);
    },
    scrivi: async (testo) => {
      await page.keyboard.type(testo);
      await fotogrammi(page);
    },
    punto: (testo, k) => punto(page, testo, k),
    /// Clic (o tasto destro, doppio clic: `opzioni` di Playwright) su un
    /// carattere di `testo`.
    clic: async (testo, k = 0, opzioni = {}) => {
      const p = await punto(page, testo, k);
      await page.mouse.click(p.x, p.y, opzioni);
      await fotogrammi(page);
    },
    passa: async (testo, k = 0) => {
      const p = await punto(page, testo, k);
      await page.mouse.move(p.x, p.y);
      await fotogrammi(page);
    },
    /// Il centro della maniglia del blocco di `testo`, dopo averci passato
    /// sopra il puntatore.
    maniglia: async (testo, quale = ".cm-fub-block-grip") => {
      await h.passa(testo);
      const el = page.locator(`.pane.focus .pane-editor ${quale}`).first();
      await el.waitFor({ state: "visible", timeout: 3_000 });
      const b = await el.boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    clicSu: async (selettore, opzioni = {}) => {
      await page.locator(selettore).first().click(opzioni);
      await fotogrammi(page);
    },
    /// Clic sulla voce di un menu aperto che ha questo testo.
    voce: async (testo, dove = "[role=menu], [role=listbox], .cm-fub-block-menu, .slash-panel") => {
      const el = page.locator(`${dove.split(",").map((s) => `${s.trim()} :is([role=menuitem],[role=option],button,li)`).join(",")}`).filter({ hasText: testo }).first();
      await el.click({ timeout: 3_000 });
      await fotogrammi(page);
    },
    aspetta: (selettore, stato = "visible") => page.locator(selettore).first().waitFor({ state: stato, timeout: 3_000 }),
    trascina: async (da, a, passi = 12, pausa = 0) => {
      await page.mouse.move(da.x, da.y);
      await page.mouse.down();
      await page.mouse.move(da.x, da.y + 6, { steps: 3 });
      await page.mouse.move(a.x, a.y, { steps: passi });
      if (pausa) await page.waitForTimeout(pausa);
      await page.mouse.up();
      await fotogrammi(page);
    },
  };
  return h;
}
