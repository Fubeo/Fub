// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentSurfaceRegistry,
  isModefulSurface,
  surfaceModeId,
  textualFallbackFactory,
  type EditorSurface,
  type MountedSurface,
  type ResolvedSurface,
  type SurfaceFactory,
  type SurfaceOverride,
  type SurfaceRegistration,
  type SurfaceViewState,
} from "./registry";

type DestroySpy = {
  calls: number;
  destroy(): void;
};

type ExtendedSurface = EditorSurface & {
  in(value: string): boolean;
  has(value: string): boolean;
  get(value: string): DestroySpy | undefined;
};

type SurfaceFixture = {
  factory: SurfaceFactory;
  mounts: ExtendedSurface[];
  destroys: DestroySpy[];
};

type SurfaceFixtureOptions = {
  readonly destroyErrors?: readonly unknown[];
};

function surfaceFixture(
  label: string,
  family = "text",
  profile = label,
  options: SurfaceFixtureOptions = {},
): SurfaceFixture {
  const mounts: ExtendedSurface[] = [];
  const destroys: DestroySpy[] = [];
  const factory: SurfaceFactory = {
    family,
    profile,
    supportedVersions: [1],
    mount(_request, context) {
      const element = context.parent.ownerDocument.createElement("div");
      element.dataset.testFactory = label;
      element.textContent = label;
      context.parent.appendChild(element);
      const mountIndex = mounts.length;
      const destroy: DestroySpy = {
        calls: 0,
        destroy() {
          destroy.calls += 1;
          element.remove();
          const error = options.destroyErrors?.[mountIndex];
          if (error !== undefined) throw error;
        },
      };
      const surface: ExtendedSurface = {
        family,
        surfaceId: `${label}-${mountIndex + 1}`,
        focus() {},
        setReadOnly() {},
        setTheme() {},
        captureViewState() {
          return { version: 1, value: null };
        },
        restoreViewState() {},
        suspend() {},
        resume() {},
        in(value: string) {
          return value === label;
        },
        has(value: string) {
          return value === label;
        },
        get(value: string) {
          return value === label ? destroy : undefined;
        },
        destroy: destroy.destroy,
      };
      mounts.push(surface);
      destroys.push(destroy);
      return surface;
    },
  };
  return { factory, mounts, destroys };
}

type ReentrantUnregisterFixture = SurfaceFixture & {
  captureDisposer(disposer: () => void): void;
};

function reentrantUnregisterFixture(
  label: string,
  options: SurfaceFixtureOptions = {},
): ReentrantUnregisterFixture {
  const fixture = surfaceFixture(label, "text", label, options);
  let disposer: (() => void) | undefined;
  const factory: SurfaceFactory = {
    ...fixture.factory,
    mount(request, context) {
      const surface = fixture.factory.mount(request, context);
      disposer?.();
      return surface;
    },
  };
  return {
    ...fixture,
    factory,
    captureDisposer(value) {
      disposer = value;
    },
  };
}

type PrivateSurface = EditorSurface & {
  label: string;
  describe(value: string): string;
};

class PrivateSurfaceImpl implements EditorSurface {
  readonly family: string;
  readonly surfaceId: string;
  #label: string;
  #destroySpy: DestroySpy;

  constructor(family: string, surfaceId: string, label: string, destroySpy: DestroySpy) {
    this.family = family;
    this.surfaceId = surfaceId;
    this.#label = label;
    this.#destroySpy = destroySpy;
  }

  #format(value: string): string {
    return `${this.#label}:${value}`;
  }

  get label(): string {
    return this.#label;
  }

  set label(value: string) {
    this.#label = value;
  }

  focus(): void {}
  setReadOnly(_readOnly: boolean): void {}
  setTheme(_theme: unknown): void {}

  captureViewState(): SurfaceViewState {
    return { version: 1, value: null };
  }

  restoreViewState(_state: SurfaceViewState): void {}
  suspend(): void {}
  resume(): void {}

  describe(value: string): string {
    return this.#format(value);
  }

  destroy(): void {
    this.#destroySpy.destroy();
  }
}

type PrivateSurfaceFixture = {
  factory: SurfaceFactory;
  mounts: PrivateSurfaceImpl[];
  destroys: DestroySpy[];
};

function privateSurfaceFixture(label: string): PrivateSurfaceFixture {
  const mounts: PrivateSurfaceImpl[] = [];
  const destroys: DestroySpy[] = [];
  const factory: SurfaceFactory = {
    family: "text",
    profile: label,
    supportedVersions: [1],
    mount() {
      const mountIndex = mounts.length;
      const destroy: DestroySpy = {
        calls: 0,
        destroy() {
          destroy.calls += 1;
        },
      };
      const surface = new PrivateSurfaceImpl(
        "text",
        `${label}-${mountIndex + 1}`,
        label,
        destroy,
      );
      mounts.push(surface);
      destroys.push(destroy);
      return surface;
    },
  };
  return { factory, mounts, destroys };
}

