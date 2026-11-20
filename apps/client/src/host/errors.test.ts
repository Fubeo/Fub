// `errorText` non stampa mai «[object Object]» né una chiave del catalogo:
// un errore del contratto il cui messaggio è arrivato non risolto (un oggetto
// `{key, args}`) si legge come la frase della sua specie, nella lingua di chi
// guarda.
import { afterEach, describe, expect, it, vi } from "vitest";

import { errorText } from "./errors";
// Caricare le stringhe registra chi traduce le frasi delle specie.
import "../i18n/strings";

const speak = (language: string) => vi.stubGlobal("navigator", { language });

const unresolved = (kind: string) => ({
  kind,
  message: { key: "host.rich.codec", args: [{ name: "doc", value: { kind: "text", value: "x.docx" } }] },
});

describe("errorText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the resolved message of a contract error", () => {
    expect(errorText({ kind: "bad_args", message: "Scrivi un nome" })).toBe("Scrivi un nome");
    expect(errorText({ kind: "permission_denied", message: "La cartella è di sola lettura" })).toBe("La cartella è di sola lettura");
  });

  // Anche `not_found`, `io` e `conflict`: col default il motivo è di chi l'ha
  // scritto (un comando che dice «La nota è cambiata: riprova»). Chi chiama una
  // primitiva dell'host chiede la specie.
  it("returns the message of every kind with the default", () => {
    expect(errorText({ kind: "conflict", message: "La nota è cambiata: riprova." })).toBe("La nota è cambiata: riprova.");
    expect(errorText({ kind: "io", message: "disco pieno" })).toBe("disco pieno");
  });

  it("returns the message of a webview Error without the prefix", () => {
    expect(errorText(new TypeError("rotto"))).toBe("rotto");
  });

  it("reads an unresolved message as the phrase of its kind, never [object Object]", () => {
    speak("it-IT");
    expect(errorText(unresolved("internal"))).toBe("si è verificato un problema imprevisto");
    expect(errorText(unresolved("not_found"))).toBe("non esiste più");
    expect(errorText(unresolved("unserved"))).toBe("questa funzione non è disponibile");
    speak("en-US");
    expect(errorText(unresolved("io"))).toBe("the file could not be read or written");
    expect(errorText(unresolved("una_specie_futura"))).toBe("an unexpected problem occurred");
    expect(errorText({ qualunque: 1 })).toBe("an unexpected problem occurred");
    for (const e of [unresolved("internal"), { qualunque: 1 }, { kind: 3, message: {} }]) {
      expect(errorText(e)).not.toContain("[object");
      expect(errorText(e)).not.toContain("error.kind");
    }
  });
});

describe("errorText con la specie", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Una riga che dice che cosa non è riuscito (un documento che non si apre, un
  // pannello che non si ridisegna) non legge il messaggio del kernel: un
  // `FormatError` esce come `internal` con la prosa in inglese del codec.
  it("says the kind of a failure, never the English message of the kernel", () => {
    speak("it-IT");
    const codec = { kind: "internal", message: "parse failed: rich codec: not a valid zip package" };
    expect(errorText(codec, "specie")).toBe("si è verificato un problema imprevisto");
    expect(errorText({ kind: "not_found", message: "a/Uno.md" }, "specie")).toBe("non esiste più");
    expect(errorText(new TypeError("rotto"), "specie")).toBe("si è verificato un problema imprevisto");
    speak("en-US");
    expect(errorText(codec, "specie")).toBe("an unexpected problem occurred");
    for (const e of [codec, unresolved("internal"), { qualunque: 1 }, "stringa"]) {
      expect(errorText(e, "specie")).not.toContain("parse failed");
      expect(errorText(e, "specie")).not.toContain("[object");
    }
  });
});
