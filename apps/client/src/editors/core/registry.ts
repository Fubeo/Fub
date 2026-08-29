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
}

export type SurfaceOverride = SurfaceOverrideReference | string;

export interface SurfaceOverrideReference {
  readonly registrationId?: string;
  readonly owner?: string;
  readonly formatKey?: string;
  readonly family?: string;
  readonly profile?: string;
}

export interface SurfaceFactory {
  readonly family: string;
  readonly profile?: string;
  readonly version?: SurfaceVersion;
  readonly supportedVersions?: readonly number[];
  mount(request: SurfaceRequest, context: SurfaceMountContext): EditorSurface;
}

declare const SURFACE_SELECTION_KEY: unique symbol;

export type SurfaceSelectionKey = string & {
  readonly [SURFACE_SELECTION_KEY]: true;
};

export interface ResolvedSurface {
  readonly key: SurfaceSelectionKey;
  readonly factory: SurfaceFactory;
}

export interface SurfaceRegistration {
  readonly registrationId?: string;
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
  readonly kind: "formatKey" | "species";
  readonly key: string;
  readonly label: string;
}

interface Entry {
  readonly registration: SurfaceRegistration;
  readonly selectionKey: SurfaceSelectionKey;
  readonly familyProfileKey: string;
  readonly bindings: readonly Binding[];
  readonly instances: Set<EditorSurface>;
  active: boolean;
}

interface Selection extends ResolvedSurface {
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

const TEXTUAL_FALLBACK_SELECTION_KEY =
  "builtin:text-fallback" as SurfaceSelectionKey;
const BYTE_VIEWER_SELECTION_KEY = "builtin:byte-viewer" as SurfaceSelectionKey;

let nextSurfaceId = 1;
let nextRegistrationId = 1;
let nextSelectionKey = 1;


function errorSelection(reason: string): Selection {
  return {
    key: `builtin:error:${reason}` as SurfaceSelectionKey,
    factory: errorFactory(reason),
  };
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function familyProfileKey(family: string, profile: string | undefined): string {
  return `${family}${FAMILY_PROFILE_SEPARATOR}${profile ?? ""}`;
}
function registrationProfile(registration: SurfaceRegistration): string | undefined {
  return registration.profile ?? registration.factory.profile;
}

// Collisioni solo sui binding esatti di formato e specie. La coppia
// family+profile serve alla risoluzione, ma può avere più registrazioni.
function bindingDescriptors(registration: SurfaceRegistration): Binding[] {
  const bindings: Binding[] = [];
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
  return bindings;
}

function isFactory(value: unknown): value is SurfaceFactory {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SurfaceFactory>;
  return typeof candidate.family === "string" && typeof candidate.mount === "function";
}
function exposeRegistrationId(
  registration: SurfaceRegistration,
  registrationId: string,
): void {
  if (registration.registrationId === registrationId) return;
  try {
    Object.defineProperty(registration, "registrationId", {
      configurable: true,
      enumerable: true,
      value: registrationId,
      writable: false,
    });
  } catch {
    // A frozen input still has the normalized id in the registry entry.
  }
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

function manageSurface(inner: EditorSurface, entry: Entry | undefined): EditorSurface {
  let managed: EditorSurface;
  let destroyed = false;

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    if (entry !== undefined) entry.instances.delete(managed);
    inner.destroy();
  };

  managed = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "destroy") return destroy;
      return Reflect.get(target, property, receiver);
    },
  });
  return managed;
}

export class DocumentSurfaceRegistry {
  private readonly entries = new Set<Entry>();
  private readonly registrationBindings = new Map<string, Entry>();
  private readonly formatBindings = new Map<string, Entry>();
  private readonly speciesBindings = new Map<string, Entry>();
  private readonly familyProfileBindings = new Map<string, Entry[]>();

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

