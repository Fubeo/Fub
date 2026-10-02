import { describe, expect, it } from "vitest";
import { classifyPointer, type RoleContext } from "./roles";

const calm: RoleContext = { touch: "auto", penSeen: false, penNear: false, touchesDown: 0 };

describe("ruoli dei puntatori", () => {
  it("la punta della penna disegna; tasto laterale e gomma no", () => {
    expect(classifyPointer({ pointerType: "pen", button: 0 }, calm)).toBe("ink");
    expect(classifyPointer({ pointerType: "pen", button: 2 }, calm)).toBe("ignore");
    expect(classifyPointer({ pointerType: "pen", button: 5 }, calm)).toBe("ignore");
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
});
