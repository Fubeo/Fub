// Ponte tra i due sistemi di offset che si incontrano al confine editor↔kernel.
//
// Gli `Span` del modello (e quindi ogni `reveal`/highlight che arriva dal core)
// sono in **byte UTF-8**: è così che Rust indicizza le stringhe. CodeMirror 6 —
// come ogni stringa JavaScript — indicizza in **code unit UTF-16**. Su testo
// ASCII i due coincidono; su un accento italiano (`à` = 2 byte, 1 code unit) o
// un'emoji (4 byte, 2 code unit) no, e uno scroll calcolato sui byte cadrebbe
// righe più in là. Questa è la conversione, e sta in un punto solo.

/// Lunghezza in byte UTF-8 di un code point.
function utf8Len(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/// Converte un offset in **byte UTF-8** dentro `text` nell'indice in **code
/// unit UTF-16** corrispondente (la posizione che CodeMirror capisce).
///
/// L'offset è atteso a un confine di code point (gli `Span` lo sono sempre: il
/// kernel li ricava da un parser che non spezza i caratteri). Un offset che
/// cadesse *dentro* un carattere multibyte viene arrotondato al confine
/// successivo, e un offset oltre la fine dà la fine del documento: uno scroll
/// non deve mai lanciare, al massimo essere di un carattere generoso.
export function byteToCharIndex(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  let units = 0;
  // `for…of` su una stringa itera per code point, non per code unit.
  for (const ch of text) {
    if (bytes >= byteOffset) return units;
    const cp = ch.codePointAt(0)!;
    bytes += utf8Len(cp);
    units += cp > 0xffff ? 2 : 1;
  }
  return units; // oltre la fine → fine del documento
}

/// L'inversa: da un indice in **code unit UTF-16** (una posizione di
/// CodeMirror) all'offset in **byte UTF-8** che il kernel capisce.
///
/// È la direzione che mancava, e senza la quale nessuna azione dell'editor
/// poteva parlare di `Span` al core: la selezione che attraversa il confine
/// (`ViewContext.selection`), un edit chirurgico, un'annotazione. Le regole
/// sono le stesse dell'andata, lette al contrario: una posizione dentro una
/// coppia surrogata — che CodeMirror non produce, ma un calcolo sì — si
/// arrotonda al confine di code point successivo, e oltre la fine si ottiene
/// la lunghezza in byte del documento.
/// La stessa conversione per **più posizioni insieme**, in un attraversamento
/// solo del testo.
///
/// Serve da quando il contesto pubblica N selezioni (decisione 0093): la
/// conversione qui sopra costa quanto l'offset che converte — è una scansione
/// dall'inizio —, e `paneContext()` gira a ogni `selectionSet`, cioè a ogni
/// battuta di tastiera. Chiamarla 2N volte vorrebbe dire pagare N volte lo
/// stesso attraversamento su un documento lungo, e con dieci cursori in fondo a
/// una nota lunga si vedrebbe. Qui gli indici si ordinano una volta e il testo
/// si percorre una volta: N cursori costano quanto uno.
///
/// Restituisce i byte **nell'ordine in cui gli indici sono arrivati**, non in
/// quello ordinato: chi chiama ha delle coppie da ricomporre.
export function charToByteIndices(text: string, charIndexes: readonly number[]): number[] {
  const order = charIndexes
    .map((value, position) => ({ value, position }))
    .sort((a, b) => a.value - b.value);
  const out = new Array<number>(charIndexes.length).fill(0);
  let bytes = 0;
  let units = 0;
  let k = 0;
  while (k < order.length && order[k].value <= 0) {
    out[order[k].position] = 0;
    k += 1;
  }
  for (const ch of text) {
    while (k < order.length && units >= order[k].value) {
      out[order[k].position] = bytes;
      k += 1;
    }
    if (k >= order.length) return out;
    const cp = ch.codePointAt(0)!;
    bytes += utf8Len(cp);
    units += cp > 0xffff ? 2 : 1;
  }
  // Ciò che resta cade oltre la fine → tutto il documento, come l'andata.
  while (k < order.length) {
    out[order[k].position] = bytes;
    k += 1;
  }
  return out;
}

export function charToByteIndex(text: string, charIndex: number): number {
  if (charIndex <= 0) return 0;
  let bytes = 0;
  let units = 0;
  for (const ch of text) {
    if (units >= charIndex) return bytes;
    const cp = ch.codePointAt(0)!;
    bytes += utf8Len(cp);
    units += cp > 0xffff ? 2 : 1;
  }
  return bytes; // oltre la fine → tutto il documento
}
