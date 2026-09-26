// @vitest-environment happy-dom
// Il gesto di un toast che il backend rifiuta dice **perché**, con la frase
// dell'errore: il confine Tauri consegna `{kind, message}`, e `String(error)`
// ne faceva `[object Object]` (I65).
import { afterEach, describe, expect, it } from "vitest";
import { clearHistory, notify, recentNotices } from "./notify";

describe("il gesto di un toast", () => {
  afterEach(() => {
    clearHistory();
    document.body.innerHTML = "";
  });

  it("rifiutato dal backend, notifica il messaggio dell'errore", async () => {
    const refused = { kind: "already_exists", message: "Il file esiste già" };
    notify("Nota eliminata", "info", { label: "Ricrea la nota", run: () => Promise.reject(refused) });
    document.querySelector<HTMLButtonElement>(".toast-action")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recentNotices()[0]).toMatchObject({ text: "Il file esiste già", tone: "guasto" });
  });

  it("un errore della webview dà il suo messaggio, senza il prefisso `Error:`", async () => {
    notify("Nota eliminata", "info", { label: "Riprova", run: () => Promise.reject(new Error("rotto qui")) });
    document.querySelector<HTMLButtonElement>(".toast-action")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recentNotices()[0]!.text).toBe("rotto qui");
  });
});
