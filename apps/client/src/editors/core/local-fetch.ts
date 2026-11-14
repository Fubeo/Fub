// Le letture di un file locale (un asset del vault, un file dell'app, un
// blob) fatte con `fetch`. Oggi la CSP non lascia uscire `connect-src` dalla
// app, ma un indirizzo che un giorno punti fuori non segue un redirect, non
// porta credenziali né referrer: lo stesso presidio delle tessere della
// mappa (`editors/base/surface.ts`).

/// Le opzioni di ogni lettura locale.
export const LOCAL_FETCH: RequestInit = Object.freeze({
  redirect: "error",
  credentials: "omit",
  referrerPolicy: "no-referrer",
});

/// Legge `url` senza redirect, credenziali né referrer.
export function fetchLocal(url: string): Promise<Response> {
  return fetch(url, LOCAL_FETCH);
}
