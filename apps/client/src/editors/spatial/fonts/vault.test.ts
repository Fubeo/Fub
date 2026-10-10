// I caratteri del vault sulla superficie: il catalogo letto dalla shell e
// dall'host, le facce registrate per peso e stile, la famiglia viva di un
// disegno, il tetto, ciò che manca e le facce che si tolgono.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageLayer, PaintAttr, PaintNode, PaintResource, PaintScene, PaintShape, TextRun } from "../painter/paint";
import type { FaceInfo } from "./faces";
import { DrawingFonts, facesOf, FONTS_BUDGET, markupFonts, namesVault, requestOf, sceneFonts, SETTLE_MS, VaultFonts, type FaceRegistry, type VaultFontPort } from "./vault";

// --- le facce finte -------------------------------------------------------------

function staticFace(family: string, weight = 400, style: "normal" | "italic" = "normal", generic: FaceInfo["generic"] = "sans-serif"): FaceInfo {
  return { index: 0, family, names: [family], generic, weight: [weight, weight], stretch: [100, 100], styles: [{ style, fixed: [] }], axes: [] };
}

function variableFace(family: string, generic: FaceInfo["generic"] = "serif"): FaceInfo {
  return { index: 0, family, names: [family], generic, weight: [100, 900], stretch: [100, 100], styles: [{ style: "normal", fixed: [] }], axes: [{ tag: "wght", min: 100, default: 400, max: 900 }] };
}

