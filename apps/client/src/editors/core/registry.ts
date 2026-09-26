import type { Theme } from "../../theme/theme";
import type { SourceKind } from "../../host/enums.generated";
import type { PaneMode, SelectionSet, Span, SyntaxForm } from "../../host/contract";
import type { DocumentUpdate, EditorChange } from "./text-operation";

/**
 * The family of a surface: a name its registration owns, one owner at a time.
 * The shell registers `text`, `grid`, `structured`, `canvas`, `viewer` and
 * `error`; another owner names its own family.
 */
export type SurfaceFamily = string;

export interface SurfaceOverride {
  readonly family: SurfaceFamily;
  readonly profile?: string;
}

export interface SurfaceRequest {
  readonly formatId: string | null;
  readonly sourceKind: SourceKind;
  /** Optional vault id for source-family profile selection (e.g. local media). */
  readonly documentId?: string;
  readonly override?: SurfaceOverride;
}

export interface SurfaceMode {
  readonly id: string;
  readonly label: () => string;
  readonly presentation: "surface" | "rendered";
  /**
   * What a provider learns of this mode from the session context: the source
   * as stored, a rendering the user edits, or a rendering without a caret.
   */
  readonly contextMode: PaneMode;
}

export interface SurfaceMountContext {
  readonly paneId: string;
  readonly documentId: string;
  readonly parent: HTMLElement;
  readonly formatId?: string | null;
  readonly revision?: string;
  /** Detail of a rejected document, displayed only by the inert error surface. */
  readonly errorReason?: string;
}

/** A selected range, in UTF-8 bytes of the document source, with its text. */
export interface EditorRange {
  start: number;
  end: number;
  text: string;
}

export interface EditorSelections {
  primary: EditorRange;
  secondary: EditorRange[];
}

/**
 * What a structured surface has selected (canvas cards, a range of cells), as
 * the text of each item. The items are not byte ranges of the source, so the
 * context publishes them floating: the text is true, coordinates there are
 * none.
 */
export interface SelectedText {
  primary: string;
  secondary: string[];
}

/// Le selezioni che un riquadro pubblica, cioè ciò che il contesto dice al
/// kernel. Una superficie di testo dà
/// intervalli del sorgente: ancorati a buffer pulito, fluttuanti a buffer
/// sporco. Il buffer è UNO, e il suo stato decide per tutte le selezioni
/// insieme: è la ragione per cui il caso si sceglie qui, una volta, e non
/// dentro ogni selezione (decisione 0093). Una superficie strutturata (tela,
/// foglio) sceglie elementi e non intervalli: il loro testo viaggia sempre
/// senza coordinate. `null` quando la superficie non dice niente.
export function selectionSetOf(
  surface: Pick<EditorSurface, "selections" | "selectedText"> | undefined,
  dirty: boolean,
): SelectionSet | null {
  const sel = surface?.selections?.();
  if (sel === undefined) {
    const items = surface?.selectedText?.() ?? null;
    if (!items) return null;
    return {
      kind: "floating",
      value: { primary: { text: items.primary }, secondary: items.secondary.map((text) => ({ text })) },
    };
  }
  return dirty
    ? {
        kind: "floating",
        value: {
          primary: { text: sel.primary.text },
          secondary: sel.secondary.map((s) => ({ text: s.text })),
        },
      }
    : {
        kind: "anchored",
        value: {
          primary: { span: { start: sel.primary.start, end: sel.primary.end }, text: sel.primary.text },
          secondary: sel.secondary.map((s) => ({
            span: { start: s.start, end: s.end },
            text: s.text,
          })),
        },
      };
}

/**
 * The document text a surface edits: the session's buffer, as this surface
 * holds it. A surface that shows the document some other way (the bytes of a
 * media file, a message) has no buffer, and fakes none.
 */
export interface SurfaceBuffer {
  setDoc(text: string): void;
  syncDoc(update: DocumentUpdate | string): void;
  getDoc(): string;
}

/**
 * A place in the document, in the model's currency: UTF-8 byte offsets of the
 * source (`Span`). Each surface reads it its own way: a text profile moves the
 * cursor there, the canvas selects the card whose source holds it.
 */
export interface SurfaceLocation {
  readonly span: Span;
}

/**
 * Another vault entry, to refer to from inside the document. The surface
 * writes it in the document's own syntax: the shell says what, never how.
 */
export type SurfaceReference =
  /** A resource just deposited, as a URL relative to the document. */
  | { readonly kind: "attachment"; readonly link: string }
  /** A note, by the shortest name that resolves to it in this vault. */
  | { readonly kind: "note"; readonly name: string };

/** A point on screen, in client coordinates: where something was dropped. */
export interface SurfacePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A mounted shell-owned surface. No DOM or CodeMirror value crosses its
 * boundary. Past the first five members everything is a capability: the shell
 * offers a gesture where the mounted surface declares it, and never asks which
 * family or profile it is.
 */
