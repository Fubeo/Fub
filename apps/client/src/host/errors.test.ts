// `errorText` non stampa mai «[object Object]» né una chiave del catalogo:
// un errore del contratto il cui messaggio è arrivato non risolto (un oggetto
// `{key, args}`) si legge come la frase della sua specie, nella lingua di chi
// guarda.
import { afterEach, describe, expect, it, vi } from "vitest";

import { errorKindPhrase, errorText } from "./errors";
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
    expect(errorText({ kind: "io", message: "«a.md» non si legge" })).toBe("«a.md» non si legge");
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

describe("errorKindPhrase", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Una riga che dice che cosa non è riuscito (un documento che non si apre, un
  // pannello che non si ridisegna) non legge il messaggio del kernel: un
  // `FormatError` esce come `internal` con la prosa in inglese del codec.
  it("says the kind of a failure, never the English message of the kernel", () => {
    speak("it-IT");
    const codec = { kind: "internal", message: "parse failed: rich codec: not a valid zip package" };
    expect(errorKindPhrase(codec)).toBe("si è verificato un problema imprevisto");
    expect(errorKindPhrase({ kind: "not_found", message: "a/Uno.md" })).toBe("non esiste più");
    expect(errorKindPhrase(new TypeError("rotto"))).toBe("si è verificato un problema imprevisto");
    speak("en-US");
    expect(errorKindPhrase(codec)).toBe("an unexpected problem occurred");
    for (const e of [codec, unresolved("internal"), { qualunque: 1 }, "stringa"]) {
      expect(errorKindPhrase(e)).not.toContain("parse failed");
      expect(errorKindPhrase(e)).not.toContain("[object");
    }
  });
});
