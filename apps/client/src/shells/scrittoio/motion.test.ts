// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const moto = vi.hoisted(() => ({
  invalidated: 0,
  levelListeners: new Set<() => void>(),
}));

vi.mock("../../moto", () => ({
  invalidateSpringTokens: () => {
    moto.invalidated += 1;
  },
  onMotionLevelChange: (listener: () => void) => {
    moto.levelListeners.add(listener);
    return () => moto.levelListeners.delete(listener);
  },
}));

import { emit } from "../../state/store";
import { openLifetime } from "../../ui/lifetime";
import { mountMotion } from "./motion";

beforeEach(() => {
  moto.invalidated = 0;
  moto.levelListeners.clear();
});

describe("il movimento della shell", () => {
  it("tiene acceso l'ascolto del livello di moto quanto la shell", () => {
    const life = openLifetime();
    mountMotion(life);
    expect(moto.levelListeners.size).toBe(1);
    life.close();
    expect(moto.levelListeners.size).toBe(0);
  });

  it("cambiato il tema montato, le molle si rileggono; smontata, non più", () => {
    const life = openLifetime();
    mountMotion(life);
    emit("theme");
    emit("theme");
    expect(moto.invalidated).toBe(2);
    life.close();
    emit("theme");
    expect(moto.invalidated).toBe(2);
  });
});