export interface EditorSurface {
  readonly family: SurfaceFamily;
  readonly profile: string;
  readonly surfaceId: string;
  readonly modes: readonly SurfaceMode[];
  /**
   * The mode a pane opens this surface in when it remembers none for its
   * family; the first declared one when absent.
   */
  readonly defaultMode?: string;
  setMode(mode: string): void;
  /** The document text, when this surface edits it. */
  readonly buffer?: SurfaceBuffer;
  focus?(): void;
  /**
   * Brings the view to a place in the document. `false` when this surface
   * cannot get there, so that the shell says it instead of doing nothing.
   */
  reveal?(location: SurfaceLocation): boolean;
  selections?(): EditorSelections | undefined;
  /**
   * A surface without text ranges says what it has selected here instead of
   * `selections`; `null` when nothing is.
   */
  selectedText?(): SelectedText | null;
  setReadOnly?(readOnly: boolean): void;
  setTheme?(theme: Theme): void;
  /** The syntax the vault declares for this document (tags, wikilinks, ...). */
  setSyntaxForms?(forms: readonly SyntaxForm[]): void;
  /**
   * Writes references to other vault entries into the document, at the point
   * where they were dropped or else at the cursor. It is a user edit: it goes
   * to the session and into the local history. `false` when the surface cannot
   * write now (read-only, closed).
   */
  insertReferences?(references: readonly SurfaceReference[], at?: SurfacePoint): boolean;
  /** Mounts the document rendered for a presentation into `host`; returns its teardown. */
  mountPresentation?(host: HTMLElement): () => void;
  /**
   * The document has a print rendering worth offering. The core draws it from
   * the format's provider (`IndexQuery::RenderPrint`): a surface whose format
   * has no provider, or nothing to print, does not declare it.
   */
  readonly printable?: boolean;
  destroy(): void;
}

/** A surface that edits the document text: what a text-backed format mounts. */
export type BufferedSurface = EditorSurface & { readonly buffer: SurfaceBuffer };

export interface SurfaceFactory {
  mount(profile: string, context: SurfaceMountContext): EditorSurface;
}

export interface SurfaceRegistration {
  readonly owner: string;
  readonly family: SurfaceFamily;
  readonly defaultProfile: string;
  /** Every profile a binding or explicit override may select for this family. */
  readonly profiles?: readonly string[];
  readonly factory: SurfaceFactory;
  readonly formats?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Partial<Record<SourceKind, string>>>;
  /**
   * Select a registered profile when the source binding alone is too broad, or
   * `null` when this binding does not show the requested document.
   */
  readonly selectSourceProfile?: (request: SurfaceRequest, fallback: string) => string | null;
}

export interface ResolvedSurface {
  readonly owner: string;
  readonly family: SurfaceFamily;
  readonly profile: string;
  readonly factory: SurfaceFactory;
}

interface RegistrationRecord extends SurfaceRegistration {
  readonly profileSet: ReadonlySet<string>;
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
    const profiles = new Set<string>([defaultProfile]);
    for (const profile of registration.profiles ?? []) {
      profiles.add(required("surface profile", profile));
    }
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
    for (const [binding, profile] of [
      ...Object.entries(formats).map(([key, value]) => [`format:${key}`, value] as const),
      ...Object.entries(sources).map(([key, value]) => [`source:${key}`, value] as const),
    ]) {
      if (!profiles.has(profile)) {
        throw new TypeError(`surface binding ${binding} selects unregistered profile ${profile}`);
      }
    }

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
      profileSet: profiles,
      factory: registration.factory,
      formats,
      sources,
      selectSourceProfile: registration.selectSourceProfile,
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
        const profile = request.override.profile ?? overridden.defaultProfile;
        if (overridden.profileSet.has(profile)) return this.#resolved(overridden, profile);
      }
    }
    if (request.formatId) {
      const exact = this.#formats.get(request.formatId);
      if (exact) return this.#resolved(exact.registration, exact.profile);
    }
    const source = this.#sources.get(request.sourceKind);
    const profile = source ? this.#sourceProfile(source, request) : null;
    if (source && profile !== null) return this.#resolved(source.registration, profile);
    const error = this.#families.get("error");
    return error ? this.#resolved(error, error.defaultProfile) : null;
  }

  /**
   * Whether a document can be shown from its bytes, without reading it as
   * text. The owner of the `bytes` source binding decides from the id alone:
   * it is the only place that classifies such a file, and the shell asks here
   * instead of guessing from the extension.
   */
  showsBytes(documentId: string): boolean {
    const source = this.#sources.get("bytes");
    return !!source && this.#sourceProfile(source, { formatId: null, sourceKind: "bytes", documentId }) !== null;
  }

  #sourceProfile(source: Binding, request: SurfaceRequest): string | null {
    const selected = source.registration.selectSourceProfile;
    const profile = selected ? selected(request, source.profile) : source.profile;
    if (profile !== null && !source.registration.profileSet.has(profile)) {
      throw new Error(`surface owner ${source.registration.owner} selected unregistered profile ${profile}`);
    }
    return profile;
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
    if (surface.family !== resolved.family || surface.profile !== resolved.profile) {
      surface.destroy();
      throw new Error(
        `surface factory ${resolved.owner} returned ${surface.family}/${surface.profile}, expected ${resolved.family}/${resolved.profile}`,
      );
    }
    const modeIds = new Set<string>();
    for (const mode of surface.modes) {
      const id = required("surface mode id", mode.id);
      if (modeIds.has(id)) {
        surface.destroy();
        throw new Error(`surface ${surface.surfaceId} declares mode ${id} more than once`);
      }
      modeIds.add(id);
    }
    if (modeIds.size === 0) {
      surface.destroy();
      throw new Error(`surface ${surface.surfaceId} declares no modes`);
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
