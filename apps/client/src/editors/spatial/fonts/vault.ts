// I caratteri del vault sulla superficie: i file `.ttf`, `.otf`, `.woff` e
// `.woff2` del vault sono caratteri che un disegno può usare, come per
// l'export (`typefaces.rs` di `fub-features`).
//
// - **Il catalogo.** La shell elenca i file di caratteri e ne legge i byte
//   (`VaultFontPort`); l'host ne dice le facce, dall'indice `fub.draw`. Il
//   catalogo si legge la prima volta che un disegno nomina una famiglia che
//   non è di Fub, e di nuovo quando un file di caratteri cambia; le facce di
//   un file si rileggono soltanto se il file è cambiato.
// - **Una faccia per peso e stile.** Per ogni famiglia del vault, peso e
//   stile che un testo chiede, la faccia è quella che sceglie l'export
//   (`faces.ts`), fissata dall'host negli stessi punti degli assi: gli stessi
//   byte che l'export dà a `usvg`. Un file con una faccia statica sola si
//   registra com'è. Ogni faccia entra in `document.fonts` col peso e lo stile
//   chiesti, sotto un nome della superficie (`fubdraw-vault-1`…) che nessun
//   carattere del sistema porta: il browser la trova esatta, e non inventa un
//   grassetto né un corsivo.
// - **La famiglia viva** di un `font-family` è quella di `liveFamily`, con le
//   famiglie del vault che hanno già una faccia: finché la faccia non arriva
//   il testo usa la famiglia dopo, come farebbe l'export senza.
// - **Il tetto** è quello dell'export: 64 MiB di facce per disegno. Le
//   famiglie oltre il tetto ripiegano, e il disegno lo dice.
// - **Le facce che nessun disegno usa più** si tolgono quando un disegno si
//   chiude.

import type { PaintAttr, PaintDef, PaintNode, PaintScene } from "../painter/paint";
import { choose, familyGeneric, familyKey, fubLiveFamily, isFontFile, isReserved, liveFamily, MAX_FONT_BYTES, vaultNames, type FaceChoice, type FaceInfo, type FontRequest, type FontStyle, type Generic } from "./faces";

/// Le facce che un disegno può caricare, come nell'export: 64 MiB.
export const FONTS_BUDGET = 64 * 1024 * 1024;

/// Un allegato del vault, come lo elenca l'anagrafe.
export interface VaultFontFile {
  readonly id: string;
  readonly size: number;
  /// L'ultima modifica, in millisecondi.
  readonly mtime: number;
}

/// Ciò che la superficie chiede alla shell per i caratteri del vault.
export interface VaultFontPort {
  /// Gli allegati del vault, nell'ordine dell'anagrafe, che è quello in cui
  /// li legge l'export: i file di caratteri sono fra loro.
  files(): Promise<readonly VaultFontFile[]>;
  /// I byte del file `id`; `null` se non c'è più o se pesa più di `limit`.
  read(id: string, limit: number): Promise<Uint8Array | null>;
  /// Una domanda all'indice `fub.draw` dell'host, e la sua risposta.
  ask(query: unknown): Promise<unknown>;
  /// Chiama `changed` con l'id di un allegato del vault che arriva, cambia o
  /// se ne va, o con `null` quando si apre un altro vault o degli avvisi si
  /// sono persi; torna chi smette.
  watch?(changed: (id: string | null) => void): () => void;
}

/// Dove le facce entrano perché il browser le usi: `document.fonts`, se non
/// è dato.
export interface FaceRegistry {
  /// Registra `data` sotto `family` coi descrittori dati; torna la faccia, o
  /// `null` se il browser non la legge.
  add(family: string, data: Uint8Array, descriptors: { readonly weight: string; readonly style: string }): Promise<object | null>;
  remove(face: object): void;
}

const browserFaces: FaceRegistry = {
  async add(family, data, descriptors) {
    if (typeof FontFace === "undefined" || typeof document === "undefined" || document.fonts === undefined) return null;
    try {
      // I byte vengono sempre da un `ArrayBuffer`: la porta li legge in uno
      // nuovo, l'host li manda in base64.
      const face = new FontFace(family, data as Uint8Array<ArrayBuffer>, { ...descriptors, stretch: "100%" });
      await face.load();
      document.fonts.add(face);
      return face;
    } catch {
      return null;
    }
  },
  remove(face) {
    try {
      document.fonts.delete(face as FontFace);
    } catch {
      // Una faccia che il browser non ha più non c'è da togliere.
    }
  },
};

