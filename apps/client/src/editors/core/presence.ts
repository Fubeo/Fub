// I tre livelli di presenza (E1, «Il disegno», regola 1): ogni elemento del
// foglio ha un livello, e il livello decide quando si vede.
//
// - a riposo, sempre: il testo, la testata, la riga dei dati. Non porta
//   nessun segno;
// - `hover`, al passaggio: dove sta il puntatore o il fuoco della tastiera
//   (il «+» e la maniglia del blocco, gli strumenti della testata);
// - `request`, a richiesta: dopo un gesto, un clic, un tasto, un carattere
//   (la maniglia dell'immagine scelta, la linea d'arrivo di un
//   trascinamento).
//
// Il segno è `data-presence` sull'elemento: la scena «a riposo» del banco
// controlla che nessuno di questi si veda quando il foglio è fermo. Un
// elemento al passaggio non sposta mai il testo quando compare: sta nel
// margine o in uno spazio che c'era già.

export type Presence = "hover" | "request";

/// Dichiara il livello di presenza di `element`.
export function markPresence(element: Element, level: Presence): void {
  element.setAttribute("data-presence", level);
}
