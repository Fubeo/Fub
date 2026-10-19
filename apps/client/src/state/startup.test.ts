import { describe, expect, it } from "vitest";
import { startupCommand, startupNote } from "./startup";

describe("ciò che si apre all'avvio", () => {
  it("la giornaliera e la nota nuova sono comandi, la sessione e l'ignoto niente", () => {
    expect(startupCommand("daily")).toBe("note.daily");
    expect(startupCommand("new")).toBe("shell.note.new");
    expect(startupCommand("")).toBeNull();
    expect(startupCommand(undefined)).toBeNull();
    expect(startupCommand("toString")).toBeNull();
    expect(startupCommand(true)).toBeNull();
    expect(startupCommand("note"), "la nota precisa non è un comando").toBeNull();
  });

  it("la nota precisa è il percorso scritto, con .md se manca l'estensione", () => {
    expect(startupNote("note", "Diario/Inizio.md")).toBe("Diario/Inizio.md");
    expect(startupNote("note", " /Diario/Inizio/ ")).toBe("Diario/Inizio.md");
    expect(startupNote("note", "Tavola.base")).toBe("Tavola.base");
    expect(startupNote("note", "v1.2/Note")).toBe("v1.2/Note.md");
    expect(startupNote("note", "")).toBeNull();
    expect(startupNote("note", 3)).toBeNull();
    expect(startupNote("daily", "Inizio.md")).toBeNull();
  });
});
