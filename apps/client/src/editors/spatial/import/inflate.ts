// Il deflate (RFC 1951) dei file di draw.io: una pagina compressa è il suo
// XML passato da `encodeURIComponent`, compresso in deflate grezzo e scritto
// in base64; un PNG di draw.io porta il file in un `zTXt`, in zlib (RFC
// 1950). Si legge qui, senza il `DecompressionStream` del browser, che non
// tutte le WebView di Fub hanno per il deflate grezzo: lo stesso codice nel
// programma e nelle prove.
//
// È la decodifica canonica di Huffman, un bit alla volta, come la descrive
// la RFC: i file sono piccoli, e la chiarezza vale più della velocità.

/// Un flusso deflate che non si legge, o che si allarga oltre il limite.
export class InflateError extends Error {}

/// Le lunghezze e le distanze dei simboli dopo il 256, coi bit in più.
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/// L'ordine in cui un blocco dinamico scrive le lunghezze del codice delle
/// lunghezze.
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/// Il bit più lungo di un codice.
const MAX_BITS = 15;

/// Un codice di Huffman canonico: quanti codici per lunghezza, e i simboli
/// in ordine di codice.
interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

/// Il codice dalle lunghezze dei suoi simboli; 0 è un simbolo che non c'è.
function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!] = counts[lengths[i]!]! + 1;
  counts[0] = 0;
  // Un codice con più codici di quanti la sua lunghezza ne tenga non vale.
  let left = 1;
  for (let bits = 1; bits <= MAX_BITS; bits++) {
    left = left * 2 - counts[bits]!;
    if (left < 0) throw new InflateError("un codice di Huffman con troppi simboli");
  }
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let bits = 1; bits <= MAX_BITS; bits++) offsets[bits + 1] = offsets[bits]! + counts[bits]!;
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) {
    const bits = lengths[i]!;
    if (bits === 0) continue;
    symbols[offsets[bits]!] = i;
    offsets[bits] = offsets[bits]! + 1;
  }
  return { counts, symbols };
}

/// I codici fissi del blocco di tipo 1.
let fixedCodes: { readonly literals: Huffman; readonly distances: Huffman } | null = null;

function fixed(): { readonly literals: Huffman; readonly distances: Huffman } {
  if (fixedCodes === null) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    fixedCodes = { literals: huffman(lengths), distances: huffman(new Uint8Array(30).fill(5)) };
  }
  return fixedCodes;
}

/// Chi legge: i byte in entrata, i bit dal meno significativo, e l'uscita
/// che cresce fino a `limit` byte.
class Inflater {
  private at = 0;
  private bitBuffer = 0;
  private bitCount = 0;
  private out: Uint8Array;
  private length = 0;

  constructor(
    private readonly input: Uint8Array,
    private readonly limit: number,
  ) {
    this.out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
  }

  run(): Uint8Array {
    let last = false;
    while (!last) {
      last = this.bits(1) === 1;
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.block(fixed().literals, fixed().distances);
      else if (type === 2) this.dynamic();
      else throw new InflateError("un blocco di tipo sconosciuto");
    }
    return this.out.subarray(0, this.length);
  }

  private bits(count: number): number {
    while (this.bitCount < count) {
      if (this.at >= this.input.length) throw new InflateError("il flusso finisce a metà");
      this.bitBuffer |= this.input[this.at++]! << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << count) - 1);
    this.bitBuffer >>>= count;
    this.bitCount -= count;
    return value;
  }

  private decode(code: Huffman): number {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let bits = 1; bits <= MAX_BITS; bits++) {
      value |= this.bits(1);
      const count = code.counts[bits]!;
      if (value - first < count) return code.symbols[index + value - first]!;
      index += count;
      first = (first + count) * 2;
      value *= 2;
    }
    throw new InflateError("un codice di Huffman che non c'è");
  }

  private push(byte: number): void {
    if (this.length === this.out.length) {
      if (this.length >= this.limit) throw new InflateError("il contenuto è troppo grande");
      const grown = new Uint8Array(Math.min(this.limit, this.out.length * 2));
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.length++] = byte;
  }

  private stored(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
    if (this.at + 4 > this.input.length) throw new InflateError("il flusso finisce a metà");
    const size = this.input[this.at]! | (this.input[this.at + 1]! << 8);
    const check = this.input[this.at + 2]! | (this.input[this.at + 3]! << 8);
    if ((size ^ 0xffff) !== check) throw new InflateError("un blocco non compresso con la lunghezza sbagliata");
    this.at += 4;
    if (this.at + size > this.input.length) throw new InflateError("il flusso finisce a metà");
    for (let i = 0; i < size; i++) this.push(this.input[this.at++]!);
  }

  private dynamic(): void {
    const literalCount = this.bits(5) + 257;
    const distanceCount = this.bits(5) + 1;
    const lengthCount = this.bits(4) + 4;
    if (literalCount > 286 || distanceCount > 30) throw new InflateError("un blocco con troppi codici");
    const codeLengths = new Uint8Array(19);
    for (let i = 0; i < lengthCount; i++) codeLengths[ORDER[i]!] = this.bits(3);
    const lengthCode = huffman(codeLengths);
    const lengths = new Uint8Array(literalCount + distanceCount);
    for (let i = 0; i < lengths.length; ) {
      const symbol = this.decode(lengthCode);
      if (symbol < 16) {
        lengths[i++] = symbol;
        continue;
      }
      let repeat: number;
      let value = 0;
      if (symbol === 16) {
        if (i === 0) throw new InflateError("una ripetizione senza niente prima");
        value = lengths[i - 1]!;
        repeat = 3 + this.bits(2);
      } else if (symbol === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (i + repeat > lengths.length) throw new InflateError("troppe lunghezze");
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (lengths[256] === 0) throw new InflateError("un blocco senza la fine");
    this.block(huffman(lengths.subarray(0, literalCount)), huffman(lengths.subarray(literalCount)));
  }

  private block(literals: Huffman, distances: Huffman): void {
    for (;;) {
      const symbol = this.decode(literals);
      if (symbol < 256) {
        this.push(symbol);
        continue;
      }
      if (symbol === 256) return;
      const index = symbol - 257;
      if (index >= LENGTH_BASE.length) throw new InflateError("una lunghezza che non c'è");
      const length = LENGTH_BASE[index]! + this.bits(LENGTH_EXTRA[index]!);
      const code = this.decode(distances);
      if (code >= DISTANCE_BASE.length) throw new InflateError("una distanza che non c'è");
      const distance = DISTANCE_BASE[code]! + this.bits(DISTANCE_EXTRA[code]!);
      if (distance > this.length) throw new InflateError("una distanza prima dell'inizio");
      for (let i = 0; i < length; i++) this.push(this.out[this.length - distance]!);
    }
  }
}

/// I byte del deflate grezzo `input`, al più `limit`. Lancia
/// [`InflateError`] se il flusso non vale o se ne escono di più.
export function inflateRaw(input: Uint8Array, limit: number): Uint8Array {
  return new Inflater(input, limit).run();
}

/// I byte del flusso zlib `input`: il deflate fra la testa di due byte e la
/// somma Adler-32, che non si controlla.
export function inflateZlib(input: Uint8Array, limit: number): Uint8Array {
  if (input.length < 2) throw new InflateError("il flusso finisce a metà");
  const [cmf, flg] = [input[0]!, input[1]!];
  if ((cmf & 0x0f) !== 8 || (cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) throw new InflateError("non è un flusso zlib");
  return new Inflater(input.subarray(2), limit).run();
}
