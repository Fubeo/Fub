import { describe, expect, it } from "vitest";
import { searchedName, searchedPath } from "./searched-name";

// Dal testo cercato al nome della nota che non c'era (§21.7). Si prova qui e
// non aprendo l'app perché è una funzione di una stringa in una stringa, e le
// cose che sbaglia le sbaglia sui casi che a mano nessuno prova: lo slash, i
// due punti, il punto in coda.
describe("searchedName", () => {
  it("una query normale è già un nome", () => {
    expect(searchedName("Riunione con Anna")).toBe("Riunione con Anna");
  });

  it("non normalizza: maiuscole e accenti restano", () => {
    // Il nome delle cose lo decide chi le ha, non l'app.
    expect(searchedName("Perché Sì")).toBe("Perché Sì");
  });

  it("lo slash non crea una cartella", () => {
    // È il caso che, passato dritto, fa nascere una nota dentro un albero che
    // nessuno ha chiesto.
    expect(searchedName("progetti/2026")).toBe("progetti 2026");
  });

  it("i caratteri che rompono una sincronizzazione se ne vanno", () => {
    expect(searchedName('bilancio: "2026"?')).toBe("bilancio 2026");
  });

  it("gli spazi nati dalla sostituzione non si accumulano", () => {
    expect(searchedName("a / b")).toBe("a b");
  });

  it("il punto in coda se ne va, o l'estensione ne farebbe due", () => {
    expect(searchedName("e adesso.")).toBe("e adesso");
  });

  it("un nome nascosto non si propone", () => {
    expect(searchedName(".fub")).toBeNull();
  });

  it("solo spazi, o solo caratteri vietati, non propongono niente", () => {
    // `null` vuol dire che il gesto non si offre affatto: è il caso in cui un
    // «crea» disegnato comunque creerebbe una nota chiamata come il vuoto.
    expect(searchedName("   ")).toBeNull();
    expect(searchedName("///")).toBeNull();
    expect(searchedName("")).toBeNull();
  });

  it("tre righe incollate diventano un nome leggibile", () => {
    const long = searchedName("x".repeat(300));
    expect(long).not.toBeNull();
    expect(long?.length).toBe(80);
  });
});

// Il path che la ricerca rapida propone (IMP-6200): la barra è una cartella,
// e le forme che un path del vault non ha non diventano un path inventato.
describe("searchedPath", () => {
  it("la barra è una cartella: il path resta com'è scritto", () => {
    expect(searchedPath("Aree/Eventi/prova caccia")).toBe("Aree/Eventi/prova caccia");
  });

  it("un nome senza barre resta un nome, come per searchedName", () => {
    expect(searchedPath("Riunione con Anna")).toBe("Riunione con Anna");
    expect(searchedPath("e adesso.")).toBe("e adesso");
  });

  it("ogni segmento passa la pulizia del nome", () => {
    expect(searchedPath("Aree / Eventi: 2026 /idea?")).toBe("Aree/Eventi 2026/idea");
    expect(searchedPath("Lavoro./Bozza.")).toBe("Lavoro/Bozza");
  });

  it("le barre in testa, quelle doppie e i segmenti «.» si tolgono", () => {
    expect(searchedPath("/Aree/Eventi/x")).toBe("Aree/Eventi/x");
    expect(searchedPath("Aree//Eventi/x")).toBe("Aree/Eventi/x");
    expect(searchedPath("./Idea")).toBe("Idea");
    expect(searchedPath("Aree/./Idea")).toBe("Aree/Idea");
    expect(searchedPath("a/?/b")).toBe("a/b");
  });

  it("«..» non propone niente: non si esce dalla cartella", () => {
    expect(searchedPath("../Idea")).toBeNull();
    expect(searchedPath("Aree/../Idea")).toBeNull();
  });

  it("la barra in coda nomina una cartella, non una nota", () => {
    expect(searchedPath("Aree/Eventi/")).toBeNull();
    expect(searchedPath("///")).toBeNull();
  });

  it("un segmento nascosto non si propone", () => {
    expect(searchedPath(".obsidian/Idea")).toBeNull();
    expect(searchedPath("Aree/.nascosta")).toBeNull();
  });

  it("la barra rovescia non è un separatore", () => {
    expect(searchedPath("Aree\\Idea")).toBe("Aree Idea");
  });

  it("senza testo non propone niente", () => {
    expect(searchedPath("")).toBeNull();
    expect(searchedPath("  /  ")).toBeNull();
  });
});
