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
  system: false,
}));

vi.mock("../host/dialog", () => ({ confirm: vi.fn(async () => fake.confirm) }));

vi.mock("../state/vault", () => ({
  trashNote: vi.fn(async () => ({ label: "Ripristina", steps: [] })),
  refreshDocuments: vi.fn(),
  trashesToSystem: vi.fn(async () => fake.system),
  undoLastOperation: vi.fn(async () => {}),
}));

vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

vi.mock("./document", () => ({
  isOpen: vi.fn(() => fake.open),
  closeDocument: vi.fn(),
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
import { closeDocument } from "./document";
import { documentSessions } from "../state/document-session";
import { confirm } from "../host/dialog";
import { notify } from "../ui/notify";
import { undoLastOperation } from "../state/vault";

describe("cestinare una nota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(false);
    fake.confirm = true;
    fake.open = true;
    fake.system = false;
  });

  it("chiude la nota cestinata, e non mette al suo posto una nota qualunque", async () => {
    await trashWithConfirm("vittima.md");
    expect(closeDocument).toHaveBeenCalledWith("vittima.md");
  });

  it("nel cestino del vault non chiede conferma e offre Annulla", async () => {
    await trashWithConfirm("vittima.md");
    expect(confirm).not.toHaveBeenCalled();
    const action = vi.mocked(notify).mock.calls[0]?.[2];
    expect(action?.label).toBe("Annulla");
    await action?.run();
    expect(undoLastOperation).toHaveBeenCalledOnce();
  });

  it("col cestino di sistema chiede; se l'utente ci ripensa non tocca niente", async () => {
    fake.system = true;
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

  it("non chiude niente per una nota che non era aperta", async () => {
    fake.open = false;
    await trashWithConfirm("vittima.md");
    expect(closeDocument).not.toHaveBeenCalled();
  });
  it("ignora un secondo gesto mentre la conferma è pendente", async () => {
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(true);

    await trashWithConfirm("vittima.md");

    expect(documentSessions.beginDeletion).not.toHaveBeenCalled();
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(closeDocument).not.toHaveBeenCalled();
  });
});
