import {
  createDocumentSurfaceRegistry,
  type DocumentSurfaceRegistry,
  type SurfaceRequest,
} from "./core/registry";
import {
  createMarkdownSurfaceFactory,
  plainTextSurfaceFactory,
  type MarkdownSurfaceFactoryOptions,
} from "./text/factories";

export interface SurfaceRegistryBootstrap {
  readonly registry: DocumentSurfaceRegistry;
  readonly dispose: () => void;
}

export interface SurfaceRegistryBootstrapOptions {
  /// Servizi Markdown posseduti dalla composizione della shell, non dal mount generico.
  readonly markdown?: Pick<MarkdownSurfaceFactoryOptions, "callbacks" | "completions">;
}

const MARKDOWN_EXTENSIONS: Record<string, true> = {
  md: true,
  markdown: true,
};
const PLAIN_TEXT_EXTENSIONS: Record<string, true> = {
  plain: true,
  text: true,
  txt: true,
};
const BYTE_EXTENSIONS: Record<string, true> = {
  bin: true,
  blob: true,
  bytes: true,
  dat: true,
  opaque: true,
  binary: true,
};
const MARKDOWN_REQUEST: SurfaceRequest = {
  family: "text",
  profile: "markdown",
  formatKey: "md",
  species: "text/markdown",
};
const PLAIN_TEXT_REQUEST: SurfaceRequest = {
  family: "text",
  profile: "plain-text",
  formatKey: "txt",
  species: "text/plain",
};

// temporary format inference: provider extensions are not format identities.
export function surfaceRequestForDocument(id: string): SurfaceRequest {
  const normalizedId = id.trim().toLowerCase();
  const name = id.slice(Math.max(id.lastIndexOf("/"), id.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  const extension =
    dot > 0 ? name.slice(dot + 1).trim().toLowerCase().replace(/^\.+/, "") : "";

  if (
    normalizedId === "bytes" ||
    normalizedId === "binary" ||
    BYTE_EXTENSIONS[extension] === true
  ) {
    return { species: "bytes" };
  }

  if (normalizedId === "text/plain" || PLAIN_TEXT_EXTENSIONS[extension] === true) {
    return PLAIN_TEXT_REQUEST;
  }

  if (
    normalizedId === "text/markdown" ||
    MARKDOWN_EXTENSIONS[extension] === true
  ) {
    return MARKDOWN_REQUEST;
  }

  return { family: "text", profile: "unknown" };
}

/** Boots shell-owned text bindings and keeps one disposer for their lifecycle. */
export function bootstrapSurfaceRegistry(
  options: SurfaceRegistryBootstrapOptions = {},
): SurfaceRegistryBootstrap {
  const markdownSurfaceFactory = createMarkdownSurfaceFactory(options.markdown);
  const registry = createDocumentSurfaceRegistry();
  const disposers = [
    registry.register({
      owner: "shell",
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
      factory: markdownSurfaceFactory,
    }),
    registry.register({
      owner: "shell",
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
      factory: plainTextSurfaceFactory,
    }),
  ];

  let disposed = false;
  return {
    registry,
    dispose() {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;
      for (const dispose of [...disposers].reverse()) {
        try {
          dispose();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) throw firstError;
    },
  };
}
