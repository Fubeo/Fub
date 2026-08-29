export type SurfaceFamily =
  | "text"
  | "grid"
  | "structured"
  | "canvas"
  | "viewer"
  | "error";

export interface SurfaceViewState {
  readonly version: number;
  readonly value: unknown;
}

export interface EditorSurface {
  readonly family: string;
  readonly surfaceId: string;

  focus(target?: unknown): void;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: unknown): void;

  captureViewState(): SurfaceViewState;
  restoreViewState(state: SurfaceViewState): void;

  suspend(): void;
  resume(): void;
  destroy(): void;
}

export interface SurfaceMountContext {
  readonly paneId: string;
  readonly documentId: string;
  readonly parent: HTMLElement;
}

export type SurfaceVersion = number | readonly number[];

export interface SurfaceRequest {
  readonly formatKey?: string;
  readonly species?: string;
  readonly family?: string;
  readonly profile?: string;
  readonly version?: number;
  readonly override?: SurfaceOverride;
  readonly userOverride?: SurfaceOverride;
  readonly overrideFactory?: SurfaceFactory;
}

export type SurfaceOverride = SurfaceFactory | SurfaceOverrideReference | string;

export interface SurfaceOverrideReference {
  readonly owner?: string;
  readonly formatKey?: string;
  readonly family?: string;
  readonly profile?: string;
  readonly factory?: SurfaceFactory;
}

export interface SurfaceFactory {
  readonly family: string;
  readonly profile?: string;
  readonly version?: SurfaceVersion;
  readonly supportedVersions?: readonly number[];
  mount(request: SurfaceRequest, context: SurfaceMountContext): EditorSurface;
}

export interface SurfaceRegistration {
  readonly owner: string;
  readonly family: string;
  readonly profile?: string;
  readonly formatKey?: string;
  readonly species?: string;
  readonly version?: SurfaceVersion;
  readonly supportedVersions?: readonly number[];
  readonly factory: SurfaceFactory;
}

interface Binding {
  readonly kind: "formatKey" | "species" | "familyProfile";
  readonly key: string;
  readonly label: string;
}

interface Entry {
  readonly registration: SurfaceRegistration;
  readonly bindings: readonly Binding[];
  readonly instances: Set<EditorSurface>;
  active: boolean;
}

interface Selection {
  readonly factory: SurfaceFactory;
  readonly entry?: Entry;
}

const INITIAL_SURFACE_VERSION = 1;
const FAMILY_PROFILE_SEPARATOR = "\u0000";
const TEXT_SPECIES: Record<string, true> = {
  text: true,
  textual: true,
  "plain-text": true,
  markdown: true,
  "text/plain": true,
  "text/markdown": true,
};
const BYTE_SPECIES: Record<string, true> = {
  byte: true,
  bytes: true,
  binary: true,
  opaque: true,
  blob: true,
  "application/octet-stream": true,
};

let nextSurfaceId = 1;

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function familyProfileKey(family: string, profile: string | undefined): string {
  return `${family}${FAMILY_PROFILE_SEPARATOR}${profile ?? ""}`;
}
function registrationProfile(registration: SurfaceRegistration): string | undefined {
  return registration.profile ?? registration.factory.profile;
}

// Collision means claiming the same exact formatKey, source species, or
// family+profile binding. A family alone is never a singleton for all profiles.
function bindingDescriptors(registration: SurfaceRegistration): Binding[] {
  const bindings: Binding[] = [];
  const profile = registrationProfile(registration);
  if (hasText(registration.formatKey)) {
    bindings.push({
      kind: "formatKey",
      key: registration.formatKey,
      label: `formatKey=${registration.formatKey}`,
    });
  }
  if (hasText(registration.species)) {
    bindings.push({
      kind: "species",
      key: registration.species,
      label: `species=${registration.species}`,
    });
  }
  bindings.push({
    kind: "familyProfile",
    key: familyProfileKey(registration.family, profile),
    label: `family=${registration.family}, profile=${profile ?? ""}`,
  });
  return bindings;
}

function isFactory(value: unknown): value is SurfaceFactory {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SurfaceFactory>;
  return typeof candidate.family === "string" && typeof candidate.mount === "function";
}

function normaliseSpecies(species: string | undefined): string {
  return species?.trim().toLowerCase() ?? "";
}

