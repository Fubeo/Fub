// Gli aiuti dei test dell'indice degli oggetti (`hit*.test.ts`): una scena
// con forme, gruppi e livelli bloccati e nascosti, un riquadro e il
// contenitore di un id.

import type { Bounds } from "../../scene/geometry";
import { doc } from "../../scene/test-support";
import type { ContainerNode } from "../../scene/model";
import { LAYER, open } from "../test-support";

export const SHAPES = doc(
  `<title>Prova</title><rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#ffffff"/>${LAYER}`
    + '<rect id="r" x="10" y="10" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>'
    + '<circle id="c" cx="70" cy="70" r="10" fill="#000000"/>'
    + '<g id="g" transform="translate(50 0)"><rect id="gr" x="0" y="0" width="10" height="10"/></g>'
    + '<line x1="0" y1="90" x2="40" y2="90" stroke="#000000" stroke-width="2"/>'
    + '<rect id="off" x="0" y="0" width="5" height="5" display="none"/>'
    + '</g><g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="locked" x="0" y="0" width="100" height="100"/></g>'
    + '<g id="l3" fub:layer="Nascosto" display="none"><rect id="hidden" x="0" y="0" width="100" height="100"/></g>'
    + '<circle id="loose" cx="95" cy="5" r="2"/>',
);

export const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: [x0, y0], max: [x1, y1] });
export const container = (opened: ReturnType<typeof open>, id: string): ContainerNode => opened.engine.holder(id) as ContainerNode;
