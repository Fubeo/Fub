// Archivi ZIP scritti a mano per i test, con le varianti che i programmi veri
// usano: compressione, descrittore dopo i dati, campo esteso ZIP64.

/// I byte passati per uno stream di compressione o decompressione.
export async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const piped = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/// CRC-32 dello ZIP, per scrivere archivi di prova veri.
export function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export interface Item {
  name: string;
  body: Uint8Array;
  deflate?: boolean;
  /// Dimensioni e CRC dopo i dati, come scrive chi comprime in streaming.
  descriptor?: boolean;
  /// Dimensioni e offset nel campo esteso ZIP64.
  zip64?: boolean;
}

/// Un archivio scritto a mano, con le varianti che i programmi veri usano.
export async function zip(items: readonly Item[]): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: number[] = [];
  // Niente `push(...array)`: con migliaia di voci supera lo stack.
  const append = (out: number[], values: ArrayLike<number>) => {
    for (let index = 0; index < values.length; index++) out.push(values[index]!);
  };
  const central: number[] = [];
  const u16 = (out: number[], value: number) => out.push(value & 0xff, (value >>> 8) & 0xff);
  const u32 = (out: number[], value: number) => out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  const u64 = (out: number[], value: number) => {
    u32(out, value >>> 0);
    u32(out, Math.floor(value / 2 ** 32));
  };
  for (const item of items) {
    const name = new TextEncoder().encode(item.name);
    const data = item.deflate ? await transform(item.body, new CompressionStream("deflate-raw")) : item.body;
    const crc = crc32(item.body);
    const offset = chunks.length;
    const flags = 0x0800 | (item.descriptor ? 0x0008 : 0);
    u32(chunks, 0x04034b50);
    u16(chunks, 20);
    u16(chunks, flags);
    u16(chunks, item.deflate ? 8 : 0);
    u16(chunks, 0);
    u16(chunks, 0x5021);
    u32(chunks, item.descriptor ? 0 : crc);
    u32(chunks, item.descriptor ? 0 : data.length);
    u32(chunks, item.descriptor ? 0 : item.body.length);
    u16(chunks, name.length);
    u16(chunks, 0);
    append(chunks, name);
    append(chunks, data);
    if (item.descriptor) {
      u32(chunks, 0x08074b50);
      u32(chunks, crc);
      u32(chunks, data.length);
      u32(chunks, item.body.length);
    }
    const extra: number[] = [];
    if (item.zip64) {
      u16(extra, 0x0001);
      u16(extra, 24);
      u64(extra, item.body.length);
      u64(extra, data.length);
      u64(extra, offset);
    }
    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, flags);
    u16(central, item.deflate ? 8 : 0);
    u16(central, 0);
    u16(central, 0x5021);
    u32(central, crc);
    u32(central, item.zip64 ? 0xffffffff : data.length);
    u32(central, item.zip64 ? 0xffffffff : item.body.length);
    u16(central, name.length);
    u16(central, extra.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, item.zip64 ? 0xffffffff : offset);
    append(central, name);
    append(central, extra);
  }
  const start = chunks.length;
  append(chunks, central);
  u32(chunks, 0x06054b50);
  u16(chunks, 0);
  u16(chunks, 0);
  u16(chunks, items.length);
  u16(chunks, items.length);
  u32(chunks, central.length);
  u32(chunks, start);
  u16(chunks, 0);
  return new Uint8Array(chunks);
}