interface FakeFile {
  readonly id: string;
  faces: FaceInfo[] | null;
  mtime?: number;
  /// Quanti byte pesa, se non quelli del suo nome.
  size?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesOf(file: FakeFile): Uint8Array {
  if (file.size === undefined) return encoder.encode(`font:${file.id}`);
  const bytes = new Uint8Array(file.size);
  bytes.set(encoder.encode(`font:${file.id}`));
  return bytes;
}

const decode = (base64: string): string => {
  const binary = atob(base64);
  const end = binary.indexOf("\u0000");
  return end < 0 ? binary : binary.slice(0, end);
};

function fakePort(files: FakeFile[]) {
  const asked: { kind: string; file: string; index?: number; coordinates?: unknown }[] = [];
  const reads: string[] = [];
  let changed: ((id: string | null) => void) | null = null;
  let listing = 0;
  const port: VaultFontPort = {
    files: async () => {
      listing++;
      return files.map((file) => ({ id: file.id, size: file.size ?? bytesOf(file).length, mtime: file.mtime ?? 1 }));
    },
    read: async (id, limit) => {
      reads.push(id);
      const file = files.find((each) => each.id === id);
      if (file === undefined) return null;
      const bytes = bytesOf(file);
      return bytes.length > limit ? null : bytes;
    },
    ask: async (query) => {
      const { kind, data, index, coordinates } = query as { kind: string; data: string; index?: number; coordinates?: unknown };
      const id = decode(data).replace(/^font:/, "");
      const file = files.find((each) => each.id === id)!;
      asked.push({ kind, file: id, index, coordinates });
      if (kind === "font_faces") {
        if (file.faces === null) throw new Error("not a font");
        return { faces: file.faces };
      }
      const instance = encoder.encode(`instance:${id}:${index}:${JSON.stringify(coordinates)}`);
      return { data: btoa(String.fromCharCode(...instance)) };
    },
    watch: (listener) => {
      changed = listener;
      return () => {
        changed = null;
      };
    },
  };
  return { port, asked, reads, change: (id: string | null = null) => changed?.(id), listings: () => listing };
}

interface Registered {
  readonly family: string;
  readonly text: string;
  readonly weight: string;
  readonly style: string;
  removed: boolean;
}

function fakeRegistry(refuse: (text: string) => boolean = () => false) {
  const faces: Registered[] = [];
  const registry: FaceRegistry = {
    add: async (family, data, descriptors) => {
      const text = decoder.decode(data.subarray(0, 200)).replace(/\u0000+$/, "");
      if (refuse(text)) return null;
      const face: Registered = { family, text, weight: descriptors.weight, style: descriptors.style, removed: false };
      faces.push(face);
      return face;
    },
    remove: (face) => {
      (face as Registered).removed = true;
    },
  };
  return { registry, faces, live: () => faces.filter((face) => !face.removed) };
}

/// Lascia finire le promesse in corso: la porta e il registro finti non usano
/// timer.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --- le scene finte ---------------------------------------------------------------

function text(attrs: PaintAttr[], runs: TextRun[]): PaintShape {
  return { kind: "shape", tag: "text", role: "shape", id: null, attrs, space: null, runs } as unknown as PaintShape;
}

const line = (value: string, attrs: PaintAttr[] = []): TextRun => ({ kind: "span", attrs, space: null, text: value });

function group(attrs: PaintAttr[], children: PaintNode[]): PaintNode {
  return { kind: "group", key: {}, role: "group", id: null, attrs, space: null, children } as unknown as PaintNode;
}

function scene(nodes: PaintNode[], rootAttrs: PaintAttr[] = [], resources: PaintResource[] = []): PaintScene {
  return { root: { attrs: rootAttrs, page: null, units: "px", guides: null }, layers: [{ kind: "live", nodes }], resources } as unknown as PaintScene;
}

const written = (family: string, weight = "400", style = "normal") => ({ family, weight, style });

afterEach(() => {
  vi.useRealTimers();
});

// --- le prove ---------------------------------------------------------------------

describe("i caratteri di una scena", () => {
  it("eredita famiglia, peso e stile dai gruppi, dalle righe e dai pezzi", () => {
    const pieces: TextRun = {
      kind: "span",
      attrs: [["font-style", "italic"]],
      space: null,
      text: "ab",
      parts: ["a", { attrs: [["font-weight", "bold"]], space: null, text: "b" }],
    };
    const fonts = sceneFonts(
      scene([group([["font-family", "Roboto, sans-serif"]], [text([["font-weight", "300"]], [line("uno"), { kind: "space", text: " " }, pieces])])], [["font-weight", "bold"]]),
    );
    expect(fonts).toEqual([
      { family: "Roboto, sans-serif", weight: 300, style: "normal" },
      { family: "Roboto, sans-serif", weight: 300, style: "italic" },
      { family: "Roboto, sans-serif", weight: 700, style: "italic" },
    ]);
  });

  it("scrive Literata dove nessuno dice la famiglia, e salta il testo vuoto e i pesi che non legge", () => {
    expect(sceneFonts(scene([text([["font-weight", "450"]], [line("")]), text([["font-weight", "bolder"]], [line("x")])]))).toEqual([{ family: "", weight: 400, style: "normal" }]);
  });

  it("legge il testo delle risorse", () => {
    const resource = { id: "m", tag: "mask", attrs: [], space: null, children: [{ tag: "text", attrs: [["font-family", "Roboto"]], space: null, children: ["M"] }] } as unknown as PaintResource;
    expect(sceneFonts(scene([], [], [resource]))).toEqual([{ family: "Roboto", weight: 400, style: "normal" }]);
  });

  it("legge i pesi e gli stili come la misura", () => {
    expect(requestOf({ weight: "bold", style: "italic" })).toEqual({ weight: 700, style: "italic", stretch: 100 });
    expect(requestOf({ weight: "lighter", style: "slanted" })).toEqual({ weight: 400, style: "normal", stretch: 100 });
  });
});

describe("i caratteri di un documento scritto", () => {
  const SVG = (body: string, attrs = ""): string => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;

  it("ereditano dagli attributi e dagli style, e dicono i valori di font-family", () => {
    const read = markupFonts(
      SVG('<g style="font-weight: bold; FONT-FAMILY: \'Noto Sans\'"><text>a<tspan font-style="italic">b</tspan></text></g><text font-family="Arial" style="font-family: Roboto">c</text><text>&amp;</text>', ' font-family="Inter"'),
    );
    expect(read.fonts).toEqual([
      { family: "'Noto Sans'", weight: 700, style: "normal" },
      { family: "'Noto Sans'", weight: 700, style: "italic" },
      { family: "Roboto", weight: 400, style: "normal" },
      { family: "Inter", weight: 400, style: "normal" },
    ]);
    expect(read.families).toEqual(["Inter", "Arial"]);
  });

  it("contano soltanto i testi di SVG, e niente se il documento non si legge", () => {
    expect(markupFonts('<svg xmlns="http://www.w3.org/2000/svg"><g font-family="Roboto"><desc>no</desc></g></svg>').fonts).toEqual([]);
    expect(markupFonts("<svg><text>a</text></svg>").fonts).toEqual([]);
    expect(markupFonts("<svg")).toEqual({ fonts: [], families: [] });
  });

  it("hanno un tetto, e leggono un documento annidato a fondo", () => {
    const many = markupFonts(SVG(Array.from({ length: 300 }, (_, i) => `<text font-family="F${i}">x</text>`).join("")));
    expect(many.fonts).toHaveLength(256);
    expect(many.families).toHaveLength(256);
    const deep = 20_000;
    const nested = markupFonts(SVG(`${"<g>".repeat(deep)}<text font-family="Roboto">x</text>${"</g>".repeat(deep)}`));
    expect(nested.fonts).toEqual([{ family: "Roboto", weight: 400, style: "normal" }]);
  });

  it("di uno strato immagine entrano fra quelli della scena", () => {
    const layer = (attrs: string, body: string): ImageLayer => ({
      kind: "image",
      key: attrs + body,
      prolog: "",
      root: { name: "svg", attrs: ` xmlns="http://www.w3.org/2000/svg"${attrs}`, style: null },
      body: `${body}</svg>`,
      transparent: false,
      containers: [],
    });
    const foreign = layer(' font-family="Roboto, serif"', "<text>a</text>");
    const plain = layer("", '<text font-family="Inter">b</text>');
    const painted = { ...scene([text([["font-family", "Inter"]], [line("c")])]), layers: [{ kind: "live", nodes: [text([["font-family", "Inter"]], [line("c")])] }, foreign, plain] } as unknown as PaintScene;
    expect(sceneFonts(painted)).toEqual([
      { family: "Inter", weight: 400, style: "normal" },
      { family: "Roboto, serif", weight: 400, style: "normal" },
    ]);
    expect(namesVault(foreign)).toBe(true);
    expect(namesVault(plain)).toBe(false);
  });
});

describe("le facce dell'host", () => {
  it("si leggono soltanto con la forma attesa", () => {
    expect(facesOf({ faces: [staticFace("Roboto")] })).toEqual([staticFace("Roboto")]);
    expect(facesOf({ faces: [{ ...staticFace("Roboto"), weight: [400] }] })).toBeNull();
    expect(facesOf({ faces: [{ ...staticFace("Roboto"), generic: "system-ui" }] })).toBeNull();
    expect(facesOf({})).toBeNull();
  });
});

describe("il catalogo del vault", () => {
  it("dice le famiglie in ordine, con la generica del tondo, senza quelle di Fub", async () => {
    const { port } = fakePort([
      { id: "Caratteri/Zilla.ttf", faces: [staticFace("Zilla Slab", 400, "normal", "serif")] },
      { id: "Caratteri/Inter.ttf", faces: [staticFace("Inter")] },
      { id: "Caratteri/Fira.otf", faces: [staticFace("Fira Code", 700, "normal", "monospace")] },
      { id: "Caratteri/rotto.ttf", faces: null },
      { id: "Immagini/foto.png", faces: null },
    ]);
    const vault = new VaultFonts(port, fakeRegistry().registry);
    await vault.catalog();
    expect(vault.families()).toEqual([
      { name: "Fira Code", generic: "monospace" },
      { name: "Zilla Slab", generic: "serif" },
    ]);
    expect(vault.has("zilla slab")).toBe(true);
    expect(vault.has("Inter")).toBe(false);
    expect(vault.unreadable()).toEqual(["Caratteri/rotto.ttf"]);
  });

  it("rilegge le facce di un file soltanto se è cambiato, e riprova quello che non si leggeva", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const files: FakeFile[] = [
      { id: "a.ttf", faces: [staticFace("Alfa")] },
      { id: "b.ttf", faces: null },
    ];
    const fake = fakePort(files);
    const vault = new VaultFonts(fake.port, fakeRegistry().registry);
    await vault.catalog();
    expect(fake.asked.map((each) => each.file)).toEqual(["a.ttf", "b.ttf"]);
    files[1]!.faces = [staticFace("Beta")];
    // Un'immagine che cambia non conta.
    fake.change("foto.png");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await vault.catalog();
    expect(fake.listings()).toBe(1);
    fake.change("b.ttf");
    fake.change("b.ttf");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await vault.catalog();
    expect(fake.listings()).toBe(2);
    expect(fake.asked.map((each) => each.file)).toEqual(["a.ttf", "b.ttf", "b.ttf"]);
    expect(vault.has("Beta")).toBe(true);
  });

  it("dà un nome della superficie per famiglia, lo stesso per sempre", () => {
    const vault = new VaultFonts(fakePort([]).port, fakeRegistry().registry);
    expect(vault.nameOf("Roboto")).toBe("fubdraw-vault-1");
    expect(vault.nameOf("Zilla Slab")).toBe("fubdraw-vault-2");
    expect(vault.nameOf("ROBOTO")).toBe("fubdraw-vault-1");
  });
});

