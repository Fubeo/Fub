import { describe, expect, it } from "vitest";
import { PenQuiet, type Schedule } from "./quiet";

/// Uno scheduler finto: tiene le richieste e le fa girare quando il test lo
/// dice. Conta anche quelle annullate.
class FakeScheduler {
  readonly requests: { run: () => void; cancelled: boolean; ran: boolean }[] = [];

  readonly schedule: Schedule = (run) => {
    const request = { run, cancelled: false, ran: false };
    this.requests.push(request);
    return () => {
      request.cancelled = true;
    };
  };

  /// Le richieste né girate né annullate.
  get waiting(): number {
    return this.requests.filter((r) => !r.cancelled && !r.ran).length;
  }

  /// Fa girare le richieste in attesa, nell'ordine.
  flush(): void {
    for (const request of this.requests) {
      if (request.cancelled || request.ran) continue;
      request.ran = true;
      request.run();
    }
  }
}

function setup(): { quiet: PenQuiet; scheduler: FakeScheduler; log: string[] } {
  const scheduler = new FakeScheduler();
  return { quiet: new PenQuiet(scheduler.schedule), scheduler, log: [] };
}

describe("PenQuiet", () => {
  it("senza penna giù il lavoro gira subito, senza scheduler", () => {
    const { quiet, scheduler, log } = setup();
    expect(quiet.active).toBe(false);
    quiet.defer("render", () => log.push("render"));
    expect(log).toEqual(["render"]);
    expect(scheduler.requests).toHaveLength(0);
  });

  it("con la penna giù il lavoro aspetta l'ultimo leave e la consegna", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    expect(quiet.active).toBe(true);
    quiet.defer("render", () => log.push("render"));
    expect(log).toEqual([]);
    quiet.leave();
    expect(quiet.active).toBe(false);
    expect(log).toEqual([]);
    expect(scheduler.waiting).toBe(1);
    scheduler.flush();
    expect(log).toEqual(["render"]);
  });

  it("enter e leave sono contati: due penne giù, consegna alla seconda che si alza", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    expect(quiet.active).toBe(true);
    expect(scheduler.requests).toHaveLength(0);
    quiet.leave();
    expect(quiet.active).toBe(false);
    expect(scheduler.waiting).toBe(1);
    scheduler.flush();
    expect(log).toEqual(["render"]);
  });

  it("leave senza enter non va sotto zero e non consegna niente", () => {
    const { quiet, scheduler, log } = setup();
    quiet.leave();
    quiet.leave();
    expect(quiet.active).toBe(false);
    expect(scheduler.requests).toHaveLength(0);
    // Un enter solo basta a mettere la penna giù: il conto è rimasto a zero.
    quiet.enter();
    expect(quiet.active).toBe(true);
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    expect(quiet.active).toBe(false);
    scheduler.flush();
    expect(log).toEqual(["render"]);
  });

  it("un leave senza coda non chiede niente allo scheduler", () => {
    const { quiet, scheduler } = setup();
    quiet.enter();
    quiet.leave();
    expect(scheduler.requests).toHaveLength(0);
  });

  it("la stessa chiave con lavori diversi: gira solo l'ultimo", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render 1"));
    quiet.defer("render", () => log.push("render 2"));
    quiet.defer("render", () => log.push("render 3"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["render 3"]);
  });

  it("chiavi diverse girano tutte, nell'ordine dell'ultima richiesta", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => log.push("a 1"));
    quiet.defer("b", () => log.push("b"));
    quiet.defer("a", () => log.push("a 2"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["b", "a 2"]);
  });

  it("la coda si consegna una volta sola", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => log.push("a"));
    quiet.defer("b", () => log.push("b"));
    quiet.leave();
    expect(scheduler.requests).toHaveLength(1);
    scheduler.flush();
    scheduler.requests[0]!.run();
    expect(log).toEqual(["a", "b"]);
  });

  it("una penna che torna giù prima della consegna la annulla; la coda aspetta il leave dopo", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    expect(scheduler.waiting).toBe(1);
    quiet.enter();
    expect(scheduler.requests[0]!.cancelled).toBe(true);
    expect(scheduler.waiting).toBe(0);
    scheduler.flush();
    expect(log).toEqual([]);
    quiet.leave();
    expect(scheduler.waiting).toBe(1);
    scheduler.flush();
    expect(log).toEqual(["render"]);
  });

  it("una consegna annullata che lo scheduler fa girare lo stesso non consegna", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    quiet.enter();
    // Uno scheduler che ignora l'annullamento.
    scheduler.requests[0]!.run();
    expect(log).toEqual([]);
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["render"]);
  });

  it("un defer a penna su, mentre la stessa chiave aspetta la consegna, la sostituisce", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("vecchio"));
    quiet.leave();
    quiet.defer("render", () => log.push("nuovo"));
    expect(log).toEqual(["nuovo"]);
    // La coda è vuota: la consegna non serve più.
    expect(scheduler.requests[0]!.cancelled).toBe(true);
    scheduler.flush();
    expect(log).toEqual(["nuovo"]);
  });

  it("un defer a penna su con un'altra chiave non tocca la consegna in attesa", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    quiet.defer("altro", () => log.push("altro"));
    expect(scheduler.waiting).toBe(1);
    scheduler.flush();
    expect(log).toEqual(["altro", "render"]);
  });

  it("un lavoro che lancia non ferma gli altri; si rilancia il primo errore", () => {
    const { quiet, scheduler, log } = setup();
    const first = new Error("primo");
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      throw first;
    });
    quiet.defer("b", () => {
      log.push("b");
      throw new Error("secondo");
    });
    quiet.defer("c", () => log.push("c"));
    quiet.leave();
    expect(() => scheduler.flush()).toThrow(first);
    expect(log).toEqual(["a", "b", "c"]);
    // Dopo l'errore il silenzio funziona come prima.
    quiet.enter();
    quiet.defer("d", () => log.push("d"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a", "b", "c", "d"]);
  });

  it("un lavoro fatto subito che lancia lancia a chi chiama", () => {
    const { quiet } = setup();
    const error = new Error("subito");
    expect(() =>
      quiet.defer("render", () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("defer chiamato da un lavoro che sta girando: la penna è su, gira subito", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      quiet.defer("dentro", () => log.push("dentro"));
      log.push("a fine");
    });
    quiet.defer("b", () => log.push("b"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a", "dentro", "a fine", "b"]);
    expect(scheduler.requests).toHaveLength(1);
  });

  it("defer da un lavoro con la chiave di un lavoro ancora da girare: quello vecchio non gira", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      quiet.defer("b", () => log.push("b nuovo"));
    });
    quiet.defer("b", () => log.push("b vecchio"));
    quiet.leave();
    scheduler.flush();
    // La richiesta nuova toglie dalla coda quella vecchia e gira subito.
    expect(log).toEqual(["a", "b nuovo"]);
    expect(scheduler.waiting).toBe(0);
  });

  it("enter chiamato da un lavoro: quelli che restano tornano in coda per il leave dopo", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      quiet.enter();
    });
    quiet.defer("b", () => log.push("b"));
    quiet.defer("c", () => log.push("c"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a"]);
    expect(quiet.active).toBe(true);
    // Una richiesta nuova per "c" mentre la penna è giù prende il posto di
    // quella rimessa in coda.
    quiet.defer("c", () => log.push("c nuovo"));
    quiet.defer("d", () => log.push("d"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a", "b", "c nuovo", "d"]);
  });

  it("enter e leave dentro un lavoro: il resto della consegna prosegue", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      quiet.enter();
      quiet.leave();
    });
    quiet.defer("b", () => log.push("b"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a", "b"]);
    // Il leave dentro il lavoro non ha chiesto una consegna in più.
    expect(scheduler.requests).toHaveLength(1);
  });

  it("dispose con una consegna in volo la annulla e svuota la coda", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    quiet.dispose();
    expect(scheduler.requests[0]!.cancelled).toBe(true);
    // Anche se lo scheduler la fa girare lo stesso.
    scheduler.requests[0]!.run();
    expect(log).toEqual([]);
  });

  it("dispose con la penna giù: la coda si svuota e il leave dopo non consegna", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.dispose();
    expect(quiet.active).toBe(false);
    quiet.leave();
    expect(scheduler.requests).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it("dopo dispose niente fa niente", () => {
    const { quiet, scheduler, log } = setup();
    quiet.dispose();
    quiet.defer("render", () => log.push("render"));
    quiet.enter();
    expect(quiet.active).toBe(false);
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    quiet.dispose();
    expect(log).toEqual([]);
    expect(scheduler.requests).toHaveLength(0);
  });

  it("dispose chiamato da un lavoro ferma il resto della consegna", () => {
    const { quiet, scheduler, log } = setup();
    quiet.enter();
    quiet.defer("a", () => {
      log.push("a");
      quiet.dispose();
    });
    quiet.defer("b", () => log.push("b"));
    quiet.leave();
    scheduler.flush();
    expect(log).toEqual(["a"]);
  });

  it("uno scheduler che fa girare subito consegna dentro il leave", () => {
    const log: string[] = [];
    let cancels = 0;
    const quiet = new PenQuiet((run) => {
      run();
      return () => {
        cancels++;
      };
    });
    quiet.enter();
    quiet.defer("render", () => log.push("render"));
    quiet.leave();
    expect(log).toEqual(["render"]);
    // La consegna è già girata: un enter dopo non annulla niente.
    quiet.enter();
    expect(cancels).toBe(0);
  });
});
