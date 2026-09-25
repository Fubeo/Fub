import { describe, expect, it } from "vitest";

import { COMPONENTS, HOOKS, STATE_NAMES, unassignedHooks } from "./anatomia";

const skinParts = import.meta.glob("./skin/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const shellSources = import.meta.glob(["../../**/*.ts", "!../../**/*.test.ts", "../../../index.html"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/// Attributi scritti dai renderer Rust (HTML reso), non dalla shell.
const RENDERED_ATTRIBUTES = new Set(["embed-url", "embed-path"]);

function selectorClasses(): Set<string> {
  const classes = new Set<string>();
  for (const css of Object.values(skinParts)) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of withoutComments.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(match[1]!);
  }
  return classes;
}

describe("anatomia chiusa della shell", () => {
  it("mantiene il vocabolario degli hook nei due versi", () => {
    const css = selectorClasses();
    expect([...HOOKS].sort()).toEqual([...css].sort());
    expect(unassignedHooks()).toEqual([]);
    for (const component of COMPONENTS) {
      for (const hook of component.hooks) expect(HOOKS).toContain(hook);
    }
  });

  it("veste soltanto attributi data-* che qualcuno scrive", () => {
    const css = Object.values(skinParts).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const source = Object.values(shellSources).join("\n");
    const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const orphans = [...new Set([...css.matchAll(/\[data-([a-z0-9-]+)/g)].map((m) => m[1]!))]
      .filter((name) => !RENDERED_ATTRIBUTES.has(name))
      .filter((name) =>
        !source.includes(`data-${name}`) && !source.includes(`dataset.${camel(name)}`) &&
        !source.includes(`"${camel(name)}"`)
      );
    expect(orphans).toEqual([]);
  });

  it("ha stati ammessi e almeno un componente per ciascuno", () => {
    const names = new Set(COMPONENTS.flatMap((component) => component.states.map((state) => state.name)));
    expect([...names].sort()).toEqual([...STATE_NAMES].sort());
    for (const component of COMPONENTS) expect(component.states.length).toBeGreaterThan(0);
  });

  it("non duplica o svuota componenti", () => {
    const names = COMPONENTS.map((component) => component.name);
    expect(new Set(names).size).toBe(names.length);
    expect(COMPONENTS.length).toBeGreaterThan(0);
    for (const component of COMPONENTS) expect(component.hooks.length).toBeGreaterThan(0);
  });
});
