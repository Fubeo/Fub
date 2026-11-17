import { describe, expect, it } from "vitest";
import { formatSectionAnchor, parseSectionAnchor, resolveSectionAnchor, type SectionAnchor } from "./section-anchor";

function slice(text: string, anchor: string, near?: number): string | null {
  const parsed = parseSectionAnchor(anchor);
  if (!parsed) throw new Error(`àncora non valida: ${anchor}`);
  const span = resolveSectionAnchor(text, parsed, near);
  return span ? text.slice(span.from, span.to) : null;
}

describe("l'àncora di un tratto", () => {
  it("legge titoli e id come li scrive un link", () => {
    expect(parseSectionAnchor("#Riunione del 4")).toEqual({ kind: "heading", heading: "Riunione del 4" });
    expect(parseSectionAnchor("^abc-1")).toEqual({ kind: "block", id: "abc-1" });
    expect(parseSectionAnchor("#^abc")).toEqual({ kind: "block", id: "abc" });
    expect(parseSectionAnchor("#")).toBeNull();
    expect(parseSectionAnchor("#^a b")).toBeNull();
    const anchors: SectionAnchor[] = [{ kind: "heading", heading: "Titolo" }, { kind: "block", id: "x" }];
    expect(anchors.map(formatSectionAnchor)).toEqual(["#Titolo", "#^x"]);
  });

  it("la sezione va dal titolo al prossimo di livello pari o superiore, senza le righe vuote in coda", () => {
    const text = "# A\n\n## B\n\nUno.\n\n### C\n\nDue.\n\n## D\n\nTre.\n";
    expect(slice(text, "#B")).toBe("## B\n\nUno.\n\n### C\n\nDue.");
    expect(slice(text, "#C")).toBe("### C\n\nDue.");
    expect(slice(text, "#D")).toBe("## D\n\nTre.");
    expect(slice(text, "#Z")).toBeNull();
  });

  it("trova il titolo per slug o per testo, fuori dal codice e dal frontmatter", () => {
    const text = "---\ntitle: x\n---\n```\n# Finto\n```\n## Perché **no**\n\nCorpo.\n";
    expect(slice(text, "#Finto")).toBeNull();
    expect(slice(text, "#perché-no")).toBe("## Perché **no**\n\nCorpo.");
    expect(slice(text, "#Perché no")).toBe("## Perché **no**\n\nCorpo.");
  });

  it("i titoli setext e i doppioni, col più vicino a `near`", () => {
    const text = "Titolo\n===\n\nUno.\n\nTitolo\n===\n\nDue.\n";
    expect(slice(text, "#Titolo")).toBe("Titolo\n===\n\nUno.");
    expect(slice(text, "#Titolo", text.indexOf("Due."))).toBe("Titolo\n===\n\nDue.");
    expect(slice(text, "#titolo-1")).toBe("Titolo\n===\n\nDue.");
  });

  it("il blocco di un id in coda e quello di un id su una riga sua", () => {
    const text = "Sopra.\n\nRiga uno\nriga due ^p1\n\n- voce\n- altra ^v2\n\n| a |\n| - |\n\n^t3\n";
    expect(slice(text, "#^p1")).toBe("Riga uno\nriga due ^p1");
    expect(slice(text, "#^v2")).toBe("- altra ^v2");
    expect(slice(text, "#^t3")).toBe("| a |\n| - |\n\n^t3");
    expect(slice(text, "#^P1")).toBe("Riga uno\nriga due ^p1");
    expect(slice(text, "#^zz")).toBeNull();
  });

  it("un id dentro un blocco di codice non è un'àncora", () => {
    expect(slice("```\nx ^c\n```\n", "#^c")).toBeNull();
  });
});
