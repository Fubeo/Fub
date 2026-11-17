// Ciò che la barra laterale ricorda per vault (#237 R07).
import { describe, expect, it } from "vitest";
import { PER_VAULT_LIMIT, PerVault } from "./per-vault";

describe("la memoria per vault", () => {
  it("un vault mai visto parte pulito, anche dopo due cambi di fila", () => {
    const memory = new PerVault("files");
    expect(memory.enter("/a", "files")).toBe("files");
    expect(memory.enter("/b", "search")).toBe("files");
    expect(memory.enter("/c", "trash")).toBe("files");
  });

  it("tornando in un vault, o riaprendolo, si ritrova il suo", () => {
    const memory = new PerVault("");
    memory.enter("/a", "");
    expect(memory.enter("/b", "fattura 2024")).toBe("");
    expect(memory.enter("/a", "verbale")).toBe("fattura 2024");
    expect(memory.enter("/a", "fattura 2025")).toBe("fattura 2025");
    expect(memory.enter("/b", "fattura 2025")).toBe("verbale");
  });

  it("la finestra senza vault non ricorda niente e parte pulita", () => {
    const memory = new PerVault("files");
    memory.enter("/a", "files");
    expect(memory.enter("", "search")).toBe("files");
    expect(memory.enter("/b", "trash")).toBe("files");
    expect(memory.enter("/a", "files")).toBe("search");
  });

  it("tiene al più gli ultimi vault visitati", () => {
    const memory = new PerVault("");
    memory.enter("/v0", "");
    for (let i = 1; i <= PER_VAULT_LIMIT + 1; i += 1) memory.enter(`/v${i}`, `query ${i - 1}`);
    expect(memory.enter("/v0", "x")).toBe("");
    expect(memory.enter("/v2", "")).toBe("query 2");
  });
});
