// Il presidio dei nomi che i due lati dell'editor si dicono: **il Rust dichiara
// le impostazioni dei disegni, il client le legge, e i nomi devono essere gli
// stessi**.
//
// `fub.draw` dichiara in Rust `draw.level` (con i suoi quattro valori),
// `draw.custom` (con le parti di partenza del Personalizzato),
// `draw.suggestions` e le cartelle dei modelli e delle librerie di simboli
// (`crates/fub-features/src/draw.rs`); il client li legge da
// `preferences.ts`, da `templates/choices.ts` e da
// `tools/symbol-libraries.ts`, e li interpreta con `tools/registry.ts`. Una parte
// rinominata da una parte sola non fa rumore: il livello scritto dal pannello
// Impostazioni non lo riconosce più l'editor, e ricade in silenzio sul livello
// di serie. Per questo un test le tiene ferme tutte e due.
//
// Il sorgente Rust si legge come testo, col `?raw` di Vite e non con
// `node:fs`, per la stessa ragione del presidio del §1.3
// (`host/no-tauri-outside-host.test.ts`): `tsconfig.json` dichiara i soli tipi
// di Vite. È lo stesso modo in cui `scene/corpus.test.ts` legge i file di
// `crates/`. I valori si cercano per nome di costante e non per posizione, e
// se un nome non si trova il test cade: un presidio che non trova ciò che
// confronta non deve restare verde.
import { describe, expect, it } from "vitest";
import DRAW_RS from "../../../../../crates/fub-features/src/draw.rs?raw";
import { CUSTOM_KEY, LEVEL_KEY, SUGGESTIONS_KEY, currentCustom, currentLevel } from "./preferences";
import { CUSTOM_DEFAULT, isFeature, isLevel, levelsAbove } from "./tools/registry";
import { SYMBOLS_FOLDER, SYMBOLS_SETTING, symbolsFolder } from "./tools/symbol-libraries";
import { DRAW_BUNDLE, TEMPLATES_FOLDER, TEMPLATES_SETTING, templatesFolder } from "./templates/choices";

/// Il valore, come testo, della costante pubblica `name` di `draw.rs`.
function constant(name: string): string {
  const found = new RegExp(`pub const ${name}: [^=]+= ([^;]+);`).exec(DRAW_RS);
  if (found === null) throw new Error(`draw.rs non ha la costante pubblica ${name}`);
  return found[1]!.trim();
}

/// Una costante di testo: `"draw.level"` → `draw.level`.
function text(name: string): string {
  const found = /^"([^"\\]*)"$/.exec(constant(name));
  if (found === null) throw new Error(`${name} non è una stringa semplice: ${constant(name)}`);
  return found[1]!;
}

/// Una costante che è un elenco di stringhe, nell'ordine in cui è scritto:
/// `["a", "b"]` → `["a", "b"]`. La lunghezza dichiarata nel tipo
/// (`[&str; 4]`) deve essere quella degli elementi, o la lettura è sbagliata.
function strings(name: string): string[] {
  const body = /^\[(.*)\]$/s.exec(constant(name));
  if (body === null) throw new Error(`${name} non è un elenco: ${constant(name)}`);
  const items = [...body[1]!.matchAll(/"([^"\\]*)"/g)].map((item) => item[1]!);
  const declared = new RegExp(`pub const ${name}: \\[&str; (\\d+)\\]`).exec(DRAW_RS);
  expect(declared, `${name} dichiara la sua lunghezza`).not.toBeNull();
  expect(items.length, `gli elementi di ${name}`).toBe(Number(declared![1]));
  return items;
}

describe("le impostazioni dei disegni, Rust e client", () => {
  it("il sorgente Rust si legge: le costanti che si confrontano ci sono", () => {
    for (const name of ["DRAW_LEVEL_KEY", "DRAW_CUSTOM_KEY", "DRAW_SUGGESTIONS_KEY"]) {
      expect(text(name), name).toMatch(/^draw\.[a-z]+$/);
    }
    expect(strings("DRAW_LEVELS").length).toBeGreaterThan(0);
    expect(strings("DRAW_CUSTOM_DEFAULT").length).toBeGreaterThan(0);
  });

  it("le chiavi sono quelle che il client legge e scrive", () => {
    expect(text("DRAW_LEVEL_KEY")).toBe(LEVEL_KEY);
    expect(text("DRAW_CUSTOM_KEY")).toBe(CUSTOM_KEY);
    expect(text("DRAW_SUGGESTIONS_KEY")).toBe(SUGGESTIONS_KEY);
    expect(text("DRAW_TEMPLATES_KEY")).toBe(TEMPLATES_SETTING);
    expect(text("DRAW_SYMBOLS_KEY")).toBe(SYMBOLS_SETTING);
    expect(text("DRAW_ID")).toBe(DRAW_BUNDLE);
  });

  it("le cartelle di serie sono quelle che il client usa quando l'impostazione non dice niente", () => {
    expect(text("DRAW_TEMPLATES_DEFAULT")).toBe(TEMPLATES_FOLDER);
    expect(templatesFolder(undefined)).toBe(text("DRAW_TEMPLATES_DEFAULT"));
    expect(text("DRAW_SYMBOLS_DEFAULT")).toBe(SYMBOLS_FOLDER);
    expect(symbolsFolder(undefined)).toBe(text("DRAW_SYMBOLS_DEFAULT"));
  });

  it("i livelli sono quelli del registro, nello stesso ordine, e il primo è quello di serie", () => {
    const levels = strings("DRAW_LEVELS");
    // I tre pronti dal più semplice, poi il Personalizzato.
    expect(levels).toEqual([...levelsAbove("custom"), "custom"]);
    for (const level of levels) expect(isLevel(level), level).toBe(true);
    expect(new Set(levels).size).toBe(levels.length);
    // Senza impostazioni l'editor parte dal primo: è il default che il Rust
    // dichiara per `draw.level`.
    expect(currentLevel()).toBe(levels[0]);
  });

  it("le parti di partenza del Personalizzato sono quelle del registro, nello stesso ordine", () => {
    const parts = strings("DRAW_CUSTOM_DEFAULT");
    expect(parts).toEqual([...CUSTOM_DEFAULT]);
    for (const part of parts) expect(isFeature(part), part).toBe(true);
    expect(new Set(parts).size).toBe(parts.length);
    // E sono ciò che l'editor usa quando l'impostazione non dice niente.
    expect(currentCustom()).toEqual(parts);
  });
});