function mountContext(): { paneId: string; documentId: string; parent: HTMLElement } {
  return {
    paneId: "pane-1",
    documentId: "document-1",
    parent: document.createElement("section"),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isModefulSurface", () => {
  it("accetta cataloghi propri della superficie e lascia commutare i loro ID", () => {
    const modes = [
      { id: surfaceModeId("navigate"), labelKey: "mode.navigate" },
      { id: surfaceModeId("edit"), labelKey: "mode.edit" },
    ] as const;
    let current: (typeof modes)[number]["id"] = modes[0].id;
    const surface = {
      modes,
      defaultMode: modes[0].id,
      mode: () => current,
      setMode(id: (typeof modes)[number]["id"]) {
        if (modes.some((mode) => mode.id === id)) current = id;
      },
    };

    expect(isModefulSurface(surface)).toBe(true);
    surface.setMode(modes[1].id);
    expect(surface.mode()).toBe("edit");
  });

  it("rifiuta ID duplicati o vuoti, default e corrente fuori catalogo", () => {
    expect(
      isModefulSurface({
        modes: [
          { id: "source", labelKey: "mode.source" },
          { id: "source", labelKey: "mode.source-again" },
        ],
        defaultMode: "source",
        mode: () => "source",
        setMode: () => {},
      }),
    ).toBe(false);
    expect(
      isModefulSurface({
        modes: [{ id: "", labelKey: "mode.empty" }],
        defaultMode: "",
        mode: () => "",
        setMode: () => {},
      }),
    ).toBe(false);
    expect(
      isModefulSurface({
        modes: [{ id: "source", labelKey: "mode.source" }],
        defaultMode: "live_preview",
        mode: () => "source",
        setMode: () => {},
      }),
    ).toBe(false);
    expect(
      isModefulSurface({
        modes: [{ id: "source", labelKey: "mode.source" }],
        defaultMode: "source",
        mode: () => "reading",
        setMode: () => {},
      }),
    ).toBe(false);
  });

  it("rifiuta metodi mancanti o un current mode che fallisce", () => {
    expect(
      isModefulSurface({
        modes: [{ id: "source", labelKey: "mode.source" }],
        defaultMode: "source",
        mode: () => "source",
      }),
    ).toBe(false);
    expect(
      isModefulSurface({
        modes: [{ id: "source", labelKey: "mode.source" }],
        defaultMode: "source",
        mode: () => {
          throw new Error("surface unavailable");
        },
        setMode: () => {},
      }),
    ).toBe(false);
  });
});

