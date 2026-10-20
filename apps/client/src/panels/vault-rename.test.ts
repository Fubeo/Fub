// @vitest-environment happy-dom
// Rinominare un vault cambia il nome nel registro, mai la cartella: solo Invio
// salva, Esc o l'uscita dal campo lasciano com'era, e il nome della cartella
// scritto per intero vale come «nessun nome scelto».
import { expect, it } from "vitest";
import type { KnownVault } from "../host/contract";
import { vaultNameEditor } from "./vault-rename";

const vault = (name: string): KnownVault =>
  ({ root: "/v/Appunti", name, icon: "📓", favorite: false, last_opened: 0, keys_seen: {} }) as KnownVault;

function mount(name: string) {
  const saved: string[] = [];
  const { label, rename } = vaultNameEditor(vault(name), "Appunti", "vn", (next) => void saved.push(next));
  const row = document.createElement("div");
  row.append(label, rename);
  document.body.replaceChildren(row);
  rename.click();
  const input = row.querySelector<HTMLInputElement>("input#vn")!;
  return { row, label, rename, input, saved };
}

const key = (input: HTMLInputElement, k: string) =>
  input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

it("Invio salva il nome ripulito, e l'etichetta torna al suo posto", () => {
  const { row, label, input, saved } = mount("");
  expect(row.querySelector(`label[for="vn"]`)).not.toBeNull();
  expect(input.value).toBe("Appunti");
  input.value = "  Diario  ";
  key(input, "Enter");
  expect(saved).toEqual(["Diario"]);
  expect(row.contains(label)).toBe(true);
  expect(row.querySelector("input")).toBeNull();
});

it("Esc e l'uscita dal campo non scrivono niente, e un nome uguale non si riscrive", () => {
  const first = mount("Diario");
  first.input.value = "Altro";
  key(first.input, "Escape");
  expect(first.saved).toEqual([]);
  const second = mount("Diario");
  second.input.value = "Altro";
  second.input.blur();
  expect(second.saved).toEqual([]);
  expect(second.row.querySelector("input")).toBeNull();
  const third = mount("Diario");
  key(third.input, "Enter");
  expect(third.saved).toEqual([]);
});

it("il nome della cartella, o un campo vuoto, torna a «nessun nome»", () => {
  const first = mount("Diario");
  first.input.value = "Appunti";
  key(first.input, "Enter");
  expect(first.saved).toEqual([""]);
  const second = mount("Diario");
  second.input.value = "   ";
  key(second.input, "Enter");
  expect(second.saved).toEqual([""]);
});
