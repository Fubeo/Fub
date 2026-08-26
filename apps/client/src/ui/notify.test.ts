// La regola dello storico degli avvisi (§10.3), provata dove sta: in una
// funzione pura.
//
// Il resto del centro notifiche è DOM, e non è dove stanno le decisioni. Quella
// che conta è una sola — *due avvisi identici di fila sono uno* — e ha due modi
// di essere sbagliata che non si vedono guardando l'app: raggruppare anche
// quelli lontani (e raccontare una volta ciò che è successo due), e non
// raggruppare affatto (e riempire lo storico di copie).
import { describe, expect, it } from "vitest";
import { failureNotice, HISTORY_LIMIT, collect, lineOf, type Notice } from "./notify";

function notice(text: string, when = 0, tone: Notice["tone"] = "info"): Notice {
  return { text, tone, when, times: 1 };
}

function historyOf(...texts: string[]): Notice[] {
  return texts.reduce<Notice[]>((acc, t, i) => collect(acc, notice(t, i)), []);
}

describe("lo storico degli avvisi", () => {
  it("tiene il più recente in testa", () => {
    const history = historyOf("primo", "secondo");
    expect(history.map((a) => a.text)).toEqual(["secondo", "primo"]);
  });

  it("raggruppa le ripetizioni **di fila** e conta quante", () => {
    const history = historyOf("salvataggio fallito", "salvataggio fallito", "salvataggio fallito");
    expect(history).toHaveLength(1);
    expect(history[0].times).toBe(3);
    expect(lineOf(history[0])).toBe("salvataggio fallito ×3");
    expect(history[0].when, "il gruppo porta l'ora dell'ultima volta").toBe(2);
  });

  it("non raggruppa due volte lontane, che sono due fatti", () => {
    const history = historyOf("disco pieno", "nota creata", "disco pieno");
    expect(history.map((a) => a.text)).toEqual(["disco pieno", "nota creata", "disco pieno"]);
    expect(history.every((a) => a.times === 1)).toBe(true);
  });

  it("non fonde due toni diversi con lo stesso testo", () => {
    // Lo stesso testo detto come informazione e come guasto sono due cose
    // diverse per chi legge, e fonderli mostrerebbe il tono sbagliato.
    const first = collect([], notice("indice non disponibile", 0, "info"));
    const second = collect(first, notice("indice non disponibile", 1, "guasto"));
    expect(second).toHaveLength(2);
  });

  it("dimentica i più vecchi invece di crescere per sempre", () => {
    let history: Notice[] = [];
    for (let n = 0; n < HISTORY_LIMIT + 10; n += 1) {
      history = collect(history, notice(`avviso ${n}`, n));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].text).toBe(`avviso ${HISTORY_LIMIT + 9}`);
    expect(
      history[history.length - 1].text,
      "il taglio è in coda: si dimentica il più vecchio, non il più recente",
    ).toBe("avviso 10");
  });

  it("una volta sola non mostra il contatore", () => {
    expect(lineOf(notice("nota salvata"))).toBe("nota salvata");
  });
});

describe("un guasto del kernel (§20.2)", () => {
  const failure = (
    severity: "warning" | "failure",
    subject: string | null,
    gate: "event" | null = null,
  ) =>
    (
      {
        type: "trouble",
        severity,
        subject,
        error: { kind: "internal", message: "disco pieno" },
        gate,
      }
    ) as const;

  it("nomina il documento quando l'evento ne nomina uno", () => {
    expect(failureNotice(failure("warning", "Progetti/Nota.md")).text).toBe(
      "Progetti/Nota.md: disco pieno",
    );
  });

  it("non nomina nessuno quando il guasto è del vault intero", () => {
    // Il caso che vale il presidio: `subject` è opzionale, e comporre la frase
    // con un soggetto assente darebbe «null: disco pieno».
    expect(failureNotice(failure("warning", null)).text).toBe("disco pieno");
  });

  it("un derivato perduto informa, ciò che non si ricostruisce è un guasto", () => {
    expect(failureNotice(failure("warning", null)).tone).toBe("info");
    expect(failureNotice(failure("failure", null)).tone).toBe("guasto");
  });

  it("dice da quale porta è entrato il guasto, dopo la frase del documento", () => {
    // §17.3, decisione 0161: `gate` è l'unico che il kernel popola davvero
    // oggi, e sapere da che parte guardare è metà della diagnosi.
    expect(failureNotice(failure("warning", "Progetti/Nota.md", "event")).text).toBe(
      "Progetti/Nota.md: disco pieno · da ricevendo un evento",
    );
  });

  it("dice la porta anche quando il guasto è del vault intero", () => {
    expect(failureNotice(failure("warning", null, "event")).text).toBe(
      "disco pieno · da ricevendo un evento",
    );
  });

  it("senza porta il testo resta com'era, senza suffisso", () => {
    // Il presidio del contratto: `gate: null` non deve far comparire « · da …»
    // in coda, né cambiare la frase di prima.
    expect(failureNotice(failure("warning", "Progetti/Nota.md")).text).not.toContain(
      " · da ",
    );
    expect(failureNotice(failure("warning", null)).text).not.toContain(" · da ");
  });
});