describe("DocumentSurfaceRegistry", () => {
  it("registra, seleziona e monta la factory del binding", () => {
    const registry = new DocumentSurfaceRegistry();
    const markdown = surfaceFixture("markdown");
    const dispose = registry.register({
      owner: "markdown-bundle",
      family: "text",
      profile: "markdown",
      formatKey: "markdown",
      species: "text/markdown",
      factory: markdown.factory,
    });
    const request = {
      family: "text",
      profile: "markdown",
      formatKey: "markdown",
      species: "text/markdown",
    };
    const context = mountContext();

    expect(dispose).toEqual(expect.any(Function));
    const selected = registry.select(request);
    expect(selected.key).toMatch(/^registration:/);
    const mounted = registry.mount(request, context);
    expect(mounted.key).toBe(selected.key);
    expect(mounted.surface).not.toBe(markdown.mounts[0]);
    expect(mounted.surface.family).toBe(markdown.mounts[0].family);
    expect(context.parent.querySelector('[data-test-factory="markdown"]')).not.toBeNull();
    mounted.surface.destroy();
    expect(markdown.destroys[0].calls).toBe(1);

    dispose();
  });
  it("rimonta la selezione corrente dopo che quella osservata è stata sostituita", () => {
    const registry = new DocumentSurfaceRegistry();
    const request = { formatKey: "replaced-format" };
    const a = surfaceFixture("a", "text", "profile-a");
    const disposeA = registry.register({
      owner: "owner-a",
      family: "text",
      profile: "profile-a",
      formatKey: request.formatKey,
      factory: a.factory,
    });
    const selectedA = registry.select(request);

    disposeA();
    const b = surfaceFixture("b", "text", "profile-b");
    const disposeB = registry.register({
      owner: "owner-b",
      family: "text",
      profile: "profile-b",
      formatKey: request.formatKey,
      factory: b.factory,
    });
    const selectedB = registry.select(request);
    const mounted = registry.mount(request, mountContext());

    expect(selectedB.key).not.toBe(selectedA.key);
    expect(mounted.key).toBe(selectedB.key);
    expect(mounted.surface.surfaceId).toBe("b-1");
    expect(a.mounts).toHaveLength(0);
    expect(b.mounts).toHaveLength(1);

    mounted.surface.destroy();
    disposeB();
  });
  it("espone dalla selezione solo la key e dal mount key e superficie gestita", () => {
    const registry = new DocumentSurfaceRegistry();
    const fixture = surfaceFixture("contract");
    registry.register({
      owner: "contract-owner",
      family: "text",
      profile: "contract",
      formatKey: "contract-format",
      factory: fixture.factory,
    });

    const selected: ResolvedSurface = registry.select({ formatKey: "contract-format" });
    type SelectionHasOnlyKey = Exclude<keyof ResolvedSurface, "key"> extends never
      ? true
      : false;
    const selectionHasOnlyKey: SelectionHasOnlyKey = true;
    expect(selectionHasOnlyKey).toBe(true);
    expect(Object.getOwnPropertyNames(selected)).toEqual(["key"]);
    expect(selected).not.toHaveProperty("factory");
    expect(selected).not.toHaveProperty("mount");
    expect("factory" in selected).toBe(false);
    expect("mount" in selected).toBe(false);

    const context = mountContext();
    const mounted: MountedSurface = registry.mount({ formatKey: "contract-format" }, context);
    type MountHasOnlyKeyAndSurface = Exclude<
      keyof MountedSurface,
      "key" | "surface"
    > extends never
      ? true
      : false;
    const mountHasOnlyKeyAndSurface: MountHasOnlyKeyAndSurface = true;
    expect(mountHasOnlyKeyAndSurface).toBe(true);
    expect(Object.getOwnPropertyNames(mounted)).toEqual(["key", "surface"]);
    expect(mounted.key).toBe(selected.key);
    expect(mounted).not.toHaveProperty("factory");
    expect(mounted).not.toHaveProperty("mount");
    expect(fixture.mounts).toHaveLength(1);
    expect(context.parent.querySelector('[data-test-factory="contract"]')).not.toBeNull();
    mounted.surface.destroy();
  });
  it("assegna una key distinta a ogni registrazione e rende ambigua la sola coppia family/profile", () => {
    const registry = new DocumentSurfaceRegistry();
    const markdownA = surfaceFixture("markdown-a", "text", "markdown");
    const markdownB = surfaceFixture("markdown-b", "text", "markdown");
    registry.register({
      owner: "owner-a",
      family: "text",
      profile: "markdown",
      formatKey: "format-a",
      species: "text/markdown-a",
      factory: markdownA.factory,
    });
    registry.register({
      owner: "owner-b",
      family: "text",
      profile: "markdown",
      formatKey: "format-b",
      species: "text/markdown-b",
      factory: markdownB.factory,
    });

    const selectedA = registry.select({ formatKey: "format-a" });
    const selectedB = registry.select({ formatKey: "format-b" });
    expect(selectedA.key).toMatch(/^registration:/);
    expect(selectedB.key).toMatch(/^registration:/);
    expect(selectedA.key).not.toBe(selectedB.key);

    const contextA = mountContext();
    const mountedA = registry.mount({ formatKey: "format-a" }, contextA).surface;
    expect(contextA.parent.querySelector('[data-test-factory="markdown-a"]')).not.toBeNull();
    mountedA.destroy();
    const contextB = mountContext();
    const mountedB = registry.mount({ formatKey: "format-b" }, contextB).surface;
    expect(contextB.parent.querySelector('[data-test-factory="markdown-b"]')).not.toBeNull();
    mountedB.destroy();

    const ambiguous = registry.select({ family: "text", profile: "markdown" });
    expect(ambiguous.key).toMatch(/^builtin:error:/);
    const context = mountContext();
    const surface = registry.mount({ family: "text", profile: "markdown" }, context).surface;
    expect(context.parent.textContent).toContain("owner-a");
    expect(context.parent.textContent).toContain("owner-b");
    surface.destroy();
  });

  it("mantiene key stabili e distinte per fallback, viewer ed errori", () => {
    const registry = new DocumentSurfaceRegistry();
    const fallback = registry.select({ family: "text", profile: "missing" });
    expect(fallback.key).toBe("builtin:text-fallback");
    expect(registry.select({ family: "text", profile: "missing" }).key).toBe(
      fallback.key,
    );

    const viewer = registry.select({ species: "bytes" });
    expect(viewer.key).toBe("builtin:byte-viewer");
    expect(viewer.key).not.toBe(fallback.key);

    const unknown = registry.select({ family: "future" });
    const otherUnknown = registry.select({ family: "other-future" });
    expect(unknown.key).toMatch(/^builtin:error:/);
    expect(otherUnknown.key).toMatch(/^builtin:error:/);
    expect(unknown.key).not.toBe(otherUnknown.key);
  });

  it("riconosce le superfici modeful senza allargare EditorSurface", () => {
    const registry = new DocumentSurfaceRegistry();
    const plain = surfaceFixture("plain");
    registry.register({
      owner: "plain",
      family: "text",
      profile: "plain",
      factory: plain.factory,
    });
    const mounted = registry.mount({ family: "text", profile: "plain" }, mountContext()).surface;
    expect(isModefulSurface(mounted)).toBe(false);
    expect(mounted).not.toHaveProperty("modes");
    expect(mounted).not.toHaveProperty("defaultMode");
    expect(mounted).not.toHaveProperty("mode");
    expect(mounted).not.toHaveProperty("setMode");
    expect(mounted).not.toHaveProperty("live_preview");

    const modeful = {
      ...mounted,
      modes: [{ id: "source", labelKey: "mode.source" }],
      defaultMode: "source",
      mode: () => "source",
      setMode: () => {},
    };
    expect(isModefulSurface(modeful)).toBe(true);
    mounted.destroy();
  });

  it("non rende modeful fallback, viewer ed errori", () => {
    const registry = new DocumentSurfaceRegistry();
    const fallback = registry.mount({ family: "text", profile: "missing" }, mountContext()).surface;
    const viewer = registry.mount({ species: "bytes" }, mountContext()).surface;
    const error = registry.mount({ family: "unknown" }, mountContext()).surface;

    for (const surface of [fallback, viewer, error]) {
      expect(isModefulSurface(surface)).toBe(false);
      expect(surface).not.toHaveProperty("modes");
      expect(surface).not.toHaveProperty("defaultMode");
      expect(surface).not.toHaveProperty("mode");
      expect(surface).not.toHaveProperty("setMode");
    }

    fallback.destroy();
    viewer.destroy();
    error.destroy();
  });

  it("mantiene la stessa key tra binding esatto e override della registrazione", () => {
    const registry = new DocumentSurfaceRegistry();
    const registrationA: SurfaceRegistration = {
      owner: "owner-a",
      family: "text",
      profile: "markdown",
      formatKey: "format-a",
      species: "text/markdown-a",
      factory: surfaceFixture("a", "text", "markdown").factory,
    };
    const registrationB: SurfaceRegistration = {
      owner: "owner-b",
      family: "text",
      profile: "markdown",
      formatKey: "format-b",
      species: "text/markdown-b",
      factory: surfaceFixture("b", "text", "markdown").factory,
    };
    registry.register(registrationA);
    registry.register(registrationB);

    const exactA = registry.select({ formatKey: "format-a" });
    const exactB = registry.select({ formatKey: "format-b" });
    const overrideA = registry.select({
      override: {
        kind: "registration",
        registrationId: registrationA.registrationId as string,
      },
    });
    const overrideB = registry.select({
      override: {
        kind: "registration",
        registrationId: registrationB.registrationId as string,
      },
    });

    expect(overrideA.key).toBe(exactA.key);
    expect(overrideB.key).toBe(exactB.key);
    expect(exactA.key).not.toBe(exactB.key);
  });

  it("passa da registrazione a fallback e ritorna alla registrazione con key nuove", () => {
    const registry = new DocumentSurfaceRegistry();
    const first = surfaceFixture("first", "text", "markdown");
    const request = {
      family: "text",
      profile: "markdown",
      formatKey: "format-reused",
    };
    const registration: SurfaceRegistration = {
      owner: "owner-first",
      family: "text",
      profile: "markdown",
      formatKey: "format-reused",
      factory: first.factory,
    };
    const dispose = registry.register(registration);
    const registered = registry.select(request);
    registry.mount(request, mountContext()).surface;

    dispose();
    expect(first.destroys[0].calls).toBe(1);
    const fallback = registry.select(request);
    expect(fallback.key).toBe("builtin:text-fallback");
    expect(fallback.key).not.toBe(registered.key);
    const fallbackContext = mountContext();
    const fallbackSurface = registry.mount(request, fallbackContext).surface;
    expect(fallbackContext.parent.textContent).toContain("Fallback superficie testuale");
    fallbackSurface.destroy();

    const second = surfaceFixture("second", "text", "markdown");
    const disposeAgain = registry.register({
      owner: "owner-second",
      family: "text",
      profile: "markdown",
      formatKey: "format-reused",
      factory: second.factory,
    });
    const registeredAgain = registry.select(request);
    expect(registeredAgain.key).not.toBe(fallback.key);
    const secondContext = mountContext();
    const secondSurface = registry.mount(request, secondContext).surface;
    expect(secondContext.parent.querySelector('[data-test-factory="second"]')).not.toBeNull();
    secondSurface.destroy();
    disposeAgain();
    expect(second.destroys[0].calls).toBe(1);
  });

  it("rifiuta le collisioni nominando entrambi gli owner", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "owner-a",
      family: "text",
      profile: "markdown",
      formatKey: "shared-format",
      factory: surfaceFixture("a", "text", "markdown").factory,
    });

    expect(() =>
      registry.register({
        owner: "owner-b",
        family: "text",
        profile: "plain-text",
        formatKey: "shared-format",
        factory: surfaceFixture("b", "text", "plain-text").factory,
      }),
    ).toThrow(/owner-a.*owner-b/);
  });

  it("rifiuta famiglie incoerenti senza lasciare binding parziali", () => {
    const registry = new DocumentSurfaceRegistry();
    const incompatible = surfaceFixture("incompatible", "grid", "shared-profile");

    expect(() =>
      registry.register({
        registrationId: "reused-registration",
        owner: "incompatible-owner",
        family: "text",
        profile: "shared-profile",
        formatKey: "reused-format",
        species: "text/reused",
        factory: incompatible.factory,
      }),
    ).toThrow(/incompatible-owner.*text.*grid/);

    const compatible = surfaceFixture("compatible", "text", "shared-profile");
    const dispose = registry.register({
      registrationId: "reused-registration",
      owner: "compatible-owner",
      family: "text",
      profile: "shared-profile",
      formatKey: "reused-format",
      species: "text/reused",
      factory: compatible.factory,
    });

    expect(registry.select({ formatKey: "reused-format" }).key).toMatch(
      /^registration:/,
    );
    expect(registry.select({ species: "text/reused" }).key).toMatch(
      /^registration:/,
    );
    dispose();
  });

  it("rifiuta profili dichiarati incoerenti tra registrazione e factory", () => {
    const registry = new DocumentSurfaceRegistry();
    const factory = surfaceFixture("factory-profile", "text", "factory-profile");

    expect(() =>
      registry.register({
        owner: "profile-owner",
        family: "text",
        profile: "registration-profile",
        factory: factory.factory,
      }),
    ).toThrow(/profile-owner.*registration-profile.*factory-profile/);
  });

  it("distrugge una superficie montata con famiglia incoerente senza possederla", () => {
    const registry = new DocumentSurfaceRegistry();
    const wrongInner = surfaceFixture("wrong-inner", "grid", "mismatch");
    const dispose = registry.register({
      owner: "wrong-inner-owner",
      family: "text",
      profile: "mismatch",
      formatKey: "wrong-inner-format",
      factory: { ...wrongInner.factory, family: "text" },
    });

    expect(() =>
      registry.mount({ formatKey: "wrong-inner-format" }, mountContext()).surface,
    ).toThrow(/text.*grid/);
    expect(wrongInner.destroys[0].calls).toBe(1);

    dispose();
    expect(wrongInner.destroys[0].calls).toBe(1);
  });

  it("disinstalla A senza rimuovere i binding di B", () => {
    const registry = new DocumentSurfaceRegistry();
    const a = surfaceFixture("a", "text", "profile-a");
    const b = surfaceFixture("b", "text", "profile-b");
    const disposeA = registry.register({
      owner: "owner-a",
      family: "text",
      profile: "profile-a",
      formatKey: "format-a",
      factory: a.factory,
    });
    registry.register({
      owner: "owner-b",
      family: "text",
      profile: "profile-b",
      formatKey: "format-b",
      factory: b.factory,
    });

    const selectedB = registry.select({ formatKey: "format-b" });
    expect(selectedB.key).toMatch(/^registration:/);
    disposeA();
    expect(registry.select({ formatKey: "format-a" }).key).toBe("builtin:text-fallback");
    expect(registry.select({ formatKey: "format-b" }).key).toBe(selectedB.key);
  });

  it("unregister rimuove i binding e distrugge tutte le istanze possedute", () => {
    const registry = new DocumentSurfaceRegistry();
    const a = surfaceFixture("a", "text", "profile-a");
    const b = surfaceFixture("b", "text", "profile-b");
    const disposeA = registry.register({
      owner: "owner-a",
      family: "text",
      profile: "profile-a",
      formatKey: "format-a",
      factory: a.factory,
    });
    registry.register({
      owner: "owner-b",
      family: "text",
      profile: "profile-b",
      formatKey: "format-b",
      factory: b.factory,
    });
    const context = mountContext();

    registry.mount({ formatKey: "format-a" }, context).surface;
    registry.mount({ formatKey: "format-a" }, context).surface;
    registry.mount({ formatKey: "format-b" }, context).surface;

    const selectedB = registry.select({ formatKey: "format-b" });
    expect(selectedB.key).toMatch(/^registration:/);
    disposeA();
    expect(a.destroys).toHaveLength(2);
    expect(a.destroys[0].calls).toBe(1);
    expect(a.destroys[1].calls).toBe(1);
    expect(b.destroys[0].calls).toBe(0);
    expect(registry.select({ formatKey: "format-a" }).key).toBe("builtin:text-fallback");
    expect(registry.select({ formatKey: "format-b" }).key).toBe(selectedB.key);

    disposeA();
    expect(a.destroys[0].calls).toBe(1);
  });

  it("mostra un fallback DOM testuale con lifecycle e accessibilità", () => {
    const registry = new DocumentSurfaceRegistry();
    const context = mountContext();

    const surface = registry.mount(
      { family: "text", profile: "profilo-non-registrato" },
      context,
    ).surface;
    const element = context.parent.firstElementChild as HTMLElement | null;

    expect(
      registry.select({ family: "text", profile: "profilo-non-registrato" }).key,
    ).toBe("builtin:text-fallback");
    expect(textualFallbackFactory).toMatchObject({
      family: "text",
      profile: "fallback",
      supportedVersions: [1],
    });
    expect(surface.family).toBe("text");
    expect(surface).not.toHaveProperty("setDoc");
    expect(surface).not.toHaveProperty("syncDoc");
    expect(element).not.toBeNull();
    expect(element?.textContent).toContain("Fallback superficie testuale");
    expect(element?.getAttribute("role")).toBe("region");
    expect(element?.getAttribute("aria-readonly")).toBe("false");

    surface.setTheme("dark");
    expect(element?.dataset.surfaceTheme).toBe("dark");
    surface.setReadOnly(true);
    expect(element?.dataset.surfaceReadOnly).toBe("true");
    expect(element?.getAttribute("aria-readonly")).toBe("true");

    surface.destroy();
    surface.destroy();
    expect(context.parent.childElementCount).toBe(0);
  });
  it("usa supportedVersions e il default implicito alla versione 1", () => {
    const registry = new DocumentSurfaceRegistry();
    const implicit = surfaceFixture("implicit");
    const implicitFactory: SurfaceFactory = {
      family: implicit.factory.family,
      profile: implicit.factory.profile,
      mount: implicit.factory.mount,
    };
    const implicitDispose = registry.register({
      owner: "implicit-owner",
      family: "text",
      profile: "implicit",
      formatKey: "implicit-format",
      factory: implicitFactory,
    });

    const implicitSelection = registry.select({
      formatKey: "implicit-format",
      version: 1,
    });
    expect(implicitSelection.key).toMatch(/^registration:/);
    expect(registry.select({ formatKey: "implicit-format", version: 2 }).key).toMatch(
      /^builtin:error:/,
    );

    const declared = surfaceFixture("declared");
    const declaredDispose = registry.register({
      owner: "declared-owner",
      family: "text",
      profile: "declared",
      formatKey: "declared-format",
      supportedVersions: [2, 4],
      factory: declared.factory,
    });

    const declaredVersion2 = registry.select({
      formatKey: "declared-format",
      version: 2,
    });
    const declaredVersion4 = registry.select({
      formatKey: "declared-format",
      version: 4,
    });
    expect(declaredVersion2.key).toMatch(/^registration:/);
    expect(declaredVersion4.key).toBe(declaredVersion2.key);
    expect(registry.select({ formatKey: "declared-format", version: 1 }).key).toMatch(
      /^builtin:error:/,
    );

    declaredDispose();
    implicitDispose();
  });

  it("rende fallback o errore visibile per versione e famiglia sconosciute", () => {
    const registry = new DocumentSurfaceRegistry();
    const versionContext = mountContext();
    const familyContext = mountContext();

    const versionSurface = registry.mount(
      { family: "text", version: 999 },
      versionContext,
    ).surface;
    const familySurface = registry.mount({ family: "family-futura" }, familyContext).surface;

    expect(versionContext.parent.textContent).toMatch(/Errore superficie|Fallback/);
    expect(familyContext.parent.textContent).toMatch(/Errore superficie|Fallback/);
    versionSurface.destroy();
    familySurface.destroy();
  });

  it("applica override, formatKey, specie, fallback testuale, byte viewer ed errore in ordine", () => {
    const registry = new DocumentSurfaceRegistry();
    const exact = surfaceFixture("exact");
    const species = surfaceFixture("species");
    const override = surfaceFixture("override");
    registry.register({
      owner: "exact-owner",
      family: "text",
      profile: "exact",
      formatKey: "format-key",
      factory: exact.factory,
    });
    registry.register({
      owner: "species-owner",
      family: "text",
      profile: "species",
      species: "text/source",
      factory: species.factory,
    });
    registry.register({
      owner: "override-owner",
      family: "text",
      profile: "override",
      formatKey: "override-format",
      factory: override.factory,
    });
    const overrideReference = {
      kind: "format" as const,
      owner: "override-owner",
      formatKey: "override-format",
    };

    const exactSelection = registry.select({ formatKey: "format-key" });
    const overrideSelection = registry.select({
      formatKey: "format-key",
      species: "text/source",
      override: overrideReference,
    });
    expect(overrideSelection.key).toMatch(/^registration:/);
    expect(overrideSelection.key).not.toBe(exactSelection.key);
    const overrideContext = mountContext();
    const mountedOverride = registry.mount(
      { formatKey: "format-key", override: overrideReference },
      overrideContext,
    ).surface;
    expect(mountedOverride).not.toBe(override.mounts[0]);
    expect(mountedOverride.family).toBe(override.mounts[0].family);
    mountedOverride.destroy();
    expect(override.destroys[0].calls).toBe(1);
    const exactBindingSelection = registry.select({
      formatKey: "format-key",
      species: "text/source",
    });
    const speciesSelection = registry.select({ species: "text/source" });
    const fallbackSelection = registry.select({ family: "text", profile: "missing" });
    const viewerSelection = registry.select({ species: "bytes" });
    expect(exactBindingSelection.key).toBe(exactSelection.key);
    expect(speciesSelection.key).not.toBe(exactSelection.key);
    expect(fallbackSelection.key).toBe("builtin:text-fallback");
    expect(viewerSelection.key).toBe("builtin:byte-viewer");
    const byteContext = mountContext();
    const byteSurface = registry.mount({ species: "bytes" }, byteContext).surface;
    expect(byteSurface.family).toBe("viewer");
    expect(byteContext.parent.textContent).toContain(
      "Visualizzatore read-only per sorgenti a byte",
    );
    byteSurface.destroy();
    expect(registry.select({ family: "family-futura" }).key).toMatch(/^builtin:error:/);
  });

  it("risolve ogni override nella propria namespace e invalida le registrazioni rimosse", () => {
    const registry = new DocumentSurfaceRegistry();
    const fallback = surfaceFixture("fallback", "text", "profile-fallback");
    const registeredB: SurfaceRegistration = {
      owner: "owner-b",
      family: "text",
      profile: "profile-b",
      formatKey: "format-b",
      factory: surfaceFixture("b", "text", "profile-b").factory,
    };
    const disposeFallback = registry.register({
      owner: "fallback-owner",
      family: "text",
      profile: "profile-fallback",
      formatKey: "format-fallback",
      factory: fallback.factory,
    });
    const disposeB = registry.register(registeredB);
    expect(registeredB.registrationId).toEqual(expect.any(String));
    const registrationId = registeredB.registrationId as string;
    const request = {
      formatKey: "format-fallback",
      override: { kind: "registration" as const, registrationId },
    };

    const fallbackSelection = registry.select({ formatKey: "format-fallback" });
    const registeredSelection = registry.select({ formatKey: "format-b" });
    expect(registeredSelection.key).toMatch(/^registration:/);
    expect(registry.select(request).key).toBe(registeredSelection.key);
    expect(
      registry.select({
        override: {
          kind: "format",
          owner: "owner-b",
          formatKey: "format-b",
        },
      }).key,
    ).toBe(registeredSelection.key);
    expect(
      registry.select({
        override: {
          kind: "profile",
          owner: "owner-b",
          family: "text",
          profile: "profile-b",
        },
      }).key,
    ).toBe(registeredSelection.key);
    const mismatchedOwner = registry.select({
      formatKey: "format-fallback",
      override: {
        kind: "format",
        owner: "owner-incorrect",
        formatKey: "format-b",
      },
    });
    expect(mismatchedOwner.key).toMatch(/^builtin:error:/);
    expect(mismatchedOwner.key).not.toBe(fallbackSelection.key);

    disposeB();
    expect(registry.select(request).key).not.toBe(registeredSelection.key);
    expect(registry.select(request).key).toMatch(/^builtin:error:/);
    const context = mountContext();
    const surface = registry.mount(request, context).surface;
    expect(context.parent.textContent).toContain("override utente non registrato");
    surface.destroy();

    disposeFallback();
  });

  it("rifiuta override malformati senza tentare i binding della richiesta", () => {
    const registry = new DocumentSurfaceRegistry();
    const bound = surfaceFixture("bound");
    const naked = surfaceFixture("naked");
    registry.register({
      owner: "bound-owner",
      family: "text",
      profile: "bound",
      formatKey: "format-key",
      factory: bound.factory,
    });
    const bindingSelection = registry.select({ formatKey: "format-key" });
    const conflictingRegistrationOverride = {
      kind: "registration" as const,
      registrationId: "registration-id",
      owner: "bound-owner",
      formatKey: "format-key",
    };
    // @ts-expect-error A registration override cannot carry format intent.
    void (conflictingRegistrationOverride satisfies SurfaceOverride);

    const overrides: readonly unknown[] = [
      naked.factory,
      { factory: naked.factory },
      "format-key",
      { registrationId: "registration-id" },
      conflictingRegistrationOverride,
      {
        kind: "format",
        owner: "bound-owner",
        formatKey: "format-key",
        registrationId: "registration-id",
      },
      { kind: "registration", registrationId: "" },
      { kind: "format", owner: "bound-owner" },
      { kind: "unknown", registrationId: "registration-id" },
    ];

    for (const override of overrides) {
      const request = {
        family: "text",
        formatKey: "format-key",
        override: override as SurfaceOverride,
      };
      const selection = registry.select(request);
      expect(selection.key).toMatch(/^builtin:error:/);
      expect(selection.key).not.toBe(bindingSelection.key);
      const context = mountContext();
      const surface = registry.mount(request, context).surface;
      expect(bound.mounts).toHaveLength(0);
      expect(naked.mounts).toHaveLength(0);
      expect(context.parent.textContent).toContain("override utente non registrato");
      surface.destroy();
    }
  });

  it("consente profili text distinti senza collisione sulla sola famiglia", () => {
    const registry = new DocumentSurfaceRegistry();
    const markdown = surfaceFixture("markdown");
    const plainText = surfaceFixture("plain-text");
    registry.register({
      owner: "markdown-owner",
      family: "text",
      formatKey: "markdown",
      factory: markdown.factory,
    });
    registry.register({
      owner: "plain-text-owner",
      family: "text",
      formatKey: "plain-text",
      factory: plainText.factory,
    });
    const markdownSelection = registry.select({ family: "text", profile: "markdown" });
    const plainTextSelection = registry.select({ family: "text", profile: "plain-text" });
    expect(markdownSelection.key).toMatch(/^registration:/);
    expect(plainTextSelection.key).toMatch(/^registration:/);
    expect(markdownSelection.key).not.toBe(plainTextSelection.key);
    expect(registry.select({ formatKey: "markdown" }).key).toBe(markdownSelection.key);
    expect(registry.select({ formatKey: "plain-text" }).key).toBe(plainTextSelection.key);
  });

  describe("lifecycle", () => {
    it("rimuove l'istanza dal registry prima di distruggere l'inner", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const surface = registry.mount({ formatKey: "format-a" }, mountContext()).surface;

      expect(surface).not.toBe(a.mounts[0]);
      surface.destroy();
      expect(a.destroys[0].calls).toBe(1);

      dispose();
      expect(a.destroys[0].calls).toBe(1);
    });

    it("non ridistrugge cento superfici già distrutte", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const surfaces: EditorSurface[] = [];
      const context = mountContext();
      for (let index = 0; index < 100; index += 1) {
        surfaces.push(registry.mount({ formatKey: "format-a" }, context).surface);
      }

      for (const surface of surfaces) surface.destroy();
      for (const destroy of a.destroys) expect(destroy.calls).toBe(1);

      dispose();
      for (const destroy of a.destroys) expect(destroy.calls).toBe(1);
    });

    it("unregister distrugge B ma non ridistrugge A già distrutta", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const first = registry.mount({ formatKey: "format-a" }, mountContext()).surface;
      registry.mount({ formatKey: "format-a" }, mountContext()).surface;

      first.destroy();
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(0);

      dispose();
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(1);
    });

    it("non registra istanze quando factory.mount lancia", () => {
      const registry = new DocumentSurfaceRegistry();
      const mountError = new Error("mount fallito");
      const factory: SurfaceFactory = {
        family: "text",
        profile: "throws",
        supportedVersions: [1],
        mount() {
          throw mountError;
        },
      };
      const request = { formatKey: "throws" };
      const dispose = registry.register({
        owner: "throwing-owner",
        family: "text",
        profile: "throws",
        formatKey: request.formatKey,
        factory,
      });

      expect(() => registry.mount(request, mountContext()).surface).toThrow(mountError);
      const selected = registry.select(request);
      expect(selected.key).toMatch(/^registration:/);

      expect(() => dispose()).not.toThrow();
      expect(registry.select(request).key).toBe("builtin:text-fallback");
    });

    it("rifiuta una superficie creata da una registrazione disinstallata rientrante", () => {
      const registry = new DocumentSurfaceRegistry();
      const reentrant = reentrantUnregisterFixture("reentrant");
      const request = { formatKey: "reentrant-format" };
      const context = mountContext();
      const dispose = registry.register({
        owner: "reentrant-owner",
        family: "text",
        profile: "reentrant",
        formatKey: request.formatKey,
        factory: reentrant.factory,
      });
      reentrant.captureDisposer(dispose);

      let returned: MountedSurface | undefined;
      expect(() => {
        returned = registry.mount(request, context);
      }).toThrow(/registrazione.*non.*disponibile.*mount/i);

      expect(returned).toBeUndefined();
      expect(reentrant.mounts).toHaveLength(1);
      expect(reentrant.destroys[0].calls).toBe(1);
      expect(context.parent.childElementCount).toBe(0);
      expect(registry.select(request).key).toBe("builtin:text-fallback");

      expect(() => dispose()).not.toThrow();
      expect(reentrant.destroys[0].calls).toBe(1);

      const replacement = surfaceFixture("replacement", "text", "replacement");
      const disposeReplacement = registry.register({
        owner: "replacement-owner",
        family: "text",
        profile: "replacement",
        formatKey: request.formatKey,
        factory: replacement.factory,
      });
      const replacementSelection = registry.select(request);
      expect(replacementSelection.key).toMatch(/^registration:/);
      dispose();
      expect(registry.select(request).key).toBe(replacementSelection.key);

      const replacementContext = mountContext();
      const replacementSurface = registry.mount(request, replacementContext).surface;

      expect(replacementSurface).not.toBe(replacement.mounts[0]);
      expect(
        replacementContext.parent.querySelector('[data-test-factory="replacement"]'),
      ).not.toBeNull();
      disposeReplacement();
      expect(replacement.destroys[0].calls).toBe(1);
      expect(replacementContext.parent.childElementCount).toBe(0);
    });

    it("conserva l'indisponibilità della registrazione se la pulizia rientrante fallisce", () => {
      const registry = new DocumentSurfaceRegistry();
      const destroyError = new Error("destroy rientrante fallito");
      const reentrant = reentrantUnregisterFixture("reentrant-error", {
        destroyErrors: [destroyError],
      });
      const request = { formatKey: "reentrant-error-format" };
      const context = mountContext();
      const dispose = registry.register({
        owner: "reentrant-error-owner",
        family: "text",
        profile: "reentrant-error",
        formatKey: request.formatKey,
        factory: reentrant.factory,
      });
      reentrant.captureDisposer(dispose);

      let caught: unknown;
      try {
        registry.mount(request, context).surface;
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AggregateError);
      const aggregate = caught as AggregateError;
      expect(aggregate.message).toMatch(/registrazione.*non.*disponibile.*mount/i);
      expect(aggregate.errors).toContain(destroyError);
      expect(aggregate.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/registrazione.*non.*disponibile.*mount/i),
        }),
      );
      expect(reentrant.destroys[0].calls).toBe(1);
      expect(context.parent.childElementCount).toBe(0);
      expect(registry.select(request).key).toBe("builtin:text-fallback");
      expect(() => dispose()).not.toThrow();
      expect(reentrant.destroys[0].calls).toBe(1);
    });

    it("mantiene l'ownership coerente quando il destroy di A lancia", () => {
      const registry = new DocumentSurfaceRegistry();
      const destroyError = new Error("destroy fallito");
      const a = surfaceFixture("a", "text", "profile-a", {
        destroyErrors: [destroyError],
      });
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const first = registry.mount({ formatKey: "format-a" }, mountContext()).surface;
      registry.mount({ formatKey: "format-a" }, mountContext()).surface;

      expect(() => first.destroy()).toThrow(destroyError);
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(0);

      dispose();
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(1);
      expect(() => first.destroy()).not.toThrow();
    });

    it("unregister continua il teardown e rilancia il primo errore", () => {
      const registry = new DocumentSurfaceRegistry();
      const destroyError = new Error("destroy fallito durante unregister");
      const a = surfaceFixture("a", "text", "profile-a", {
        destroyErrors: [destroyError],
      });
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      registry.mount({ formatKey: "format-a" }, mountContext()).surface;
      registry.mount({ formatKey: "format-a" }, mountContext()).surface;

      expect(() => dispose()).toThrow(destroyError);
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(1);
      expect(() => dispose()).not.toThrow();
    });

    it("rende il disposer idempotente senza doppio destroy", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      registry.mount({ formatKey: "format-a" }, mountContext()).surface;

      dispose();
      dispose();
      expect(a.destroys[0].calls).toBe(1);
    });

    it("permette a un nuovo owner di riusare il binding senza stato fantasma", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const disposeA = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "shared-format",
        factory: a.factory,
      });
      registry.mount({ formatKey: "shared-format" }, mountContext()).surface;
      disposeA();
      expect(a.destroys[0].calls).toBe(1);

      const b = surfaceFixture("b", "text", "profile-b");
      const disposeB = registry.register({
        owner: "owner-b",
        family: "text",
        profile: "profile-b",
        formatKey: "shared-format",
        factory: b.factory,
      });
      expect(registry.select({ formatKey: "shared-format" }).key).toMatch(/^registration:/);
      registry.mount({ formatKey: "shared-format" }, mountContext()).surface;

      disposeB();
      expect(b.destroys[0].calls).toBe(1);
    });

    it("inoltra i metodi extra della superficie inner", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a", "text", "profile-a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const surface = registry.mount(
        { formatKey: "format-a" },
        mountContext(),
      ).surface as ExtendedSurface;

      expect(surface.in("a")).toBe(true);
      expect(surface.has("a")).toBe(true);
      expect(surface.get("a")).toBe(a.destroys[0]);
      expect(surface.in("missing")).toBe(false);

      surface.destroy();
      dispose();
    });

    it("preserva getter, setter, metodi e stato privato delle superfici class", () => {
      const registry = new DocumentSurfaceRegistry();
      const privateSurface = privateSurfaceFixture("private");
      const dispose = registry.register({
        owner: "private-owner",
        family: "text",
        profile: "private",
        formatKey: "private-format",
        factory: privateSurface.factory,
      });
      const mounted = registry.mount(
        { formatKey: "private-format" },
        mountContext(),
      ).surface as PrivateSurface;
      const inner = privateSurface.mounts[0];

      expect(mounted).not.toBe(inner);
      expect(mounted.label).toBe("private");
      expect(mounted.describe("value")).toBe("private:value");
      expect(mounted.describe).toBe(mounted.describe);

      mounted.label = "updated";
      expect(mounted.label).toBe("updated");
      expect(inner.label).toBe("updated");
      const describe = mounted.describe;
      expect(describe("value")).toBe("updated:value");

      mounted.destroy();
      expect(privateSurface.destroys[0].calls).toBe(1);
      mounted.destroy();
      expect(privateSurface.destroys[0].calls).toBe(1);

      dispose();
      expect(privateSurface.destroys[0].calls).toBe(1);
    });
  });
});
