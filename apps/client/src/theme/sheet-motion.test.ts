// @vitest-environment happy-dom
//
// Il moto dentro il foglio (`skin/motion.css`): il prototipo della cornice
// anima dentro il foglio, la scrittura resta ferma. Le righe, il contenuto e
// la selezione non hanno transizioni né animazioni calcolate col moto pieno —
// è il punto in cui un ritardo si sentirebbe sotto le dita —, mentre la
// maniglia dei blocchi e le schede vive tengono le loro; col moto ridotto,
// del sistema o di Fub, dentro il foglio non si muove niente.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import skin from "./scrittoio/skin.css?raw";

/// Il foglio come lo costruiscono il pannello e CodeMirror, ridotto alle
/// parti che la regola nomina: una riga con un segno della sintassi, la
/// selezione, la maniglia dei blocchi e una scheda viva fra le righe.
const SHEET = `
  <div id="app">
    <div class="pane focus">
      <div class="pane-editor" data-markdown-mode="live_preview">
        <div class="cm-editor cm-focused">
          <div class="cm-scroller">
            <div class="cm-gutters"><div class="cm-gutterElement">1</div></div>
            <div class="cm-content">
              <div class="cm-line cm-activeLine">Testo <span class="cm-fub-strong">forte</span></div>
              <div class="live-card"></div>
              <div class="cm-line">Altra riga</div>
            </div>
            <div class="cm-selectionLayer"><div class="cm-selectionBackground"></div></div>
            <div class="cm-fub-block-handles" data-active="true">
              <button class="cm-fub-block-grip"><span class="cm-fub-block-grip-eyes"><svg></svg></span></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

/// Le parti della scrittura: niente moto, mai.
const WRITING = [".cm-content", ".cm-line", ".cm-line .cm-fub-strong", ".cm-selectionLayer", ".cm-selectionBackground", ".cm-gutterElement"];
/// Le parti copiate dal prototipo che si muovono col moto pieno.
const LIVING = [".cm-fub-block-grip", ".cm-fub-block-grip-eyes svg", ".live-card"];

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`manca «${selector}» nel foglio di prova`);
  return found;
}

/// Il moto che lo stile calcolato dà a un elemento: la transizione e
/// l'animazione, `none` se non c'è. happy-dom tiene la scorciatoia com'è
/// scritta e non la riparte nelle proprietà lunghe: si leggono tutte e due.
function motionOf(selector: string): { transition: string; animation: string } {
  const style = getComputedStyle(el(selector));
  const read = (short: string, long: string): string => {
    const text = (short || long).trim();
    return text === "" || text === "none" ? "none" : text;
  };
  return {
    transition: read(style.transition, style.transitionProperty && `${style.transitionProperty} ${style.transitionDuration}`),
    animation: read(style.animation, style.animationName),
  };
}

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = skin;
  document.head.append(style);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-motion");
  document.body.innerHTML = "";
});

describe("il moto dentro il foglio", () => {
  it("col moto pieno la scrittura non ha transizioni né animazioni", () => {
    document.body.innerHTML = SHEET;
    for (const selector of WRITING) {
      expect(motionOf(selector), selector).toEqual({ transition: "none", animation: "none" });
    }
  });

  it("col moto pieno le transizioni copiate dal prototipo vivono", () => {
    document.body.innerHTML = SHEET;
    for (const selector of LIVING) {
      expect(motionOf(selector).transition, selector).not.toBe("none");
    }
  });

  it("col moto ridotto dentro il foglio non si muove niente", () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    document.body.innerHTML = SHEET;
    for (const selector of [...WRITING, ...LIVING]) {
      expect(motionOf(selector), selector).toEqual({ transition: "none", animation: "none" });
    }
  });

  it("in Concentrazione le righe si attenuano piano, solo d'opacità", () => {
    document.body.innerHTML = SHEET;
    el("#app").setAttribute("data-focus-mode", "");
    expect(motionOf(".cm-line").transition).toBe("opacity 0.25s ease");
    expect(motionOf(".cm-line .cm-fub-strong").transition).toBe("none");
  });
});