describe("le facce registrate", () => {
  it("registrano il file com'è se ha una faccia statica sola, col peso e lo stile chiesti", async () => {
    const fake = fakePort([{ id: "r.ttf", faces: [staticFace("Roboto", 400)] }]);
    const { registry, faces } = fakeRegistry();
    const vault = new VaultFonts(fake.port, registry);
    const slot = vault.want("roboto", { weight: 700, style: "normal", stretch: 100 });
    await slot.done;
    expect(slot.state).toBe("ready");
    expect(faces).toEqual([{ family: "fubdraw-vault-1", text: "font:r.ttf", weight: "700", style: "normal", removed: false }]);
    expect(fake.asked.filter((each) => each.kind === "font_instance")).toEqual([]);
  });

  it("chiedono all'host la faccia fissata di un carattere variabile", async () => {
    const fake = fakePort([{ id: "v.ttf", faces: [variableFace("Fraunces")] }]);
    const { registry, faces } = fakeRegistry();
    const vault = new VaultFonts(fake.port, registry);
    await vault.want("Fraunces", { weight: 650, style: "normal", stretch: 100 }).done;
    const instance = fake.asked.find((each) => each.kind === "font_instance")!;
    expect(instance.index).toBe(0);
    expect(instance.coordinates).toEqual([{ tag: "wght", value: 650 }]);
    expect(faces[0]!.text).toBe(`instance:v.ttf:0:${JSON.stringify([{ tag: "wght", value: 650 }])}`);
  });

  it("dice che non si carica una faccia che il browser non legge", async () => {
    const fake = fakePort([{ id: "r.ttf", faces: [staticFace("Roboto")] }]);
    const vault = new VaultFonts(fake.port, fakeRegistry(() => true).registry);
    const slot = vault.want("Roboto", { weight: 400, style: "normal", stretch: 100 });
    await slot.done;
    expect(slot.state).toBe("failed");
  });

  it("cambiano faccia quando il file cambia, e tolgono quella di prima", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const files: FakeFile[] = [{ id: "r.ttf", faces: [staticFace("Roboto", 400)] }];
    const fake = fakePort(files);
    const { registry, faces, live } = fakeRegistry();
    const vault = new VaultFonts(fake.port, registry);
    await vault.want("Roboto", { weight: 700, style: "normal", stretch: 100 }).done;
    files.push({ id: "rb.ttf", faces: [staticFace("Roboto", 700)] });
    fake.change();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await vault.catalog();
    await vault.want("Roboto", { weight: 700, style: "normal", stretch: 100 }).done;
    expect(faces.map((face) => face.text)).toEqual(["font:r.ttf", "font:rb.ttf"]);
    expect(live().map((face) => face.text)).toEqual(["font:rb.ttf"]);
  });
});

