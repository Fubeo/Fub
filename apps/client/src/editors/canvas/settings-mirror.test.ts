// Il presidio dei nomi che i due lati della lavagna si dicono: **il Rust
// dichiara le impostazioni della lavagna, il client le legge, e chiavi, ordine,
// specie, valori e default devono essere gli stessi**.
//
// `fub.lavagna` dichiara in Rust le dodici impostazioni del gruppo «Lavagna»
// (`crates/fub-features/src/lavagna.rs`); il client le legge da `preferences.ts`.
// Una chiave rinominata da una parte sola non fa rumore: l'interruttore acceso
// nelle Impostazioni la lavagna non lo vede più, e resta in silenzio spento.
// Per questo un test le tiene ferme tutte e due.
//
// Il sorgente Rust si legge come testo, col `?raw` di Vite, come
// `editors/spatial/draw-settings-mirror.test.ts`. I valori si cercano per nome
// di costante e non per posizione, e se un nome non si trova il test cade.
import { describe, expect, it } from "vitest";
import LAVAGNA_RS from "../../../../../crates/fub-features/src/lavagna.rs?raw";
import {
  DEFAULT_PREFERENCES,
  DROP_FOLDER_KEY,
  DROP_FOLDER_PATH_DEFAULT,
  DROP_FOLDER_PATH_KEY,
  DROP_FOLDER_VALUES,
  FINGER_MOVES_CARD_KEY,
  FINGER_WRITES_KEY,
  GRID_KEY,
  INK_MOUSE_REMEMBER_KEY,
  LAVAGNA_BUNDLE,
  PARTS_PICKER_KEY,
  PEN_BUTTON_KEY,
  PEN_BUTTON_VALUES,
  SNAP_KEY,
  TOOLBAR_KEY,
  WHEEL_KEY,
  WHEEL_VALUES,
  WORKSPACE_KEY,
  WORKSPACE_VALUES,
} from "./preferences";

/// La specie che il client legge per ciascuna riga.
type Kind = "toggle" | "choice" | "list" | "text";

/// Una riga del client: il nome della costante Rust, la chiave, la specie, il
/// default, le scelte (per `choice`) e se è della macchina.
interface ClientRow {
  readonly rust: string;
  readonly key: string;
  readonly kind: Kind;
  readonly fallback: unknown;
  readonly values?: readonly string[];
  readonly machine: boolean;
}

/// Le dodici righe del client, nell'ordine del pannello.
const CLIENT: readonly ClientRow[] = [
  { rust: "CANVAS_INK_MOUSE_REMEMBER_KEY", key: INK_MOUSE_REMEMBER_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.inkMouseRemember, machine: true },
  { rust: "CANVAS_FINGER_MOVES_CARD_KEY", key: FINGER_MOVES_CARD_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.fingerMovesCard, machine: true },
  { rust: "CANVAS_FINGER_WRITES_KEY", key: FINGER_WRITES_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.fingerWrites, machine: true },
  { rust: "CANVAS_PEN_BUTTON_KEY", key: PEN_BUTTON_KEY, kind: "choice", fallback: DEFAULT_PREFERENCES.penButton, values: PEN_BUTTON_VALUES, machine: true },
  { rust: "CANVAS_WHEEL_KEY", key: WHEEL_KEY, kind: "choice", fallback: DEFAULT_PREFERENCES.wheel, values: WHEEL_VALUES, machine: true },
  { rust: "CANVAS_WORKSPACE_KEY", key: WORKSPACE_KEY, kind: "choice", fallback: DEFAULT_PREFERENCES.workspace, values: WORKSPACE_VALUES, machine: false },
  { rust: "CANVAS_TOOLBAR_KEY", key: TOOLBAR_KEY, kind: "list", fallback: DEFAULT_PREFERENCES.toolbar, machine: false },
  { rust: "CANVAS_GRID_KEY", key: GRID_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.grid, machine: false },
  { rust: "CANVAS_SNAP_KEY", key: SNAP_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.snap, machine: false },
  { rust: "CANVAS_PARTS_PICKER_KEY", key: PARTS_PICKER_KEY, kind: "toggle", fallback: DEFAULT_PREFERENCES.partsPicker, machine: false },
  { rust: "CANVAS_DROP_FOLDER_KEY", key: DROP_FOLDER_KEY, kind: "choice", fallback: DEFAULT_PREFERENCES.dropFolder, values: DROP_FOLDER_VALUES, machine: false },
  { rust: "CANVAS_DROP_FOLDER_PATH_KEY", key: DROP_FOLDER_PATH_KEY, kind: "text", fallback: DEFAULT_PREFERENCES.dropFolderPath, machine: false },
];

/// Il valore, come testo, della costante pubblica `name` di `lavagna.rs`.
function constant(name: string): string {
  const found = new RegExp(`pub const ${name}: [^=]+= ([^;]+);`).exec(LAVAGNA_RS);
  if (found === null) throw new Error(`lavagna.rs non ha la costante pubblica ${name}`);
  return found[1]!.trim();
}

/// Una costante di testo: `"canvas.x"` → `canvas.x`.
function text(name: string): string {
  const found = /^"([^"\\]*)"$/.exec(constant(name));
  if (found === null) throw new Error(`${name} non è una stringa semplice: ${constant(name)}`);
  return found[1]!;
}

