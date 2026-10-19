// Un archivio ZIP troppo grande per passare intero, diviso in parti che
// passano.
//
// L'importer degli archivi tratta ogni voce da sé: il nome nel vault viene dal
// path della voce, non dal resto dell'archivio. Dividere per voci non cambia
// quindi ciò che entra, e ogni parte diventa un import a tappe con la sua
// anteprima, la sua ricevuta e il suo annullamento.
//
// Qui non si decomprime niente. Si legge la directory centrale dalla coda del
// file (`Blob.slice`, senza caricarlo tutto), si raggruppano le voci in parti
// che stanno sotto i tetti dell'importer, e ogni parte si riscrive come un ZIP
// piccolo: le voci copiate così come sono, compresse, con intestazioni nuove
// che portano dimensioni e CRC della directory. Una voce che da sola supera un
// tetto non entra in nessuna parte: torna in `oversized`, e chi chiama lo
// dice, invece di perderla in silenzio.
import { t } from "../i18n/strings";

/// Una voce della directory centrale.
export interface ZipEntry {
  /// Il nome come byte: si copia identico, qualunque codifica dica il flag.
  readonly nameBytes: Uint8Array;
  /// Il nome per chi legge: UTF-8 se il flag lo dice, altrimenti byte per byte.
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly external: number;
  /// Dove comincia l'intestazione locale.
  readonly offset: number;
  /// Dove comincia la voce che segue nel file (o la directory centrale): fra
  /// le due stanno l'intestazione, i dati e l'eventuale descrittore.
  readonly end: number;
}

/// I tetti di una parte. Di serie stanno sotto quelli dell'importer
/// (`fub-importers/src/common.rs`), con margine.
export interface PartLimits {
  /// Byte della parte, intestazioni comprese (`MAX_SOURCE_BYTES` è 64 MiB).
  readonly bytes: number;
  /// Voci della parte (`MAX_ENTRIES` è 10 000).
  readonly entries: number;
  /// Byte decompressi della parte (`MAX_TOTAL_UNCOMPRESSED` è 256 MiB).
  readonly inflated: number;
  /// Byte decompressi di una voce (`MAX_ENTRY_BYTES` è 32 MiB).
  readonly entry: number;
}

export const PART_LIMITS: PartLimits = {
  bytes: 48 * 1024 * 1024,
  entries: 5_000,
  inflated: 192 * 1024 * 1024,
  entry: 32 * 1024 * 1024,
};

/// Il tetto della directory centrale che si accetta di leggere.
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const FULL32 = 0xffffffff;

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function u64(view: DataView, at: number): number {
  const value = view.getUint32(at, true) + view.getUint32(at + 4, true) * 2 ** 32;
  if (!Number.isSafeInteger(value)) throw new Error(t("errors.zip.offset"));
  return value;
}

/// Il nome leggibile di una voce.
function nameOf(bytes: Uint8Array, flags: number): string {
  if (flags & 0x0800) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  }
}

/// Le voci dell'archivio, nell'ordine del file. Rifiuta ciò che non è uno ZIP
/// leggibile: un archivio su più dischi, una directory che esce dal file.
export async function readDirectory(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  if (size < 22) throw new Error(t("errors.zip.short"));
  const tailStart = Math.max(0, size - (65535 + 22));
  const tail = await bytesOf(blob, tailStart, size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tailView.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error(t("errors.zip.no_end"));
  if (tailView.getUint16(eocd + 4, true) !== 0 || tailView.getUint16(eocd + 6, true) !== 0) {
    throw new Error(t("errors.zip.multidisk"));
  }
  let count = tailView.getUint16(eocd + 10, true);
  let directorySize = tailView.getUint32(eocd + 12, true);
  let directoryStart = tailView.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === FULL32 || directoryStart === FULL32) {
    // ZIP64: il localizzatore sta subito prima della fine della directory.
    const locatorAt = tailStart + eocd - 20;
    if (locatorAt < 0) throw new Error(t("errors.zip.no_locator"));
    const locator = await bytesOf(blob, locatorAt, locatorAt + 20);
    const locatorView = new DataView(locator.buffer);
    if (locatorView.getUint32(0, true) !== ZIP64_LOCATOR) throw new Error(t("errors.zip.no_locator"));
    const recordAt = u64(locatorView, 8);
    const record = await bytesOf(blob, recordAt, recordAt + 56);
    const recordView = new DataView(record.buffer);
    if (record.length < 56 || recordView.getUint32(0, true) !== ZIP64_EOCD) throw new Error(t("errors.zip.bad_zip64"));
    count = u64(recordView, 32);
    directorySize = u64(recordView, 40);
    directoryStart = u64(recordView, 48);
  }
  if (directoryStart + directorySize > size) throw new Error(t("errors.zip.directory_outside"));
  if (directorySize > MAX_DIRECTORY_BYTES) throw new Error(t("errors.zip.directory_large"));
  const directory = await bytesOf(blob, directoryStart, directoryStart + directorySize);
  const view = new DataView(directory.buffer);
  const found: Omit<ZipEntry, "end">[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || view.getUint32(at, true) !== CENTRAL) throw new Error(t("errors.zip.bad_entry"));
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let compressed = view.getUint32(at + 20, true);
    let uncompressed = view.getUint32(at + 24, true);
    let offset = view.getUint32(at + 42, true);
    const nameStart = at + 46;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > directory.length) throw new Error(t("errors.zip.truncated_entry"));
    // I campi pieni stanno nel campo esteso ZIP64, in quest'ordine.
    for (let extra = extraStart; extra + 4 <= extraStart + extraLength; ) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (uncompressed === FULL32 && field + 8 <= extra + 4 + length) {
          uncompressed = u64(view, field);
          field += 8;
        }
        if (compressed === FULL32 && field + 8 <= extra + 4 + length) {
          compressed = u64(view, field);
          field += 8;
        }
        if (offset === FULL32 && field + 8 <= extra + 4 + length) offset = u64(view, field);
      }
      extra += 4 + length;
    }
    const nameBytes = directory.slice(nameStart, extraStart);
    found.push({
      nameBytes,
      name: nameOf(nameBytes, flags),
      flags,
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      crc: view.getUint32(at + 16, true),
      compressed,
      size: uncompressed,
      external: view.getUint32(at + 38, true),
      offset,
    });
    at = next;
  }
  const ordered = [...found].sort((a, b) => a.offset - b.offset);
  return ordered.map((entry, index) => {
    const end = index + 1 < ordered.length ? ordered[index + 1]!.offset : directoryStart;
    if (end < entry.offset + 30 + entry.compressed) throw new Error(t("errors.zip.overlap", { name: entry.name }));
    return { ...entry, end };
  });
}

