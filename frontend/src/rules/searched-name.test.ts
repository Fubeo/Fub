import { describe, expect, it } from "vitest";
import { searchedName } from "./searched-name";

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
