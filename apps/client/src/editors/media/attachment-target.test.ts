// Il deposito degli allegati: `depositAttachment` com'è oggi (note e
// registratore) e `depositOrReuse` della lavagna, che riusa lo stesso file
// invece di farne un doppione (D-3).
import { describe, expect, it } from "vitest";
import { depositAttachment, depositOrReuse, type AttachmentDeposit, type SameFile } from "./attachment-target";

const MIB = 1024 * 1024;

/// Un vault finto create-only: `write` rifiuta con `already_exists` un path preso.
function fakeVault(initial: Record<string, Uint8Array> = {}, folder = "attachments", fromDocument = "lavagne/studio.canvas") {
  const files = new Map(Object.entries(initial));
  const attempts: string[] = [];
  let revision = 0;
  const deposit: AttachmentDeposit = {
    folder,
    fromDocument,
    async write(id, bytes) {
      attempts.push(id);
      if (files.has(id)) throw { kind: "already_exists", message: `«${id}» c'è già` };
      files.set(id, bytes);
      revision += 1;
      return { id, revision: `r${revision}` };
    },
  };
  /// `same` che legge davvero il file del vault finto e confronta i byte.
  const same = async (id: string, bytes: Uint8Array): Promise<SameFile> => {
    const there = files.get(id);
    return there !== undefined && there.length === bytes.length && there.every((b, i) => b === bytes[i]);
  };
  return { files, attempts, deposit, same };
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe("depositAttachment (il comportamento di oggi)", () => {
  it("dopo un already_exists prova il candidato dopo, anche con byte uguali", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(1, 2) });
    const result = await depositAttachment(vault.deposit, "foto.png", bytes(1, 2));
    expect(vault.attempts).toEqual(["attachments/foto.png", "attachments/foto 1.png"]);
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "r1" }, link: "../attachments/foto%201.png" });
  });

  it("un errore che non è already_exists risale senza altri tentativi", async () => {
    const attempts: string[] = [];
    const failure = { kind: "invalid_path", message: "nome rifiutato" };
    await expect(depositAttachment({
      folder: "attachments",
      fromDocument: "a.md",
      async write(id) { attempts.push(id); throw failure; },
    }, "foto?.png", bytes(1))).rejects.toBe(failure);
    expect(attempts).toEqual(["attachments/foto?.png"]);
  });

  it("un nome vuoto è rifiutato prima di scrivere", async () => {
    const vault = fakeVault();
    await expect(depositAttachment(vault.deposit, "   ", bytes(1))).rejects.toThrow();
    await expect(depositAttachment(vault.deposit, "C:\\foto\\", bytes(1))).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
  });

  it("oltre 64 MiB rifiuta senza scrivere; 64 MiB esatti passano", async () => {
    const vault = fakeVault();
    await expect(depositAttachment(vault.deposit, "grande.bin", new Uint8Array(64 * MIB + 1))).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
    const result = await depositAttachment(vault.deposit, "grande.bin", new Uint8Array(64 * MIB));
    expect(result.receipt.id).toBe("attachments/grande.bin");
  });

  it("finiti i candidati, errors.attachment.no_name", async () => {
    let attempts = 0;
    await expect(depositAttachment({
      folder: "attachments",
      fromDocument: "a.md",
      async write() { attempts += 1; throw { kind: "already_exists" }; },
    }, "foto.png", bytes(1))).rejects.toThrow(/foto\.png/);
    expect(attempts).toBe(10_001);
  });
});

