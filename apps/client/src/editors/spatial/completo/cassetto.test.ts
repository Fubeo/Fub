// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { apriErroreCassetto } from "./index";

describe("il cassetto che non si apre", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dice che non si è aperto e «Riprova» lo chiede di nuovo", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const life = openLifetime();
    const riprova = vi.fn();
    apriErroreCassetto(anchor, life, riprova);
    const messaggio = document.querySelector<HTMLElement>(".draw-drawer-failed")!;
    expect(messaggio.textContent).toContain("Il cassetto non si è aperto");
    expect(messaggio.querySelector("[role=alert]")).not.toBeNull();
    messaggio.querySelector<HTMLButtonElement>("button")!.click();
    expect(riprova).toHaveBeenCalledTimes(1);
    life.close();
  });
});
