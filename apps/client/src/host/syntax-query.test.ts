import { describe, expect, it } from "vitest";

import { createFakeHost } from "./fake";
import type { SyntaxForm } from "./contract";

describe("runtime syntax query", () => {
  it("the fake host returns the same declared forms shape as the native channel", async () => {
    const declared: SyntaxForm[] = [
      {
        name: "third.party:spoiler",
        trigger: { inline: { open: "||", close: "||" } },
      },
    ];
    const host = createFakeHost({ syntaxForms: declared });

    await expect(
      host.module.api.queryIndex({ kind: "syntax_forms", doc: "Note.md" }),
    ).resolves.toEqual({ kind: "syntax_forms", value: declared });
  });
});
