import { describe, expect, it } from "vitest";
import { conInCima } from "./recenti";

// La memoria corta del quick switcher (§21.5). Si prova qui e non aprendo
// l'app perché la decisione che contiene è una sola e non ha bisogno di un
// DOM: cosa succede a una nota che si riapre.
describe("conInCima", () => {
  it("la nota appena aperta va in cima", () => {
    expect(conInCima(["a.md", "b.md"], "c.md")).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("una nota già vista si SPOSTA, non si duplica", () => {
    // È la differenza fra una memoria corta e un registro di accessi: chi
    // rimbalza fra due note non deve vedere quelle due note dieci volte.
    expect(conInCima(["a.md", "b.md", "c.md"], "c.md")).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("riaprire la prima non cambia niente", () => {
    expect(conInCima(["a.md", "b.md"], "a.md")).toEqual(["a.md", "b.md"]);
  });

  it("oltre il tetto la più vecchia cade", () => {
    expect(conInCima(["a.md", "b.md", "c.md"], "d.md", 3)).toEqual(["d.md", "a.md", "b.md"]);
  });

  it("da vuota", () => {
    expect(conInCima([], "a.md")).toEqual(["a.md"]);
  });
});
