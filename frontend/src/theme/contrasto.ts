// Il rapporto di contrasto della WCAG 2.1, in un posto solo.
//
// Stava dentro `contrast.test.ts`, che è il posto in cui è nato e per un pezzo
// il posto giusto: c'era un lettore solo. Adesso ce ne sono due — quel presidio,
// che legge i colori dai **fogli come testo**, e il catalogo della tavolozza del
// banco (`banco/catalogo.ts`), che li legge **resi** da `getComputedStyle`. Sono
// due misure diverse della stessa promessa, ed è esattamente la ragione per cui
// devono condividere la formula: se il conto fosse scritto due volte, il giorno
// in cui le due misure divergono nessuno saprebbe dire se è cambiato un colore o
// se è cambiata un'aritmetica.
//
// Non c'è nessun `import` verso `vitest` qui dentro apposta: questo modulo lo
// carica anche il browser.

/// I tre canali di un colore.
///
/// Legge `#rgb`, `#rrggbb` e la forma resa da `getComputedStyle`, che è sempre
/// `rgb(r, g, b)` o `rgb(r g b / a)` — quale delle due dipende dal motore, e
/// nessuna delle due è quella scritta nel foglio. Non legge nient'altro: i
/// token in `rgb(… / …)` con alfa sono veli e ombre, cioè colori che stanno
/// **sopra** qualcosa di variabile, e il loro contrasto non è una funzione dei
/// soli token — chi ne ha bisogno deve prima comporli su un fondo, e a quel
/// punto ha un colore pieno da passare di qua.
export function canali(colore: string): [number, number, number] {
  const testo = colore.trim();

  const esa = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(testo);
  if (esa) {
    const cifre = esa[1]!;
    const doppie =
      cifre.length === 3
        ? [...cifre].map((c) => c + c)
        : [cifre.slice(0, 2), cifre.slice(2, 4), cifre.slice(4, 6)];
    return doppie.map((h) => parseInt(h, 16)) as [number, number, number];
  }

  // `rgb(17, 20, 24)` e `rgb(17 20 24 / 0.5)`: il separatore è una virgola o
  // uno spazio, e l'alfa — se c'è — è ciò che questo modulo non sa comporre.
  const reso = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i.exec(
    testo,
  );
  if (reso) {
    if (reso[4] !== undefined && reso[4] !== "1" && reso[4] !== "100%") {
      throw new Error(`«${colore}» ha un'alfa: componilo su un fondo prima di contarlo`);
    }
    return [Number(reso[1]), Number(reso[2]), Number(reso[3])] as [number, number, number];
  }

  throw new Error(`«${colore}» non è un colore che questo conto sappia leggere`);
}

/// La luminanza relativa (WCAG, *relative luminance*).
export function luminanza(colore: string): number {
  const [r, g, b] = canali(colore).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Il rapporto di contrasto fra due colori: `(L1 + 0,05) / (L2 + 0,05)`, col
/// più chiaro sopra. È simmetrico — quale dei due sia l'inchiostro non cambia
/// il numero, e infatti chi lo chiama li ordina per leggibilità e non per conto.
export function contrasto(a: string, b: string): number {
  const [x, y] = [luminanza(a), luminanza(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
