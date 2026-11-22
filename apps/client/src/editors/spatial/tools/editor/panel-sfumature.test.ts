// Le sfumature della selezione che il pannello dà alla sezione Sfumatura del Completo (K6 T15,
// giro 5): riempimento e contorno, un colore che nessuna parte mostra manca, un oggetto bloccato lo
// dice, e una selezione di soli testi pure.

import { describe, expect, it } from "vitest";
import { doc } from "../../scene/test-support";
import { LAYER, open } from "../test-support";
import { selectionGradients } from "./panel";

const DEFS =
  '<defs id="fub-defs"><linearGradient id="rg" fub:role="private" gradientUnits="userSpaceOnUse" x1="10" y1="30" x2="50" y2="30"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>';
const RECT = (id: string, extra: string): string => `<rect id="${id}" x="10" y="20" width="40" height="20"${extra}/>`;
const TEXT = '<text id="ot1t1t1t1" x="40" y="80" fill="#000000" font-family="Inter, sans-serif" font-size="32"><tspan x="40" dy="0">Ciao</tspan></text>';

function gradientsOf(body: string, keys: readonly string[]) {
  const opened = open(doc(`${DEFS}${LAYER}${body}</g>`));
  const units = opened.seen().filter((unit) => keys.includes(unit.key));
  expect(units).toHaveLength(keys.length);
  return selectionGradients(opened.engine.model!, units);
}

describe("le sfumature della selezione", () => {
  it("riempimento con la sfumatura, contorno pieno", () => {
    const g = gradientsOf(RECT("oa", ' fill="url(#rg)" stroke="#000000"'), ["oa"]);
    expect(g.fill).toMatchObject({ count: 1, gradients: 1, kind: "linear", angle: 0 });
    expect(g.stroke).toMatchObject({ count: 1, gradients: 0, kind: null });
    expect(g).toMatchObject({ locked: false, onlyText: false });
  });

  it("una forma senza contorno ha il contorno, un testo no", () => {
    const g = gradientsOf(RECT("oa", ' fill="#ff0000"'), ["oa"]);
    expect(g.fill).toMatchObject({ count: 1, gradients: 0 });
    // Una forma senza contorno lo mostra «nessuno»: la sfumatura glielo dà.
    expect(g.stroke).toMatchObject({ count: 1, gradients: 0 });
    expect(gradientsOf(TEXT, ["ot1t1t1t1"]).stroke).toBeUndefined();
  });

  it("un oggetto bloccato lo dice", () => {
    expect(gradientsOf(RECT("oa", ' fill="#ff0000" fub:locked="true"'), ["oa"]).locked).toBe(true);
  });

  it("soli testi lo dicono; un testo con una forma no", () => {
    expect(gradientsOf(TEXT, ["ot1t1t1t1"]).onlyText).toBe(true);
    expect(gradientsOf(`${TEXT}${RECT("oa", ' fill="#ff0000"')}`, ["ot1t1t1t1", "oa"]).onlyText).toBe(false);
  });
});
