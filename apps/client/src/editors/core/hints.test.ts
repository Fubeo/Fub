// La porta dei suggerimenti: quale fonte vince, chi viene avvisato e quando
// smette di esserlo. La riga che la disegna ha i suoi test in
// `shells/scrittoio/frame/hints-row.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";

import { currentHints, type HintContext, onHintsChanged, openHintSource, resetHintSources } from "./hints";

const context = (id: string): HintContext => ({ id, items: [{ keys: ["/"], say: id }] });

afterEach(() => resetHintSources());

describe("la porta dei suggerimenti", () => {
  it("vince la fonte più recente che ha qualcosa da dire", () => {
    let secondSays: HintContext | null = context("seconda");
    openHintSource(() => context("prima"));
    openHintSource(() => secondSays);
    expect(currentHints()?.id).toBe("seconda");
    secondSays = null;
    expect(currentHints()?.id).toBe("prima");
  });

  it("changed(true) porta in cima chi ha preso il fuoco; close la toglie", () => {
    const first = openHintSource(() => context("prima"));
    const second = openHintSource(() => context("seconda"));
    first.changed(true);
    expect(currentHints()?.id).toBe("prima");
    first.close();
    expect(currentHints()?.id).toBe("seconda");
    second.close();
    expect(currentHints()).toBeNull();
  });

  it("avvisa chi ascolta a ogni cambiamento, e smette col disabbonamento", () => {
    const listener = vi.fn();
    const stop = onHintsChanged(listener);
    const source = openHintSource(() => null);
    source.changed();
    source.changed(true);
    source.close();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    openHintSource(() => null).changed();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("una fonte chiusa non avvisa più e non legge più", () => {
    const listener = vi.fn();
    onHintsChanged(listener);
    const read = vi.fn(() => context("chiusa"));
    const source = openHintSource(read);
    source.close();
    source.changed();
    source.close();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(currentHints()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
