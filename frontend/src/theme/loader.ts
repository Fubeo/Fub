// Il caricatore del foglio e della pelle (§29.1).
//
// Montare un CSS qui vuol dire **sostituire**: prima si toglie quello che c'è,
// poi si appende il nuovo. Il vecchio modo — impilare fogli con `disabled` o
// con un `id` da sovrascrivere in cascata — metteva in gara la specificità di
// due temi e vinceva l'ultimo per una ragione che nessuno aveva scritto; qui
// il banco resta com'è: **un foglio montato e una pelle montata, mai due**. È
// la stessa promessa del loader della logica di presentazione (§2.2), fatta
// per il CSS: ciò che non è montato non vale, quindi non può nemmeno
// interferire.
//
// I due strati viaggiano su canali separati (`data-fub="foglio"` e
// `data-fub="pelle"`), perché crescono separatamente: la pelle di un tema di
// terzi sarà un file suo, e il foglio un altro. La struttura, che non si
// tematizza, non passa da qui: è importata da `main.ts` e resta sempre montata.
//
// Il testo arriva come stringa (`?raw`), non come CSS bundlato: il bundle
// saprebbe solo *aggiungere* fogli al documento, e il punto è sostituirli. I
// test del banco (`theme/loader.test.ts`) guardano qui dentro.

export type Strato = "foglio" | "pelle";

/** Monta uno strato a sostituzione: rimuove l'eventuale montato, appende il
 *  nuovo in coda a `<head>`. Il contenuto resta testo, non parsed: al
 *  navigatore la riga `textContent = css` basta, e non c'è parsing nostro da
 *  mantenere. */
export function monta(testo: string, strato: Strato): void {
  const head = document.head;
  for (const el of head.querySelectorAll<HTMLStyleElement>(
    `style[data-fub="${strato}"]`,
  )) {
    el.remove();
  }
  const el = document.createElement("style");
  el.dataset.fub = strato;
  el.textContent = testo;
  head.append(el);
}

/** Quanti elementi di uno strato sono montati. Nel banco dev'essere sempre 1
 *  dopo ogni `monta`; 0 significa «nessun tema», 2 significa che qualcuno ha
 *  ripreso ad accatastare. */
export function conta(strato: Strato): number {
  return document.head.querySelectorAll(`style[data-fub="${strato}"]`).length;
}
