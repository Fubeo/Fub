import type { Theme } from "../../theme/theme";
import type { SourceKind } from "../../host/enums.generated";
import type {
  DocumentUpdate,
  EditorChange,
  EditorSelections,
} from "../text/engine";

export type SurfaceFamily = "text" | "grid" | "structured" | "canvas" | "viewer" | "error";

export interface SurfaceOverride {
  readonly family: SurfaceFamily;
  readonly profile?: string;
}

export interface SurfaceRequest {
  readonly formatId: string | null;
  readonly sourceKind: SourceKind;
  readonly override?: SurfaceOverride;
}

export interface SurfaceMountContext {
  readonly paneId: string;
  readonly documentId: string;
  readonly parent: HTMLElement;
}

/** A mounted shell-owned surface. No DOM or CodeMirror value crosses its boundary. */
export interface EditorSurface {
  readonly family: SurfaceFamily;
  readonly profile: string;
  readonly surfaceId: string;
  setDoc(text: string): void;
  syncDoc(update: DocumentUpdate | string): void;
  getDoc(): string;
  focus?(): void;
  revealByteOffset?(byteOffset: number): void;
  selections?(): EditorSelections | undefined;
  setReadOnly?(readOnly: boolean): void;
  setTheme?(theme: Theme): void;
  destroy(): void;
}

export interface SurfaceFactory {
  mount(profile: string, context: SurfaceMountContext): EditorSurface;
}

export interface SurfaceRegistration {
  readonly owner: string;
  readonly family: SurfaceFamily;
  readonly defaultProfile: string;
  readonly factory: SurfaceFactory;
  readonly formats?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Partial<Record<SourceKind, string>>>;
}

export interface ResolvedSurface {
  readonly owner: string;
  readonly family: SurfaceFamily;
  readonly profile: string;
  readonly factory: SurfaceFactory;
}

interface RegistrationRecord extends SurfaceRegistration {
  readonly formats: Readonly<Record<string, string>>;
  readonly sources: Readonly<Partial<Record<SourceKind, string>>>;
}

interface Binding {
  readonly registration: RegistrationRecord;
  readonly profile: string;
}

interface MountedSurface {
  readonly registration: RegistrationRecord;
  readonly surface: EditorSurface;
  active: boolean;
}

export class SurfaceRegistrationConflict extends Error {
  constructor(
    readonly key: string,
    readonly existingOwner: string,
    readonly incomingOwner: string,
  ) {
    super(`surface registration ${key} is owned by ${existingOwner}, not ${incomingOwner}`);
    this.name = "SurfaceRegistrationConflict";
  }
}

