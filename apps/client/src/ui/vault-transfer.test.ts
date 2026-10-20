// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fileUrl, importDropped, offerOutside, pickedFiles, readDropped, systemPath, type ImportPorts } from "./vault-transfer";

function ports(existing: Record<string, string[]> = {}) {
  const written: string[] = [];
  const folders: string[] = [];
  const disk = new Set(Object.entries(existing).flatMap(([dir, names]) => names.map((n) => (dir ? `${dir}/${n}` : n))));
  const api: ImportPorts = {
    taken: async (folder) => new Set(existing[folder] ?? []),
    write: async (id) => {
      if (disk.has(id)) throw { kind: "already_exists", message: id };
      disk.add(id);
      written.push(id);
      return { id };
    },
    createFolder: async (path) => folders.push(path),
  };
  return { api, written, folders };
}

const file = (name: string, size = 1) => new File([new Uint8Array(size)], name);
const describeError = (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string }).message));

describe("importare da fuori", () => {
  it("una cartella entra intera, e col nome preso diventa «Viaggio 1»", async () => {
    const { api, written, folders } = ports({ Foto: ["Viaggio", "mare.png"] });
    const outcome = await importDropped(
      { files: [{ path: "Viaggio/a.png", file: file("a.png") }, { path: "mare.png", file: file("mare.png") }], folders: ["Viaggio", "Viaggio/vuota"] },
      "Foto",
      api,
      describeError,
    );
    expect(written).toEqual(["Foto/Viaggio 1/a.png", "Foto/mare 1.png"]);
    expect(folders).toEqual(["Foto/Viaggio 1/vuota"]);
    expect(outcome.skipped).toEqual([]);
  });

  it("il nome preso si confronta senza maiuscole, e una corsa col disco riprova", async () => {
    const { api, written } = ports({ "": ["NOTA.md"] });
    await importDropped({ files: [{ path: "nota.md", file: file("nota.md") }], folders: [] }, "", api, describeError);
    expect(written).toEqual(["nota 1.md"]);
    const raced = ports({ "": [] });
    await raced.api.write("x.md", new Uint8Array());
    await importDropped({ files: [{ path: "x.md", file: file("x.md") }], folders: [] }, "", raced.api, describeError);
    expect(raced.written).toEqual(["x.md", "x 1.md"]);
  });

  it("ciò che non entra si dice, uno per uno, e il resto entra", async () => {
    const { api, written } = ports();
    const big = file("grande.bin");
    Object.defineProperty(big, "size", { value: 65 * 1024 * 1024 });
    const outcome = await importDropped({ files: [{ path: "grande.bin", file: big }, { path: "ok.txt", file: file("ok.txt") }], folders: [] }, "", api, describeError);
    expect(written).toEqual(["ok.txt"]);
    expect(outcome.skipped.map((s) => s.name)).toEqual(["grande.bin"]);
  });

  it("il selettore con webkitdirectory porta le cartelle dal path relativo", () => {
    const one = file("a.md");
    Object.defineProperty(one, "webkitRelativePath", { value: "Libro/Parte/a.md" });
    expect(pickedFiles([one])).toEqual({ files: [{ path: "Libro/Parte/a.md", file: one }], folders: ["Libro", "Libro/Parte"] });
  });

  it("senza voci di cartella il rilascio legge i file", async () => {
    const one = file("a.md");
    const data = { items: [], files: [one] } as unknown as DataTransfer;
    expect(await readDropped(data)).toEqual({ files: [{ path: "a.md", file: one }], folders: [] });
  });
});

describe("offrire fuori", () => {
  it("file:// e path del sistema, anche da una radice Windows", () => {
    expect(fileUrl("/home/io/Vault", "Libro/una nota.md")).toBe("file:///home/io/Vault/Libro/una%20nota.md");
    expect(fileUrl("C:\\Utenti\\io\\Vault", "a#b.md")).toBe("file:///C:/Utenti/io/Vault/a%23b.md");
    expect(systemPath("C:\\Utenti\\io\\Vault", "Libro/a.md")).toBe("C:\\Utenti\\io\\Vault\\Libro\\a.md");
    expect(systemPath("/home/io/Vault/", "a.md")).toBe("/home/io/Vault/a.md");
  });

  it("più voci: niente DownloadURL, che ne porta una sola", () => {
    const set = new Map<string, string>();
    const data = { setData: (k: string, v: string) => set.set(k, v) } as unknown as DataTransfer;
    offerOutside(data, "/v", ["a.md", "b.png"]);
    expect(set.get("text/uri-list")).toBe("file:///v/a.md\r\nfile:///v/b.png");
    expect(set.has("DownloadURL")).toBe(false);
    const none = new Map<string, string>();
    offerOutside({ setData: (k: string, v: string) => none.set(k, v) } as unknown as DataTransfer, undefined, ["a.md"]);
    expect(none.size).toBe(0);
  });
});
