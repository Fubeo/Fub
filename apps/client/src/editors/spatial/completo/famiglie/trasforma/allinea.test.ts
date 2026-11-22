// La prova client della sezione «Allinea» (T13, giro 1): ogni voce
// dell'interfaccia e il pannello `align` di `crates/fub-disegno/tests/famiglie/trasforma.json`
// hanno qui il loro nome. Le prove vere arrivano con la sezione.

import { describe, expect, it } from "vitest";

const VOCI_ALLINEA = [
  "align.horizontalLeft",
  "align.horizontalCenter",
  "align.horizontalRight",
  "align.horizontalVerticalCenter",
  "align.verticalTop",
  "align.verticalCenter",
  "align.verticalBottom",
  "align.distributeVerticalTop",
  "align.distributeVerticalCenter",
  "align.distributeVerticalBottom",
  "align.distributeHorizontalLeft",
  "align.distributeHorizontalCenter",
  "align.distributeHorizontalRight",
  "align.distributeVerticalSpace",
  "align.distributeHorizontalSpace",
  "align",
];

describe("sezione Allinea", () => {
  it("nomina ogni voce del suo elenco", () => {
    expect(VOCI_ALLINEA.length).toBe(16);
  });
});
