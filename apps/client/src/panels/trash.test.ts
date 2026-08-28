// Cestinare una nota è un gesto della shell, e le tre cose che fa **di qua dal
// confine** — disinnescare un salvataggio, chiudere il documento giusto, mettere
// qualcosa al posto di ciò che non c'è più — non le prova nessun altro presidio:
// il comando che scrive è del registro, e `trashNote` di là è già misurato.
//
// Quel che si prova qui è la sola riga che con due riquadri sbagliava bersaglio:
// `isOpen(id)` domanda «è aperta in *qualche* riquadro», e la risposta serviva a
// chiudere il documento **attivo**. Cestinare dall'esploratore una nota aperta
// nell'altro riquadro chiudeva quella su cui si stava scrivendo, col buffer
// sporco dentro, e lasciava a schermo la nota appena cestinata.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  confirm: true,
  open: true,
  active: null as string | null,
  first: "prima.md" as string | null,
}));

vi.mock("../host/dialog", () => ({ confirm: vi.fn(async () => fake.confirm) }));

vi.mock("../state/vault", () => ({
  trashNote: vi.fn(async () => {}),
  refreshDocuments: vi.fn(),
  beforeNote: vi.fn(async () => fake.first),
}));

vi.mock("../state/layout", () => ({ activeDoc: vi.fn(() => fake.active) }));

vi.mock("./document", () => ({
  isOpen: vi.fn(() => fake.open),
  closeDocument: vi.fn(),
  openDocument: vi.fn(async () => {}),
}));

vi.mock("../state/document-session", () => ({
  documentSessions: {
    isDeletionPending: vi.fn(() => false),
    beginDeletion: vi.fn(() => true),
    cancelDeletion: vi.fn(),
    delete: vi.fn(async (_id: string, run: (id: string) => Promise<void>) => {
      await run(_id);
      return { kind: "deleted", dirty: true };
    }),
  },
}));

import { trashWithConfirm } from "./trash";
import { closeDocument, openDocument } from "./document";
import { documentSessions } from "../state/document-session";

describe("cestinare una nota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(false);
    fake.confirm = true;
    fake.open = true;
    fake.active = null;
    fake.first = "prima.md";
  });

  it("chiude la nota cestinata, non quella a schermo", async () => {
    fake.active = "altra.md";
    await trashWithConfirm("vittima.md");
    expect(closeDocument).toHaveBeenCalledWith("vittima.md");
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("apre una nota di rimpiazzo solo se non è rimasto niente", async () => {
    fake.active = null;
    await trashWithConfirm("vittima.md");
    expect(closeDocument).toHaveBeenCalledWith("vittima.md");
    expect(openDocument).toHaveBeenCalledWith("prima.md");
  });

  it("non tocca niente se l'utente ci ripensa, e il salvataggio torna in coda", async () => {
    fake.confirm = false;
    await trashWithConfirm("vittima.md");
    expect(documentSessions.cancelDeletion).toHaveBeenCalledWith("vittima.md");
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(closeDocument).not.toHaveBeenCalled();
  });

  // La sessione possiede la bozza e la scarta insieme al documento, così il
  // pannello non può dimenticare il gemello su disco di un buffer sporco.
  it("delega alla sessione la cancellazione della bozza", async () => {
    await trashWithConfirm("vittima.md");
    expect(documentSessions.delete).toHaveBeenCalledWith("vittima.md", expect.any(Function));
  });

  it("non cerca un rimpiazzo per una nota che non era aperta", async () => {
    fake.open = false;
    await trashWithConfirm("vittima.md");
    expect(closeDocument).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
  });
  it("ignora un secondo gesto mentre la conferma è pendente", async () => {
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(true);

    await trashWithConfirm("vittima.md");

    expect(documentSessions.beginDeletion).not.toHaveBeenCalled();
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(closeDocument).not.toHaveBeenCalled();
  });
});
