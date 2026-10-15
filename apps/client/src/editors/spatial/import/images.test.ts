import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import type { Decoded, EncodeType } from "../tools/images";
import type { Diagram, GroupNode, ImageNode, Node } from "./diagram";
import { dataBytes, imagesOf, settleImages, svgPixels, type Pictures } from "./images";

/// I byte di un testo, un carattere per byte.
const bytesOf = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text, (c) => c.charCodeAt(0));

/// Un PNG finto di `size` byte: la firma e degli zeri.
const png = (size = 16): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(size);
  out.set(bytesOf("\x89PNG\r\n\x1a\n"));
  return out;
};

/// Un JPEG con l'orientamento EXIF `value`.
function exifJpeg(value: number): Uint8Array<ArrayBuffer> {
  const u16 = (n: number): number[] => [n & 0xff, n >> 8];
  return Uint8Array.from([
    ...[0xff, 0xd8, 0xff, 0xe1, 0, 34],
    ...bytesOf("Exif\0\0II"),
    ...u16(42),
    ...[8, 0, 0, 0],
    ...u16(1),
    ...[...u16(0x0112), ...u16(3), 1, 0, 0, 0, ...u16(value), 0, 0],
    ...[0, 0, 0, 0],
    ...[0xff, 0xda, 0, 2],
  ]);
}