// --- i caratteri di una scena -------------------------------------------------------

/// Il carattere di un pezzo di testo: `font-family` com'è scritto, il peso e
/// lo stile, ereditati come li eredita l'export.
export interface TextFont {
  readonly family: string;
  readonly weight: number;
  readonly style: FontStyle;
}

const keyOf = (font: TextFont): string => `${font.family}\u0000${font.weight}\u0000${font.style}`;

/// Il peso di `value`, o `null` se non è uno di quelli del formato.
function weightOf(value: string): number | null {
  const weight = value.trim();
  if (weight === "normal") return 400;
  if (weight === "bold") return 700;
  return /^[1-9]00$/.test(weight) ? Number(weight) : null;
}

function styleOf(value: string): FontStyle | null {
  const style = value.trim();
  return style === "normal" || style === "italic" || style === "oblique" ? style : null;
}

/// Ciò che chiede un carattere scritto come lo scrive la misura del testo.
export function requestOf(font: { readonly weight: string; readonly style: string }): FontRequest {
  return { weight: weightOf(font.weight) ?? 400, style: styleOf(font.style) ?? "normal", stretch: 100 };
}

/// `parent` con gli attributi di carattere di `attrs`.
function inherit(parent: TextFont, attrs: readonly PaintAttr[]): TextFont {
  let { family, weight, style } = parent;
  for (const [name, value] of attrs) {
    if (name === "font-family") family = value;
    else if (name === "font-weight") weight = weightOf(value) ?? weight;
    else if (name === "font-style") style = styleOf(value) ?? style;
  }
  return family === parent.family && weight === parent.weight && style === parent.style ? parent : { family, weight, style };
}

/// Il carattere di un testo che nessuno dice: senza `font-family` l'export
/// scrive in Literata.
const ROOT_FONT: TextFont = { family: "", weight: 400, style: "normal" };

interface Walked {
  readonly context: string;
  readonly fonts: readonly TextFont[];
}

/// I caratteri dei nodi già visti, col carattere che ereditavano: un gruppo
/// che non è cambiato non si rilegge.
const walked = new WeakMap<object, Walked>();

/// I caratteri dei pezzi di testo di `node`. Anche gli spazi fra le righe
/// si scrivono, col carattere del testo.
function fontsOfNode(node: PaintNode, parent: TextFont): readonly TextFont[] {
  const context = keyOf(parent);
  const known = walked.get(node);
  if (known !== undefined && known.context === context) return known.fonts;
  const font = inherit(parent, node.attrs);
  const out: TextFont[] = [];
  if (node.kind === "group") {
    for (const child of node.children) out.push(...fontsOfNode(child, font));
  } else if (node.tag === "text") {
    for (const run of node.runs ?? []) {
      if (run.kind === "space") {
        if (run.text !== "") out.push(font);
        continue;
      }
      const line = run.kind === "span" ? inherit(font, run.attrs) : font;
      const parts = run.parts;
      if (parts === undefined ? run.text !== "" : parts.some((part) => typeof part === "string" && part !== "")) out.push(line);
      for (const part of parts ?? []) if (typeof part !== "string" && part.text !== "") out.push(inherit(line, part.attrs));
    }
  }
  walked.set(node, { context, fonts: out });
  return out;
}

function fontsOfDef(def: PaintDef, parent: TextFont, out: TextFont[]): void {
  const font = inherit(parent, def.attrs);
  const text = def.tag === "text" || def.tag === "tspan";
  for (const child of def.children) {
    if (typeof child === "string") {
      if (text && child !== "") out.push(font);
    } else {
      fontsOfDef(child, font, out);
    }
  }
}

