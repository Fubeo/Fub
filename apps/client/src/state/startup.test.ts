import { describe, expect, it } from "vitest";
import { startupCommand } from "./startup";

describe("ciò che si apre all'avvio", () => {
  it("la giornaliera e la nota nuova sono comandi, la sessione e l'ignoto niente", () => {
    expect(startupCommand("daily")).toBe("note.daily");
    expect(startupCommand("new")).toBe("shell.note.new");
    expect(startupCommand("")).toBeNull();
    expect(startupCommand(undefined)).toBeNull();
    expect(startupCommand("toString")).toBeNull();
    expect(startupCommand(true)).toBeNull();
  });
});