describe("i caratteri di un disegno", () => {
  it("usano la famiglia dopo finché la faccia non arriva, e avvisano quando arriva", async () => {
    const vault = new VaultFonts(fakePort([{ id: "r.ttf", faces: [staticFace("Roboto")] }]).port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    const changes = vi.fn();
    fonts.watch(changes);
    const value = "Roboto, sans-serif";
    fonts.use(scene([text([["font-family", value]], [line("Ciao")])]));
    expect(fonts.live(value)).toBe('Inter, Literata, "JetBrains Mono"');
    expect(fonts.settled(written(value))).toBe(false);
    await settle();
    expect(fonts.live(value)).toBe('fubdraw-vault-1, Inter, Literata, "JetBrains Mono"');
    expect(fonts.settled(written(value))).toBe(true);
    expect(changes).toHaveBeenCalled();
  });

  it("dicono le famiglie che mancano e i file che non si leggono", async () => {
    const vault = new VaultFonts(fakePort([{ id: "x.ttf", faces: null }]).port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    fonts.use(scene([text([["font-family", "Roboto, 'Open Sans', roboto, serif"]], [line("Ciao")])]));
    await settle();
    expect(fonts.fontNotes()).toEqual({ missing: ["Roboto", "Open Sans"], unreadable: ["x.ttf"], over: [], failed: [] });
    expect(fonts.live("Roboto, serif")).toBe('Literata, Inter, "JetBrains Mono"');
    expect(fonts.settled(written("Roboto, serif"))).toBe(true);
  });

  it("senza caratteri del vault danno le sole famiglie di Fub", async () => {
    const fonts = new DrawingFonts(null);
    fonts.use(scene([text([["font-family", "Roboto"]], [line("Ciao")])]));
    expect(fonts.live("Roboto, monospace")).toBe('"JetBrains Mono", Literata, Inter');
    expect(fonts.settled(written("Roboto"))).toBe(true);
    await fonts.ready([written("Roboto")]);
    expect(fonts.fontNotes().missing).toEqual([]);
  });

  it("aspettano le facce prima di misurare", async () => {
    const vault = new VaultFonts(fakePort([{ id: "r.ttf", faces: [staticFace("Roboto"), staticFace("Roboto", 700)] }]).port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    await fonts.ready([written("Roboto", "bold")]);
    expect(fonts.settled(written("Roboto", "bold"))).toBe(true);
  });

  it("lasciano ripiegare le famiglie oltre il tetto, nell'ordine del documento", async () => {
    // Un tetto piccolo per la prova: quello vero è di 64 MiB, come l'export.
    expect(FONTS_BUDGET).toBe(64 * 1024 * 1024);
    const budget = 1000;
    const size = budget / 2 + 1;
    const vault = new VaultFonts(
      fakePort([
        { id: "a.ttf", faces: [staticFace("Alfa")], size },
        { id: "b.ttf", faces: [staticFace("Beta")], size },
      ]).port,
      fakeRegistry().registry,
    );
    const fonts = new DrawingFonts(vault, budget);
    fonts.use(scene([text([["font-family", "Beta"]], [line("b")]), text([["font-family", "Alfa"]], [line("a")]), text([["font-family", "Beta"]], [line("c", [["font-weight", "bold"]])])]));
    await settle();
    await settle();
    expect(fonts.fontNotes().over).toEqual(["Alfa"]);
    expect(fonts.live("Alfa")).toBe('Literata, Inter, "JetBrains Mono"');
    expect(fonts.live("Beta")).toBe('fubdraw-vault-1, Literata, Inter, "JetBrains Mono"');
  });

  it("danno alle immagini le facce pronte col nome della famiglia, e i byte dentro", async () => {
    const vault = new VaultFonts(fakePort([{ id: "r.ttf", faces: [staticFace("Roboto"), staticFace("Roboto", 700)] }]).port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    const wanted = [
      { family: "roboto, sans-serif", weight: 400, style: "normal" as const },
      { family: "Roboto", weight: 700, style: "normal" as const },
      { family: "Roboto, serif", weight: 400, style: "normal" as const },
    ];
    expect(fonts.faces(wanted, true)).toBeNull();
    expect(fonts.faces(wanted, false)).toBe("");
    fonts.useFonts(wanted);
    expect(fonts.faces(wanted, true)).toBeNull();
    expect(fonts.picture("Roboto, sans-serif")).toBe('Inter, Literata, "JetBrains Mono"');
    await settle();
    const uri = `data:application/octet-stream;base64,${btoa("instance:r.ttf:0:[]")}`;
    expect(fonts.faces(wanted, true)).toBe(
      `@font-face{font-family:"roboto";src:url(${uri});font-weight:400;font-style:normal}@font-face{font-family:"Roboto";src:url(${uri});font-weight:700;font-style:normal}`,
    );
    expect(fonts.picture("Arial, ROBOTO, serif")).toBe('ROBOTO, Literata, Inter, "JetBrains Mono"');
    expect(fonts.shown("Arial, ROBOTO, serif")).toBe("ROBOTO");
    expect(fonts.shown("Arial, serif")).toBe("Literata");
    expect(new DrawingFonts(null).faces(wanted, true)).toBe("");
  });

  it("le facce oltre il tetto non entrano nelle immagini, e il testo dice con che cosa si vede", async () => {
    // Beta pesa pochi byte, Alfa quanto il tetto: dopo Beta non ci sta.
    const budget = 1000;
    const vault = new VaultFonts(
      fakePort([
        { id: "a.ttf", faces: [staticFace("Alfa")], size: budget },
        { id: "b.ttf", faces: [staticFace("Beta")] },
      ]).port,
      fakeRegistry().registry,
    );
    const fonts = new DrawingFonts(vault, budget);
    const wanted = [
      { family: "Beta", weight: 400, style: "normal" as const },
      { family: "Alfa, monospace", weight: 400, style: "normal" as const },
    ];
    fonts.useFonts(wanted);
    await settle();
    await settle();
    expect(fonts.faces(wanted, true)).toContain('font-family:"Beta"');
    expect(fonts.faces(wanted, true)).not.toContain('"Alfa"');
    expect(fonts.picture("Alfa, monospace")).toBe('"JetBrains Mono", Literata, Inter');
    expect(fonts.shown("Alfa, monospace")).toBe("JetBrains Mono");
  });

  it("danno le famiglie del menu, lo stesso elenco finché il catalogo non cambia, e avvisano quando cambiano", async () => {
    const files: FakeFile[] = [{ id: "r.ttf", faces: [staticFace("Roboto")] }];
    const fake = fakePort(files);
    const vault = new VaultFonts(fake.port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    const changes = vi.fn();
    fonts.watch(changes);
    expect(fonts.families()).toEqual([]);
    fonts.catalog();
    fonts.catalog();
    await settle();
    expect(fake.listings()).toBe(1);
    const first = fonts.families();
    expect(first).toEqual([{ name: "Roboto", generic: "sans-serif" }]);
    expect(fonts.families()).toBe(first);
    expect(changes).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    files.push({ id: "c.otf", faces: [staticFace("Caslon", 400, "normal", "serif")] });
    fake.change("c.otf");
    vi.advanceTimersByTime(SETTLE_MS);
    vi.useRealTimers();
    await settle();
    await settle();
    expect(fonts.families()).toEqual([
      { name: "Caslon", generic: "serif" },
      { name: "Roboto", generic: "sans-serif" },
    ]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("chiedono in anticipo il grassetto e il corsivo di un testo che si scrive", async () => {
    const fake = fakePort([{ id: "r.ttf", faces: [variableFace("Roboto", "sans-serif")] }]);
    const vault = new VaultFonts(fake.port, fakeRegistry().registry);
    const fonts = new DrawingFonts(vault);
    fonts.prefetch("Inter, sans-serif", "normal");
    await settle();
    expect(fake.listings()).toBe(0);
    fonts.prefetch("Roboto, sans-serif", "300");
    await settle();
    await settle();
    for (const [weight, style] of [["300", "normal"], ["300", "italic"], ["bold", "normal"], ["bold", "italic"]] as const) {
      expect(fonts.settled(written("Roboto", weight, style)), `${weight} ${style}`).toBe(true);
    }
  });

  it("tolgono, quando il disegno si chiude, le facce che nessun altro disegno usa", async () => {
    const fake = fakePort([{ id: "a.ttf", faces: [staticFace("Alfa")] }, { id: "b.ttf", faces: [staticFace("Beta")] }]);
    const { registry, live } = fakeRegistry();
    const vault = new VaultFonts(fake.port, registry);
    const one = new DrawingFonts(vault);
    const two = new DrawingFonts(vault);
    one.use(scene([text([["font-family", "Alfa"]], [line("a")]), text([["font-family", "Beta"]], [line("b")])]));
    two.use(scene([text([["font-family", "Beta"]], [line("b")])]));
    await settle();
    expect(live().map((face) => face.text)).toEqual(["font:a.ttf", "font:b.ttf"]);
    one.dispose();
    expect(live().map((face) => face.text)).toEqual(["font:b.ttf"]);
    two.dispose();
    expect(live()).toEqual([]);
  });
});