/// Il data URI in base64 di `bytes`, col tipo che dice.
const uri = (type: string, bytes: Uint8Array): string => `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;

/// I byte di un data URI in base64.
const decoded64 = (href: string): Uint8Array => bytesOf(atob(href.slice(href.indexOf(",") + 1)));

const BOX: Bounds = { min: [0, 0], max: [100, 50] };

const image = (href: string, box = BOX): ImageNode => ({ type: "image", key: "", locked: false, spin: null, href, box, opacity: 1, crop: null, flip: null });

const group = (children: readonly Node[]): GroupNode => ({ type: "group", key: "", locked: false, spin: null, name: "g", children });

const diagramOf = (nodes: readonly Node[], notes: Diagram["notes"] = []): Diagram => ({
  source: "excalidraw",
  background: null,
  layers: [{ name: "", hidden: false, locked: false, nodes }],
  boards: [],
  notes,
});

/// Il browser finto: legge ogni immagine se `readable`, ogni tipo pesa
/// `full` byte a scala piena e il peso scende col numero dei pixel; un SVG
/// diventa un PNG. `calls` dice che cosa gli si è chiesto.
function pictures(full: Partial<Record<EncodeType, number>> = {}, readable = true): Pictures & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    codec: {
      async decode(blob): Promise<Decoded | null> {
        calls.push(`decode ${blob.type}`);
        if (!readable) return null;
        return {
          width: 400,
          height: 200,
          opaque: () => true,
          async encode(type, scale) {
            calls.push(`${type} ${scale.toFixed(2)}`);
            const size = full[type];
            return size === undefined ? null : new Uint8Array(Math.round(size * scale * scale));
          },
          close() {
            calls.push("close");
          },
        };
      },
    },
    async svg(blob, width, height) {
      calls.push(`svg ${blob.type} ${width}×${height}`);
      return new Blob([png()], { type: "image/png" });
    },
  };
}

/// Le immagini del primo livello di `diagram`, anche dentro i gruppi.
const settledOf = (diagram: Diagram): ImageNode[] => imagesOf(diagram);

describe("dataBytes", () => {
  it("legge i data URI in base64 e quelli in chiaro", () => {
    expect(dataBytes(uri("image/png", png(8)))?.type).toBe("image/png");
    const plain = dataBytes("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E");
    expect(plain?.type).toBe("image/svg+xml");
    return plain!.text().then((text) => expect(text).toBe('<svg a="1"/>'));
  });

  it("senza tipo è testo; non legge ciò che non è un data URI, o non si decodifica", async () => {
    expect(await dataBytes("data:,ciao")!.text()).toBe("ciao");
    expect(dataBytes("data:,ciao")!.type).toBe("text/plain");
    expect(dataBytes("https://example.com/a.png")).toBeNull();
    expect(dataBytes("data:image/svg+xml,%E0%A4%A")).toBeNull();
    // Il base64 si legge soltanto per le immagini.
    expect(dataBytes("data:application/pdf;base64,JVBERi0=")).toBeNull();
  });
});

describe("svgPixels", () => {
  it("disegna un SVG al doppio, ma il lato lungo fra 512 e 4096 pixel", () => {
    expect(svgPixels(1000, 500)).toEqual([2000, 1000]);
    expect(svgPixels(100, 50)).toEqual([512, 256]);
    expect(svgPixels(5000, 100)).toEqual([4096, 82]);
    expect(svgPixels(0, 0)).toEqual([1, 1]);
  });
});

describe("imagesOf", () => {
  it("trova le immagini anche nei gruppi, nell'ordine in cui si scrivono", () => {
    const [a, b, c] = ["data:a", "data:b", "data:c"].map((href) => image(href));
    expect(imagesOf(diagramOf([a!, group([b!, group([c!])])]))).toEqual([a, b, c]);
  });
});

describe("settleImages", () => {
  it("senza immagini lascia il diagramma com'è", async () => {
    const diagram = diagramOf([group([])]);
    expect(await settleImages(diagram, null)).toBe(diagram);
  });

  it("un'immagine che è davvero del tipo che dice entra com'è, anche senza browser", async () => {
    const node = image(uri("image/png", png()));
    const settled = await settleImages(diagramOf([group([node])]), null);
    expect(settledOf(settled)[0]).toBe(node);
    expect(settled.notes).toEqual([]);
  });

  it("un'immagine col tipo sbagliato prende il suo", async () => {
    const settled = await settleImages(diagramOf([image(uri("image/jpeg", png()))]), null);
    expect(settledOf(settled)[0]!.href).toBe(uri("image/png", png()));
  });

  it("un'immagine fuori dal file resta fuori, e il rapporto ne dà l'indirizzo", async () => {
    const long = `https://example.com/${"x".repeat(100)}.png`;
    const settled = await settleImages(diagramOf([image("https://example.com/a.png"), group([image(long)])], [{ kind: "link", count: 1, sample: "s" }]), null);
    expect(settledOf(settled)).toEqual([]);
    // Il gruppo resta, vuoto.
    expect(settled.layers[0]!.nodes.map((node) => node.type)).toEqual(["group"]);
    expect(settled.notes).toEqual([
      { kind: "link", count: 1, sample: "s" },
      { kind: "image", count: 2, sample: "https://example.com/a.png" },
    ]);
    const other = await settleImages(diagramOf([image(long)]), null);
    expect(other.notes[0]!.sample).toBe(`${long.slice(0, 79)}…`);
  });

  it("un SVG si disegna in PNG, una volta per ogni SVG uguale; senza browser resta fuori", async () => {
    const svg = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
    const browser = pictures();
    const settled = await settleImages(diagramOf([image(svg), image(svg), image(svg, { min: [0, 0], max: [1000, 500] })]), browser);
    expect(browser.calls).toEqual(["svg image/svg+xml 512×256", "svg image/svg+xml 2000×1000"]);
    expect(settledOf(settled).map((node) => node.href)).toEqual([uri("image/png", png()), uri("image/png", png()), uri("image/png", png())]);
    expect(settled.notes).toEqual([]);
    const without = await settleImages(diagramOf([image(svg)]), null);
    expect(settledOf(without)).toEqual([]);
    expect(without.notes).toEqual([{ kind: "image", count: 1, sample: "image/svg+xml" }]);
  });

  it("riconosce un SVG che si dice PNG", async () => {
    const browser = pictures();
    const settled = await settleImages(diagramOf([image(uri("image/png", bytesOf('<?xml version="1.0"?>\n<!-- x --><svg xmlns="http://www.w3.org/2000/svg"/>')))]), browser);
    expect(browser.calls).toEqual(["svg image/svg+xml 512×256"]);
    expect(settledOf(settled)[0]!.href).toBe(uri("image/png", png()));
  });

  it("un altro formato si ricodifica in PNG; se il browser non lo legge, resta fuori", async () => {
    const bmp = uri("image/bmp", bytesOf("BM\0\0"));
    const browser = pictures({ "image/png": 30 });
    const settled = await settleImages(diagramOf([image(bmp)]), browser);
    expect(browser.calls).toEqual(["decode image/bmp", "image/png 1.00", "close"]);
    expect(decoded64(settledOf(settled)[0]!.href)).toHaveLength(30);
    expect(settledOf(settled)[0]!.href.startsWith("data:image/png;base64,")).toBe(true);
    const unread = await settleImages(diagramOf([image(bmp)]), pictures({}, false));
    expect(unread.notes).toEqual([{ kind: "image", count: 1, sample: "image/bmp" }]);
  });

  it("un JPEG girato si ricodifica diritto, e resta JPEG", async () => {
    const browser = pictures({ "image/jpeg": 40 });
    const settled = await settleImages(diagramOf([image(uri("image/jpeg", exifJpeg(6)))]), browser);
    expect(browser.calls).toEqual(["decode image/jpeg", "image/jpeg 1.00", "close"]);
    expect(settledOf(settled)[0]!.href.startsWith("data:image/jpeg;base64,")).toBe(true);
    // Diritto, entra com'è.
    const upright = image(uri("image/jpeg", exifJpeg(1)));
    expect(settledOf(await settleImages(diagramOf([upright]), null))[0]).toBe(upright);
  });

  it("con un tetto, le immagini se lo dividono per peso e si rimpiccioliscono, e il rapporto lo dice", async () => {
    const browser = pictures({ "image/jpeg": 400 });
    const settled = await settleImages(diagramOf([image(uri("image/png", png(300))), image(uri("image/png", png(100)))]), browser, 200);
    const sizes = settledOf(settled).map((node) => decoded64(node.href).length);
    expect(sizes[0]).toBeLessThanOrEqual(150);
    expect(sizes[1]).toBeLessThanOrEqual(50);
    expect(settledOf(settled).every((node) => node.href.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(settled.notes).toEqual([{ kind: "reduced", count: 2, sample: "" }]);
    // Senza browser, troppo pesante resta fuori.
    const without = await settleImages(diagramOf([image(uri("image/png", png(300)))]), null, 200);
    expect(without.notes).toEqual([{ kind: "image", count: 1, sample: "image/png" }]);
  });
});
