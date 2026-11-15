import { describe, expect, it } from "vitest";
import { declaredSha256, renderEntitiesModule } from "../../../../../scripts/html-entities.mjs";
import written from "./html-entities.generated.ts?raw";
import { HTML_NAMED_ENTITIES } from "./html-entities.generated";
import upstream from "../../../../../../../vendor/whatwg-entities/UPSTREAM.md?raw";
import source from "../../../../../../../vendor/whatwg-entities/entities.json?raw";

/// Lo sha256 di un testo, come lo calcola lo script sui byte del file.
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// La stessa promessa di `npm run entities:verify`, dentro `npm test`: la copia
// della specifica è quella dichiarata, e la tabella è quella che produce.
describe("la tabella delle entità generata", () => {
  it("la copia in vendor ha lo sha256 scritto in UPSTREAM.md", async () => {
    expect(await sha256(source)).toBe(declaredSha256(upstream));
  });

  it("rigenerata dà gli stessi byte del file scritto", () => {
    expect(renderEntitiesModule(source)).toBe(written);
  });

  it("ha soltanto i nomi con `;` e niente dal prototipo", () => {
    const names = Object.keys(HTML_NAMED_ENTITIES);
    expect(names.length).toBe(Object.keys(JSON.parse(source) as object).filter((key) => key.endsWith(";")).length);
    expect(Object.getPrototypeOf(HTML_NAMED_ENTITIES)).toBeNull();
    expect(Object.isFrozen(HTML_NAMED_ENTITIES)).toBe(true);
  });
});
