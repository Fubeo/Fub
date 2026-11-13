import { describe, expect, it } from "vitest";
import { EN, IT, type Key } from "./catalog";
import { FORBIDDEN } from "./lexicon";

// Il lessico dei componenti (K2, D18) vale anche per le Impostazioni: la scheda
// di un componente installato dice «Acceso», «Spegni» e «Togli», come la pagina
// Componenti. `ui/menu-budget.test.ts` guarda le voci dei menu; questo guarda i
// testi `settings.components.*`.

const PREFIX = "settings.components.";

/// La prima variante vietata dentro `text`, come parola o frase intera. Si
/// confronta senza maiuscole: in mezzo alla frase «abilita» è la stessa parola
/// di «Abilita».
function forbiddenWordIn(text: string): string | null {
  const lower = text.toLocaleLowerCase("it");
  for (const word of FORBIDDEN) {
    const needle = word.toLocaleLowerCase("it");
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
      const before = lower[at - 1];
      const after = lower[at + needle.length];
      if ((before === undefined || !/\p{L}/u.test(before)) && (after === undefined || !/\p{L}/u.test(after))) {
        return word;
      }
    }
  }
  return null;
}

function texts(catalog: Record<Key, string>): [Key, string][] {
  return (Object.entries(catalog) as [Key, string][]).filter(([key]) => key.startsWith(PREFIX));
}

describe("le parole dei componenti nelle Impostazioni", () => {
  it("nessun testo italiano settings.components.* usa una variante vietata", () => {
    const italian = texts(IT);
    expect(italian.length).toBeGreaterThan(20);
    const found = italian.flatMap(([key, text]) => {
      const word = forbiddenWordIn(text);
      return word ? [`${key}: «${text}» → ${word}`] : [];
    });
    expect(found).toEqual([]);
  });

  it("la guardia riconosce le frasi di prima, anche in minuscolo", () => {
    expect(forbiddenWordIn("Disabilita il componente prima di rimuoverlo.")).toBe("Disabilita");
    expect(forbiddenWordIn("L'installazione non lo abilita.")).toBe("Abilita");
    expect(forbiddenWordIn("Disinstalla «{name}»")).toBe("Disinstalla");
    expect(forbiddenWordIn("Spegni il componente prima di toglierlo.")).toBeNull();
    expect(forbiddenWordIn("Arancione")).toBeNull();
  });

  it("la scheda di un componente installato dice Acceso, Spegni e Togli", () => {
    // «Rimuovi» non è fra le varianti del lessico («Togli il link» vieta solo
    // «Rimuovi il link»): per la scheda si fissano le frasi intere.
    expect(IT["settings.components.enabled"]).toBe("Acceso");
    expect(IT["settings.components.enabled_failed"]).toBe("Componente non acceso né spento: {reason}");
    expect(IT["settings.components.consent.hint"]).toMatch(/^È distinto da acceso e spento: /);
    expect(IT["settings.components.remove"]).toBe("Togli");
    expect(IT["settings.components.remove.hint"]).toBe("Toglie l'installazione; i suoi dati restano nel vault.");
    expect(IT["settings.components.remove.disabled"]).toBe("Spegni il componente prima di toglierlo.");
    expect(IT["settings.components.remove.title"]).toBe("Togli il componente");
    expect(IT["settings.components.remove.confirm"]).toBe(
      "Togliere «{name}»? I dati che il componente ha salvato nei vault restano.",
    );
    expect(IT["settings.components.remove_failed"]).toBe("Componente non tolto: {reason}");
    const found = texts(IT).filter(([, text]) => /(?<!\p{L})[Rr]imuov/u.test(text)).map(([key]) => key);
    expect(found).toEqual([]);
  });

  it("in inglese la scheda dice On e turn off", () => {
    expect(EN["settings.components.enabled"]).toBe("On");
    expect(EN["settings.components.enabled_failed"]).toBe("Component not turned on or off: {reason}");
    expect(EN["settings.components.remove.disabled"]).toBe("Turn the component off before removing it.");
    expect(EN["settings.components.consent.hint"]).toMatch(/^This is separate from turning it on or off: /);
    expect(EN["settings.components.install.hint"]).not.toMatch(/\benable/u);
  });
});