function isByteRequest(request: SurfaceRequest): boolean {
  const species = normaliseSpecies(request.species);
  const profile = normaliseSpecies(request.profile);
  return (
    BYTE_SPECIES[species] === true ||
    species.startsWith("bytes:") ||
    profile === "bytes" ||
    profile === "binary"
  );
}

function isTextualRequest(request: SurfaceRequest): boolean {
  if (isByteRequest(request)) return false;
  if (request.family === undefined) return true;
  if (request.family === "text") return true;
  return TEXT_SPECIES[normaliseSpecies(request.species)] === true;
}

function declaredVersions(
  registration: SurfaceRegistration | undefined,
  factory: SurfaceFactory,
): SurfaceVersion | readonly number[] | undefined {
  return (
    registration?.supportedVersions ??
    registration?.version ??
    factory.supportedVersions ??
    factory.version
  );
}

function supportsVersion(
  registration: SurfaceRegistration | undefined,
  factory: SurfaceFactory,
  requestedVersion: number | undefined,
): boolean {
  if (requestedVersion === undefined) return true;
  const declared = declaredVersions(registration, factory) ?? INITIAL_SURFACE_VERSION;
  if (Array.isArray(declared)) return declared.includes(requestedVersion);
  return declared === requestedVersion;
}

function versionDescription(version: number | undefined): string {
  return version === undefined ? "versione sconosciuta" : `versione ${version}`;
}

function errorFactory(reason: string): SurfaceFactory {
  return createDomFactory({
    family: "error",
    profile: "error",
    message: `Errore superficie: ${reason}`,
    readOnly: true,
    className: "document-surface-error",
  });
}

function createDomFactory(options: {
  family: string;
  profile?: string;
  message: string;
  readOnly?: boolean;
  className: string;
}): SurfaceFactory {
  return {
    family: options.family,
    profile: options.profile,
    version: INITIAL_SURFACE_VERSION,
    mount(_request, context) {
      return new DomSurface(options, context.parent);
    },
  };
}

class DomSurface implements EditorSurface {
  readonly family: string;
  readonly surfaceId: string;

  private readonly element: HTMLElement;
  private readonly state = {
    readOnly: false,
    suspended: false,
    theme: "",
  };
  private destroyed = false;

  constructor(
    options: {
      family: string;
      profile?: string;
      message: string;
      readOnly?: boolean;
      className: string;
    },
    parent: HTMLElement,
  ) {
    this.family = options.family;
    this.surfaceId = `surface-${nextSurfaceId++}`;
    this.state.readOnly = options.readOnly ?? false;

    const element = parent.ownerDocument.createElement("div");
    element.className = `document-surface ${options.className}`;
    element.dataset.surfaceFamily = options.family;
    if (options.profile !== undefined) element.dataset.surfaceProfile = options.profile;
    element.dataset.surfaceId = this.surfaceId;
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.textContent = options.message;
    parent.appendChild(element);
    this.element = element;
    this.updateReadOnlyAttribute();
  }

  focus(_target?: unknown): void {
    if (!this.destroyed) this.element.focus();
  }

  setReadOnly(readOnly: boolean): void {
    if (this.destroyed) return;
    this.state.readOnly = readOnly;
    this.updateReadOnlyAttribute();
  }

  setTheme(theme: unknown): void {
    if (this.destroyed) return;
    this.state.theme = typeof theme === "string" ? theme : "custom";
    this.element.dataset.surfaceTheme = this.state.theme;
  }

  captureViewState(): SurfaceViewState {
    return {
      version: INITIAL_SURFACE_VERSION,
      value: {
        readOnly: this.state.readOnly,
        suspended: this.state.suspended,
        theme: this.state.theme,
      },
    };
  }

  restoreViewState(state: SurfaceViewState): void {
    if (this.destroyed || state.version !== INITIAL_SURFACE_VERSION) return;
    if (typeof state.value !== "object" || state.value === null) return;
    const value = state.value as {
      readOnly?: unknown;
      suspended?: unknown;
      theme?: unknown;
    };
    if (typeof value.readOnly === "boolean") this.setReadOnly(value.readOnly);
    if (typeof value.theme === "string") this.setTheme(value.theme);
    if (typeof value.suspended === "boolean") {
      if (value.suspended) this.suspend();
      else this.resume();
    }
  }

