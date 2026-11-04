// @vitest-environment happy-dom
//
// La consegna (prima forma): a fine avvio lo strato se ne va con tutto ciò che
// ha scritto, e l'app sotto torna viva e col fuoco al suo posto.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import desktop from "../../index.html?raw";
import documento from "../../document.html?raw";
import { consegna } from "./consegna";

/// La pagina come la trova la webview: la testa con lo stile, il corpo con lo
/// strato e l'app inerte, gli attributi che luce.js scrive su `<html>`.
function monta(html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.head.querySelectorAll("script")) el.remove();
  for (const el of doc.body.querySelectorAll("script")) el.remove();
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  const root = document.documentElement;
  root.setAttribute("data-avvio-luce", "dark");
  root.setAttribute("data-avvio-contrasto", "normal");
  root.setAttribute("data-avvio-moto", "ridotto");
  root.style.setProperty("--avvio-sfondo", "#101418");
  root.style.setProperty("color", "red");
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => {
  document.documentElement.removeAttribute("style");
});

function nienteStrato(): void {
  const root = document.documentElement;
  expect(document.querySelector(".avvio")).toBeNull();
  expect(document.getElementById("avvio-stile")).toBeNull();
  expect(root.getAttributeNames().filter((nome) => nome.startsWith("data-avvio"))).toEqual([]);
  expect(root.getAttribute("style") ?? "").not.toContain("--avvio-");
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  expect(document.querySelectorAll("[aria-busy]")).toHaveLength(0);
  expect(document.activeElement).not.toBe(document.body);
}

describe("consegna", () => {
  it("index.html: via lo strato e i suoi segni, l'app viva, il fuoco sui fogli", async () => {
    monta(desktop);
    expect(document.querySelectorAll("[inert]")).toHaveLength(2);
    await consegna();
    nienteStrato();
    expect(document.activeElement?.id).toBe("panes");
    // Ciò che non è dello strato resta.
    expect(document.documentElement.style.getPropertyValue("color")).toBe("red");
    expect(document.getElementById("app")).not.toBeNull();
  });

  it("il fuoco va prima al foglio attivo, poi alla scelta del vault", async () => {
    monta(desktop);
    const onboarding = document.getElementById("onboarding")!;
    onboarding.hidden = false;
    await consegna();
    expect(document.activeElement?.id).toBe("onboarding-open");

    monta(desktop);
    const foglio = document.createElement("div");
    foglio.className = "pane focus";
    const scritto = document.createElement("div");
    scritto.setAttribute("contenteditable", "true");
    foglio.appendChild(scritto);
    document.getElementById("panes")!.appendChild(foglio);
    await consegna();
    expect(document.activeElement).toBe(scritto);
  });

  it("un fuoco già dato dall'avvio resta dov'è", async () => {
    monta(desktop);
    const vault = document.getElementById("vault-chip")!;
    // Il fuoco fuori da un elemento inerte: come se l'avvio l'avesse dato dopo.
    document.getElementById("app")!.removeAttribute("inert");
    vault.focus();
    await consegna();
    expect(document.activeElement).toBe(vault);
  });

  it("document.html: #document-window torna viva", async () => {
    monta(documento);
    // L'editor che l'ingresso monta nel foglio.
    const scritto = document.createElement("div");
    scritto.setAttribute("contenteditable", "true");
    document.getElementById("document-window-sheet")!.appendChild(scritto);
    await consegna();
    expect(document.activeElement).toBe(scritto);
    nienteStrato();
    expect(document.getElementById("document-window")?.hasAttribute("inert")).toBe(false);
  });

  it("senza strato non fa niente", async () => {
    document.body.innerHTML = '<div id="app" inert></div>';
    document.documentElement.setAttribute("data-avvio-luce", "dark");
    await consegna();
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(document.documentElement.getAttribute("data-avvio-luce")).toBe("dark");
    document.documentElement.removeAttribute("data-avvio-luce");
  });
});
