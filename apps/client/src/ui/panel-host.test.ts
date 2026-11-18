// @vitest-environment happy-dom
// Un pannello che non si ridisegna dice una volta sola che non si ridisegna, e
// lo dice con la frase di chi guarda: la prosa del kernel («parse failed:
// rich codec…», in inglese) non arriva allo schermo (IMP-117).
import { beforeEach, describe, expect, it, vi } from "vitest";

const notified = vi.hoisted(() => [] as Array<{ message: string; tone: string }>);
vi.mock("./notify", () => ({
  notify: (message: string, tone: string) => {
    notified.push({ message, tone });
  },
}));

import { refreshOn, refreshPanel, registerPanel, unregisterPanel } from "./panel-host";
import "../i18n/strings";

const PANEL = "shell:stats-test";
const codec = { kind: "internal", message: "parse failed: rich codec: not a valid zip package" };

describe("un pannello che non si ridisegna", () => {
  let broken = true;

  beforeEach(() => {
    notified.length = 0;
    broken = true;
    registerPanel({
      id: PANEL,
      title: "Statistiche",
      placement: "right_sidebar",
      refresh: refreshOn("document_changed"),
      render: () => {
        if (broken) throw codec;
      },
    });
  });

  it("dice il motivo di chi guarda, non il messaggio del kernel", async () => {
    await refreshPanel(PANEL);
    expect(notified).toEqual([
      {
        message: "Il pannello «Statistiche» non si è ridisegnato: si è verificato un problema imprevisto",
        tone: "guasto",
      },
    ]);
    expect(notified[0]!.message).not.toContain("parse failed");
    expect(notified[0]!.message).not.toContain("[object");
    unregisterPanel(PANEL);
  });

  it("una registrazione nuova è un pannello nuovo: la sua rottura si dice", async () => {
    await refreshPanel(PANEL);
    expect(notified).toHaveLength(1);
    registerPanel({
      id: PANEL,
      title: "Statistiche",
      placement: "right_sidebar",
      refresh: refreshOn("document_changed"),
      render: () => {
        throw codec;
      },
    });
    await refreshPanel(PANEL);
    expect(notified).toHaveLength(2);
    unregisterPanel(PANEL);
  });

  it("non ripete l'avviso a ogni ridisegno rotto, e torna a dirlo dopo una guarigione", async () => {
    await refreshPanel(PANEL);
    await refreshPanel(PANEL);
    await refreshPanel(PANEL);
    expect(notified).toHaveLength(1);

    broken = false;
    await refreshPanel(PANEL);
    broken = true;
    await refreshPanel(PANEL);
    expect(notified).toHaveLength(2);
    unregisterPanel(PANEL);
  });
});
