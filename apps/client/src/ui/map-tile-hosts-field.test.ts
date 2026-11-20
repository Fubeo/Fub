// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../host/contract";
import { hostFromInput, mapTileHostsField, OPENSTREETMAP_HOST } from "./map-tile-hosts-field";

function entry(value: string[]): SettingEntry {
  return {
    spec: {
      key: "map.tile-hosts",
      label: "Tessere delle mappe",
      description: "",
      group: "Privacy",
      scope: "machine",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value,
    source: value.length ? "machine" : "default",
  };
}

describe("il campo dei siti delle tessere", () => {
  it("vuoto lo dice, e OpenStreetMap si aggiunge con un clic", () => {
    const write = vi.fn();
    const field = mapTileHostsField(entry([]), "setting-map", write);
    expect(field.textContent).toContain("Nessun sito");
    expect(field.textContent).toContain("© OpenStreetMap contributors");
    const osm = [...field.querySelectorAll("button")].find((button) => button.textContent === "Aggiungi OpenStreetMap")!;
    osm.click();
    expect(write).toHaveBeenCalledWith([OPENSTREETMAP_HOST], OPENSTREETMAP_HOST, true);
  });

  it("con OpenStreetMap già dentro non lo ripropone, e un sito si toglie", () => {
    const write = vi.fn();
    const field = mapTileHostsField(entry([OPENSTREETMAP_HOST, "tiles.example.test"]), "setting-map", write);
    expect([...field.querySelectorAll("button")].some((button) => button.textContent === "Aggiungi OpenStreetMap")).toBe(false);
    field.querySelector<HTMLButtonElement>('[aria-label="Rimuovi tiles.example.test dai siti delle mappe"]')!.click();
    expect(write).toHaveBeenCalledWith([OPENSTREETMAP_HOST], "tiles.example.test", false);
  });

  it("aggiunge un nome, anche da un indirizzo incollato, e rifiuta ciò che non lo è", () => {
    const write = vi.fn();
    const field = mapTileHostsField(entry(["tiles.example.test"]), "setting-map", write);
    document.body.append(field);
    const input = field.querySelector<HTMLInputElement>("input")!;
    const form = field.querySelector("form")!;
    const error = field.querySelector<HTMLElement>(".setting-field-error")!;
    input.value = "tiles.example.test:8080/x";
    form.requestSubmit();
    expect(error.hidden).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.value = "TILES.example.test";
    form.requestSubmit();
    expect(error.textContent).toContain("già nell’elenco");
    input.value = "https://Mappe.Example.org/{z}/{x}/{y}.png";
    form.requestSubmit();
    expect(write).toHaveBeenCalledWith(["tiles.example.test", "mappe.example.org"], "mappe.example.org", true);
    field.remove();
  });

  it("dal testo esce soltanto un nome di host https", () => {
    expect(hostFromInput(" tile.openstreetmap.org ")).toBe("tile.openstreetmap.org");
    expect(hostFromInput("http://tile.openstreetmap.org/{z}/{x}/{y}.png")).toBeNull();
    expect(hostFromInput("*.example.org")).toBeNull();
    expect(hostFromInput("a b")).toBeNull();
    expect(hostFromInput("")).toBeNull();
  });
});
