// «Nuova nota» coi tipi (T33, E5): la domanda c'è solo se il vault ha dei
// tipi; Invio (la nota semplice) crea come prima, un tipo crea dal tipo, Esc
// non crea niente; un errore non apre niente e lo dice.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteType, NoteTypeList } from "./note-types";

const calls = vi.hoisted(() => ({
  list: null as (() => Promise<NoteTypeList>) | null,
  created: [] as [string, string | undefined][],
  opened: [] as string[],
  notices: [] as [string, string][],
  focused: 0,
  refreshed: 0,
  fail: null as Error | null,
}));

vi.mock("./note-types", () => ({
  NO_TYPES: { folder: null, types: [] },
  listNoteTypes: () => calls.list!(),
  createFromType: (type: NoteType, folder?: string) => {
    if (calls.fail) return Promise.reject(calls.fail);
    calls.created.push([`type:${type.link}`, folder]);
    return Promise.resolve(`${type.folder ?? folder ?? ""}/Senza titolo.md`);
  },
}));
vi.mock("./vault", () => ({
  createNote: (_name: string | undefined, folder?: string) => {
    if (calls.fail) return Promise.reject(calls.fail);
    calls.created.push(["plain", folder]);
    return Promise.resolve("Senza titolo.md");
  },
  folderOfOpenNote: () => Promise.resolve(null),
  refreshDocuments: () => { calls.refreshed += 1; },
}));
vi.mock("./document-controller", () => ({
  openDocument: (doc: string) => { calls.opened.push(doc); return Promise.resolve(); },
  focusEditor: () => { calls.focused += 1; },
}));
vi.mock("../ui/notify", () => ({
  notify: (message: string, tone: string) => { calls.notices.push([message, tone]); },
}));
vi.mock("../ui/note-type-menu", () => ({
  chooseNoteType: () => Promise.reject(new Error("il menu vero non si apre nei test")),
}));

const { newNoteInActiveSpace } = await import("./new-note");
const { state } = await import("./store");

const LIBRO: NoteType = {
  doc: "Tipi/Libro.md", link: "Tipi/Libro", name: "Libro", icon: "book", featured: ["autore"],
  properties: [{ key: "autore", kind: "text" }], folder: "Biblioteca", notes: 3, readable: true, revision: null,
};
const anchor = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };

beforeEach(() => {
  calls.list = () => Promise.resolve({ folder: "Tipi", types: [LIBRO] });
  calls.created = [];
  calls.opened = [];
  calls.notices = [];
  calls.focused = 0;
  calls.refreshed = 0;
  calls.fail = null;
  state.activeSpace = null;
});

describe("newNoteInActiveSpace", () => {
  it("senza tipi non chiede niente e crea la nota semplice nello spazio attivo", async () => {
    calls.list = () => Promise.resolve({ folder: "Tipi", types: [] });
    state.activeSpace = "Progetti";
    const choose = vi.fn();
    await newNoteInActiveSpace({ choose, anchor });
    expect(choose).not.toHaveBeenCalled();
    expect(calls.created).toEqual([["plain", "Progetti"]]);
    expect(calls.opened).toEqual(["Senza titolo.md"]);
    expect(calls.focused).toBe(1);
  });

  it("se i tipi non si leggono crea lo stesso la nota semplice", async () => {
    calls.list = () => Promise.reject(new Error("guasto"));
    const choose = vi.fn();
    await newNoteInActiveSpace({ choose, anchor });
    expect(choose).not.toHaveBeenCalled();
    expect(calls.created).toEqual([["plain", undefined]]);
    expect(calls.notices).toEqual([]);
  });

  it("coi tipi chiede; la nota semplice (Invio) crea come prima", async () => {
    const choose = vi.fn(() => Promise.resolve(null));
    await newNoteInActiveSpace({ choose, anchor, folder: "Archivio" });
    expect(choose).toHaveBeenCalledWith({ folder: "Tipi", types: [LIBRO] }, anchor);
    expect(calls.created).toEqual([["plain", "Archivio"]]);
    expect(calls.opened).toEqual(["Senza titolo.md"]);
  });

  it("un tipo scelto crea dal tipo, apre la nota e rilegge l'elenco", async () => {
    const before = vi.fn();
    await newNoteInActiveSpace({ choose: () => Promise.resolve(LIBRO), anchor, beforeOpen: before });
    expect(calls.created).toEqual([["type:Tipi/Libro", undefined]]);
    expect(before).toHaveBeenCalledWith("Biblioteca/Senza titolo.md");
    expect(calls.opened).toEqual(["Biblioteca/Senza titolo.md"]);
    expect(calls.refreshed).toBe(1);
  });

  it("Esc (il menu chiuso senza scelta) non crea niente e non sposta il fuoco", async () => {
    await newNoteInActiveSpace({ choose: () => Promise.resolve(undefined), anchor });
    expect(calls.created).toEqual([]);
    expect(calls.opened).toEqual([]);
    expect(calls.focused).toBe(0);
  });

  it("una nota che non nasce non apre niente e lo dice", async () => {
    calls.fail = new Error("la cartella è di sola lettura");
    await newNoteInActiveSpace({ choose: () => Promise.resolve(LIBRO), anchor });
    expect(calls.opened).toEqual([]);
    expect(calls.notices).toHaveLength(1);
    expect(calls.notices[0]![0]).toContain("la cartella è di sola lettura");
    expect(calls.notices[0]![1]).toBe("guasto");
  });
});
