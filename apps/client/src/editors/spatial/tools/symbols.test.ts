// I comandi dei simboli: le operazioni, che il motore le accetta così come
// sono, che ciò che si vede resta dove era, che gli agganci restano veri e
// che un annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { followConnectors } from "./connectors";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";
import { attrOf } from "./tip-support";
describe("i connettori e le istanze", () => {
  const LINKED = doc(
    '<defs id="fub-defs"><symbol id="r1" overflow="visible"><rect id="o1" x="-5" y="-5" width="10" height="10"/></symbol>'
      + '<symbol id="r2" overflow="visible"><use id="o2" transform="translate(0 0)" href="#r1"/></symbol></defs>'
      + `${LAYER}<use id="i1" transform="translate(100 50)" href="#r1"/><use id="i2" transform="translate(100 150) scale(2)" href="#r2"/>`
      + '<rect id="oc" x="200" y="45" width="10" height="10"/>'
      + '<path id="k1" fub:shape="connector" fub:geom="straight 105 50 200 50" fub:from="i1 right" fub:to="oc left" d="M105 50 L200 50" fill="none" stroke="#000000"/>'
      + '<path id="k2" fub:shape="connector" fub:geom="straight 110 150 200 50" fub:from="i2 right" fub:to="oc left" d="M110 150 L200 50" fill="none" stroke="#000000"/></g>',
  );
  const find = (opened: Opened) => (id: string) => opened.engine.holder(id);


  it("un connettore segue l'istanza quando cambia il contenuto del simbolo, anche attraverso un altro", () => {
    const opened = open(LINKED);
    expect(opened.engine.apply({ op: "set", id: "o1", attrs: { width: "20" } }).outcome).toBe("applied");
    const op = followConnectors(opened.engine.model!, new Set(["o1"]), find(opened), estimate);
    expect(op).not.toBeNull();
    expect(opened.engine.apply(op!).outcome).toBe("applied");
    expect(attrOf(opened, "k1", "d")).toBe("M115 50 L200 50");
    expect(attrOf(opened, "k2", "d")).toBe("M130 150 L200 50");
  });
});
