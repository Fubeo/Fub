// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  byteViewerFactory,
  DocumentSurfaceRegistry,
  isModefulSurface,
  textualFallbackFactory,
  type EditorSurface,
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

describe("DocumentSurfaceRegistry", () => {
  it("registra, risolve e monta la factory del binding", () => {
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
    expect(registry.resolve(request)).toBe(markdown.factory);
    const mounted = registry.mount(request, context);
    expect(mounted).not.toBe(markdown.mounts[0]);
    expect(mounted.family).toBe(markdown.mounts[0].family);
    expect(context.parent.querySelector('[data-test-factory="markdown"]')).not.toBeNull();
    mounted.destroy();
    expect(markdown.destroys[0].calls).toBe(1);

    dispose();
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
    expect(selectedA.factory).toBe(markdownA.factory);
    expect(selectedB.factory).toBe(markdownB.factory);
    expect(selectedA.key).not.toBe(selectedB.key);

    const ambiguous = registry.select({ family: "text", profile: "markdown" });
    expect(ambiguous.key).toMatch(/^builtin:error:/);
    const context = mountContext();
    const surface = registry.mount({ family: "text", profile: "markdown" }, context);
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
    const mounted = registry.mount({ family: "text", profile: "plain" }, mountContext());
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
    const fallback = registry.mount({ family: "text", profile: "missing" }, mountContext());
    const viewer = registry.mount({ species: "bytes" }, mountContext());
    const error = registry.mount({ family: "unknown" }, mountContext());

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
      override: { registrationId: registrationA.registrationId as string },
    });
    const overrideB = registry.select({
      override: { registrationId: registrationB.registrationId as string },
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
    registry.mount(request, mountContext());

    dispose();
    expect(first.destroys[0].calls).toBe(1);
    const fallback = registry.select(request);
    expect(fallback.factory).toBe(textualFallbackFactory);
    expect(fallback.key).toBe("builtin:text-fallback");
    expect(fallback.key).not.toBe(registered.key);
    registry.mount(request, mountContext()).destroy();

    const second = surfaceFixture("second", "text", "markdown");
    const disposeAgain = registry.register({
      owner: "owner-second",
      family: "text",
      profile: "markdown",
      formatKey: "format-reused",
      factory: second.factory,
    });
    const registeredAgain = registry.select(request);
    expect(registeredAgain.factory).toBe(second.factory);
    expect(registeredAgain.key).not.toBe(fallback.key);
    registry.mount(request, mountContext()).destroy();
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
      factory: surfaceFixture("a").factory,
    });

    expect(() =>
      registry.register({
        owner: "owner-b",
        family: "text",
        profile: "plain-text",
        formatKey: "shared-format",
        factory: surfaceFixture("b").factory,
      }),
    ).toThrow(/owner-a.*owner-b/);
  });

  it("disinstalla A senza rimuovere i binding di B", () => {
    const registry = new DocumentSurfaceRegistry();
    const a = surfaceFixture("a");
    const b = surfaceFixture("b");
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

    expect(registry.resolve({ formatKey: "format-b" })).toBe(b.factory);
    disposeA();
    expect(registry.resolve({ formatKey: "format-a" })).not.toBe(a.factory);
    expect(registry.resolve({ formatKey: "format-b" })).toBe(b.factory);
  });

  it("unregister rimuove i binding e distrugge tutte le istanze possedute", () => {
    const registry = new DocumentSurfaceRegistry();
    const a = surfaceFixture("a");
    const b = surfaceFixture("b");
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

    registry.mount({ formatKey: "format-a" }, context);
    registry.mount({ formatKey: "format-a" }, context);
    registry.mount({ formatKey: "format-b" }, context);

    disposeA();
    expect(a.destroys).toHaveLength(2);
    expect(a.destroys[0].calls).toBe(1);
    expect(a.destroys[1].calls).toBe(1);
    expect(b.destroys[0].calls).toBe(0);
    expect(registry.resolve({ formatKey: "format-a" })).not.toBe(a.factory);
    expect(registry.resolve({ formatKey: "format-b" })).toBe(b.factory);

    disposeA();
    expect(a.destroys[0].calls).toBe(1);
  });

  it("mostra un fallback DOM testuale con lifecycle e accessibilità", () => {
    const registry = new DocumentSurfaceRegistry();
    const context = mountContext();

    const surface = registry.mount(
      { family: "text", profile: "profilo-non-registrato" },
      context,
    );
    const element = context.parent.firstElementChild as HTMLElement | null;

    expect(registry.resolve({ family: "text", profile: "profilo-non-registrato" })).toBe(
      textualFallbackFactory,
    );
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

    expect(registry.resolve({ formatKey: "implicit-format", version: 1 })).toBe(
      implicitFactory,
    );
    expect(registry.resolve({ formatKey: "implicit-format", version: 2 }).family).toBe("error");

    const declared = surfaceFixture("declared");
    const declaredDispose = registry.register({
      owner: "declared-owner",
      family: "text",
      profile: "declared",
      formatKey: "declared-format",
      supportedVersions: [2, 4],
      factory: declared.factory,
    });

    expect(registry.resolve({ formatKey: "declared-format", version: 2 })).toBe(
      declared.factory,
    );
    expect(registry.resolve({ formatKey: "declared-format", version: 4 })).toBe(
      declared.factory,
    );
    expect(registry.resolve({ formatKey: "declared-format", version: 1 }).family).toBe("error");

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
    );
    const familySurface = registry.mount({ family: "family-futura" }, familyContext);

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
      owner: "override-owner",
      formatKey: "override-format",
    };

    expect(
      registry.resolve({
        formatKey: "format-key",
        species: "text/source",
        override: overrideReference,
      }),
    ).toBe(override.factory);
    const overrideContext = mountContext();
    const mountedOverride = registry.mount(
      { formatKey: "format-key", override: overrideReference },
      overrideContext,
    );
    expect(mountedOverride).not.toBe(override.mounts[0]);
    expect(mountedOverride.family).toBe(override.mounts[0].family);
    mountedOverride.destroy();
    expect(override.destroys[0].calls).toBe(1);
    expect(registry.resolve({ formatKey: "format-key", species: "text/source" })).toBe(
      exact.factory,
    );
    expect(registry.resolve({ species: "text/source" })).toBe(species.factory);
    expect(registry.resolve({ family: "text", profile: "missing" })).toBe(
      textualFallbackFactory,
    );
    expect(registry.resolve({ species: "bytes" })).toBe(byteViewerFactory);
    const byteContext = mountContext();
    const byteSurface = registry.mount({ species: "bytes" }, byteContext);
    expect(byteSurface.family).toBe("viewer");
    expect(byteContext.parent.textContent).toContain(
      "Visualizzatore read-only per sorgenti a byte",
    );
    byteSurface.destroy();
    expect(registry.resolve({ family: "family-futura" }).family).toBe("error");
  });

  it("lega l'override alla registrazione e segnala quando viene disinstallata", () => {
    const registry = new DocumentSurfaceRegistry();
    const fallback = surfaceFixture("fallback");
    const registeredB: SurfaceRegistration = {
      owner: "owner-b",
      family: "text",
      profile: "profile-b",
      formatKey: "format-b",
      factory: surfaceFixture("b").factory,
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
      override: { registrationId },
    };

    expect(registry.resolve(request)).toBe(registeredB.factory);
    expect(registry.resolve({ override: registrationId })).toBe(registeredB.factory);
    expect(registry.resolve({ override: "format-b" })).toBe(registeredB.factory);
    expect(
      registry.resolve({
        override: { owner: "owner-b", formatKey: "format-b" },
      }),
    ).toBe(registeredB.factory);
    expect(
      registry.resolve({
        override: { owner: "owner-b", family: "text", profile: "profile-b" },
      }),
    ).toBe(registeredB.factory);
    expect(
      registry.resolve({
        override: { owner: "owner-incorrect", formatKey: "format-b" },
      }).family,
    ).toBe("error");

    disposeB();
    expect(registry.resolve(request)).not.toBe(registeredB.factory);
    expect(registry.resolve(request).family).toBe("error");
    const context = mountContext();
    const surface = registry.mount(request, context);
    expect(context.parent.textContent).toContain("override utente non registrato");
    surface.destroy();

    disposeFallback();
  });

  it("non monta una factory nuda passata come override", () => {
    const registry = new DocumentSurfaceRegistry();
    const naked = surfaceFixture("naked");
    const overrides: readonly SurfaceOverride[] = [
      naked.factory as unknown as SurfaceOverride,
      { factory: naked.factory } as unknown as SurfaceOverride,
    ];

    for (const override of overrides) {
      const request = {
        family: "text",
        formatKey: "format-key",
        override,
      };
      expect(registry.resolve(request)).not.toBe(naked.factory);
      expect(registry.resolve(request).family).toBe("error");
      const context = mountContext();
      const surface = registry.mount(request, context);
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
    expect(registry.resolve({ family: "text", profile: "markdown" })).toBe(markdown.factory);
    expect(registry.resolve({ family: "text", profile: "plain-text" })).toBe(
      plainText.factory,
    );

    expect(registry.resolve({ formatKey: "markdown" })).toBe(markdown.factory);
    expect(registry.resolve({ formatKey: "plain-text" })).toBe(plainText.factory);
  });

  describe("lifecycle", () => {
    it("rimuove l'istanza dal registry prima di distruggere l'inner", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const surface = registry.mount({ formatKey: "format-a" }, mountContext());

      expect(surface).not.toBe(a.mounts[0]);
      surface.destroy();
      expect(a.destroys[0].calls).toBe(1);

      dispose();
      expect(a.destroys[0].calls).toBe(1);
    });

    it("non ridistrugge cento superfici già distrutte", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
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
        surfaces.push(registry.mount({ formatKey: "format-a" }, context));
      }

      for (const surface of surfaces) surface.destroy();
      for (const destroy of a.destroys) expect(destroy.calls).toBe(1);

      dispose();
      for (const destroy of a.destroys) expect(destroy.calls).toBe(1);
    });

    it("unregister distrugge B ma non ridistrugge A già distrutta", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      const first = registry.mount({ formatKey: "format-a" }, mountContext());
      registry.mount({ formatKey: "format-a" }, mountContext());

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

      expect(() => registry.mount(request, mountContext())).toThrow(mountError);
      expect(registry.resolve(request)).toBe(factory);

      expect(() => dispose()).not.toThrow();
      expect(registry.resolve(request)).not.toBe(factory);
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
      const first = registry.mount({ formatKey: "format-a" }, mountContext());
      registry.mount({ formatKey: "format-a" }, mountContext());

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
      registry.mount({ formatKey: "format-a" }, mountContext());
      registry.mount({ formatKey: "format-a" }, mountContext());

      expect(() => dispose()).toThrow(destroyError);
      expect(a.destroys[0].calls).toBe(1);
      expect(a.destroys[1].calls).toBe(1);
      expect(() => dispose()).not.toThrow();
    });

    it("rende il disposer idempotente senza doppio destroy", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
      const dispose = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "format-a",
        factory: a.factory,
      });
      registry.mount({ formatKey: "format-a" }, mountContext());

      dispose();
      dispose();
      expect(a.destroys[0].calls).toBe(1);
    });

    it("permette a un nuovo owner di riusare il binding senza stato fantasma", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
      const disposeA = registry.register({
        owner: "owner-a",
        family: "text",
        profile: "profile-a",
        formatKey: "shared-format",
        factory: a.factory,
      });
      registry.mount({ formatKey: "shared-format" }, mountContext());
      disposeA();
      expect(a.destroys[0].calls).toBe(1);

      const b = surfaceFixture("b");
      const disposeB = registry.register({
        owner: "owner-b",
        family: "text",
        profile: "profile-b",
        formatKey: "shared-format",
        factory: b.factory,
      });
      expect(registry.resolve({ formatKey: "shared-format" })).toBe(b.factory);
      registry.mount({ formatKey: "shared-format" }, mountContext());

      disposeB();
      expect(b.destroys[0].calls).toBe(1);
    });

    it("inoltra i metodi extra della superficie inner", () => {
      const registry = new DocumentSurfaceRegistry();
      const a = surfaceFixture("a");
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
      ) as ExtendedSurface;

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
      ) as PrivateSurface;
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
