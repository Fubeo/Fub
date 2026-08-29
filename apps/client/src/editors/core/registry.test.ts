// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  byteViewerFactory,
  DocumentSurfaceRegistry,
  textualFallbackFactory,
  type EditorSurface,
  type SurfaceFactory,
  type SurfaceOverride,
  type SurfaceRegistration,
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
    version: 1,
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

  it("mostra un fallback testuale quando manca una factory di famiglia", () => {
    const registry = new DocumentSurfaceRegistry();
    const context = mountContext();

    const surface = registry.mount(
      { family: "text", profile: "profilo-non-registrato" },
      context,
    );

    expect(registry.resolve({ family: "text", profile: "profilo-non-registrato" })).toBe(
      textualFallbackFactory,
    );
    expect(surface.family).toBe("text");
    expect(context.parent.textContent).toContain("Fallback superficie testuale");
    surface.destroy();
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
        version: 1,
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
  });
});
