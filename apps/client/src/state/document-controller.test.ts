// @vitest-environment happy-dom
// Il nome libero di una nota che nasce dalla lavagna (N6 T70, T99):
// `canvasFreeName` elenca la cartella (`vaultEntries`) e propone il nome, o il
// primo «nome N» che nessun documento usa, senza guardare l'estensione né le
// maiuscole. Il nome che arriva è già pulito dalla tela (`proposedNoteName`,
// `searchedName`): qui si prova anche che un nome fatto da un testo coi
// caratteri che il file system non vuole arriva e resta pulito.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchedName } from "../rules/searched-name";

const listed = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../host/query", async (original) => {
  const real = await original<typeof import("../host/query")>();
  return {
    ...real,
    vaultEntries: vi.fn(async () => ({
      items: listed.ids.map((id) => ({ id })),
      total: listed.ids.length,
    })),
  };
});

// Il controller cerca i suoi elementi in `index.html` quando si carica.
const rawHtml = (await import("../../index.html?raw")).default;
document.body.innerHTML = (/<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml)?.[1] ?? "").replace(/<script[\s\S]*?<\/script>/g, "");
const { canvasFreeName } = await import("./document-controller");
const { vaultEntries, WITHOUT_PAGE } = await import("../host/query");

describe("canvasFreeName", () => {
  beforeEach(() => {
    listed.ids = [];
    vi.mocked(vaultEntries).mockClear();
  });

  it("un nome libero resta com'è; chiede i soli documenti della cartella, senza le sottocartelle", async () => {
    listed.ids = ["Lavagne/Altro.md", "Lavagne/gita.canvas"];
    await expect(canvasFreeName("Lavagne", "Idee per la gita")).resolves.toBe("Idee per la gita");
    expect(vaultEntries).toHaveBeenCalledWith(WITHOUT_PAGE, "document", { path: "Lavagne", descendants: false });
  });

  it("un nome preso diventa il primo «nome N» libero, senza badare a estensione e maiuscole", async () => {
    listed.ids = ["Lavagne/idee.md", "Lavagne/Idee 1.txt", "Lavagne/IDEE 2.canvas", "Lavagne/Idee 4.md"];
    await expect(canvasFreeName("Lavagne", "Idee")).resolves.toBe("Idee 3");
    // Alla radice del vault la cartella è "".
    listed.ids = ["Gita.md"];
    await expect(canvasFreeName("", "Gita")).resolves.toBe("Gita 1");
    expect(vaultEntries).toHaveBeenLastCalledWith(WITHOUT_PAGE, "document", { path: "", descendants: false });
  });

  it("un file senza estensione, o che comincia col punto, conta col suo nome intero", async () => {
    listed.ids = ["Note/Gita", "Note/.gita"];
    await expect(canvasFreeName("Note", "Gita")).resolves.toBe("Gita 1");
    await expect(canvasFreeName("Note", ".gita")).resolves.toBe(".gita 1");
  });

  it("i caratteri che il file system non vuole: il nome arriva pulito, e un file d'altri con quei caratteri non lo occupa", async () => {
    const proposed = searchedName("Gita: a/b?");
    expect(proposed).toBe("Gita a b");
    // Un file scritto da un altro programma col nome sporco non è lo stesso nome.
    listed.ids = ["Note/Gita: a b.md"];
    await expect(canvasFreeName("Note", proposed!)).resolves.toBe("Gita a b");
    listed.ids = ["Note/Gita: a b.md", "Note/Gita a b.md"];
    const free = await canvasFreeName("Note", proposed!);
    expect(free).toBe("Gita a b 1");
    // Il nome proposto è ancora un nome di file valido.
    expect(searchedName(free)).toBe(free);
  });
});