  suspend(): void {
    if (this.destroyed) return;
    this.state.suspended = true;
    this.element.dataset.surfaceSuspended = "true";
  }

  resume(): void {
    if (this.destroyed) return;
    this.state.suspended = false;
    delete this.element.dataset.surfaceSuspended;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.remove();
  }

  private updateReadOnlyAttribute(): void {
    this.element.dataset.surfaceReadOnly = String(this.state.readOnly);
    this.element.setAttribute("aria-readonly", String(this.state.readOnly));
  }
}

export const textualFallbackFactory: SurfaceFactory = createDomFactory({
  family: "text",
  profile: "fallback",
  message: "Fallback superficie testuale: profilo non disponibile.",
  className: "document-surface-text-fallback",
});

export const byteViewerFactory: SurfaceFactory = createDomFactory({
  family: "viewer",
  profile: "bytes",
  message: "Visualizzatore read-only per sorgenti a byte.",
  readOnly: true,
  className: "document-surface-byte-viewer",
});

export class DocumentSurfaceRegistry {
  private readonly entries = new Set<Entry>();
  private readonly formatBindings = new Map<string, Entry>();
  private readonly speciesBindings = new Map<string, Entry>();
  private readonly familyProfileBindings = new Map<string, Entry>();

  register(registration: SurfaceRegistration): () => void {
    if (!hasText(registration.owner)) {
      throw new Error("La registrazione di una superficie richiede un owner.");
    }
    if (!hasText(registration.family)) {
      throw new Error(`L'owner ${registration.owner} deve dichiarare una famiglia.`);
    }
    if (!isFactory(registration.factory)) {
      throw new Error(`L'owner ${registration.owner} deve dichiarare una factory.`);
    }

    const normalized: SurfaceRegistration = { ...registration };
    const bindings = bindingDescriptors(normalized);
    const collisions = new Map<Entry, Binding[]>();
    for (const binding of bindings) {
      const existing = this.bindingFor(binding);
      if (existing !== undefined) {
        const previous = collisions.get(existing) ?? [];
        previous.push(binding);
        collisions.set(existing, previous);
      }
    }
    if (collisions.size > 0) {
      const existingOwners = [...collisions.keys()].map(
        (entry) => entry.registration.owner,
      );
      const owners = [...new Set([...existingOwners, normalized.owner])];
      const labels = [...collisions.values()]
        .flat()
        .map((binding) => binding.label)
        .join("; ");
      throw new Error(
        `Collisione del binding (${labels}): owner coinvolti ${owners
          .map((owner) => `"${owner}"`)
          .join(" e ")}.`,
      );
    }

    const entry: Entry = {
      registration: normalized,
      bindings,
      instances: new Set(),
      active: true,
    };
    this.entries.add(entry);
    for (const binding of bindings) this.setBinding(binding, entry);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.unregister(entry);
    };
  }

  resolve(request: SurfaceRequest): SurfaceFactory {
    return this.select(request).factory;
  }

  mount(request: SurfaceRequest, context: SurfaceMountContext): EditorSurface {
    const selection = this.select(request);
    const surface = selection.factory.mount(request, context);
    if (selection.entry?.active) selection.entry.instances.add(surface);
    return surface;
  }

  private select(request: SurfaceRequest): Selection {
    const override = request.overrideFactory ?? request.override ?? request.userOverride;
    if (override !== undefined) {
      const selected = this.selectionForOverride(override);
      if (selected === undefined) {
        return {
          factory: errorFactory("override utente non registrato"),
        };
      }
      if (
        !supportsVersion(
          selected.entry?.registration,
          selected.factory,
          request.version,
        )
      ) {
        return {
          factory: errorFactory(
            `${versionDescription(request.version)} non supportata dall'override utente`,
          ),
        };
      }
      return selected;
    }

    if (hasText(request.formatKey)) {
      const entry = this.formatBindings.get(request.formatKey);
      if (entry !== undefined) return this.selectionForEntry(entry, request);
    }

    if (hasText(request.species)) {
      const entry = this.speciesBindings.get(request.species);
      if (entry !== undefined) return this.selectionForEntry(entry, request);
    }

    // A family/profile binding lets two text profiles coexist without making
    // the family itself a process-wide singleton. It is considered only after
    // the required format and source-species bindings.
    if (hasText(request.family) && request.profile !== undefined) {
      const entry = this.familyProfileBindings.get(
        familyProfileKey(request.family, request.profile),
      );
      if (entry !== undefined) return this.selectionForEntry(entry, request);
    }

    if (isByteRequest(request)) {
      if (!supportsVersion(undefined, byteViewerFactory, request.version)) {
        return {
          factory: errorFactory(
            `${versionDescription(request.version)} non supportata dal viewer a byte`,
          ),
        };
      }
      return { factory: byteViewerFactory };
    }

    if (isTextualRequest(request)) {
      if (!supportsVersion(undefined, textualFallbackFactory, request.version)) {
        return {
          factory: errorFactory(
            `${versionDescription(request.version)} non supportata dal fallback testuale`,
          ),
        };
      }
      return { factory: textualFallbackFactory };
    }

    return {
      factory: errorFactory(
        `famiglia superficie sconosciuta: ${request.family ?? "assente"}`,
      ),
    };
  }

  private selectionForOverride(override: SurfaceOverride): Selection | undefined {
    if (isFactory(override)) return this.selectionForFactory(override);
    if (typeof override === "string") {
      return this.selectionForReference({ formatKey: override, owner: override });
    }
    if (override.factory !== undefined) {
      if (!isFactory(override.factory)) return undefined;
      return this.selectionForFactory(override.factory);
    }
    return this.selectionForReference(override);
  }

  private selectionForFactory(factory: SurfaceFactory): Selection {
    for (const entry of this.entries) {
      if (entry.registration.factory === factory) return { factory, entry };
    }
    return { factory };
  }

  private selectionForReference(reference: SurfaceOverrideReference): Selection | undefined {
    if (hasText(reference.formatKey)) {
      const entry = this.formatBindings.get(reference.formatKey);
      if (entry !== undefined) return { factory: entry.registration.factory, entry };
    }
    if (hasText(reference.owner)) {
      for (const entry of this.entries) {
        if (entry.registration.owner === reference.owner) {
          return { factory: entry.registration.factory, entry };
        }
      }
    }
    if (hasText(reference.family) && reference.profile !== undefined) {
      const entry = this.familyProfileBindings.get(
        familyProfileKey(reference.family, reference.profile),
      );
      if (entry !== undefined) return { factory: entry.registration.factory, entry };
    }
    return undefined;
  }

  private selectionForEntry(entry: Entry, request: SurfaceRequest): Selection {
    if (!supportsVersion(entry.registration, entry.registration.factory, request.version)) {
      return {
        factory: errorFactory(
          `${versionDescription(request.version)} non supportata dall'owner ${entry.registration.owner}`,
        ),
      };
    }
    return { factory: entry.registration.factory, entry };
  }

  private bindingFor(binding: Binding): Entry | undefined {
    switch (binding.kind) {
      case "formatKey":
        return this.formatBindings.get(binding.key);
      case "species":
        return this.speciesBindings.get(binding.key);
      case "familyProfile":
        return this.familyProfileBindings.get(binding.key);
    }
  }

  private setBinding(binding: Binding, entry: Entry): void {
    switch (binding.kind) {
      case "formatKey":
        this.formatBindings.set(binding.key, entry);
        break;
      case "species":
        this.speciesBindings.set(binding.key, entry);
        break;
      case "familyProfile":
        this.familyProfileBindings.set(binding.key, entry);
        break;
    }
  }

  private deleteBinding(binding: Binding, entry: Entry): void {
    const map =
      binding.kind === "formatKey"
        ? this.formatBindings
        : binding.kind === "species"
          ? this.speciesBindings
          : this.familyProfileBindings;
    if (map.get(binding.key) === entry) map.delete(binding.key);
  }

  private unregister(entry: Entry): void {
    if (!entry.active) return;
    entry.active = false;
    this.entries.delete(entry);
    for (const binding of entry.bindings) this.deleteBinding(binding, entry);

    const instances = [...entry.instances];
    entry.instances.clear();
    let firstError: unknown;
    for (const instance of instances) {
      try {
        instance.destroy();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}

export function createDocumentSurfaceRegistry(): DocumentSurfaceRegistry {
  return new DocumentSurfaceRegistry();
}
