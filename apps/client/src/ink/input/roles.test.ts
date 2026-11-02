import { describe, expect, it } from "vitest";
import { classifyPointer, type MousePolicy, type RoleContext } from "./roles";

const calm: RoleContext = { touch: "auto", mouse: "ink", penSeen: false, penNear: false, touchesDown: 0 };

describe("ruoli dei puntatori", () => {
  it("la punta della penna disegna, la gomma cancella, il tasto laterale sceglie", () => {
    expect(classifyPointer({ pointerType: "pen", button: 0 }, calm)).toBe("ink");
    expect(classifyPointer({ pointerType: "pen", button: 2 }, calm)).toBe("barrel");
    expect(classifyPointer({ pointerType: "pen", button: 5 }, calm)).toBe("erase");
    expect(classifyPointer({ pointerType: "pen", button: 3 }, calm)).toBe("ignore");
  });

  it("il mouse disegna col tasto principale e muove la vista con quello centrale", () => {
    expect(classifyPointer({ pointerType: "mouse", button: 0 }, calm)).toBe("ink");
    expect(classifyPointer({ pointerType: "mouse", button: 1 }, calm)).toBe("navigate");
    expect(classifyPointer({ pointerType: "mouse", button: 2 }, calm)).toBe("ignore");
    expect(classifyPointer({ pointerType: "", button: 0 }, calm)).toBe("ink");
  });

  it("un dito disegna finché non si è vista una penna, poi muove la vista", () => {
    expect(classifyPointer({ pointerType: "touch", button: 0 }, calm)).toBe("ink");
    expect(classifyPointer({ pointerType: "touch", button: 0 }, { ...calm, penSeen: true })).toBe("navigate");
  });

  it("la politica del tocco sceglie quando nessuna penna è vicina", () => {
    expect(classifyPointer({ pointerType: "touch", button: 0 }, { ...calm, touch: "ink", penSeen: true })).toBe("ink");
    expect(classifyPointer({ pointerType: "touch", button: 0 }, { ...calm, touch: "navigate" })).toBe("navigate");
  });

  it("un dito con la penna vicina è palmo, qualunque sia la politica", () => {
    for (const touch of ["auto", "ink", "navigate"] as const) {
      expect(classifyPointer({ pointerType: "touch", button: 0 }, { ...calm, touch, penNear: true })).toBe("ignore");
    }
  });

  it("un secondo dito fa un gesto di navigazione", () => {
    expect(classifyPointer({ pointerType: "touch", button: 0 }, { ...calm, touch: "ink", touchesDown: 1 })).toBe("navigate");
  });

  it("con la politica `ignore` il tasto principale del mouse non fa niente, il centrale muove la vista", () => {
    const ignore: RoleContext = { ...calm, mouse: "ignore" };
    expect(classifyPointer({ pointerType: "mouse", button: 0 }, ignore)).toBe("ignore");
    expect(classifyPointer({ pointerType: "mouse", button: 1 }, ignore)).toBe("navigate");
    for (const button of [2, 3, 4, 5]) expect(classifyPointer({ pointerType: "mouse", button }, ignore)).toBe("ignore");
    // Un tipo che il motore non sa dire segue il mouse: con `ignore` non scrive.
    expect(classifyPointer({ pointerType: "", button: 0 }, ignore)).toBe("ignore");
    expect(classifyPointer({ pointerType: "", button: 1 }, ignore)).toBe("navigate");
  });

  it("la politica di serie del mouse dà i ruoli di sempre", () => {
    // La tabella di prima della politica del mouse, scritta a mano.
    const table: [string, number, string][] = [
      ["mouse", 0, "ink"], ["mouse", 1, "navigate"], ["mouse", 2, "ignore"], ["mouse", 3, "ignore"], ["mouse", 5, "ignore"],
      ["", 0, "ink"], ["", 1, "navigate"], ["", 2, "ignore"],
      ["pen", 0, "ink"], ["pen", 1, "ignore"], ["pen", 2, "barrel"], ["pen", 3, "ignore"], ["pen", 5, "erase"],
      ["touch", 0, "ink"],
    ];
    for (const [pointerType, button, want] of table) {
      expect(classifyPointer({ pointerType, button }, calm), `${pointerType} ${button}`).toBe(want);
    }
  });

  it("la politica del mouse non cambia la penna e il dito", () => {
    for (const touch of ["auto", "ink", "navigate"] as const) {
      for (const penSeen of [false, true]) {
        for (const penNear of [false, true]) {
          for (const touchesDown of [0, 1, 2]) {
            const roles = (mouse: MousePolicy): string[] =>
              ["pen", "touch"].flatMap((pointerType) =>
                [0, 1, 2, 3, 5].map((button) =>
                  classifyPointer({ pointerType, button }, { touch, mouse, penSeen, penNear, touchesDown })));
            expect(roles("ignore")).toEqual(roles("ink"));
          }
        }
      }
    }
  });
});
