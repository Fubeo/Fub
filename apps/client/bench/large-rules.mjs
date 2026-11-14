// **Le regole dei passi ripetuti**: la parte pura del banco delle scene
// grandi (`large.mjs`).
//
// Sta a parte per la ragione per cui `motion-rules.mjs` sta a parte da
// `motion.mjs`: qui non c'è né browser né server, e un test la legge
// (`large-rules.test.ts`).
//
// # Perché si ripete
//
// Un passo che risponde a un comando (un tasto, la scelta) è un evento solo:
// se il banco lo misura una volta, un compito del runner che cade proprio in
// quel fotogramma (il garbage collector, lo scheduler della macchina
// condivisa) lo porta sopra la soglia senza che l'editor sia lento. Sui
// runner GitHub è successo: il tasto V a 49 900 elementi misurava 57 ms in un
// giro e 184 nel successivo, con tre compiti lunghi nella finestra; e un
// compito del runner di 74 ms, fuori da ogni passo, ha fatto rossa una
// scelta. Così le corse si fanno `REPEATS` volte, ognuna dallo stesso stato,
// e ogni passo si giudica sulla **mediana** delle sue misure, come
// l'assestamento peggiore di ogni giro e il compito lungo peggiore fuori dai
// passi (`worst`, 0 per un giro che non ne ha): un campione storto su tre non
// la sposta, una lentezza vera sì, perché tocca tutti i giri. La soglia
// resta quella.
//
// Se i campioni dello stesso passo hanno soglie diverse (un giro ridisegna la
// vista e un altro no), si prende la mediana dello **scarto** di ciascuno
// dalla sua soglia: con soglie uguali è lo stesso confronto della mediana
// con la soglia.

/// Quante volte si fa una corsa di passi che rispondono a un comando. Dispari,
/// perché la mediana sia una misura vera.
export const REPEATS = 3;

/// La mediana di un elenco di numeri finiti, non vuoto. Con un numero pari di
/// valori, la media dei due di mezzo.
export function median(values) {
  if (values.length === 0 || !values.every(Number.isFinite)) throw new RangeError("la mediana vuole numeri finiti, almeno uno");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/// Il giudizio di un passo misurato una o più volte: `samples` sono i tempi,
/// in millisecondi, `limits` la soglia, una per tutti o una per campione.
/// Passa se la mediana degli scarti dalla soglia non è sopra zero.
export function judgeSamples(samples, limits) {
  const each = typeof limits === "number" ? samples.map(() => limits) : limits;
  if (each.length !== samples.length) throw new RangeError("una soglia per campione, o una per tutti");
  const excess = median(samples.map((ms, i) => ms - each[i]));
  return { medianMs: median(samples), samplesMs: [...samples], limitsMs: each, pass: excess <= 0 };
}

/// Il più grande di un elenco di tempi, 0 se è vuoto: il compito lungo
/// peggiore di un giro fuori dai passi, o il suo assestamento peggiore. Un
/// giro senza conta 0, e la mediana dei giri si confronta con la soglia come
/// quella di un passo.
export function worst(values) {
  return values.reduce((a, b) => Math.max(a, b), 0);
}
