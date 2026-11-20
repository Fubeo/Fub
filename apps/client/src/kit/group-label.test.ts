// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { accessibleName } from "../ui/a11y-check";
import { createGroupLabel } from "./group-label";

afterEach(() => {
  document.body.replaceChildren();
});

describe("createGroupLabel", () => {
  it("per chi guarda: chi ascolta sente il nome che il gruppo porta già", () => {
    const label = createGroupLabel({ text: "Altri comandi", className: "menu-group-label" });
    expect(label.className).toBe("kit-group-label menu-group-label");
    expect(label.textContent).toBe("Altri comandi");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(label.hasAttribute("data-sticky")).toBe(false);
  });

  it("con `labels` diventa il nome del gruppo, detto una volta sola", () => {
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "vecchio");
    const label = createGroupLabel({ text: "Blocchi", labels: group });
    group.append(label);
    document.body.append(group);
    expect(label.hasAttribute("aria-hidden")).toBe(false);
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
    expect(group.hasAttribute("aria-label")).toBe(false);
    expect(accessibleName(group)).toBe("Blocchi");
    // Due etichette non si rubano il nome.
    expect(createGroupLabel({ text: "Altro", labels: document.createElement("div") }).id).not.toBe(label.id);
  });

  it("resta in cima mentre l'elenco scorre, se glielo si chiede", () => {
    expect(createGroupLabel({ text: "Note", sticky: true }).hasAttribute("data-sticky")).toBe(true);
  });
});