    const registrationId = hasText(registration.registrationId)
      ? registration.registrationId
      : `surface-registration-${nextRegistrationId++}`;
    const normalized: SurfaceRegistration = { ...registration, registrationId };
    const existingById = this.registrationBindings.get(registrationId);
    if (existingById !== undefined) {
      throw new Error(
        `Collisione della registrationId "${registrationId}": owner coinvolti ` +
          `"${existingById.registration.owner}" e "${normalized.owner}".`,
      );
    }

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
      selectionKey: `registration:${nextSelectionKey++}` as SurfaceSelectionKey,
      familyProfileKey: familyProfileKey(
        normalized.family,
        registrationProfile(normalized),
      ),
      bindings,
      instances: new Set(),
      active: true,
    };
    this.entries.add(entry);
    this.registrationBindings.set(registrationId, entry);
    for (const binding of bindings) this.setBinding(binding, entry);
    const familyEntries = this.familyProfileBindings.get(entry.familyProfileKey) ?? [];
    familyEntries.push(entry);
    this.familyProfileBindings.set(entry.familyProfileKey, familyEntries);
    exposeRegistrationId(registration, registrationId);

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

  select(request: SurfaceRequest): ResolvedSurface {
    const selection = this.selectSelection(request);
    return { key: selection.key, factory: selection.factory };
  }

  mount(request: SurfaceRequest, context: SurfaceMountContext): EditorSurface {
    const selection = this.selectSelection(request);
    const inner = selection.factory.mount(request, context);
    const surface = manageSurface(inner, selection.entry);
    if (selection.entry?.active) selection.entry.instances.add(surface);
    return surface;
  }

  private selectSelection(request: SurfaceRequest): Selection {
    const override = request.override ?? request.userOverride;
    if (override !== undefined) {
      const selected = this.selectionForOverride(override);
      if (selected === undefined) {
        return errorSelection("override utente non registrato");
      }
      if (
        selected.entry !== undefined &&
        !supportsVersion(
          selected.entry.registration,
          selected.factory,
          request.version,
        )
      ) {
        return errorSelection(
          `${versionDescription(request.version)} non supportata dall'override utente`,
        );
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

    // La coppia family/profile è considerata dopo i binding esatti. Più
    // registrazioni possono dichiararla: in quel caso non si sceglie l'ultima.
    if (hasText(request.family) && request.profile !== undefined) {
      const entries = this.familyProfileBindings.get(
        familyProfileKey(request.family, request.profile),
      );
      if (entries !== undefined) {
        if (entries.length === 1) {
          return this.selectionForEntry(entries[0], request);
        }
        if (entries.length > 1) {
          const owners = [...new Set(entries.map((entry) => entry.registration.owner))];
          return errorSelection(
            `selezione ambigua per family=${request.family}, profile=${request.profile}: ` +
              `owner coinvolti ${owners.map((owner) => `"${owner}"`).join(" e ")}`,
          );
        }
      }
    }

    if (isByteRequest(request)) {
      if (!supportsVersion(undefined, byteViewerFactory, request.version)) {
        return errorSelection(
          `${versionDescription(request.version)} non supportata dal viewer a byte`,
        );
      }
      return { key: BYTE_VIEWER_SELECTION_KEY, factory: byteViewerFactory };
    }

    if (isTextualRequest(request)) {
      if (!supportsVersion(undefined, textualFallbackFactory, request.version)) {
        return errorSelection(
          `${versionDescription(request.version)} non supportata dal fallback testuale`,
        );
      }
      return {
        key: TEXTUAL_FALLBACK_SELECTION_KEY,
        factory: textualFallbackFactory,
      };
    }

    return errorSelection(
      `famiglia superficie sconosciuta: ${request.family ?? "assente"}`,
    );
  }

  private selectionForOverride(override: SurfaceOverride): Selection | undefined {
    if (typeof override === "string") {
      const byRegistrationId = this.registrationBindings.get(override);
      if (byRegistrationId !== undefined) {
        return {
          key: byRegistrationId.selectionKey,
          factory: byRegistrationId.registration.factory,
          entry: byRegistrationId,
        };
      }
      const byFormatKey = this.formatBindings.get(override);
      if (byFormatKey !== undefined) {
        return {
          key: byFormatKey.selectionKey,
          factory: byFormatKey.registration.factory,
          entry: byFormatKey,
        };
      }
      return undefined;
    }
    if (typeof override !== "object" || override === null) return undefined;
    if (isFactory(override) || "factory" in override) return undefined;
    return this.selectionForReference(override);
  }

  private selectionForReference(reference: SurfaceOverrideReference): Selection | undefined {
    if (hasText(reference.registrationId)) {
      const entry = this.registrationBindings.get(reference.registrationId);
      if (entry === undefined) return undefined;
      return {
        key: entry.selectionKey,
        factory: entry.registration.factory,
        entry,
      };
    }

    if (hasText(reference.formatKey)) {
      const entry = this.formatBindings.get(reference.formatKey);
      if (entry === undefined) return undefined;
      if (hasText(reference.owner) && entry.registration.owner !== reference.owner) {
        return undefined;
      }
      return {
        key: entry.selectionKey,
        factory: entry.registration.factory,
        entry,
      };
    }

    if (
      hasText(reference.owner) &&
      hasText(reference.family) &&
      reference.profile !== undefined
    ) {
      const entries =
        this.familyProfileBindings.get(
          familyProfileKey(reference.family, reference.profile),
        ) ?? [];
      const matching = entries.filter(
        (entry) => entry.registration.owner === reference.owner,
      );
      if (matching.length === 0) return undefined;
      if (matching.length > 1) {
        const owners = [...new Set(matching.map((entry) => entry.registration.owner))];
        return errorSelection(
          `override utente ambiguo per family=${reference.family}, ` +
            `profile=${reference.profile}: owner coinvolti ${owners
              .map((owner) => `"${owner}"`)
              .join(" e ")}`,
        );
      }
      const entry = matching[0];
      return {
        key: entry.selectionKey,
        factory: entry.registration.factory,
        entry,
      };
    }

    return undefined;
  }

  private selectionForEntry(entry: Entry, request: SurfaceRequest): Selection {
    if (!supportsVersion(entry.registration, entry.registration.factory, request.version)) {
      return errorSelection(
        `${versionDescription(request.version)} non supportata dall'owner ${entry.registration.owner}`,
      );
    }
    return {
      key: entry.selectionKey,
      factory: entry.registration.factory,
      entry,
    };
  }

  private bindingFor(binding: Binding): Entry | undefined {
    switch (binding.kind) {
      case "formatKey":
        return this.formatBindings.get(binding.key);
      case "species":
        return this.speciesBindings.get(binding.key);
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
    }
  }

  private deleteBinding(binding: Binding, entry: Entry): void {
    const map = binding.kind === "formatKey" ? this.formatBindings : this.speciesBindings;
    if (map.get(binding.key) === entry) map.delete(binding.key);
  }

  private deleteFamilyProfileBinding(entry: Entry): void {
    const entries = this.familyProfileBindings.get(entry.familyProfileKey);
    if (entries === undefined) return;
    const remaining = entries.filter((candidate) => candidate !== entry);
    if (remaining.length === 0) this.familyProfileBindings.delete(entry.familyProfileKey);
    else this.familyProfileBindings.set(entry.familyProfileKey, remaining);
  }

  private unregister(entry: Entry): void {
    if (!entry.active) return;
    entry.active = false;
    this.entries.delete(entry);
    const registrationId = entry.registration.registrationId;
    if (
      registrationId !== undefined &&
      this.registrationBindings.get(registrationId) === entry
    ) {
      this.registrationBindings.delete(registrationId);
    }
    for (const binding of entry.bindings) this.deleteBinding(binding, entry);
    this.deleteFamilyProfileBinding(entry);

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
