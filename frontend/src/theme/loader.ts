// Il caricatore del foglio, della pelle e dei caratteri (§29.1, §31.3).
//
// Montare un CSS qui vuol dire **sostituire**: prima si toglie quello che c'è,
// poi si appende il nuovo. Il vecchio modo — impilare fogli con `disabled` o
// con un `id` da sovrascrivere in cascata — metteva in gara la specificità di
// due temi e vinceva l'ultimo per una ragione che nessuno aveva scritto; qui
// il banco resta com'è: **un elemento montato per canale, mai due**. È la
// stessa promessa del loader della logica di presentazione (§2.2), fatta per
// il CSS: ciò che non è montato non vale, quindi non può nemmeno interferire.
//
// I tre strati viaggiano su canali separati (`data-fub="caratteri"`,
// `data-fub="foglio"`, `data-fub="pelle"`), perché crescono separatamente: la
// pelle di un tema di terzi sarà un file suo, il foglio un altro, e i
// caratteri un terzo ancora (§31.3). La struttura, che non si tematizza, non
// passa da qui: è importata da `main.ts` e resta sempre montata.
//
// **L'ordine è dichiarato, non una conseguenza di quando si monta.** Finché i
// canali erano due, appendere in coda bastava — l'ordine di montaggio era
// sempre lo stesso ordine di lettura. Con un terzo canale (e presto un quarto,
// lo strato delle preferenze della persona, §31.6) non è più vero: chi monta
// prima o dopo dipende dall'ordine di avvio di `theme.ts`, e la cascata non
// deve dipendere da quello. `ORDINE` dice come i canali si susseguono nel
// documento — i caratteri per primi, perché non dipendono da nessun altro
// strato e ogni cosa dopo di loro può ridichiarare `font-family` a parità di
// specificità; la pelle per ultima, perché veste i componenti sopra ai token
// che il foglio dichiara — e `monta()` inserisce ogni nuovo elemento al posto
// giusto anche se i canali si montano in un ordine diverso.
//
// Il testo arriva come stringa (`?raw`), non come CSS bundlato: il bundle
// saprebbe solo *aggiungere* fogli al documento, e il punto è sostituirli. I
// test del banco (`theme/loader.test.ts`) guardano qui dentro.

export type Layer = "caratteri" | "foglio" | "pelle";

/** L'ordine dichiarato della cascata. Un canale nuovo si aggiunge qui, non si
 *  deduce da dove capita di chiamare `monta()`. */
const ORDER: readonly Layer[] = ["caratteri", "foglio", "pelle"];

/** Monta uno strato a sostituzione: rimuove l'eventuale montato, e inserisce
 *  il nuovo nel punto che `ORDINE` gli assegna — non necessariamente in coda.
 *  Il contenuto resta testo, non parsed: al navigatore la riga
 *  `textContent = css` basta, e non c'è parsing nostro da mantenere. */
export function mount(text: string, layer: Layer): void {
  const head = document.head;
  for (const el of head.querySelectorAll<HTMLStyleElement>(
    `style[data-fub="${layer}"]`,
  )) {
    el.remove();
  }
  const el = document.createElement("style");
  el.dataset.fub = layer;
  el.textContent = text;

  const position = ORDER.indexOf(layer);
  const mounted = head.querySelectorAll<HTMLStyleElement>("style[data-fub]");
  const next = [...mounted].find(
    (existing) => ORDER.indexOf(existing.dataset.fub as Layer) > position,
  );
  if (next) head.insertBefore(el, next);
  else head.append(el);
}

/** Quanti elementi di uno strato sono montati. Nel banco dev'essere sempre 1
 *  dopo ogni `monta`; 0 significa «nessun tema», 2 significa che qualcuno ha
 *  ripreso ad accatastare. */
export function count(layer: Layer): number {
  return document.head.querySelectorAll(`style[data-fub="${layer}"]`).length;
}