describe("depositOrReuse (la lavagna)", () => {
  it("un file nuovo si scrive come in depositAttachment", async () => {
    const vault = fakeVault();
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), vault.same);
    expect(result).toEqual({ receipt: { id: "attachments/foto.png", revision: "r1" }, reused: false });
    expect(vault.files.get("attachments/foto.png")).toEqual(bytes(1, 2));
  });

  it("lo stesso file trascinato due volte non si duplica", async () => {
    const vault = fakeVault();
    const first = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), vault.same);
    const second = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), vault.same);
    expect(second).toEqual({ receipt: { id: first.receipt.id, revision: null }, reused: true });
    expect([...vault.files.keys()]).toEqual(["attachments/foto.png"]);
  });

  it("stesso nome e byte diversi: nasce «nome 1.ext»", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), vault.same);
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "r1" }, reused: false });
  });

  it("«nome.ext» diverso e «nome 1.ext» uguale: si riusa «nome 1.ext»", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9), "attachments/foto 1.png": bytes(1, 2) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), vault.same);
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: null }, reused: true });
    expect(vault.attempts).toEqual(["attachments/foto.png", "attachments/foto 1.png"]);
  });

  it("la revisione del riuso è quella del descrittore che same porta", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(1) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1), async () => ({ revision: "rev-7" }));
    expect(result).toEqual({ receipt: { id: "attachments/foto.png", revision: "rev-7" }, reused: true });
    const withoutRevision = await depositOrReuse(vault.deposit, "foto.png", bytes(1), async () => ({ revision: null }));
    expect(withoutRevision.receipt.revision).toBeNull();
  });

  it("same chiamato solo dopo already_exists, col path e i byte del candidato", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9) });
    const asked: Array<[string, Uint8Array]> = [];
    const payload = bytes(1, 2);
    await depositOrReuse(vault.deposit, "foto.png", payload, async (id, b) => { asked.push([id, b]); return false; });
    expect(asked).toEqual([["attachments/foto.png", payload]]);
    expect(asked[0]?.[1]).toBe(payload);
  });

  it("un same che lancia vale come diverso: si passa al candidato dopo", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(1) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1), async () => { throw new Error("lettura fallita"); });
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "r1" }, reused: false });
  });

  it("same lento e un altro che scrive nel frattempo il candidato dopo", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let asked = 0;
    const pending = depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), async (id, b) => {
      asked += 1;
      if (asked === 1) await gate;
      return vault.same(id, b);
    });
    // Mentre `same` aspetta, un altro deposita «foto 1.png» con altri byte.
    await new Promise((resolve) => setTimeout(resolve, 0));
    vault.files.set("attachments/foto 1.png", bytes(5));
    release();
    const result = await pending;
    expect(result).toEqual({ receipt: { id: "attachments/foto 2.png", revision: "r1" }, reused: false });
    expect(vault.files.get("attachments/foto 1.png")).toEqual(bytes(5));
  });

  it("un altro che scrive gli stessi byte nel frattempo: si riusa il suo", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let asked = 0;
    const pending = depositOrReuse(vault.deposit, "foto.png", bytes(1, 2), async (id, b) => {
      asked += 1;
      if (asked === 1) await gate;
      return vault.same(id, b);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vault.files.set("attachments/foto 1.png", bytes(1, 2));
    release();
    expect(await pending).toEqual({ receipt: { id: "attachments/foto 1.png", revision: null }, reused: true });
  });

  it("byte vuoti: si scrivono, e un file vuoto uguale si riusa", async () => {
    const vault = fakeVault();
    expect((await depositOrReuse(vault.deposit, "vuoto.txt", bytes(), vault.same)).reused).toBe(false);
    expect(await depositOrReuse(vault.deposit, "vuoto.txt", bytes(), vault.same))
      .toEqual({ receipt: { id: "attachments/vuoto.txt", revision: null }, reused: true });
    const other = await depositOrReuse(vault.deposit, "vuoto.txt", bytes(3), vault.same);
    expect(other.receipt.id).toBe("attachments/vuoto 1.txt");
  });

  it("un nome che il vault rifiuta: l'errore dell'host risale, same non è chiesto", async () => {
    const failure = { kind: "invalid_path", message: "nome rifiutato" };
    let asked = 0;
    await expect(depositOrReuse({
      folder: "attachments",
      fromDocument: "a.canvas",
      async write() { throw failure; },
    }, "con:.png", bytes(1), async () => { asked += 1; return true; })).rejects.toBe(failure);
    expect(asked).toBe(0);
  });

  it("gli stessi limiti di depositAttachment: nome vuoto, 64 MiB, candidati finiti", async () => {
    const vault = fakeVault();
    await expect(depositOrReuse(vault.deposit, " ", bytes(1), vault.same)).rejects.toThrow();
    await expect(depositOrReuse(vault.deposit, "grande.bin", new Uint8Array(64 * MIB + 1), vault.same)).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
    let asked = 0;
    await expect(depositOrReuse({
      folder: "attachments",
      fromDocument: "a.canvas",
      async write() { throw { kind: "already_exists" }; },
    }, "foto.png", bytes(1), async () => { asked += 1; return false; })).rejects.toThrow(/foto\.png/);
    expect(asked).toBe(10_001);
  });

  it("prova i candidati nello stesso ordine di depositAttachment, per ogni cartella", async () => {
    const cases: Array<[string, string]> = [
      ["attachments", "lavagne/studio.canvas"],
      ["./", "lavagne/studio.canvas"],
      ["./img", "lavagne/studio.canvas"],
      ["./", "studio.canvas"],
      ["./img", "studio.canvas"],
      ["media/allegati/", "studio.canvas"],
    ];
    for (const [folder, fromDocument] of cases) {
      const taken = (attempts: string[]): AttachmentDeposit => ({
        folder,
        fromDocument,
        async write(id) {
          attempts.push(id);
          if (attempts.length < 4) throw { kind: "already_exists" };
          return { id, revision: "r" };
        },
      });
      const viaNotes: string[] = [];
      const viaCanvas: string[] = [];
      await depositAttachment(taken(viaNotes), "C:\\foto\\😊 x.png", bytes(1));
      await depositOrReuse(taken(viaCanvas), "C:\\foto\\😊 x.png", bytes(1), async () => false);
      expect(viaCanvas).toEqual(viaNotes);
    }
  });

  it("una cartella non valida è rifiutata prima di scrivere, come in depositAttachment", async () => {
    const vault = fakeVault({}, "../fuori");
    await expect(depositAttachment(vault.deposit, "foto.png", bytes(1))).rejects.toThrow();
    await expect(depositOrReuse(vault.deposit, "foto.png", bytes(1), vault.same)).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
  });
});
