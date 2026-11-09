// Il presidio dei nomi che i due lati della lavagna si dicono: **il Rust
// dichiara le impostazioni della lavagna, il client le legge, e i nomi devono
// essere gli stessi**.
//
// `fub.lavagna` dichiara in Rust `canvas.ink_mouse_remember` e
// `canvas.finger_moves_card` (`crates/fub-features/src/lavagna.rs`); il client
// le legge da `preferences.ts`. Una chiave rinominata da una parte sola non fa
// rumore: l'interruttore acceso nelle Impostazioni la lavagna non lo vede più,
// e resta in silenzio spento. Per questo un test le tiene ferme tutte e due.
//
// Il sorgente Rust si legge come testo, col `?raw` di Vite, come
// `editors/spatial/draw-settings-mirror.test.ts`. I valori si cercano per nome
// di costante e non per posizione, e se un nome non si trova il test cade.
import { describe, expect, it } from "vitest";
import LAVAGNA_RS from "../../../../../crates/fub-features/src/lavagna.rs?raw";
import { DEFAULT_PREFERENCES, FINGER_MOVES_CARD_KEY, INK_MOUSE_REMEMBER_KEY, LAVAGNA_BUNDLE } from "./preferences";

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

/// Il corpo della funzione `settings()` di `lavagna.rs`.
function settingsBody(): string {
  const found = /pub fn settings\(\) -> Vec<SettingSpec> \{([\s\S]*?)\n\}/.exec(LAVAGNA_RS);
  if (found === null) throw new Error("lavagna.rs non ha `pub fn settings()`");
  return found[1]!;
}

describe("le impostazioni della lavagna, Rust e client", () => {
  it("il sorgente Rust si legge: le costanti che si confrontano ci sono", () => {
    for (const name of ["CANVAS_INK_MOUSE_REMEMBER_KEY", "CANVAS_FINGER_MOVES_CARD_KEY"]) {
      expect(text(name), name).toMatch(/^canvas\.[a-z_]+$/);
    }
  });

  it("le chiavi e il bundle sono quelli che il client legge", () => {
    expect(text("CANVAS_INK_MOUSE_REMEMBER_KEY")).toBe(INK_MOUSE_REMEMBER_KEY);
    expect(text("CANVAS_FINGER_MOVES_CARD_KEY")).toBe(FINGER_MOVES_CARD_KEY);
    expect(text("LAVAGNA_ID")).toBe(LAVAGNA_BUNDLE);
  });

  it("le due sono interruttori della macchina spenti di serie, come il client parte", () => {
    const body = settingsBody();
    for (const name of ["CANVAS_INK_MOUSE_REMEMBER_KEY", "CANVAS_FINGER_MOVES_CARD_KEY"]) expect(body).toContain(name);
    expect(body.match(/SettingKind::Toggle \{ default: false \}/g)).toHaveLength(2);
    expect(body.match(/\.for_machine\(\)/g)).toHaveLength(2);
    expect(body).not.toContain("default: true");
    expect(DEFAULT_PREFERENCES).toEqual({ inkMouseRemember: false, fingerMovesCard: false });
  });
});
