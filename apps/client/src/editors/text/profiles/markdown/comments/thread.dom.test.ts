// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import { composerView, messageRow, when } from "./thread";
import { markLabel, stack } from "./margin";

// Il riquadro della discussione e il segno del margine, senza la vista: le
// ore come si leggono, chi ha scritto, il piede del primo messaggio.

afterEach(() => {
  document.body.innerHTML = "";
});

describe("quando", () => {
  const now = new Date(2026, 10, 9, 12, 0);
  it("oggi, ieri, un giorno dell'anno, un altro anno", () => {
    expect(when("2026-11-09 07:05", now)).toBe("oggi 7:05");
    expect(when("2026-11-08 17:40", now)).toBe("ieri 17:40");
    expect(when("2026-10-02 09:00", now)).toMatch(/^2 ott\S* 9:00$/);
    expect(when("2025-10-02", now)).toMatch(/2025/);
    expect(when("domani", now)).toBe("domani");
    expect(when(null, now)).toBe("");
  });
});

describe("un messaggio", () => {
  it("senza autore dice «Senza nome» e il pallino è neutro", () => {
    const row = messageRow({ author: null, date: null, text: "solo testo" });
    expect(row.querySelector("b")!.textContent).toBe("Senza nome");
    expect(row.querySelector<HTMLElement>(".cm-fub-comment-avatar")!.dataset.slot).toBe("0");
    expect(row.querySelector("p")!.textContent).toBe("solo testo");
  });
});

describe("il primo messaggio", () => {
  it("dice dove finisce nel file e come si invia; il pulsante aspetta il testo", () => {
    const life = openLifetime();
    const send = vi.fn();
    const view = composerView({ quote: "passo", note: null, askName: false, me: "Anna", send }, life);
    document.body.append(view.element);
    expect(view.element.querySelector(".cm-fub-comment-foot")!.textContent).toMatch(/^Nel file: \{==…==\}\{>>…<<\}.+invia$/);
    const button = view.element.querySelector<HTMLButtonElement>(".cm-fub-comment-send")!;
    expect(button.disabled).toBe(true);
    const input = view.element.querySelector<HTMLTextAreaElement>(".cm-fub-comment-input")!;
    input.value = "ciao";
    input.dispatchEvent(new Event("input"));
    expect(button.disabled).toBe(false);
    button.click();
    expect(send).toHaveBeenCalledWith("ciao", null);
    life.close();
  });
});

describe("il segno", () => {
  it("dice chi ha cominciato e quanti messaggi; due segni vicini non si coprono", () => {
    expect(markLabel({ author: "Anna", count: 3 })).toBe("Commento di Anna: 3 messaggi");
    expect(markLabel({ author: null, count: 1 })).toBe("Commento di Senza nome: 1 messaggio");
    expect(stack([10, 20, 100, 110])).toEqual([10, 42, 100, 132]);
  });
});
