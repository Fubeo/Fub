// Il deposito degli allegati: `depositAttachment` com'è oggi (note e
// registratore) e `depositOrReuse` della lavagna, che chiede all'host di
// riusare il file che il vault ha già con gli stessi byte (D-3, T32). Il vault
// finto risponde a `reuse` come l'host: cerca i byte in tutto il vault.
import { describe, expect, it } from "vitest";
import { depositAttachment, depositOrReuse, type AttachmentDeposit } from "./attachment-target";

const MIB = 1024 * 1024;

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/// Un vault finto create-only. Con `reuse` risponde come l'host: il primo file
/// per percorso con gli stessi byte, in tutto il vault, senza scrivere. Senza
/// `reuse` rifiuta con `already_exists` un path preso.
function fakeVault(initial: Record<string, Uint8Array> = {}, folder = "attachments", fromDocument = "lavagne/studio.canvas") {
  const files = new Map(Object.entries(initial));
  const revisions = new Map(Object.keys(initial).map((id) => [id, `iniziale:${id}`]));
  const attempts: string[] = [];
  const reuses: boolean[] = [];
  let revision = 0;
  const deposit: AttachmentDeposit = {
    folder,
    fromDocument,
    async write(id, bytes, options) {
      attempts.push(id);
      reuses.push(options?.reuse === "same-content");
      if (options?.reuse === "same-content") {
        const twin = [...files.keys()].sort().find((there) => sameBytes(files.get(there)!, bytes));
        if (twin !== undefined) return { id: twin, revision: revisions.get(twin)!, reused: true };
      }
      if (files.has(id)) throw { kind: "already_exists", message: `«${id}» c'è già` };
      files.set(id, bytes);
      revision += 1;
      revisions.set(id, `r${revision}`);
      return { id, revision: `r${revision}` };
    },
  };
  return { files, attempts, reuses, deposit };
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe("depositAttachment (il comportamento di oggi)", () => {
  it("dopo un already_exists prova il candidato dopo, anche con byte uguali", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(1, 2) });
    const result = await depositAttachment(vault.deposit, "foto.png", bytes(1, 2));
    expect(vault.attempts).toEqual(["attachments/foto.png", "attachments/foto 1.png"]);
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "r1" }, link: "../attachments/foto%201.png" });
  });

  it("le note non chiedono il riuso: nessuna scrittura con `reuse`", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(1, 2) });
    await depositAttachment(vault.deposit, "foto.png", bytes(1, 2));
    expect(vault.reuses).toEqual([false, false]);
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
  it("un file nuovo si chiede all'host con `reuse` e si scrive al candidato", async () => {
    const vault = fakeVault();
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2));
    expect(result).toEqual({ receipt: { id: "attachments/foto.png", revision: "r1" }, reused: false });
    expect(vault.files.get("attachments/foto.png")).toEqual(bytes(1, 2));
    expect(vault.reuses).toEqual([true]);
  });

  it("lo stesso file trascinato due volte non si duplica: l'host risponde col primo", async () => {
    const vault = fakeVault();
    const first = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2));
    const second = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2));
    expect(second).toEqual({ receipt: first.receipt, reused: true });
    expect([...vault.files.keys()]).toEqual(["attachments/foto.png"]);
  });

  it("lo stesso file con un altro nome nel vault: si riusa quello, con la sua revisione", async () => {
    const vault = fakeVault({ "Foto/lavagna.jpg": bytes(1, 2) });
    const result = await depositOrReuse(vault.deposit, "IMG_2042.jpg", bytes(1, 2));
    expect(result).toEqual({ receipt: { id: "Foto/lavagna.jpg", revision: "iniziale:Foto/lavagna.jpg" }, reused: true });
    expect(vault.attempts).toEqual(["attachments/IMG_2042.jpg"]);
    expect(vault.files.size).toBe(1);
  });

  it("stesso nome e byte diversi: nasce «nome 1.ext»", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2));
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "r1" }, reused: false });
    expect(vault.attempts).toEqual(["attachments/foto.png", "attachments/foto 1.png"]);
    expect(vault.reuses).toEqual([true, true]);
  });

  it("«nome.ext» diverso e «nome 1.ext» uguale: l'host trova «nome 1.ext» al primo tentativo", async () => {
    const vault = fakeVault({ "attachments/foto.png": bytes(9), "attachments/foto 1.png": bytes(1, 2) });
    const result = await depositOrReuse(vault.deposit, "foto.png", bytes(1, 2));
    expect(result).toEqual({ receipt: { id: "attachments/foto 1.png", revision: "iniziale:attachments/foto 1.png" }, reused: true });
    expect(vault.attempts).toEqual(["attachments/foto.png"]);
  });

  it("una ricevuta senza `reused` (un host che non riusa) è una scrittura nuova", async () => {
    const deposit: AttachmentDeposit = {
      folder: "attachments",
      fromDocument: "a.canvas",
      async write(id) { return { id, revision: "r" }; },
    };
    expect(await depositOrReuse(deposit, "foto.png", bytes(1))).toEqual({ receipt: { id: "attachments/foto.png", revision: "r" }, reused: false });
  });

  it("un errore dell'host che non è already_exists risale, senza altri candidati", async () => {
    const failure = { kind: "invalid_path", message: "nome rifiutato" };
    const attempts: string[] = [];
    await expect(depositOrReuse({
      folder: "attachments",
      fromDocument: "a.canvas",
      async write(id) { attempts.push(id); throw failure; },
    }, "con:.png", bytes(1))).rejects.toBe(failure);
    expect(attempts).toEqual(["attachments/con:.png"]);
  });

  it("gli stessi limiti di depositAttachment: nome vuoto e oltre 64 MiB sono rifiutati prima di chiedere", async () => {
    const vault = fakeVault();
    await expect(depositOrReuse(vault.deposit, " ", bytes(1))).rejects.toThrow();
    await expect(depositOrReuse(vault.deposit, "grande.bin", new Uint8Array(64 * MIB + 1))).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
  });

  it("finiti i candidati, errors.attachment.no_name", async () => {
    let attempts = 0;
    await expect(depositOrReuse({
      folder: "attachments",
      fromDocument: "a.canvas",
      async write() { attempts += 1; throw { kind: "already_exists" }; },
    }, "foto.png", bytes(1))).rejects.toThrow(/foto\.png/);
    expect(attempts).toBe(10_001);
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
      await depositOrReuse(taken(viaCanvas), "C:\\foto\\😊 x.png", bytes(1));
      expect(viaCanvas).toEqual(viaNotes);
    }
  });

  it("una cartella non valida è rifiutata prima di scrivere, come in depositAttachment", async () => {
    const vault = fakeVault({}, "../fuori");
    await expect(depositAttachment(vault.deposit, "foto.png", bytes(1))).rejects.toThrow();
    await expect(depositOrReuse(vault.deposit, "foto.png", bytes(1))).rejects.toThrow();
    expect(vault.attempts).toEqual([]);
  });
});