/// Un elenco di testi di `lavagna.rs`: `["radial", "eraser", "pan"]`.
function strings(name: string): string[] {
  const list = constant(name);
  if (!list.startsWith("[") || !list.endsWith("]")) throw new Error(`${name} non è un elenco: ${list}`);
  return Array.from(list.matchAll(/"([^"\\]*)"/g), (match) => match[1]!);
}

/// Il corpo della funzione `settings()` di `lavagna.rs`.
function settingsBody(): string {
  const found = /pub fn settings\(\) -> Vec<SettingSpec> \{([\s\S]*?)\n\}/.exec(LAVAGNA_RS);
  if (found === null) throw new Error("lavagna.rs non ha `pub fn settings()`");
  return found[1]!;
}

/// Una riga di `settings()` come sta nel Rust: la costante della chiave, la
/// specie, il default, le scelte e le loro frasi, e se è della macchina.
interface RustRow {
  readonly key: string;
  readonly kind: string;
  readonly fallback: unknown;
  readonly values: string[];
  readonly labels: string[];
  readonly machine: boolean;
}

/// Le righe di `settings()`, una per blocco `row(`, nell'ordine in cui sono scritte.
function rustRows(): RustRow[] {
  return settingsBody()
    .split(/\brow\(/)
    .slice(1)
    .map((block): RustRow => {
      const key = /(CANVAS_[A-Z_]+_KEY)\b/.exec(block)?.[1];
      if (key === undefined) throw new Error(`una riga di settings() non ha una chiave: ${block}`);
      const machine = /\.for_machine\(\)/.test(block);
      const toggle = /SettingKind::Toggle \{ default: (true|false) \}/.exec(block);
      if (toggle !== null) return { key, kind: "toggle", fallback: toggle[1] === "true", values: [], labels: [], machine };
      const choice = /choice\(\s*&(CANVAS_[A-Z_]+_VALUES)/.exec(block);
      if (choice !== null) {
        const values = strings(choice[1]!);
        const labels = (/&\[([^\]]*)\]/.exec(block)?.[1] ?? "")
          .split(",")
          .map((label) => label.trim())
          .filter((label) => label !== "");
        return { key, kind: "choice", fallback: values[0], values, labels, machine };
      }
      if (/SettingKind::List \{\s*default: Vec::new\(\),?\s*\}/.test(block)) {
        return { key, kind: "list", fallback: [], values: [], labels: [], machine };
      }
      const plain = /SettingKind::Text \{\s*default: (CANVAS_[A-Z_]+)\.to_string\(\),?\s*\}/.exec(block);
      if (plain !== null) return { key, kind: "text", fallback: text(plain[1]!), values: [], labels: [], machine };
      throw new Error(`una riga di settings() non è di una specie che il client conosce: ${block}`);
    });
}

describe("le impostazioni della lavagna, Rust e client", () => {
  it("il sorgente Rust si legge: le dodici righe ci sono, e il bundle è quello del client", () => {
    expect(rustRows()).toHaveLength(CLIENT.length);
    expect(text("LAVAGNA_ID")).toBe(LAVAGNA_BUNDLE);
  });

  it("le chiavi sono quelle che il client legge, nello stesso ordine del pannello", () => {
    const rows = rustRows();
    expect(rows.map((row) => row.key)).toEqual(CLIENT.map((row) => row.rust));
    CLIENT.forEach((client, index) => {
      expect(text(client.rust), client.rust).toBe(client.key);
      expect(client.key, client.rust).toMatch(/^canvas\.[a-z_]+$/);
      expect(rows[index]!.key, client.rust).toBe(client.rust);
    });
  });

  it("ogni specie è quella che il client legge, e ogni default è quello di serie del client", () => {
    rustRows().forEach((row, index) => {
      const client = CLIENT[index]!;
      expect(row.kind, client.key).toBe(client.kind);
      expect(row.fallback, client.key).toEqual(client.fallback);
    });
  });

  it("le scelte hanno i valori del client, nello stesso ordine, e ciascuna una frase", () => {
    rustRows()
      .filter((row) => row.kind === "choice")
      .forEach((row) => {
        const client = CLIENT.find((candidate) => candidate.rust === row.key)!;
        expect(row.values, client.key).toEqual(client.values);
        expect(row.labels, client.key).toHaveLength(row.values.length);
      });
  });

  it("la cartella di serie dei file trascinati è quella del client", () => {
    expect(text("CANVAS_DROP_FOLDER_PATH_DEFAULT")).toBe(DROP_FOLDER_PATH_DEFAULT);
    expect(strings("CANVAS_DROP_FOLDER_VALUES")).toEqual(DROP_FOLDER_VALUES);
  });

  it("le prime cinque sono della macchina, le altre del vault", () => {
    expect(rustRows().map((row) => row.machine)).toEqual(CLIENT.map((row) => row.machine));
    expect(CLIENT.filter((row) => row.machine).map((row) => row.rust)).toEqual([
      "CANVAS_INK_MOUSE_REMEMBER_KEY",
      "CANVAS_FINGER_MOVES_CARD_KEY",
      "CANVAS_FINGER_WRITES_KEY",
      "CANVAS_PEN_BUTTON_KEY",
      "CANVAS_WHEEL_KEY",
    ]);
  });
});
