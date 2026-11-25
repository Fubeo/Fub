// Tab e Maiusc+Tab del Completo, come `window.dock` e `window.panels` di
// VectorCraft: Tab nasconde la barra, la colonna e i pannelli che si vedono, o
// rimostra quelli che l'ultimo Tab ha nascosto (tutti e tre se nessuno si vede e
// Tab non ne ha nascosto nessuno); Maiusc+Tab mostra o nasconde i soli pannelli.

/// I pannelli: nel dock dell'editor o nell'ispettore di chi lo ospita.
export interface PannelliTab {
  siVedono(): boolean;
  mostra(si: boolean): void;
}

type Quale = "barra" | "colonna" | "pannelli";

/// `premi(false)` è Tab, `premi(true)` Maiusc+Tab, `premi(null)` rimostra tutto
/// (uscendo dal Completo). La barra e la colonna si nascondono con lo stile, non con
/// `hidden`, che è di chi li tiene.
export function pannelliTab(barra: HTMLElement, colonna: HTMLElement, pannelli: PannelliTab): (soloPannelli: boolean | null) => void {
  const nascosti = new Set<Quale>();
  const pezzo = { barra, colonna } as const;
  const siVede = (element: HTMLElement): boolean => !element.hidden && element.style.display !== "none";
  const mostra = (quale: Quale, si: boolean): void => {
    if (quale === "pannelli") pannelli.mostra(si);
    else pezzo[quale].style.display = si ? "" : "none";
  };
  return (soloPannelli) => {
    if (soloPannelli === true) {
      nascosti.delete("pannelli");
      pannelli.mostra(!pannelli.siVedono());
      return;
    }
    if (soloPannelli === null || nascosti.size > 0) {
      for (const quale of nascosti) mostra(quale, true);
      nascosti.clear();
      return;
    }
    const visti: Quale[] = [...(["barra", "colonna"] as const).filter((quale) => siVede(pezzo[quale])), ...(pannelli.siVedono() ? (["pannelli"] as const) : [])];
    if (visti.length === 0) {
      for (const quale of ["barra", "colonna", "pannelli"] as const) mostra(quale, true);
      return;
    }
    for (const quale of visti) {
      nascosti.add(quale);
      mostra(quale, false);
    }
  };
}

/// Il Tab del foglio col motore nasconde i pannelli, e il fuoco non ne uscirebbe
/// mai: Fine e poi Tab esce dal foglio, col Tab del browser (WCAG 2.1.2). Vale
/// solo per il tasto subito dopo Fine; Maiusc non conta, così Fine e poi
/// Maiusc+Tab esce all'indietro. Rende che cosa fa il tasto: `fine` arma
/// l'uscita, `esce` lascia il Tab al browser, `tab` è il Tab dei pannelli.
export function uscitaDalFoglio(): (tasto: string) => "fine" | "esce" | "tab" | null {
  let dopoFine = false;
  return (tasto) => {
    if (tasto === "Shift") return null;
    const prima = dopoFine;
    dopoFine = tasto === "End";
    if (tasto === "End") return "fine";
    if (tasto === "Tab") return prima ? "esce" : "tab";
    return null;
  };
}
