import { describe, expect, it } from "vitest";

import { TREE_FOLDERS, TREE_TOTAL, treeFixture } from "./vault-fixture";

describe("il vault del banco dell'albero", () => {
  const fixture = treeFixture();
  const paths = Object.keys(fixture.files);

  it("ha cinquemila file in cinque cartelle, e la prima ne ha milleecinquecento", () => {
    expect(fixture.total).toBe(TREE_TOTAL);
    expect(paths).toHaveLength(TREE_TOTAL);
    expect(TREE_FOLDERS.reduce((sum, [, notes]) => sum + notes, 0)).toBe(TREE_TOTAL);
    const tops = new Set(paths.map((path) => path.split("/")[0]));
    expect([...tops].sort()).toEqual(TREE_FOLDERS.map(([name]) => name).sort());
    expect(paths.filter((path) => path.startsWith(`${fixture.big}/`))).toHaveLength(1500);
    expect(fixture.big).toBe("Archivio");
  });

  it("ha una catena di dieci cartelle, con una nota per livello e la nota in fondo", () => {
    expect(fixture.chain).toHaveLength(10);
    fixture.chain.forEach((folder, i) => {
      expect(folder.split("/")).toHaveLength(i + 2);
      // Ogni livello ha un file diretto: il finto dell'indice non vede una
      // cartella che ha soltanto sottocartelle (vedi `vault-fixture.ts`).
      const direct = paths.filter((path) => path.startsWith(`${folder}/`) && path.split("/").length === folder.split("/").length + 1);
      expect(direct.length).toBeGreaterThanOrEqual(1);
    });
    expect(fixture.deepest.startsWith(`${fixture.chain[9]}/`)).toBe(true);
    expect(fixture.files[fixture.deepest]).toBeDefined();
  });

  it("ha un nome lungo un centinaio di caratteri", () => {
    expect(fixture.longName.length).toBeGreaterThanOrEqual(100);
    expect(fixture.files[fixture.longName]).toBeDefined();
  });

  it("ha una nota da cercare che nessun'altra ha", () => {
    const name = fixture.target.split("/").pop()!.replace(/\.md$/, "");
    expect(paths.filter((path) => path.includes(name))).toEqual([fixture.target]);
  });

  it("è lo stesso vault a ogni chiamata", () => {
    const again = treeFixture();
    expect(again.digest).toBe(fixture.digest);
    expect(again.files).toEqual(fixture.files);
  });
});