/// I caratteri che i testi vivi di `scene` chiedono, ciascuno una volta, in
/// ordine di documento: quelli degli strati, poi quelli delle risorse.
export function sceneFonts(scene: PaintScene): TextFont[] {
  const root = inherit(ROOT_FONT, scene.root.attrs);
  const context = keyOf(root);
  const all: TextFont[] = [];
  for (const layer of scene.layers) if (layer.kind === "live") for (const node of layer.nodes) all.push(...fontsOfNode(node, root));
  for (const resource of scene.resources) {
    let known = walked.get(resource);
    if (known === undefined || known.context !== context) {
      const fonts: TextFont[] = [];
      fontsOfDef(resource, root, fonts);
      known = { context, fonts };
      walked.set(resource, known);
    }
    all.push(...known.fonts);
  }
  const seen = new Set<string>();
  return all.filter((font) => {
    const key = keyOf(font);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- il catalogo e le facce -----------------------------------------------------------

/// Un file del catalogo, con le sue facce; `null` per uno che non si legge
/// come carattere.
interface CatalogFile {
  readonly file: VaultFontFile;
  readonly faces: readonly FaceInfo[] | null;
}

/// A che punto è una faccia: si sta caricando, è registrata, non si carica,
/// o la famiglia non è nel vault.
export type SlotState = "pending" | "ready" | "failed" | "absent";

/// Una famiglia del vault a un peso e uno stile.
export interface Slot {
  readonly key: string;
  readonly name: string;
  readonly request: FontRequest;
  readonly state: SlotState;
  /// L'istanza registrata, uguale per due richieste che danno la stessa: il
  /// file, la faccia e i punti degli assi.
  readonly source: string | null;
  /// I byte dell'istanza registrata.
  readonly bytes: number;
  /// Si risolve quando la scelta di ora è registrata, o non si registra.
  readonly done: Promise<void>;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

interface SlotRecord extends Writable<Slot> {
  face: object | null;
  /// Cresce a ogni nuova scelta: una risposta arrivata tardi non vale più.
  turn: number;
  /// I disegni aperti che usano la faccia.
  users: number;
}

const fileKey = (file: VaultFontFile): string => `${file.id}\u0000${file.size}\u0000${file.mtime}`;

/// I byte in base64, a pezzi: `String.fromCharCode` non prende milioni di
/// argomenti.
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRange = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]);
const STYLES: ReadonlySet<unknown> = new Set(["normal", "italic", "oblique"]);
const GENERICS: ReadonlySet<unknown> = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy"]);

function isCoordinate(value: unknown): boolean {
  const item = value as { tag?: unknown; value?: unknown } | null;
  return typeof item === "object" && item !== null && typeof item.tag === "string" && isNumber(item.value);
}

function isAxis(value: unknown): boolean {
  const axis = value as { tag?: unknown; min?: unknown; default?: unknown; max?: unknown } | null;
  return typeof axis === "object" && axis !== null && typeof axis.tag === "string" && isNumber(axis.min) && isNumber(axis.default) && isNumber(axis.max);
}

function isStyleSlot(value: unknown): boolean {
  const slot = value as { style?: unknown; fixed?: unknown } | null;
  return typeof slot === "object" && slot !== null && STYLES.has(slot.style) && Array.isArray(slot.fixed) && slot.fixed.every(isCoordinate);
}

/// Le facce della risposta di `font_faces`; `null` se non ha la forma attesa.
export function facesOf(answer: unknown): FaceInfo[] | null {
  const faces = (answer as { faces?: unknown } | null)?.faces;
  if (!Array.isArray(faces)) return null;
  for (const face of faces as unknown[]) {
    const item = face as Partial<Record<keyof FaceInfo, unknown>> | null;
    if (typeof item !== "object" || item === null) return null;
    if (!isNumber(item.index) || typeof item.family !== "string" || !GENERICS.has(item.generic)) return null;
    if (!Array.isArray(item.names) || !item.names.every((name) => typeof name === "string")) return null;
    if (!isRange(item.weight) || !isRange(item.stretch)) return null;
    if (!Array.isArray(item.styles) || !item.styles.every(isStyleSlot)) return null;
    if (!Array.isArray(item.axes) || !item.axes.every(isAxis)) return null;
  }
  return faces as FaceInfo[];
}

/// Quanti file si leggono insieme.
const READS = 4;

/// Quanto aspettare, dopo un file cambiato, prima di rileggere il catalogo:
/// una cartella copiata nel vault è un evento per file.
export const SETTLE_MS = 300;

/// I caratteri del vault di una shell: il catalogo, le facce registrate e chi
/// li segue. Uno per porta, per tutta la vita dell'app.
export class VaultFonts {
  private files: readonly CatalogFile[] | null = null;
  /// Le chiavi delle famiglie del catalogo che si possono usare.
  private known: ReadonlySet<string> = new Set();
  private loading: Promise<void> | null = null;
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly described = new Map<string, Promise<FaceInfo[] | null>>();
  private readonly slots = new Map<string, SlotRecord>();
  private readonly names = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private emitting = false;
  private faces = 0;

  constructor(
    private readonly port: VaultFontPort,
    private readonly registry: FaceRegistry = browserFaces,
  ) {
    port.watch?.((id) => {
      if (id === null || isFontFile(id)) this.changed();
    });
  }

  /// Vero se il catalogo è già stato letto.
  get loaded(): boolean {
    return this.files !== null;
  }

  /// Cresce ogni volta che una faccia entra o esce: una misura fatta prima
  /// può non valere più.
  get epoch(): number {
    return this.faces;
  }

  /// Legge il catalogo, se non c'è o se un file è cambiato; si risolve quando
  /// è letto.
  catalog(): Promise<void> {
    if (this.loading === null && (this.files === null || this.stale)) this.loading = this.reload();
    return this.loading ?? Promise.resolve();
  }

  private async reload(): Promise<void> {
    this.stale = false;
    let listed: readonly VaultFontFile[] | null = null;
    try {
      listed = (await this.port.files()).filter((file) => isFontFile(file.id));
    } catch {
      // Resta il catalogo di prima, e si riprova alla prossima domanda.
      this.stale = true;
    }
    if (listed !== null) {
      const keys = new Set(listed.map(fileKey));
      // Un file che non si leggeva si riprova; uno che non c'è più si scorda.
      for (const [key, faces] of this.described) if (!keys.has(key) || (await faces) === null) this.described.delete(key);
      const files: CatalogFile[] = new Array(listed.length);
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < listed.length) {
          const at = next++;
          const file = listed[at]!;
          files[at] = { file, faces: await this.describe(file) };
        }
      };
      await Promise.all(Array.from({ length: Math.min(READS, listed.length) }, worker));
      this.files = files;
    } else if (this.files === null) {
      this.files = [];
    }
    const known = new Set<string>();
    for (const { faces } of this.files) for (const face of faces ?? []) if (!isReserved(face)) for (const name of face.names) known.add(familyKey(name));
    this.known = known;
    this.loading = null;
    for (const slot of this.slots.values()) this.resolve(slot);
    this.emit();
    // Un file cambiato mentre si leggeva, e l'attesa già finita: si rilegge
    // ora.
    if (this.stale && listed !== null && this.timer === null) void this.catalog();
  }

  /// Le facce di `file`, lette una volta finché il file non cambia.
  private describe(file: VaultFontFile): Promise<FaceInfo[] | null> {
    const key = fileKey(file);
    let faces = this.described.get(key);
    if (faces === undefined) {
      faces = (async () => {
        if (file.size > MAX_FONT_BYTES) return null;
        try {
          const bytes = await this.port.read(file.id, MAX_FONT_BYTES);
          if (bytes === null) return null;
          return facesOf(await this.port.ask({ kind: "font_faces", version: 1, data: toBase64(bytes) }));
        } catch {
          return null;
        }
      })();
      this.described.set(key, faces);
    }
    return faces;
  }

  /// Un file di caratteri è cambiato: il catalogo si rilegge fra poco, se
  /// qualcuno l'ha già letto.
  private changed(): void {
    this.stale = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.files !== null) void this.catalog();
    }, SETTLE_MS);
  }

  /// Vero se il vault ha la famiglia `name`, fra quelle che non sono di Fub.
  has(name: string): boolean {
    return this.known.has(familyKey(name));
  }

  /// I file di caratteri che non si leggono.
  unreadable(): string[] {
    return (this.files ?? []).filter((file) => file.faces === null).map((file) => file.file.id);
  }

  /// Le famiglie del vault, una volta ciascuna, col nome che dicono e la
  /// famiglia generica da scrivere dopo, in ordine alfabetico.
  families(): { readonly name: string; readonly generic: Generic }[] {
    const lists = (this.files ?? []).map((file) => file.faces ?? []);
    const out = new Map<string, { name: string; generic: Generic }>();
    for (const faces of lists) {
      for (const face of faces) {
        const key = familyKey(face.family);
        if (isReserved(face) || out.has(key) || !this.known.has(key)) continue;
        out.set(key, { name: face.family, generic: familyGeneric(lists, face.family) ?? face.generic });
      }
    }
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    return [...out.values()].sort((a, b) => collator.compare(a.name, b.name));
  }

  /// Il nome con cui la superficie registra la famiglia `name`: lo stesso per
  /// tutta la vita dell'app.
  nameOf(name: string): string {
    const key = familyKey(name);
    let live = this.names.get(key);
    if (live === undefined) {
      live = `fubdraw-vault-${this.names.size + 1}`;
      this.names.set(key, live);
    }
    return live;
  }

  /// Il nome registrato della famiglia `name`, se ha già una faccia pronta;
  /// se no `null`, e il testo usa la famiglia dopo.
  liveName(name: string): string | null {
    const key = familyKey(name);
    if (!this.known.has(key)) return null;
    for (const slot of this.slots.values()) if (slot.state === "ready" && familyKey(slot.name) === key) return this.nameOf(name);
    return null;
  }

  /// La faccia della famiglia `name` per `request`: la chiede, se nessuno
  /// l'ha chiesta.
  want(name: string, request: FontRequest): Slot {
    const key = `${familyKey(name)}\u0000${request.weight}\u0000${request.style}\u0000${request.stretch}`;
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = { key, name, request, state: "pending", source: null, face: null, bytes: 0, done: Promise.resolve(), turn: 0, users: 0 };
      this.slots.set(key, slot);
      this.resolve(slot);
    }
    return slot;
  }

  /// Un disegno aperto usa `slot`.
  hold(slot: Slot): void {
    const record = this.slots.get(slot.key);
    if (record !== undefined) record.users++;
  }

  /// Un disegno non usa più `slot`.
  release(slot: Slot): void {
    const record = this.slots.get(slot.key);
    if (record !== undefined && record.users > 0) record.users--;
  }

  /// Toglie le facce che nessun disegno aperto usa.
  sweep(): void {
    for (const [key, slot] of this.slots) {
      if (slot.users > 0) continue;
      slot.turn++;
      slot.done = Promise.resolve();
      if (slot.face !== null) {
        this.registry.remove(slot.face);
        this.faces++;
      }
      this.slots.delete(key);
    }
  }

  /// Sceglie di nuovo la faccia di `slot` dal catalogo, e la registra se è
  /// un'altra. Una scelta che ne trova una più nuova finisce con quella.
  private resolve(slot: SlotRecord): void {
    const turn = ++slot.turn;
    slot.done = (async (): Promise<void> => {
      await this.catalog();
      if (slot.turn !== turn) return slot.done;
      const files = this.files ?? [];
      const choice = this.has(slot.name) ? choose(files.map((file) => file.faces ?? []), slot.name, slot.request) : null;
      if (choice === null) {
        this.settle(slot, "absent", null, null, 0);
        return;
      }
      const file = files[choice.file]!;
      const face = file.faces![choice.face]!;
      const source = `${fileKey(file.file)}\u0000${face.index}\u0000${choice.coordinates.map((each) => `${each.tag}=${each.value}`).join(",")}`;
      if (slot.state === "ready" && slot.source === source) return;
      const bytes = await this.instance(file, face, choice);
      if (slot.turn !== turn) return slot.done;
      const registered = bytes === null ? null : await this.registry.add(this.nameOf(slot.name), bytes, { weight: String(slot.request.weight), style: slot.request.style });
      if (slot.turn !== turn) {
        if (registered !== null) this.registry.remove(registered);
        return slot.done;
      }
      if (registered === null) this.settle(slot, "failed", null, null, 0);
      else this.settle(slot, "ready", source, registered, bytes!.length);
    })();
  }

  /// I byte della faccia scelta: il file com'è, se ha una faccia statica sola;
  /// se no la faccia fissata dall'host nei punti scelti.
  private async instance(file: CatalogFile, face: FaceInfo, choice: FaceChoice): Promise<Uint8Array | null> {
    try {
      const bytes = await this.port.read(file.file.id, MAX_FONT_BYTES);
      if (bytes === null) return null;
      if (file.faces!.length === 1 && face.axes.length === 0 && choice.coordinates.length === 0) return bytes;
      const answer = await this.port.ask({ kind: "font_instance", version: 1, data: toBase64(bytes), index: face.index, coordinates: choice.coordinates });
      const data = (answer as { data?: unknown } | null)?.data;
      return typeof data === "string" ? fromBase64(data) : null;
    } catch {
      return null;
    }
  }

  private settle(slot: SlotRecord, state: SlotState, source: string | null, face: object | null, bytes: number): void {
    if (slot.face !== null && slot.face !== face) this.registry.remove(slot.face);
    if (slot.face !== face) this.faces++;
    slot.state = state;
    slot.source = source;
    slot.face = face;
    slot.bytes = bytes;
    this.emit();
  }

  /// Chiama `listener` quando il catalogo o una faccia cambiano; torna chi
  /// smette.
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /// Avvisa chi segue, una volta per giro: più facce arrivate insieme sono un
  /// avviso solo.
  private emit(): void {
    if (this.emitting) return;
    this.emitting = true;
    queueMicrotask(() => {
      this.emitting = false;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

/// I caratteri del vault di ogni porta.
const vaults = new WeakMap<VaultFontPort, VaultFonts>();

/// I caratteri del vault della porta `port`, gli stessi per ogni disegno.
export function vaultFontsOf(port: VaultFontPort): VaultFonts {
  let fonts = vaults.get(port);
  if (fonts === undefined) {
    fonts = new VaultFonts(port);
    vaults.set(port, fonts);
  }
  return fonts;
}

// --- i caratteri di un disegno ------------------------------------------------------------

/// Ciò che il disegno dice dei suoi caratteri.
export interface FontNotes {
  /// Le famiglie che non sono di Fub né del vault, e ripiegano.
  readonly missing: readonly string[];
  /// I file di caratteri che non si leggono, quando una famiglia manca.
  readonly unreadable: readonly string[];
  /// Le famiglie oltre il tetto dei caratteri del disegno.
  readonly over: readonly string[];
  /// Le famiglie del vault che non si caricano.
  readonly failed: readonly string[];
}

export const NO_NOTES: FontNotes = { missing: [], unreadable: [], over: [], failed: [] };

/// Un carattere come lo scrive la misura del testo.
export interface WrittenFont {
  readonly family: string;
  readonly weight: string;
  readonly style: string;
}

/// Vero se `names` ha già la famiglia `name`.
const listed = (names: readonly string[], name: string): boolean => names.some((each) => familyKey(each) === familyKey(name));

/// I caratteri di un disegno: la famiglia viva di ogni `font-family`, le facce
/// che i suoi testi chiedono, e ciò che manca. Senza caratteri del vault, le
/// sole famiglie di Fub.
export class DrawingFonts {
  private fonts: readonly TextFont[] = [];
  private held: readonly Slot[] = [];
  private over: ReadonlySet<string> = new Set();
  private notes: FontNotes = NO_NOTES;
  private signature = "";
  private readonly memo = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly unwatch: () => void;

  constructor(private readonly vault: VaultFonts | null) {
    this.unwatch = vault === null ? () => undefined : vault.watch(() => this.update());
  }

  /// La `font-family` da dare al browser per `value`.
  readonly live = (value: string): string => {
    const vault = this.vault;
    if (vault === null) return fubLiveFamily(value);
    let live = this.memo.get(value);
    if (live === undefined) {
      live = liveFamily(value, (name) => (this.over.has(familyKey(name)) ? null : vault.liveName(name)));
      this.memo.set(value, live);
    }
    return live;
  };

  /// I testi del disegno sono quelli di `scene`: le facce che chiedono si
  /// caricano.
  use(scene: PaintScene): void {
    if (this.vault === null) return;
    const fonts = sceneFonts(scene);
    if (fonts.length === this.fonts.length && fonts.every((font, i) => keyOf(font) === keyOf(this.fonts[i]!))) return;
    this.fonts = fonts;
    this.update();
  }

  /// Chiede le facce dei testi, conta il tetto e ciò che manca; avvisa se la
  /// famiglia viva o le note cambiano.
  private update(): void {
    const vault = this.vault!;
    this.memo.clear();
    const wanted = this.fonts.map((font) => [font, vaultNames(font.family)] as const).filter(([, names]) => names.length > 0);
    if (wanted.length > 0 && !vault.loaded) void vault.catalog();
    const missing: string[] = [];
    const failed: string[] = [];
    const over = new Set<string>();
    const overNames: string[] = [];
    const held: Slot[] = [];
    if (vault.loaded) {
      let total = 0;
      const counted = new Set<string>();
      for (const [font, names] of wanted) {
        for (const name of names) {
          const key = familyKey(name);
          if (!vault.has(name)) {
            if (!listed(missing, name)) missing.push(name);
            continue;
          }
          const slot = vault.want(name, { weight: font.weight, style: font.style, stretch: 100 });
          if (!held.includes(slot)) held.push(slot);
          if (slot.state === "failed" && !listed(failed, name)) failed.push(name);
          if (slot.state !== "ready" || slot.source === null || counted.has(slot.source) || over.has(key)) continue;
          if (total + slot.bytes > FONTS_BUDGET) {
            over.add(key);
            overNames.push(name);
            continue;
          }
          total += slot.bytes;
          counted.add(slot.source);
        }
      }
    }
    for (const slot of held) vault.hold(slot);
    for (const slot of this.held) vault.release(slot);
    this.held = held;
    this.over = over;
    this.notes = { missing, unreadable: missing.length > 0 ? vault.unreadable() : [], over: overNames, failed };
    const live = [...new Set(wanted.flatMap(([, names]) => names.map((name) => `${familyKey(name)}=${over.has(familyKey(name)) ? "" : (vault.liveName(name) ?? "")}`)))];
    const signature = JSON.stringify([live, this.notes]);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const listener of [...this.listeners]) listener();
  }

  /// Si risolve quando le facce di `fonts` sono pronte, o quando si sa che
  /// non ci saranno: la misura di dopo le usa.
  async ready(fonts: readonly WrittenFont[]): Promise<void> {
    const vault = this.vault;
    if (vault === null || !fonts.some((font) => vaultNames(font.family).length > 0)) return;
    await vault.catalog();
    const slots = fonts.flatMap((font) => vaultNames(font.family).filter((name) => vault.has(name)).map((name) => vault.want(name, requestOf(font))));
    await Promise.all(slots.map((slot) => slot.done));
  }

  /// Vero se la famiglia viva di `font` non cambierà più: le sue facce del
  /// vault sono arrivate, o si sa che non ci saranno.
  settled(font: WrittenFont): boolean {
    const vault = this.vault;
    if (vault === null) return true;
    const names = vaultNames(font.family);
    if (names.length === 0) return true;
    if (!vault.loaded) return false;
    const request = requestOf(font);
    return names.every((name) => !vault.has(name) || vault.want(name, request).state !== "pending");
  }

  /// Cresce ogni volta che una faccia del vault entra o esce.
  epoch(): number {
    return this.vault?.epoch ?? 0;
  }

  /// Le famiglie del vault, per il menu.
  families(): { readonly name: string; readonly generic: Generic }[] {
    return this.vault?.families() ?? [];
  }

  /// Ciò che manca, è oltre il tetto o non si carica.
  fontNotes(): FontNotes {
    return this.notes;
  }

  /// Chiama `listener` quando la famiglia viva o le note cambiano; torna chi
  /// smette.
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /// Il disegno si chiude: le sue facce che nessun altro usa si tolgono.
  dispose(): void {
    this.unwatch();
    this.listeners.clear();
    const vault = this.vault;
    if (vault === null) return;
    for (const slot of this.held) vault.release(slot);
    this.held = [];
    vault.sweep();
  }
}
