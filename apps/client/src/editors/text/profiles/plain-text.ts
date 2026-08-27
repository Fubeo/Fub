import type { Extension } from "@codemirror/state";

export interface PlainTextProfile {
  /// Produces the profile extension for the TextEngine seam.
  extensions(): Extension;
}

/// A deliberately empty profile: plain text has no domain syntax or commands.
export function createPlainTextProfile(): PlainTextProfile {
  return {
    extensions: () => [],
  };
}