/// Una cartella dell'archivio: non diventa mai una nota.
function isDirectory(entry: ZipEntry): boolean {
  return entry.name.endsWith("/") && entry.compressed === 0;
}

/// Quanto pesa una voce nella parte riscritta: intestazione locale, dati e
/// voce della directory.
function written(entry: ZipEntry): number {
  return 30 + entry.nameBytes.length + entry.compressed + 46 + entry.nameBytes.length;
}

/// Le parti, nell'ordine del file, e le voci che non stanno in nessuna.
export function planParts(entries: readonly ZipEntry[], limits: PartLimits = PART_LIMITS): { parts: ZipEntry[][]; oversized: ZipEntry[] } {
  const parts: ZipEntry[][] = [];
  const oversized: ZipEntry[] = [];
  let current: ZipEntry[] = [];
  let bytes = 22;
  let inflated = 0;
  for (const entry of entries) {
    if (isDirectory(entry)) continue;
    const weight = written(entry);
    if (entry.size > limits.entry || weight + 22 > limits.bytes || entry.size > limits.inflated) {
      oversized.push(entry);
      continue;
    }
    if (current.length > 0 && (current.length + 1 > limits.entries || bytes + weight > limits.bytes || inflated + entry.size > limits.inflated)) {
      parts.push(current);
      current = [];
      bytes = 22;
      inflated = 0;
    }
    current.push(entry);
    bytes += weight;
    inflated += entry.size;
  }
  if (current.length > 0) parts.push(current);
  return { parts, oversized };
}

/// Riscrive una parte come ZIP: le voci compresse così come sono, con
/// intestazioni che portano dimensioni e CRC della directory (niente
/// descrittore dopo i dati, niente campi estesi).
export async function buildPart(blob: Blob, part: readonly ZipEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const total = part.reduce((sum, entry) => sum + written(entry), 22);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;
  // Le voci contigue nel file si leggono insieme; una voce saltata in mezzo
  // (una cartella, una troppo grande) apre una lettura nuova.
  let first = -1;
  let span: Uint8Array = new Uint8Array();
  let spanView = new DataView(span.buffer);
  for (const [index, entry] of part.entries()) {
    if (first < 0 || entry.offset < first || entry.end > first + span.length) {
      let last = index;
      while (last + 1 < part.length && part[last + 1]!.offset === part[last]!.end) last++;
      first = entry.offset;
      span = await bytesOf(blob, first, part[last]!.end);
      spanView = new DataView(span.buffer);
    }
    const local = entry.offset - first;
    if (local + 30 > span.length || spanView.getUint32(local, true) !== LOCAL) throw new Error(t("errors.zip.bad_local", { name: entry.name }));
    const dataStart = local + 30 + spanView.getUint16(local + 26, true) + spanView.getUint16(local + 28, true);
    const dataEnd = dataStart + entry.compressed;
    if (dataEnd > span.length) throw new Error(t("errors.zip.data_outside", { name: entry.name }));
    offsets.push(at);
    view.setUint32(at, LOCAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, entry.flags & ~0x0008, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.compressed, true);
    view.setUint32(at + 22, entry.size, true);
    view.setUint16(at + 26, entry.nameBytes.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(entry.nameBytes, at + 30);
    at += 30 + entry.nameBytes.length;
    out.set(span.subarray(dataStart, dataEnd), at);
    at += entry.compressed;
  }
  const directoryStart = at;
  part.forEach((entry, index) => {
    view.setUint32(at, CENTRAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, entry.flags & ~0x0008, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.compressed, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, entry.nameBytes.length, true);
    // Campo esteso, commento, disco e attributi interni restano a zero.
    view.setUint32(at + 38, entry.external, true);
    view.setUint32(at + 42, offsets[index]!, true);
    out.set(entry.nameBytes, at + 46);
    at += 46 + entry.nameBytes.length;
  });
  view.setUint32(at, EOCD, true);
  view.setUint16(at + 8, part.length, true);
  view.setUint16(at + 10, part.length, true);
  view.setUint32(at + 12, at - directoryStart, true);
  view.setUint32(at + 16, directoryStart, true);
  return out;
}

/// Il nome di una parte, con `suffix` (per esempio «parte 2 di 5») prima
/// dell'estensione: resta un `.zip`, perché è dall'estensione che l'importer
/// riconosce l'archivio.
export function partName(name: string, suffix: string): string {
  return `${name.replace(/\.zip$/i, "")} (${suffix}).zip`;
}
