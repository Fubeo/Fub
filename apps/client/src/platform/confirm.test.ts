import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lifetime, Teardown } from "../ui/lifetime";

const system = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("../host/dialog", () => ({ confirm: system.confirm }));

import { confirm, declareConfirm, type ConfirmOptions, type ConfirmPresenter } from "./confirm";

/// Tutti i `.ts` sotto `src/`, contenuto compreso (vedi
/// `host/no-tauri-outside-host.test.ts` per il perché di `import.meta.glob`).
const sources = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Un `import { … confirm … } from "…/host/dialog"`, anche su più righe e
/// anche rinominato.
const SYSTEM_CONFIRM = /import\s*(?:type\s*)?\{[^}]*\bconfirm\b[^}]*\}\s*from\s*["'][^"']*host\/dialog["']/;

const DELETE: ConfirmOptions = { title: "Elimina", okLabel: "Elimina", danger: true };

/// Una domanda arrivata al presentatore finto, con le maniglie per rispondere.
interface Shown {
  message: string;
  opts: ConfirmOptions;
  life: Lifetime;
  yes(): void;
  no(): void;
  fail(error: unknown): void;
}

/// Un presentatore che tiene aperta ogni domanda finché il banco non risponde.
function presenter(): { present: ConfirmPresenter; shown: Shown[] } {
  const shown: Shown[] = [];
  const present: ConfirmPresenter = (message, opts, life) =>
    new Promise<boolean>((resolve, reject) => {
      shown.push({
        message,
        opts,
        life,
        yes: () => resolve(true),
        no: () => resolve(false),
        fail: reject,
      });
    });
  return { present, shown };
}

