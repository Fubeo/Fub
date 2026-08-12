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

const finto = vi.hoisted(() => ({
  conferma: true,
  aperta: true,
  attivo: null as string | null,
  prima: "prima.md" as string | null,
}));

vi.mock("../host/dialog", () => ({ confirm: vi.fn(async () => finto.conferma) }));

vi.mock("../state/vault", () => ({
  trashNote: vi.fn(async () => {}),
  refreshDocuments: vi.fn(),
  primaNota: vi.fn(async () => finto.prima),
}));

vi.mock("../state/layout", () => ({ docAttivo: vi.fn(() => finto.attivo) }));

vi.mock("./document", () => ({
  isOpen: vi.fn(() => finto.aperta),
  closeDocument: vi.fn(),
  openDocument: vi.fn(async () => {}),
  suspendSave: vi.fn(() => true),
  resumeSave: vi.fn(),
  scartaLaBozzaDi: vi.fn(async () => {}),
}));

import { trashWithConfirm } from "./trash";
import { closeDocument, openDocument, resumeSave, scartaLaBozzaDi } from "./document";

describe("cestinare una nota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finto.conferma = true;
    finto.aperta = true;
    finto.attivo = null;
    finto.prima = "prima.md";
  });

  it("chiude la nota cestinata, non quella a schermo", async () => {
    finto.attivo = "altra.md";
    await trashWithConfirm("vittima.md");
    expect(closeDocument).toHaveBeenCalledWith("vittima.md");
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("apre una nota di rimpiazzo solo se non è rimasto niente", async () => {
    finto.attivo = null;
    await trashWithConfirm("vittima.md");
    expect(closeDocument).toHaveBeenCalledWith("vittima.md");
    expect(openDocument).toHaveBeenCalledWith("prima.md");
  });

  it("non tocca niente se l'utente ci ripensa, e il salvataggio torna in coda", async () => {
    finto.conferma = false;
    await trashWithConfirm("vittima.md");
    expect(resumeSave).toHaveBeenCalledWith("vittima.md");
    expect(closeDocument).not.toHaveBeenCalled();
    expect(scartaLaBozzaDi).not.toHaveBeenCalled();
  });

  // La bozza è il gemello su disco del buffer sporco, e `trashWithConfirm`
  // dichiara che quel buffer «muore col documento». Sopravvivendogli, al
  // prossimo avvio la nota buttata tornava come `orfana`: riofferta a chi
  // aveva appena risposto di sì (difetto 0211).
  it("la bozza muore col documento cestinato", async () => {
    await trashWithConfirm("vittima.md");
    expect(scartaLaBozzaDi).toHaveBeenCalledWith("vittima.md");
  });

  it("non cerca un rimpiazzo per una nota che non era aperta", async () => {
    finto.aperta = false;
    await trashWithConfirm("vittima.md");
    expect(closeDocument).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
  });
});
