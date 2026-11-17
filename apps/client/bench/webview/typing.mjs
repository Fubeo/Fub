// La scrittura di S1: 200 caratteri in fondo a una nota di 5.000 righe, in
// più giri nella stessa nota, e il valore che la soglia guarda.
//
// La sonda (`src/perf/probe.ts`) misura un tasto alla volta, dal `keydown` al
// secondo fotogramma dopo, e salta i tasti che arrivano mentre il precedente
// è ancora in volo: sul runner della CI, dove un fotogramma costa 30–150 ms,
// di 200 tasti ne misura 30–100. Il p95 di 35 campioni è il secondo più lento,
// e due fotogrammi lunghi nello stesso giro (la macchina condivisa del
// runner) lo portano da 180 a 400 ms sullo stesso commit (#293). Con più
// giri il referto dà la mediana dei p95: un giro storto non la sposta, un
// editor davvero più lento sposta tutti i giri e la mediana con loro.

/// I caratteri di un giro, gli stessi da sempre.
export const S1_TYPED = "Il corso di analisi del lunedì, in aula. ".repeat(5).slice(0, 200);

/// Quanti giri fa S1 nella stessa nota. Dispari, perché la mediana sia un
/// giro vero.
export const S1_ROUNDS = 5;

/// La pausa fra un giro e il successivo, fuori dalla misura: il salvataggio
/// della nota parte 400 ms dopo l'ultimo tasto (`SAVE_MS` in
/// `document-session.ts`) e la bozza al più un secondo dopo (`DRAFT_MS`), e
/// il loro lavoro non deve cadere nel giro dopo.
export const S1_ROUND_GAP_MS = 1_500;

/// La mediana di numeri già validi; `null` se non ce n'è nessuno. Con un
/// numero pari di valori, la media dei due di mezzo.
function median(xs) {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/// I valori di S1 dai referti della sonda, uno per giro, nell'ordine.
/// `S1.keyToPaint.p95` è la mediana dei p95 dei giri. Un giro senza tasti
/// misurati non ha un p95 (la sonda scrive 0, che non è un tempo): allora la
/// misura non vale e il valore è `null`, che la soglia conta come misura che
/// manca, invece di una mediana fatta sui giri rimasti.
export function s1Values(reports) {
  if (reports.length === 0) throw new Error("S1 senza giri");
  const keys = reports.map((r) => r.input.key);
  if (keys.some((k) => k.count === 0)) return { "S1.keyToPaint.p95": null };
  return { "S1.keyToPaint.p95": median(keys.map((k) => k.p95)) };
}

/// Una riga del referto coi giri: p95 e campioni di ciascuno.
export function s1Note(reports) {
  const keys = reports.map((r) => r.input.key);
  return `giri: p95 ${keys.map((k) => k.p95).join("/")} ms, campioni ${keys.map((k) => k.count).join("/")}`;
}