function required(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty`);
  return normalized;
}

/** Owns family bindings and every instance mounted through those bindings. */
export class DocumentSurfaceRegistry {
  readonly #families = new Map<SurfaceFamily, RegistrationRecord>();
  readonly #formats = new Map<string, Binding>();
  readonly #sources = new Map<SourceKind, Binding>();
  readonly #mounted = new Set<MountedSurface>();

  register(registration: SurfaceRegistration): () => void {
    const owner = required("surface owner", registration.owner);
    const family = registration.family;
    const defaultProfile = required("surface default profile", registration.defaultProfile);
    const formats = Object.fromEntries(
      Object.entries(registration.formats ?? {}).map(([format, profile]) => [
        required("format id", format),
        required(`profile for format ${format}`, profile),
      ]),
    );
    const sources = Object.fromEntries(
      Object.entries(registration.sources ?? {}).map(([source, profile]) => [
        source,
        required(`profile for source ${source}`, profile),
      ]),
    ) as Partial<Record<SourceKind, string>>;

    const occupiedFamily = this.#families.get(family);
    if (occupiedFamily) {
      throw new SurfaceRegistrationConflict(`family:${family}`, occupiedFamily.owner, owner);
    }
    for (const format of Object.keys(formats)) {
      const occupied = this.#formats.get(format);
      if (occupied) {
        throw new SurfaceRegistrationConflict(`format:${format}`, occupied.registration.owner, owner);
      }
    }
    for (const source of Object.keys(sources) as SourceKind[]) {
      const occupied = this.#sources.get(source);
      if (occupied) {
        throw new SurfaceRegistrationConflict(`source:${source}`, occupied.registration.owner, owner);
      }
    }

    const record: RegistrationRecord = {
      owner,
      family,
      defaultProfile,
      factory: registration.factory,
      formats,
      sources,
    };
    this.#families.set(family, record);
    for (const [format, profile] of Object.entries(formats)) {
      this.#formats.set(format, { registration: record, profile });
    }
    for (const [source, profile] of Object.entries(sources) as [SourceKind, string][]) {
      this.#sources.set(source, { registration: record, profile });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#unregister(record);
    };
  }

  resolve(request: SurfaceRequest): ResolvedSurface | null {
    if (request.override) {
      const overridden = this.#families.get(request.override.family);
      if (overridden) {
        return this.#resolved(overridden, request.override.profile ?? overridden.defaultProfile);
      }
    }
    if (request.formatId) {
      const exact = this.#formats.get(request.formatId);
      if (exact) return this.#resolved(exact.registration, exact.profile);
    }
    const source = this.#sources.get(request.sourceKind);
    if (source) return this.#resolved(source.registration, source.profile);
    const error = this.#families.get("error");
    return error ? this.#resolved(error, error.defaultProfile) : null;
  }

  mount(request: SurfaceRequest, context: SurfaceMountContext): EditorSurface {
    const resolved = this.resolve(request);
    if (!resolved) {
      throw new Error(
        `no surface for format ${request.formatId ?? "unknown"} and source ${request.sourceKind}`,
      );
    }
    const registration = this.#families.get(resolved.family);
    if (!registration || registration.owner !== resolved.owner) {
      throw new Error(`surface family ${resolved.family} was unregistered before mount`);
    }
    const surface = resolved.factory.mount(resolved.profile, context);
    if (surface.family !== resolved.family) {
      surface.destroy();
      throw new Error(
        `surface factory ${resolved.owner} returned family ${surface.family}, expected ${resolved.family}`,
      );
    }
    const mounted: MountedSurface = { registration, surface, active: true };
    this.#mounted.add(mounted);
    return this.#ownedSurface(mounted);
  }

  #resolved(registration: RegistrationRecord, profile: string): ResolvedSurface {
    return {
      owner: registration.owner,
      family: registration.family,
      profile,
      factory: registration.factory,
    };
  }

  #ownedSurface(mounted: MountedSurface): EditorSurface {
    const registry = this;
    return new Proxy(mounted.surface, {
      get(target, property, receiver) {
        if (property !== "destroy") return Reflect.get(target, property, receiver);
        return () => {
          if (!mounted.active) return;
          mounted.active = false;
          registry.#mounted.delete(mounted);
          target.destroy();
        };
      },
    });
  }

  #unregister(registration: RegistrationRecord): void {
    if (this.#families.get(registration.family) === registration) {
      this.#families.delete(registration.family);
    }
    for (const format of Object.keys(registration.formats)) {
      if (this.#formats.get(format)?.registration === registration) this.#formats.delete(format);
    }
    for (const source of Object.keys(registration.sources) as SourceKind[]) {
      if (this.#sources.get(source)?.registration === registration) this.#sources.delete(source);
    }

    const failures: unknown[] = [];
    for (const mounted of [...this.#mounted]) {
      if (mounted.registration !== registration) continue;
      this.#mounted.delete(mounted);
      mounted.active = false;
      try {
        mounted.surface.destroy();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, `failed to destroy surfaces owned by ${registration.owner}`);
  }
}

export interface SurfaceCallbacks {
  onChange(paneId: string, change: EditorChange): void;
  onSelectionChange(paneId: string): void;
}
