// @vitest-environment happy-dom
//
// I promemoria passati all'avvio (T36): il dialogo con «Apri» e «Fatto», che
// aspetta l'indice dell'apertura, si mostra una volta per vault e rilegge
// l'indice prima di spuntare.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountReminders,
  readReminderList,
  showPastReminders,
  wallMinute,
  type ReminderEntry,
  type ReminderList,
  type RemindersPort,
} from "./reminders";
import { reminderNotificationsOn, setReminderNotifications } from "../editors/text/profiles/markdown/task-reminder";
import { emit, state } from "../state/store";
import { openLifetime } from "../ui/lifetime";

const NOW = new Date(2026, 10, 18, 10, 0);

const call: ReminderEntry = { doc: "Lavoro/Clienti.md", at: 12, when: "2026-11-13 09:00", text: "Chiama Anna", heading: "Settimana" };
const send: ReminderEntry = { doc: "Casa.md", at: 40, when: "2026-11-17 18:30", text: "Manda il preventivo", heading: null };

function fakePort(list: ReminderList, overrides: Partial<RemindersPort> = {}) {
  const port = {
    ask: vi.fn(async () => list),
    done: vi.fn(async () => {}),
    open: vi.fn(),
    indexed: vi.fn(async () => true),
    notificationsOn: vi.fn(async () => true),
    ...overrides,
  } satisfies RemindersPort;
  return port;
}

const dialog = () => document.querySelector<HTMLElement>(".reminders-dialog");
const rows = () => [...document.querySelectorAll<HTMLElement>(".reminders-row")];
const button = (row: HTMLElement, label: string) =>
  [...row.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  setReminderNotifications(true);
  state.vaultRoot = null as unknown as string;
  document.body.replaceChildren();
});

describe("la risposta dell'indice", () => {
  it("si legge soltanto con la sua forma", () => {
    expect(readReminderList({ reminders: [call], more: false })).toEqual({ reminders: [call], more: false });
    expect(readReminderList({ reminders: [{ ...send, heading: undefined }], more: true })?.reminders[0]!.heading).toBeNull();
    expect(readReminderList({ reminders: [{ doc: "a.md", at: "12", when: "x", text: "" }] })).toBeNull();
    expect(readReminderList({ more: false })).toBeNull();
    expect(readReminderList(null)).toBeNull();
  });

  it("l'ora del muro è nella forma che l'indice confronta", () => {
    expect(wallMinute(new Date(2026, 0, 5, 7, 3))).toBe("2026-01-05 07:03");
  });
});

