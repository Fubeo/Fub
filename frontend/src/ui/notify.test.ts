// La regola dello storico degli avvisi (§10.3), provata dove sta: in una
// funzione pura.
//
// Il resto del centro notifiche è DOM, e non è dove stanno le decisioni. Quella
// che conta è una sola — *due avvisi identici di fila sono uno* — e ha due modi
// di essere sbagliata che non si vedono guardando l'app: raggruppare anche
// quelli lontani (e raccontare una volta ciò che è successo due), e non
// raggruppare affatto (e riempire lo storico di copie).
import { describe, expect, it } from "vitest";
import { avvisoDiGuasto, MEMORIA, raccogli, rigaDi, type Avviso } from "./notify";

function avviso(testo: string, quando = 0, tono: Avviso["tono"] = "info"): Avviso {
  return { testo, tono, quando, volte: 1 };
}

function storicoDi(...testi: string[]): Avviso[] {
  return testi.reduce<Avviso[]>((acc, t, i) => raccogli(acc, avviso(t, i)), []);
}

describe("lo storico degli avvisi", () => {
  it("tiene il più recente in testa", () => {
    const storico = storicoDi("primo", "secondo");
    expect(storico.map((a) => a.testo)).toEqual(["secondo", "primo"]);
  });

  it("raggruppa le ripetizioni **di fila** e conta quante", () => {
    const storico = storicoDi("salvataggio fallito", "salvataggio fallito", "salvataggio fallito");
    expect(storico).toHaveLength(1);
    expect(storico[0].volte).toBe(3);
    expect(rigaDi(storico[0])).toBe("salvataggio fallito ×3");
    expect(storico[0].quando, "il gruppo porta l'ora dell'ultima volta").toBe(2);
  });

  it("non raggruppa due volte lontane, che sono due fatti", () => {
    const storico = storicoDi("disco pieno", "nota creata", "disco pieno");
    expect(storico.map((a) => a.testo)).toEqual(["disco pieno", "nota creata", "disco pieno"]);
    expect(storico.every((a) => a.volte === 1)).toBe(true);
  });

  it("non fonde due toni diversi con lo stesso testo", () => {
    // Lo stesso testo detto come informazione e come guasto sono due cose
    // diverse per chi legge, e fonderli mostrerebbe il tono sbagliato.
    const uno = raccogli([], avviso("indice non disponibile", 0, "info"));
    const due = raccogli(uno, avviso("indice non disponibile", 1, "guasto"));
    expect(due).toHaveLength(2);
  });

  it("dimentica i più vecchi invece di crescere per sempre", () => {
    let storico: Avviso[] = [];
    for (let n = 0; n < MEMORIA + 10; n += 1) {
      storico = raccogli(storico, avviso(`avviso ${n}`, n));
    }
    expect(storico).toHaveLength(MEMORIA);
    expect(storico[0].testo).toBe(`avviso ${MEMORIA + 9}`);
    expect(
      storico[storico.length - 1].testo,
      "il taglio è in coda: si dimentica il più vecchio, non il più recente",
    ).toBe("avviso 10");
  });

  it("una volta sola non mostra il contatore", () => {
    expect(rigaDi(avviso("nota salvata"))).toBe("nota salvata");
  });
});

describe("un guasto del kernel (§20.2)", () => {
  const guasto = (severity: "warning" | "failure", subject: string | null) =>
    ({ type: "trouble", severity, subject, error: { kind: "internal", message: "disco pieno" } }) as const;

  it("nomina il documento quando l'evento ne nomina uno", () => {
    expect(avvisoDiGuasto(guasto("warning", "Progetti/Nota.md")).testo).toBe(
      "Progetti/Nota.md: disco pieno",
    );
  });

  it("non nomina nessuno quando il guasto è del vault intero", () => {
    // Il caso che vale il presidio: `subject` è opzionale, e comporre la frase
    // con un soggetto assente darebbe «null: disco pieno».
    expect(avvisoDiGuasto(guasto("warning", null)).testo).toBe("disco pieno");
  });

  it("un derivato perduto informa, ciò che non si ricostruisce è un guasto", () => {
    expect(avvisoDiGuasto(guasto("warning", null)).tono).toBe("info");
    expect(avvisoDiGuasto(guasto("failure", null)).tono).toBe("guasto");
  });
});
