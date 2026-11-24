// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { t } from "../../../strings";
import type { ExportAsk } from "../../export-plan";
import type { EditorContext } from "../context";
import { eseguiVoceClient } from "./commands";
import { VOCI_ESPORTA, voceClienteCompleto, voceEsporta } from "./status";

/// Il pezzo del contesto che le voci di Esporta leggono: chi monta l'editor, le parti e la scelta.
function fingi(opzioni: { export?: boolean; parte?: boolean; scelti?: number } = {}): { ctx: EditorContext; chiesti: (ExportAsk | undefined)[] } {
  const chiesti: (ExportAsk | undefined)[] = [];
  const onExport = opzioni.export === false ? undefined : vi.fn((ask?: ExportAsk) => chiesti.push(ask));
  const ctx = {
    options: { onExport },
    has: (parte: string) => parte !== "export" || opzioni.parte !== false,
    selection: Array.from({ length: opzioni.scelti ?? 0 }, (_, i) => `k${i}`),
    editable: () => false,
  } as unknown as EditorContext;
  return { ctx, chiesti };
}

describe("le voci di File › Esporta del Disegno completo", () => {
  it("file.exportAs, file.export.png, file.export.svg, file.export.pdf aprono la finestra sul formato, anche in sola lettura", () => {
    const { ctx, chiesti } = fingi();
    for (const id of ["file.exportAs", "file.export.png", "file.export.svg", "file.export.pdf"]) {
      expect(voceClienteCompleto(ctx, id), id).toBeNull();
      eseguiVoceClient(ctx, id);
    }
    expect(chiesti).toEqual([undefined, { format: "png" }, { format: "svg" }, { format: "pdf" }]);
  });

  it("file.exportSelection è spenta senza oggetti scelti, e con loro apre la finestra sulla selezione", () => {
    const vuota = fingi();
    expect(voceEsporta(vuota.ctx, "file.exportSelection")).toBe(t("draw.export.noselection"));
    const scelta = fingi({ scelti: 2 });
    expect(voceEsporta(scelta.ctx, "file.exportSelection")).toBeNull();
    eseguiVoceClient(scelta.ctx, "file.exportSelection");
    expect(scelta.chiesti).toEqual([{ what: "selection" }]);
  });

  it("senza la finestra di chi monta l'editor, o senza la sua parte, le voci sono spente col perché", () => {
    for (const ctx of [fingi({ export: false }).ctx, fingi({ parte: false }).ctx]) {
      for (const id of Object.keys(VOCI_ESPORTA)) expect(voceEsporta(ctx, id), id).toBe(t("draw.export.off"));
    }
    // Una voce che non è di Esporta non la riguarda.
    expect(voceEsporta(fingi().ctx, "file.place")).toBeUndefined();
  });
});