describe("il dialogo dei promemoria passati", () => {
  it("una riga per compito: il testo, l'ora e la nota, «Apri» e «Fatto»", () => {
    const life = openLifetime();
    showPastReminders({ reminders: [call, send], more: false }, fakePort({ reminders: [], more: false }), life, NOW);
    try {
      expect(dialog()!.querySelector(".kit-dialog-title")!.textContent).toBe("2 promemoria passati");
      expect(rows().map((row) => row.querySelector(".reminders-task")!.textContent)).toEqual(["Chiama Anna", "Manda il preventivo"]);
      expect(rows()[0]!.querySelector(".reminders-where")!.textContent).toBe("venerdì 13 novembre 2026, 09:00 · Clienti › Settimana");
      expect(rows()[1]!.querySelector(".reminders-where")!.textContent).toBe("martedì 17 novembre 2026, 18:30 · Casa");
      expect(button(rows()[0]!, "Fatto").getAttribute("aria-label")).toBe("Segna come fatto «Chiama Anna»");
    } finally {
      life.close();
    }
    expect(dialog()).toBeNull();
  });

  it("«Apri» chiude il dialogo e porta al compito", () => {
    const life = openLifetime();
    const port = fakePort({ reminders: [call], more: false });
    showPastReminders({ reminders: [call], more: false }, port, life, NOW);
    expect(dialog()!.querySelector(".kit-dialog-title")!.textContent).toBe("Un promemoria passato");
    button(rows()[0]!, "Apri").click();
    expect(port.open).toHaveBeenCalledWith("Lavoro/Clienti.md", 12);
    expect(dialog()).toBeNull();
    life.close();
  });

  it("«Fatto» rilegge l'indice, spunta il compito e toglie la riga; l'ultimo chiude il dialogo", async () => {
    const life = openLifetime();
    const port = fakePort({ reminders: [call, send], more: false });
    showPastReminders({ reminders: [call, send], more: false }, port, life, NOW);
    button(rows()[0]!, "Fatto").click();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(port.ask).toHaveBeenCalledWith("2026-11-18 10:00", expect.any(Number));
    expect(port.done).toHaveBeenCalledWith("Lavoro/Clienti.md", 12);
    button(rows()[0]!, "Fatto").click();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(port.done).toHaveBeenCalledTimes(2);
    life.close();
  });

  it("un compito già spuntato altrove non si rovescia: la riga sparisce e basta", async () => {
    const life = openLifetime();
    const port = fakePort({ reminders: [send], more: false });
    showPastReminders({ reminders: [call, send], more: false }, port, life, NOW);
    button(rows()[0]!, "Fatto").click();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(port.done).not.toHaveBeenCalled();
    life.close();
  });

  it("se la spunta non riesce lo dice nella riga, e si può riprovare", async () => {
    const life = openLifetime();
    const port = fakePort({ reminders: [call], more: false }, { done: vi.fn(async () => { throw new Error("la nota è in sola lettura"); }) });
    showPastReminders({ reminders: [call], more: false }, port, life, NOW);
    const done = button(rows()[0]!, "Fatto");
    done.click();
    await vi.waitFor(() => expect(rows()[0]!.querySelector<HTMLElement>(".reminders-error")!.hidden).toBe(false));
    expect(rows()[0]!.querySelector(".reminders-error")!.textContent).toMatch(/^Non sono riuscito a segnarlo come fatto: /);
    expect(done.disabled).toBe(false);
    life.close();
  });

  it("oltre il limite una riga dice che ce ne sono altri", () => {
    const life = openLifetime();
    showPastReminders({ reminders: [call], more: true }, fakePort({ reminders: [], more: false }), life, NOW);
    expect(document.querySelector(".reminders-more")!.textContent).toMatch(/E altri ancora/);
    life.close();
  });
});

describe("all'apertura del vault", () => {
  it("aspetta l'indice, mostra i passati fino ad adesso una volta, e legge il permesso", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    const life = openLifetime();
    let ready = false;
    const port = fakePort({ reminders: [call], more: false }, {
      indexed: vi.fn(async () => ready),
      notificationsOn: vi.fn(async () => false),
    });
    try {
      mountReminders(life, port);
      state.vaultRoot = "/vault";
      emit("vault", "/vault");
      await vi.waitFor(() => expect(port.indexed).toHaveBeenCalled());
      expect(port.ask).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(reminderNotificationsOn()).toBe(false));
      ready = true;
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(dialog()).not.toBeNull());
      expect(port.ask).toHaveBeenCalledWith("2026-11-18 10:00", 50);
      // Lo stesso vault riaperto non lo ripete.
      dialog()!.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
      await vi.waitFor(() => expect(dialog()).toBeNull());
      emit("vault", "/vault");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(port.ask).toHaveBeenCalledTimes(1);
    } finally {
      life.close();
    }
  });

  it("niente da dire, niente dialogo", async () => {
    const life = openLifetime();
    const port = fakePort({ reminders: [], more: false });
    try {
      mountReminders(life, port);
      state.vaultRoot = "/vuoto";
      emit("vault", "/vuoto");
      await vi.waitFor(() => expect(port.ask).toHaveBeenCalled());
      expect(dialog()).toBeNull();
    } finally {
      life.close();
    }
  });
});
