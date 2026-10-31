import { describe, expect, it } from "vitest";
import type { CommandOutcome } from "../host/contract";
import { cardOf, readDone, readOutcome } from "./link-cards";

const url = "https://esempio.it/";
const card = { version: 1, url, title: "T", description: "D", site: "esempio.it", icon: "" };

function outcome(effect: CommandOutcome["effect"]): CommandOutcome {
  return { notify: null, effect, undo: null } as CommandOutcome;
}

describe("le schede dei collegamenti (K8)", () => {
  it("legge la scheda soltanto se è di quell'indirizzo", () => {
    expect(cardOf(card, url)?.title).toBe("T");
    expect(cardOf({ ...card, url: "https://altro.it/" }, url)).toBeNull();
    expect(cardOf(null, url)).toBeNull();
  });

  it("legge l'effetto del comando: cache, download partito o niente", () => {
    expect(readOutcome(outcome({ kind: "custom", ns: "fub.linkcard", payload: { url, card, pending: false } }), url).kind).toBe("card");
    expect(readOutcome(outcome({ kind: "custom", ns: "fub.linkcard", payload: { url, card: null, pending: true } }), url).kind).toBe("loading");
    expect(readOutcome(outcome({ kind: "custom", ns: "fub.linkcard", payload: { url, card: null, pending: false } }), url).kind).toBe("bare");
    expect(readOutcome(outcome({ kind: "custom", ns: "altro", payload: { url, card } }), url).kind).toBe("bare");
    expect(readOutcome(outcome({ kind: "done" }), url).kind).toBe("bare");
  });

  it("legge l'esito del job, riuscito o no, nella lingua di chi guarda", () => {
    expect(readDone({ Ok: { url, card, cached: false } })).toEqual({ url, view: { kind: "card", card: { url, title: "T", description: "D", site: "esempio.it", icon: "" } } });
    const failed = readDone({ Ok: { url, failed: "status", status: 404 } });
    expect(failed?.view.kind).toBe("failed");
    expect(failed?.view.kind === "failed" && failed.view.reason).toContain("404");
    expect(readDone({ Ok: { url, card: null } })?.view.kind).toBe("bare");
    expect(readDone({ Err: { kind: "permission_denied", message: "no" } })).toBeNull();
  });
});
