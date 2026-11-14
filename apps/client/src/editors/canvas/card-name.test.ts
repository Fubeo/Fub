// La regola del nome di una scheda di testo (N6): la prima riga non vuota,
// senza i segni del Markdown; le parole restano come sono.
import { describe, expect, it } from "vitest";
import { textCardName } from "./card-name";

describe("textCardName", () => {
  it("la prima riga non vuota, senza i segni di blocco davanti", () => {
    expect(textCardName("# Idee")).toBe("Idee");
    expect(textCardName("\n\n  ## Da rifare  \n- uno")).toBe("Da rifare");
    expect(textCardName("> una citazione")).toBe("una citazione");
    expect(textCardName("> > annidata")).toBe("annidata");
    expect(textCardName("- [ ] portare il libro")).toBe("portare il libro");
    expect(textCardName("- [x] fatto")).toBe("fatto");
    expect(textCardName("+ più punti")).toBe("più punti");
    expect(textCardName("3. terzo")).toBe("terzo");
    expect(textCardName("1) primo")).toBe("primo");
    expect(textCardName("## Titolo ##")).toBe("Titolo");
    expect(textCardName("Domande per giovedì\naltro")).toBe("Domande per giovedì");
    expect(textCardName("Prima riga\n# Seconda")).toBe("Prima riga");
    expect(textCardName("   \n  ")).toBe("");
    expect(textCardName("")).toBe("");
  });

  it("una riga che dopo i segni è vuota non è il nome: si passa alla riga dopo", () => {
    expect(textCardName("- \n# Idee")).toBe("Idee");
    expect(textCardName("*\nIdee")).toBe("Idee");
    expect(textCardName("---\nIdee")).toBe("Idee");
    expect(textCardName("* * *\n___\nIdee")).toBe("Idee");
    expect(textCardName("# #\n> \nIdee")).toBe("Idee");
  });

  it("i segni in linea si tolgono e il testo resta", () => {
    expect(textCardName("Un **appunto** veloce")).toBe("Un appunto veloce");
    expect(textCardName("Un __appunto__ veloce")).toBe("Un appunto veloce");
    expect(textCardName("Una *nota* e _altra_")).toBe("Una nota e altra");
    expect(textCardName("***tutto*** insieme")).toBe("tutto insieme");
    expect(textCardName("~~vecchio~~ e ==nuovo==")).toBe("vecchio e nuovo");
    expect(textCardName("Usa `npm ci` ora")).toBe("Usa npm ci ora");
    expect(textCardName("Vedi [la guida](https://example.com/a_b_c) ora")).toBe("Vedi la guida ora");
    expect(textCardName("![foto del lago](lago.png)")).toBe("foto del lago");
    expect(textCardName("Vedi [[Varianza]]")).toBe("Vedi Varianza");
    expect(textCardName("Vedi [[Varianza|la varianza]]")).toBe("Vedi la varianza");
    expect(textCardName("Embed ![[Varianza]]")).toBe("Embed Varianza");
    expect(textCardName("**[Guida](https://x.it)** ora")).toBe("Guida ora");
    expect(textCardName("- **Compra** il pane")).toBe("Compra il pane");
    expect(textCardName("# Idee *vecchie*")).toBe("Idee vecchie");
  });

  it("il codice tiene i suoi segni, e gli escape dicono il carattere", () => {
    expect(textCardName("Il `**non** è grassetto`")).toBe("Il **non** è grassetto");
    expect(textCardName("Il `_a_` resta")).toBe("Il _a_ resta");
    expect(textCardName("un \\*asterisco\\* e \\\\")).toBe("un *asterisco* e \\");
    expect(textCardName("\\# non un titolo")).toBe("# non un titolo");
    expect(textCardName("\\`non codice\\`")).toBe("`non codice`");
  });

  it("le parole e i segni che non fanno coppia restano come sono", () => {
    expect(textCardName("snake_case_name")).toBe("snake_case_name");
    expect(textCardName("a__b__c")).toBe("a__b__c");
    expect(textCardName("2*3*4")).toBe("2*3*4");
    expect(textCardName("2**3**4")).toBe("2**3**4");
    expect(textCardName("a * b * c")).toBe("a * b * c");
    expect(textCardName("un * da solo")).toBe("un * da solo");
    expect(textCardName("C# e C++")).toBe("C# e C++");
    expect(textCardName("#tag non è un titolo")).toBe("#tag non è un titolo");
    expect(textCardName("#1 priorità")).toBe("#1 priorità");
    expect(textCardName("1.5 litri")).toBe("1.5 litri");
    expect(textCardName("-5 gradi")).toBe("-5 gradi");
    expect(textCardName("Il prezzo è 5*")).toBe("Il prezzo è 5*");
  });

  it("un wikilink con il titolo dice il titolo com'è scritto", () => {
    expect(textCardName("Vedi [[Nota#Sezione]]")).toBe("Vedi Nota#Sezione");
  });
});
