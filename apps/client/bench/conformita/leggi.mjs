// **La lettura degli stili calcolati**, uguale dai due lati.
//
// La usano l'estrazione dal prototipo (`estrai.mjs`) e la verifica nell'app
// (`verifica.mjs`): un modo solo di leggere, perché due letture scritte in due
// posti divergono, e una differenza nata dal lettore si presenterebbe come una
// differenza di design.

/// Ciò che gira nella pagina: per ogni richiesta `{ selettore, proprieta }`
/// trova il primo elemento visibile dentro `radice` e ne legge le proprietà
/// lunghe con `getComputedStyle`. Un selettore che finisce in `::before` o
/// `::after` legge lo pseudo-elemento. `null` se non trova niente di visibile:
/// chi chiama lo tratta come rosso.
///
/// Il colore di un bordo senza stile (`border-*-style: none`) non disegna
/// niente: si scrive `none`, così due bordi assenti non differiscono per il
/// `currentColor` che il browser restituirebbe.
export function leggiNellaPagina({ radice, richieste }) {
  const base = radice ? document.querySelector(radice) : document;
  return richieste.map(({ selettore, proprieta }) => {
    if (!base) return null;
    const m = /^(.*?)(::(?:before|after))?$/.exec(selettore);
    const elementi = [...base.querySelectorAll(m[1])];
    const el = elementi.find((e) => e.getClientRects().length > 0);
    if (!el) return null;
    const stile = getComputedStyle(el, m[2] ?? null);
    if (m[2] && (stile.content === "none" || stile.content === "normal")) return null;
    const valori = {};
    for (const p of proprieta) valori[p] = stile.getPropertyValue(p);
    for (const lato of ["top", "right", "bottom", "left"]) {
      const s = valori[`border-${lato}-style`] ?? stile.getPropertyValue(`border-${lato}-style`);
      if ((s === "none" || s === "hidden") && `border-${lato}-color` in valori) {
        valori[`border-${lato}-color`] = "none";
      }
    }
    return valori;
  });
}

/// Ciò che gira nella pagina dell'app: risolve le espressioni coi token di Fub
/// (`var(--border)`, un `color-mix`…) **sotto l'elemento del pezzo**, così un
/// token ridefinito da un antenato (la luce, un pannello) vale come vale per
/// l'elemento. Una sonda invisibile, figlia dell'elemento (o del suo genitore,
/// se l'elemento non può avere figli resi: un campo, un'icona), prende
/// l'espressione come valore della stessa proprietà, e se ne legge lo stile
/// calcolato. Restituisce, per ogni voce, i valori risolti nell'ordine delle
/// espressioni; `null` se l'elemento non c'è.
export function risolviNellaPagina({ selettore, voci }) {
  const m = /^(.*?)(::(?:before|after))?$/.exec(selettore);
  const el = [...document.querySelectorAll(m[1])].find((e) => e.getClientRects().length > 0);
  if (!el) return null;
  const vuoti = ["INPUT", "TEXTAREA", "SELECT", "IMG"];
  const casa = el instanceof HTMLElement && !vuoti.includes(el.tagName) ? el : el.parentElement;
  const sonda = document.createElement("span");
  sonda.style.setProperty("position", "absolute");
  sonda.style.setProperty("visibility", "hidden");
  sonda.style.setProperty("pointer-events", "none");
  sonda.style.setProperty("border-style", "solid");
  casa.appendChild(sonda);
  try {
    return voci.map(({ proprieta, espressioni }) =>
      espressioni.map((e) => {
        sonda.style.setProperty(proprieta, e);
        const v = getComputedStyle(sonda).getPropertyValue(proprieta);
        sonda.style.removeProperty(proprieta);
        return v;
      }),
    );
  } finally {
    sonda.remove();
  }
}

/// Risolve in `page` le espressioni coi token di Fub sotto l'elemento di
/// `selettore`.
export async function risolvi(page, selettore, voci) {
  return page.evaluate(risolviNellaPagina, { selettore, voci });
}

/// Legge in `page` gli stili di un elenco di richieste.
export async function leggi(page, radice, richieste) {
  return page.evaluate(leggiNellaPagina, { radice, richieste });
}

/// Porta il puntatore o il fuoco dove dice il gesto di un pezzo della mappa:
/// `tipo` è `hover`, `focus` o `click`, `selettore` quello del proprio lato. I
/// selettori del prototipo vivono dentro `#win` (la `radice`), quelli
/// dell'app nella pagina.
export async function gesto(page, radice, tipo, selettore) {
  const dove = radice ? `${radice} ${selettore}` : selettore;
  if (tipo === "hover") await page.hover(dove);
  else if (tipo === "focus") await page.focus(dove);
  else if (tipo === "click") await page.click(dove);
  else throw new Error(`gesto sconosciuto: «${tipo}»`);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/// Riporta il puntatore in un angolo neutro dopo un passaggio del mouse.
export async function riposo(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
