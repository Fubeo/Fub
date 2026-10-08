// Le punte delle linee attraverso i comandi che tagliano, uniscono, chiudono
// o combinano: ogni capo di ciò che esce prende la punta di un capo di ciò
// che entra, o nessuna, e lo scrive come attributo.

import { describe, expect, it } from "vitest";
import { bareAttrs, bareLook, keepTips, NO_TIPS, pooledTips, tipAttrs, tipName, tipRef } from "./endtips";

const own = (...pairs: Array<[string, string]>): ReadonlyMap<string, string> => new Map(pairs);

describe("i capi e i loro attributi", () => {
  it("ogni capo ha il suo attributo", () => {
    expect(tipName("start")).toBe("marker-start");
    expect(tipName("end")).toBe("marker-end");
  });

  it("il riferimento di un capo è quello che l'attributo scrive, soltanto se nomina una risorsa", () => {
    expect(tipRef(own(["marker-end", "url(#m1)"]), "end")).toBe("url(#m1)");
    expect(tipRef(own(["marker-end", "url(#m1)"]), "start")).toBeNull();
    expect(tipRef(own(["marker-start", "none"]), "start")).toBeNull();
    expect(tipRef(own(), "end")).toBeNull();
  });
});

describe("gli attributi che portano alle punte volute", () => {
  const both = own(["marker-start", "url(#a)"], ["marker-end", "url(#b)"]);

  it("le punte che ha già non cambiano niente", () => {
    expect(tipAttrs(both, { start: "start", end: "end" })).toEqual({});
    expect(tipAttrs(own(), NO_TIPS)).toEqual({});
    expect(tipAttrs(both, { start: { ref: "url(#a)" }, end: { ref: "url(#b)" } })).toEqual({});
  });

  it("nessuna punta toglie solo l'attributo che c'è", () => {
    expect(tipAttrs(both, NO_TIPS)).toEqual({ "marker-start": null, "marker-end": null });
    expect(tipAttrs(own(["marker-end", "url(#b)"]), NO_TIPS)).toEqual({ "marker-end": null });
  });

  it("la punta di un altro capo della stessa parte copia il suo riferimento", () => {
    expect(tipAttrs(both, { start: "end", end: "start" })).toEqual({ "marker-start": "url(#b)", "marker-end": "url(#a)" });
    // Un capo senza punta non ne dà: l'altro la perde.
    expect(tipAttrs(own(["marker-end", "url(#b)"]), { start: "start", end: "start" })).toEqual({ "marker-end": null });
  });

  it("il riferimento di un'altra parte si scrive com'è", () => {
    expect(tipAttrs(own(), { start: null, end: { ref: "url(#z)" } })).toEqual({ "marker-end": "url(#z)" });
    expect(tipAttrs(both, { start: "start", end: { ref: "url(#z)" } })).toEqual({ "marker-end": "url(#z)" });
  });
});

describe("le punte di parti unite in una", () => {
  const others = [own(["marker-start", "url(#x)"], ["marker-end", "url(#y)"]), own()];

  it("la parte stessa dà il suo capo; un'altra, il suo riferimento", () => {
    expect(pooledTips(others, { start: { owner: 0, end: "end" }, end: { owner: 1, end: "end" } })).toEqual({ start: "end", end: { ref: "url(#y)" } });
    expect(pooledTips(others, { start: { owner: 1, end: "start" }, end: { owner: 2, end: "start" } })).toEqual({ start: { ref: "url(#x)" }, end: null });
  });

  it("senza capo di partenza, nessuna punta", () => {
    expect(pooledTips(others, { start: null, end: null })).toEqual(NO_TIPS);
  });
});

describe("l'aspetto di un pezzo che le sta accanto", () => {
  const look = { fill: "none", stroke: "#000000", "marker-start": "url(#a)", "marker-mid": "url(#m)", "marker-end": "url(#b)" };

  it("tiene le punte dei capi che dice, e marker-mid sempre", () => {
    expect(keepTips(look, { start: true, end: false })).toEqual({ fill: "none", stroke: "#000000", "marker-start": "url(#a)", "marker-mid": "url(#m)" });
    expect(keepTips(look, { start: false, end: true })).toEqual({ fill: "none", stroke: "#000000", "marker-mid": "url(#m)", "marker-end": "url(#b)" });
    expect(keepTips(look, { start: true, end: true })).toEqual(look);
  });

  it("una regione non ha marcatori", () => {
    expect(bareLook(look)).toEqual({ fill: "none", stroke: "#000000" });
    expect(bareAttrs(new Map(Object.entries(look)))).toEqual({ "marker-start": null, "marker-mid": null, "marker-end": null });
    expect(bareAttrs(own(["fill", "none"]))).toEqual({});
  });
});