/// La risposta di una promessa, o `"aperta"` se non è ancora arrivata.
async function state(question: Promise<boolean>): Promise<boolean | "aperta"> {
  const open = Symbol("aperta");
  // Abbastanza giri di microtask perché una risposta già decisa arrivi qui.
  let latest: boolean | typeof open = open;
  void question.then((answer) => {
    latest = answer;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return latest === open ? "aperta" : latest;
}

let retire: Teardown[] = [];
const declare = (present: ConfirmPresenter): Teardown => {
  const teardown = declareConfirm(present);
  retire.push(teardown);
  return teardown;
};

beforeEach(() => {
  system.confirm.mockReset();
  system.confirm.mockResolvedValue(true);
});

afterEach(() => {
  for (const teardown of retire.reverse()) teardown();
  retire = [];
});

describe("senza presentatore", () => {
  it("chiede al sistema, con gli stessi argomenti, e ne rende la risposta", async () => {
    const opts: ConfirmOptions = { title: "Titolo", okLabel: "Sì", cancelLabel: "No", danger: true };
    system.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(confirm("procedo?", opts)).resolves.toBe(true);
    await expect(confirm("procedo?", opts)).resolves.toBe(false);
    expect(system.confirm).toHaveBeenCalledTimes(2);
    expect(system.confirm).toHaveBeenNthCalledWith(1, "procedo?", opts);
    // Le opzioni sono quelle del chiamante, non una copia ritoccata.
    expect(system.confirm.mock.calls[0]![1]).toBe(opts);
  });

  // La shell che non dichiara niente non cambia comportamento: un dialogo di
  // sistema che rifiuta rifiuta ancora, e chi lo prevedeva lo vede ancora.
  it("un rifiuto del sistema arriva com'è", async () => {
    system.confirm.mockRejectedValueOnce(new Error("il dialogo non si apre"));
    await expect(confirm("procedo?", DELETE)).rejects.toThrow("il dialogo non si apre");
  });

  it("due domande insieme vanno tutte e due al sistema, subito", () => {
    system.confirm.mockReturnValue(new Promise<boolean>(() => {}));
    void confirm("prima", DELETE);
    void confirm("seconda", DELETE);
    expect(system.confirm.mock.calls.map((call) => call[0])).toEqual(["prima", "seconda"]);
  });
});

describe("con un presentatore dichiarato", () => {
  it("risponde lui, e il sistema non viene toccato", async () => {
    const { present, shown } = presenter();
    declare(present);
    const first = confirm("elimino?", DELETE);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.message).toBe("elimino?");
    expect(shown[0]!.opts).toBe(DELETE);
    expect(shown[0]!.life.closed).toBe(false);
    shown[0]!.yes();
    await expect(first).resolves.toBe(true);

    const second = confirm("elimino?", DELETE);
    shown[1]!.no();
    await expect(second).resolves.toBe(false);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("chiude la vita della domanda quando la risposta c'è", async () => {
    const { present, shown } = presenter();
    declare(present);
    const question = confirm("elimino?", DELETE);
    shown[0]!.yes();
    await question;
    expect(shown[0]!.life.closed).toBe(true);
  });

  it("ritirato, torna a rispondere il sistema", async () => {
    const { present, shown } = presenter();
    const teardown = declare(present);
    teardown();
    await expect(confirm("elimino?", DELETE)).resolves.toBe(true);
    expect(shown).toHaveLength(0);
    expect(system.confirm).toHaveBeenCalledOnce();
  });
});

describe("un presentatore che fallisce vale «no»", () => {
  it("se rifiuta", async () => {
    const { present, shown } = presenter();
    declare(present);
    const question = confirm("elimino?", DELETE);
    shown[0]!.fail(new Error("la superficie è caduta"));
    await expect(question).resolves.toBe(false);
    expect(shown[0]!.life.closed).toBe(true);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("se lancia prima di disegnare", async () => {
    declare(() => {
      throw new Error("niente DOM");
    });
    await expect(confirm("elimino?", DELETE)).resolves.toBe(false);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("se risponde qualcosa che non è un sì", async () => {
    for (const answer of [undefined, null, 1, "true", {}]) {
      const teardown = declare(() => Promise.resolve(answer as unknown as boolean));
      await expect(confirm("elimino?", DELETE)).resolves.toBe(false);
      teardown();
    }
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("e non ferma la domanda dopo", async () => {
    const answers = [Promise.reject(new Error("caduta")), Promise.resolve(true)];
    const asked: string[] = [];
    declare((message) => {
      asked.push(message);
      return answers.shift()!;
    });
    const first = confirm("prima", DELETE);
    const second = confirm("seconda", DELETE);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(asked).toEqual(["prima", "seconda"]);
  });
});

describe("ritirare il presentatore a domanda aperta", () => {
  it("la chiude con «no», insieme alla sua vita", async () => {
    const { present, shown } = presenter();
    const teardown = declare(present);
    const question = confirm("elimino?", DELETE);
    expect(await state(question)).toBe("aperta");
    teardown();
    await expect(question).resolves.toBe(false);
    expect(shown[0]!.life.closed).toBe(true);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("un sì che arriva dopo non la cambia", async () => {
    const { present, shown } = presenter();
    const teardown = declare(present);
    const question = confirm("elimino?", DELETE);
    teardown();
    shown[0]!.yes();
    await expect(question).resolves.toBe(false);
  });

  it("vale una volta: ritirare di nuovo non fa niente", async () => {
    const first = presenter();
    const second = presenter();
    const teardown = declare(first.present);
    teardown();
    declare(second.present);
    // Il teardown del primo, richiamato, non ritira il secondo.
    teardown();
    const question = confirm("elimino?", DELETE);
    expect(second.shown).toHaveLength(1);
    second.shown[0]!.yes();
    await expect(question).resolves.toBe(true);
  });
});

describe("due domande insieme", () => {
  it("la seconda aspetta la risposta alla prima, nell'ordine di arrivo", async () => {
    const { present, shown } = presenter();
    declare(present);
    const first = confirm("prima", DELETE);
    const second = confirm("seconda", DELETE);
    const third = confirm("terza", DELETE);
    // Una sola a schermo.
    expect(shown.map((each) => each.message)).toEqual(["prima"]);
    expect(await state(second)).toBe("aperta");

    shown[0]!.no();
    await expect(first).resolves.toBe(false);
    expect(shown.map((each) => each.message)).toEqual(["prima", "seconda"]);
    expect(await state(third)).toBe("aperta");

    // Ognuna ha la sua risposta: il «no» alla prima non è passato alla seconda.
    shown[1]!.yes();
    await expect(second).resolves.toBe(true);
    expect(shown.map((each) => each.message)).toEqual(["prima", "seconda", "terza"]);
    shown[2]!.no();
    await expect(third).resolves.toBe(false);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("la domanda dopo si apre quando quella prima ha già chiuso la sua vita", async () => {
    const closedBefore: boolean[] = [];
    const lives: Lifetime[] = [];
    const answers: ((yes: boolean) => void)[] = [];
    declare((_message, _opts, life) => {
      closedBefore.push(lives.every((each) => each.closed));
      lives.push(life);
      return new Promise<boolean>((resolve) => answers.push(resolve));
    });
    const first = confirm("prima", DELETE);
    const second = confirm("seconda", DELETE);
    answers[0]!(true);
    await first;
    answers[1]!(true);
    await second;
    expect(closedBefore).toEqual([true, true]);
  });

  it("nessuna resta appesa: ritirato il presentatore hanno tutte «no»", async () => {
    const { present, shown } = presenter();
    const teardown = declare(present);
    const questions = [confirm("prima", DELETE), confirm("seconda", DELETE), confirm("terza", DELETE)];
    teardown();
    await expect(Promise.all(questions)).resolves.toEqual([false, false, false]);
    // Quelle in fila non sono mai arrivate a schermo, né al sistema.
    expect(shown.map((each) => each.message)).toEqual(["prima"]);
    expect(system.confirm).not.toHaveBeenCalled();
  });
});

describe("dichiarazioni annidate", () => {
  it("risponde l'ultima; ritirarla rimette quella di prima", async () => {
    const outer = presenter();
    const inner = presenter();
    declare(outer.present);
    const retireInner = declare(inner.present);

    const toInner = confirm("alla seconda", DELETE);
    expect(inner.shown).toHaveLength(1);
    expect(outer.shown).toHaveLength(0);
    inner.shown[0]!.yes();
    await expect(toInner).resolves.toBe(true);

    retireInner();
    const toOuter = confirm("alla prima", DELETE);
    expect(outer.shown).toHaveLength(1);
    outer.shown[0]!.yes();
    await expect(toOuter).resolves.toBe(true);
    expect(system.confirm).not.toHaveBeenCalled();
  });

  it("ritirare la prima lascia la seconda; ritirate tutte e due risponde il sistema", async () => {
    const outer = presenter();
    const inner = presenter();
    const retireOuter = declare(outer.present);
    const retireInner = declare(inner.present);

    retireOuter();
    const toInner = confirm("alla seconda", DELETE);
    expect(inner.shown).toHaveLength(1);
    inner.shown[0]!.no();
    await expect(toInner).resolves.toBe(false);
    expect(system.confirm).not.toHaveBeenCalled();

    retireInner();
    await expect(confirm("al sistema", DELETE)).resolves.toBe(true);
    expect(system.confirm).toHaveBeenCalledOnce();
  });

  it("una domanda resta di chi l'ha ricevuta, e se ne va solo con lui", async () => {
    const outer = presenter();
    const inner = presenter();
    const retireOuter = declare(outer.present);
    const open = confirm("aperta sulla prima", DELETE);
    const retireInner = declare(inner.present);

    // Ritirare la seconda non tocca la domanda della prima.
    retireInner();
    expect(await state(open)).toBe("aperta");
    retireOuter();
    await expect(open).resolves.toBe(false);
  });
});

describe("la porta", () => {
  it("è l'unica a chiedere la conferma al sistema", () => {
    const offenders = Object.entries(sources)
      .filter(([key]) => key !== "./confirm.ts" && !key.endsWith(".test.ts"))
      .filter(([, text]) => SYSTEM_CONFIRM.test(text))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
    // Il presidio legge davvero i sources e riconosce un uso quando c'è.
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(SYSTEM_CONFIRM.test(sources["./confirm.ts"]!)).toBe(true);
  });
});
