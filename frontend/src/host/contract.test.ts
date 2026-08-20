import { describe, expect, it } from "vitest";
import { nameQuery, textQuery } from "./contract";

// **Le query si compongono qui**, ed è la regola della
// [0082](../../../docs/decisions/0082-una-porta-per-chi-cerca.md): una
// superficie che se la componesse in casa sarebbe già una seconda
// implementazione. Se le query hanno un posto solo, hanno anche un banco solo —
// e questo è il posto in cui le due proprietà su cui poggia la §21.5 restano
// vere anche quando qualcuno riscriverà il quick switcher.
describe("nomeCercato", () => {
  const text = (q: ReturnType<typeof nameQuery>) => {
    const predicate = q.any[0]!.all[0]!.predicate;
    if (predicate.kind !== "text") throw new Error("non è un predicato di testo");
    return predicate;
  };

  it("cerca SOLO nel nome", () => {
    // È ciò che distingue il quick switcher dalla casella del vault: chi ha
    // premuto la scorciatoia per aprire la nota *Rust* non vuole davanti a sé
    // le trecento note che ne parlano.
    expect(text(nameQuery("rust")).fields).toEqual(["name"]);
  });

  it("il prefisso è acceso per default", () => {
    // Queste superfici partono a ogni battuta: chi ha scritto `ar` sta cercando
    // *architettura*, non una nota che si chiami «ar». È la §21.2, e lo dice la
    // query — non la casella appendendo un `*`.
    expect(text(nameQuery("ar")).partial_last_term).toBe(true);
    expect(text(nameQuery("ar", false)).partial_last_term).toBe(false);
  });

  it("è una clausola sola con un letterale solo, non negato", () => {
    const q = nameQuery("ar");
    expect(q.any).toHaveLength(1);
    expect(q.any[0]!.all).toHaveLength(1);
    expect(q.any[0]!.all[0]!.negated).toBe(false);
  });

  it("la casella del vault non ha ereditato niente: là i campi restano liberi", () => {
    // Le due configurazioni della stessa porta devono restare due: se un
    // giorno `textQuery` si restringesse al nome, la ricerca del vault
    // smetterebbe di trovare il testo delle note e nessuno lo direbbe.
    const predicate = textQuery("rust").any[0]!.all[0]!.predicate;
    if (predicate.kind !== "text") throw new Error("non è un predicato di testo");
    expect(predicate.fields).toEqual([]);
    expect(predicate.partial_last_term).toBe(false);
  });
});
