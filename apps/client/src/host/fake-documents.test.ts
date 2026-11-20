// Le chiavi di apertura dell'host finto: una lettura semplice non apre
// niente, un'apertura o una scrittura sotto la chiave la contano, la chiusura
// la toglie. È il contratto di `read_document`, `write_document` e
// `document_closed` (docs/reference/ipc-contract.md).

import { describe, expect, it } from "vitest";
import { createFakeHost } from "./fake";

describe("le chiavi di apertura dell'host finto", () => {
  it("un'apertura conta, una lettura semplice no, la chiusura toglie", async () => {
    const host = createFakeHost({ file: { "Lettera.docx": "Cara Anna.", "Nota.md": "# Nota\n" } });
    const { api } = host.module;

    const semplice = await api.readDocument("Lettera.docx");
    expect(host.openKeys()).toBe(0);

    const aperta = await api.openDocument("Lettera.docx", "sessione-1");
    expect(aperta).toEqual(semplice);
    expect(host.openKeys()).toBe(1);
    await api.openDocument("Lettera.docx", "sessione-2");
    expect(host.openKeys()).toBe(2);
    // Una nota sotto la chiave si legge e non segna niente.
    await api.openDocument("Nota.md", "nota");
    expect(host.openKeys()).toBe(2);

    await api.documentClosed("sessione-1");
    expect(host.openKeys()).toBe(1);
    // Una chiave già chiusa o sconosciuta non è un errore.
    await api.documentClosed("sessione-1");
    await api.documentClosed("mai-aperta");
    expect(host.openKeys()).toBe(1);
    await api.documentClosed("sessione-2");
    expect(host.openKeys()).toBe(0);
    expect(host.atGate("documentClosed").map((call) => call.args)).toEqual([
      ["sessione-1"],
      ["sessione-1"],
      ["mai-aperta"],
      ["sessione-2"],
    ]);
  });

  it("una scrittura sotto la chiave la apre, una senza chiave no", async () => {
    const host = createFakeHost({ file: { "Lettera.docx": "Cara Anna." } });
    const { api } = host.module;
    const { revision } = await api.readDocument("Lettera.docx");
    const nuova = await api.writeDocument("Lettera.docx", "Ciao.", { kind: "descends_from", value: revision });
    expect(host.openKeys()).toBe(0);
    await api.writeDocument("Lettera.docx", "Ciao ancora.", { kind: "descends_from", value: nuova }, null, "sessione");
    expect(host.openKeys()).toBe(1);
    await api.documentClosed("sessione");
    expect(host.openKeys()).toBe(0);
  });

  it("una chiave malformata è bad_args, e non apre niente", async () => {
    const host = createFakeHost({ file: { "Lettera.docx": "Cara Anna." } });
    const { api } = host.module;
    for (const bad of ["", "a/b", "a.b", "x".repeat(65)]) {
      await expect(api.openDocument("Lettera.docx", bad)).rejects.toMatchObject({ kind: "bad_args" });
      await expect(api.documentClosed(bad)).rejects.toMatchObject({ kind: "bad_args" });
    }
    expect(host.openKeys()).toBe(0);
  });
});
