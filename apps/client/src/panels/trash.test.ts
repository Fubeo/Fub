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

vi.mock("../state/document-controller", () => ({
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

import { trashManyWithConfirm, trashWithConfirm } from "./trash";
import { closeDocument } from "../state/document-controller";
import { documentSessions } from "../state/document-session";
import { confirm } from "../host/dialog";
import { declareConfirm } from "../platform/confirm";
import { notify, type NoticeAction } from "../ui/notify";
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
    const action = vi.mocked(notify).mock.calls[0]?.[2] as NoticeAction | undefined;
    expect(action?.label).toBe("Annulla");
    await action?.run();
    expect(undoLastOperation).toHaveBeenCalledOnce();
  });

  it("col cestino di sistema chiede; se l'utente ci ripensa non tocca niente", async () => {
    fake.system = true;
    fake.confirm = false;
    await trashWithConfirm("vittima.md");
    // Il bottone dice ciò che fa: sposta, non elimina.
    expect(vi.mocked(confirm).mock.calls[0]?.[1]).toMatchObject({ okLabel: "Sposta nel cestino" });
    expect(documentSessions.cancelDeletion).toHaveBeenCalledWith("vittima.md");
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(closeDocument).not.toHaveBeenCalled();
  });

  // Una domanda che **rifiuta** (il dialogo di sistema che non si apre) non è
  // un sì e non può nemmeno restare senza risposta: la sessione resterebbe
  // sospesa — sola lettura, niente salvataggio né bozza — per un gesto che
  // nessuno ha confermato. Vale «no», come per il presentatore in-app.
  it("se la domanda rifiuta vale no: non cestina niente e ritira la cancellazione pendente", async () => {
    fake.system = true;
    vi.mocked(confirm).mockRejectedValueOnce(new Error("il dialogo non si apre"));
    await trashWithConfirm("vittima.md");
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(closeDocument).not.toHaveBeenCalled();
    expect(documentSessions.beginDeletion).toHaveBeenCalledWith("vittima.md");
    expect(documentSessions.cancelDeletion).toHaveBeenCalledWith("vittima.md");
  });

  // Lo stesso guasto con un presentatore dichiarato (lo Scrittoio) non arriva
  // qui come rifiuto: la porta lo traduce in «no», e il «no» ritira la
  // cancellazione pendente.
  it("se a fallire è il presentatore in-app la risposta è no, e la cancellazione si ritira", async () => {
    fake.system = true;
    const retire = declareConfirm(() => Promise.reject(new Error("la superficie non si apre")));
    try {
      await trashWithConfirm("vittima.md");
    } finally {
      retire();
    }
    expect(confirm).not.toHaveBeenCalled();
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

describe("cestinare più note insieme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(false);
    fake.confirm = true;
    fake.open = true;
    fake.system = false;
  });

  it("le cestina tutte in fila e lo dice una volta sola", async () => {
    expect(await trashManyWithConfirm(["a.md", "b.md", "a.md"])).toBe(2);
    expect(documentSessions.delete).toHaveBeenCalledTimes(2);
    expect(closeDocument).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("col cestino di sistema fa una sola domanda; se si rifiuta non tocca niente", async () => {
    fake.system = true;
    fake.confirm = false;
    expect(await trashManyWithConfirm(["a.md", "b.md"])).toBe(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0]?.[1]).toMatchObject({ okLabel: "Sposta nel cestino" });
    expect(documentSessions.delete).not.toHaveBeenCalled();
    expect(documentSessions.cancelDeletion).toHaveBeenCalledTimes(2);
  });

  it("un guasto su una nota non ferma le altre", async () => {
    vi.mocked(documentSessions.delete).mockImplementationOnce(async () => {
      throw new Error("no");
    });
    expect(await trashManyWithConfirm(["a.md", "b.md"])).toBe(1);
    expect(documentSessions.cancelDeletion).toHaveBeenCalledWith("a.md");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("salta le note già in cancellazione", async () => {
    vi.mocked(documentSessions.isDeletionPending).mockReturnValue(true);
    expect(await trashManyWithConfirm(["a.md"])).toBe(0);
    expect(documentSessions.beginDeletion).not.toHaveBeenCalled();
  });
});
