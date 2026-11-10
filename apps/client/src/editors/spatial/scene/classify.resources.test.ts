// La classificazione della scena, le risorse e gli stili, nei due versi: che
// cosa resta modificabile e che cosa diventa estraneo. Sono i casi di
// `crates/fub-scene/tests/classify.rs`, letti da questo lettore.

import { describe, expect, it } from "vitest";
import type { Role } from "./analysis";
import { at, doc, findings, first, load, role } from "./test-support";

describe("le risorse", () => {
  /// Il ruolo del primo figlio della `defs` di `doc(<defs>body</defs>)`.
  const resource = (body: string): Role | null => role(load(doc(`<defs>${body}</defs>`)), [0, 0]);
  /// Il ruolo del primo figlio della radice, dopo una `defs` con `defs`.
  const user = (defs: string, body: string): Role | null => role(load(doc(`<defs>${defs}</defs>${body}`)), [1]);
  const GRADIENT = '<linearGradient id="r1"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>';

  it("una defs della radice è un contenitore che giudica ogni figlio da sé", () => {
    const scene = load(doc(`<defs id="fub-defs">${GRADIENT}<symbol id="s"/><title>Risorse</title></defs>`));
    expect(role(scene, [0])).toBe("defs");
    expect(role(scene, [0, 0])).toBe("resource");
    expect(role(scene, [0, 1])).toBeNull();
    expect(role(scene, [0, 2])).toBe("title");
    expect(first("<defs/>")).toBe("defs");
    // Un attributo SVG che non è l'id, o una defs fuori dalla radice, la
    // rendono estranea.
    expect(first('<defs fill="#000000"></defs>')).toBeNull();
    expect(first('<defs id=""></defs>')).toBeNull();
    expect(role(load(doc(`<g><defs>${GRADIENT}</defs></g>`)), [0, 0])).toBeNull();
    // Gli attributi di altri namespace restano.
    expect(first('<defs fub:nota="x"></defs>')).toBe("defs");
  });

  it("ogni tipo di risorsa è modificabile in una defs della radice, con l'id", () => {
    for (const body of [
      GRADIENT,
      '<radialGradient id="r1" cx="0.5" cy="50%" r="0.5" fx="0.4" fy="0.4" spreadMethod="reflect"><stop offset="0.5" stop-color="red" stop-opacity="0.5"/></radialGradient>',
      '<pattern id="r1" x="0" y="0" width="0.1" height="0.1" patternContentUnits="objectBoundingBox" viewBox="0 0 10 10"><rect width="5" height="5" fill="#000000"/></pattern>',
      '<marker id="r1" refX="5" refY="5" markerWidth="10" markerHeight="10" markerUnits="strokeWidth" orient="auto-start-reverse" viewBox="0 0 10 10"><path d="M0 0 L10 5 L0 10 z"/></marker>',
      '<marker id="r1" orient="90deg"/>',
      '<clipPath id="r1" clipPathUnits="objectBoundingBox" transform="scale(2)"><circle cx="0.5" cy="0.5" r="0.5" clip-rule="evenodd"/><text x="0" y="1"><tspan x="0" dy="0">Ritaglio</tspan></text></clipPath>',
      '<mask id="r1" x="-10%" y="-10%" width="120%" height="120%" maskContentUnits="userSpaceOnUse"><rect width="100" height="100" fill="#ffffff"/></mask>',
      '<filter id="r1" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2 3"/></filter>',
    ]) {
      expect(resource(body), body).toBe("resource");
    }
    expect(resource("<linearGradient/>")).toBeNull();
    expect(resource('<linearGradient id=""/>')).toBeNull();
  });

  it("una risorsa che si rimanda a un'altra, o che ha style, è estranea", () => {
    for (const body of [
      '<linearGradient id="r1" href="#r2"/>',
      '<linearGradient id="r1" xlink:href="#r2"/>',
      '<pattern id="r1" href="#r2"/>',
      '<linearGradient id="r1" style="color:red"/>',
      '<radialGradient id="r1" fr="0.1"/>',
      '<mask id="r1" mask-type="alpha"/>',
      '<filter id="r1" primitiveUnits="objectBoundingBox"/>',
      '<linearGradient id="r1" fill="#000000"/>',
      '<clipPath id="r1" fill="#000000"/>',
    ]) {
      expect(resource(body), body).toBeNull();
    }
  });

  it("le coordinate seguono le unità: numeri e percentuali nel riquadro, lunghezze nello spazio d'uso", () => {
    expect(resource('<linearGradient id="r1" x1="10%" x2="1"/>')).toBe("resource");
    expect(resource('<linearGradient id="r1" x1="10px"/>')).toBeNull();
    expect(resource('<linearGradient id="r1" gradientUnits="userSpaceOnUse" x1="0" x2="10mm"/>')).toBe("resource");
    expect(resource('<linearGradient id="r1" gradientUnits="userSpaceOnUse" x1="0" x2="10%"/>')).toBeNull();
    // Nello spazio d'uso, ciò che mancando sarebbe in percentuale del
    // viewport va scritto, se c'è una sfumatura: con uno `stop` o nessuno è un
    // colore pieno, o niente, e le coordinate non contano.
    expect(resource('<linearGradient id="r1" gradientUnits="userSpaceOnUse"><stop offset="0"/><stop offset="1"/></linearGradient>')).toBeNull();
    expect(resource('<linearGradient id="r1" gradientUnits="userSpaceOnUse"><stop stop-color="#000"/></linearGradient>')).toBe("resource");
    expect(resource('<linearGradient id="r1" gradientUnits="userSpaceOnUse"/>')).toBe("resource");
    expect(resource('<radialGradient id="r1" gradientUnits="userSpaceOnUse"><stop/></radialGradient>')).toBe("resource");
    expect(resource('<radialGradient id="r1" gradientUnits="userSpaceOnUse" cx="0" cy="0"><stop/><stop/></radialGradient>')).toBeNull();
    expect(resource('<radialGradient id="r1" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="5"/>')).toBe("resource");
    expect(resource('<filter id="r1" filterUnits="userSpaceOnUse" x="0" y="0" width="10"/>')).toBeNull();
    expect(resource('<filter id="r1" filterUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"/>')).toBe("resource");
    // Raggi e dimensioni non negativi.
    expect(resource('<radialGradient id="r1" r="-0.5"/>')).toBeNull();
    expect(resource('<pattern id="r1" width="-1"/>')).toBeNull();
    expect(resource('<marker id="r1" markerWidth="-1"/>')).toBeNull();
    // Gli angoli, le scatole e le parole chiave.
    for (const orient of ["auto", "45", "-1.5e1deg", "100grad", "3.14rad"]) expect(resource(`<marker id="r1" orient="${orient}"/>`), orient).toBe("resource");
    for (const orient of ["", "45turn", "auto auto", "1 deg"]) expect(resource(`<marker id="r1" orient="${orient}"/>`), orient).toBeNull();
    expect(resource('<marker id="r1" viewBox="0,0,10,-1"/>')).toBeNull();
    expect(resource('<linearGradient id="r1" spreadMethod="mirror"/>')).toBeNull();
    expect(resource('<marker id="r1" markerUnits="objectBoundingBox"/>')).toBeNull();
  });

  it("le sfumature hanno soltanto stop, coi loro attributi, fino a 256", () => {
    const gradient = (stops: string): string => `<linearGradient id="r1">${stops}</linearGradient>`;
    expect(resource(gradient('\n  <title>Cielo</title>\n  <stop offset="50%" stop-color="#ff0000"/>\n'))).toBe("resource");
    for (const stop of [
      '<stop offset="0" stop-color="none"/>',
      '<stop offset="0" style="stop-color:red"/>',
      '<stop offset="0" stop-opacity="2"/>',
      '<stop offset="1px"/>',
      '<stop offset="0" fill="#000000"/>',
      '<stop offset="0"><title>x</title></stop>',
      '<rect width="1" height="1"/>',
      "testo",
    ]) {
      expect(resource(gradient(stop)), stop).toBeNull();
    }
    expect(resource(gradient('<stop offset="0"/>'.repeat(256)))).toBe("resource");
    expect(resource(gradient('<stop offset="0"/>'.repeat(257)))).toBeNull();
  });

  it("il contenuto di motivi, marcatori e maschere sono forme, testi e gruppi; quello dei ritagli niente gruppi", () => {
    expect(resource('<pattern id="r1"><g fill="#ff0000"><g><rect width="1" height="1"/></g></g></pattern>')).toBe("resource");
    expect(resource('<clipPath id="r1"><g><rect width="1" height="1"/></g></clipPath>')).toBeNull();
    for (const content of ['<image href="a.png"/>', '<a href="n.md"></a>', '<use href="#x"/>', '<g fub:layer="Uno"><rect/></g>', '<rect width="1" class="x"/>']) {
      const body = `<mask id="r1">${content}</mask>`;
      expect(resource(body), body).toBe(content.startsWith("<g") ? "resource" : null);
    }
    // Trentadue gruppi annidati sì, trentatré no.
    const nest = (depth: number): string => `<marker id="r1">${"<g>".repeat(depth)}<rect/>${"</g>".repeat(depth)}</marker>`;
    expect(resource(nest(32))).toBe("resource");
    expect(resource(nest(33))).toBeNull();
  });

  it("il contenuto rimanda soltanto a sfumature", () => {
    const defs = `${GRADIENT}<pattern id="r2" width="1" height="1"/><filter id="r3"/>`;
    const scene = (inner: string): Role | null => role(load(doc(`<defs>${defs}<pattern id="r4">${inner}</pattern></defs>`)), [0, 3]);
    expect(scene('<rect fill="url(#r1)"/>')).toBe("resource");
    expect(scene('<rect fill="url(#r2)"/>')).toBeNull();
    expect(scene('<rect filter="url(#r3)"/>')).toBeNull();
    expect(scene('<rect filter="none" clip-path="none"/>')).toBe("resource");
  });

  it("le primitive dei filtri sono un elenco chiuso", () => {
    const filter = (body: string): Role | null => resource(`<filter id="r1">${body}</filter>`);
    for (const body of [
      '<feOffset dx="2" dy="-2"/>',
      '<feFlood flood-color="#000000" flood-opacity="0.5"/>',
      '<feDropShadow dx="2" dy="2" stdDeviation="1" flood-color="black" flood-opacity="0.3"/>',
      '<feColorMatrix type="saturate" values="0.5"/>',
      '<feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>',
      '<feColorMatrix type="luminanceToAlpha"/>',
      '<feComposite in="SourceGraphic" in2="SourceAlpha" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>',
      '<feBlend in2="SourceGraphic" mode="multiply"/>',
      '<feMorphology operator="dilate" radius="1 2"/>',
      '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge>',
      '<feGaussianBlur id="p1" x="0" y="0" width="10" height="10" color-interpolation-filters="linearRGB" stdDeviation="1"/>',
    ]) {
      expect(filter(body), body).toBe("resource");
    }
    for (const body of [
      '<feTurbulence baseFrequency="0.1"/>',
      '<feImage href="a.png"/>',
      '<feGaussianBlur stdDeviation="-1"/>',
      '<feGaussianBlur stdDeviation="1 2 3"/>',
      '<feGaussianBlur in="BackgroundImage"/>',
      '<feComposite operator="in"/>',
      '<feBlend in2="SourceGraphic" mode="overlay"/>',
      '<feColorMatrix type="saturate" values="-1"/>',
      '<feColorMatrix values="1 0 0"/>',
      '<feOffset dx="1px"/>',
      '<feFlood flood-color="none"/>',
      '<feFlood in="SourceGraphic"/>',
      '<feOffset stdDeviation="1"/>',
      '<feOffset x="1%"/>',
      '<feOffset result="a b"/>',
      '<feMerge><feOffset/></feMerge>',
      '<feMergeNode/>',
      '<feOffset><title>x</title></feOffset>',
      '<g/>',
    ]) {
      expect(filter(body), body).toBeNull();
    }
  });

  it("gli ingressi rimandano ai risultati che vengono prima", () => {
    const filter = (body: string): Role | null => resource(`<filter id="r1">${body}</filter>`);
    expect(filter('<feGaussianBlur in="SourceAlpha" result="ombra"/><feOffset in="ombra" result="spostata"/><feMerge><feMergeNode in="spostata"/><feMergeNode in="SourceGraphic"/></feMerge>')).toBe("resource");
    expect(filter('<feOffset in="ombra"/><feGaussianBlur result="ombra"/>')).toBeNull();
    // Gli ingressi si leggono come sono scritti.
    expect(filter('<feGaussianBlur result="ombra"/><feOffset in=" ombra"/>')).toBeNull();
    expect(filter('<feOffset in="sourcegraphic"/>')).toBeNull();
    expect(filter('<feOffset/>'.repeat(64))).toBe("resource");
    expect(filter('<feOffset/>'.repeat(63) + "<feMerge><feMergeNode/></feMerge>")).toBeNull();
  });

  it("fill e stroke rimandano a sfumature e motivi, con un ripiego facoltativo", () => {
    const defs = `${GRADIENT}<pattern id="r2" width="1" height="1"/><filter id="r3"/>`;
    for (const value of ["url(#r1)", "url(#r2)", "url(#r1) #ff0000", "url(#r1) none", 'url("#r1")', "url( '#r1' )", "URL(#r1)", " url(#r1) red "]) {
      expect(user(defs, `<rect fill="${value.replace(/"/g, "&quot;")}"/>`), value).toBe("rect");
      expect(user(defs, `<g stroke="${value.replace(/"/g, "&quot;")}"></g>`), value).toBe("group");
    }
    // Non sulle righe e sui pezzi di un testo.
    expect(user(defs, '<text x="0" y="0" fill="url(#r1)"><tspan x="0" dy="0">a</tspan></text>')).toBe("text");
    expect(user(defs, '<text x="0" y="0"><tspan x="0" dy="0" fill="url(#r1)">a</tspan></text>')).toBeNull();
    expect(user(defs, '<text x="0" y="0"><tspan x="0" dy="0">a<tspan stroke="url(#r1)">b</tspan></tspan></text>')).toBeNull();
    for (const value of ["url(#r3)", "url(#r4)", "url(#r1)#ff0000", "url(#r1) url(#r2)", "url(r1)", "url(#r\\31)", "url(#r1) currentColor", "url(#r1", "url(a.svg#r1)"]) {
      expect(user(defs, `<rect fill="${value}"/>`), value).toBeNull();
    }
  });

  it("i marcatori vanno sui tracciati, ritagli, maschere e filtri su ciò che si disegna", () => {
    const defs = `${GRADIENT}<marker id="r2"/><clipPath id="r3"/><mask id="r4"/><filter id="r5"/>`;
    for (const tag of ["path", "line", "polyline", "polygon"]) {
      expect(user(defs, `<${tag} marker-start="url(#r2)" marker-mid="none" marker-end="url(#r2)"/>`), tag).not.toBeNull();
    }
    expect(user(defs, '<rect marker-end="url(#r2)"/>')).toBeNull();
    expect(user(defs, '<g marker-end="none"></g>')).toBeNull();
    expect(user(defs, '<path marker-end="url(#r1)"/>')).toBeNull();
    for (const body of [
      '<rect clip-path="url(#r3)" mask="url(#r4)" filter="url(#r5)"/>',
      '<text x="0" y="0" filter="url(#r5)"><tspan x="0" dy="0">a</tspan></text>',
      '<image href="a.png" clip-path="url(#r3)"/>',
      '<g mask="url(#r4)"></g>',
      '<a href="n.md" filter="url(#r5)"></a>',
      '<g fub:layer="Uno" filter="url(#r5)"></g>',
    ]) {
      expect(user(defs, body), body).not.toBeNull();
    }
    expect(user(defs, '<rect clip-path="url(#r4)"/>')).toBeNull();
    expect(user(defs, '<rect filter="url(#r3)"/>')).toBeNull();
    expect(user(defs, '<rect clip-path="inset(10%)"/>')).toBeNull();
    expect(user(defs, '<rect filter="url(#r5) blur(1px)"/>')).toBeNull();
    // `clip-rule` vale soltanto dentro un ritaglio.
    expect(user(defs, '<rect clip-rule="evenodd"/>')).toBeNull();
  });

  it("un riferimento vale verso una risorsa modificabile in una defs della radice, dovunque stia", () => {
    // La defs può venire dopo chi la usa.
    let scene = load(doc(`<rect fill="url(#r1)"/><defs>${GRADIENT}</defs>`));
    expect(role(scene, [0])).toBe("rect");
    // Una risorsa estranea, o in una defs estranea, non vale.
    scene = load(doc('<defs><linearGradient id="r1" href="#x"/></defs><rect fill="url(#r1)"/>'));
    expect(role(scene, [1])).toBeNull();
    scene = load(doc(`<defs class="x">${GRADIENT}</defs><rect fill="url(#r1)"/>`));
    expect(role(scene, [1])).toBeNull();
    scene = load(doc(`<g><defs>${GRADIENT}</defs></g><rect fill="url(#r1)"/>`));
    expect(role(scene, [1])).toBeNull();
    // Due risorse con lo stesso id: vale la prima.
    scene = load(doc(`<defs>${GRADIENT}<filter id="r1"/></defs><rect fill="url(#r1)"/><rect filter="url(#r1)"/>`));
    expect(role(scene, [1])).toBe("rect");
    expect(role(scene, [2])).toBeNull();
    // Un motivo che usa una sfumatura scritta dopo di lui.
    scene = load(doc(`<defs><pattern id="r2"><rect fill="url(#r1)"/></pattern>${GRADIENT}</defs><rect fill="url(#r2)"/>`));
    expect(role(scene, [0, 0])).toBe("resource");
    expect(role(scene, [1])).toBe("rect");
  });

  it("una risorsa dice il suo ciclo di vita e il suo nome", () => {
    const scene = load(doc(`<defs><linearGradient id="r1" fub:role="private"><title>Tramonto</title></linearGradient><filter id="r2" fub:role="shared"/><mask id="r3" fub:role="paper"/></defs>`));
    expect(at(scene, [0, 0])!.lifecycle).toBe("private");
    expect(at(scene, [0, 0])!.title).toBe("Tramonto");
    expect(at(scene, [0, 1])!.lifecycle).toBe("shared");
    expect(at(scene, [0, 2])!.lifecycle).toBeUndefined();
    expect(at(scene, [0, 2])!.role).toBe("resource");
  });
});

describe("gli stili", () => {
  const TEXT =
    '<text id="r1" fub:role="style" fub:name="Titolo" fub:leading="1.25" font-family="Inter" font-size="24" font-weight="700" font-style="italic" letter-spacing="0.5" text-decoration="underline" fill="#1a1a1a"/>';
  const GRAPHIC =
    '<polyline id="r2" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100" fill="#e69f00" fill-opacity="0.5" stroke="#1a1a1a" stroke-opacity="0.8" stroke-width="2" stroke-dasharray="4 2" stroke-linecap="round" stroke-linejoin="bevel" opacity="0.9" style="mix-blend-mode: multiply"/>';

  it("uno stile è un text o una polyline con fub:role=style in una defs della radice, col nome e il tipo", () => {
    const scene = load(doc(`<defs>${TEXT}${GRAPHIC}</defs>`));
    expect(at(scene, [0, 0])!.role).toBe("resource");
    expect(at(scene, [0, 0])!.lifecycle).toBe("style");
    expect(at(scene, [0, 0])!.style).toEqual({ name: "Titolo", kind: "text" });
    expect(at(scene, [0, 1])!.lifecycle).toBe("style");
    expect(at(scene, [0, 1])!.style).toEqual({ name: "Riquadro", kind: "graphic" });
    // I marcatori, il filtro e un riempimento con una sfumatura sono suoi
    // come di ogni spezzata; il testo prende un colore, none o una sfumatura.
    const marker = '<marker id="r3" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker>';
    const filter = '<filter id="r4"><feGaussianBlur stdDeviation="2"/></filter>';
    const gradient = '<linearGradient id="r5" fub:role="private"><stop offset="0" stop-color="#000000"/></linearGradient>';
    for (const style of [
      '<polyline id="r6" fub:role="style" fub:name="R" points="0,0 100,0 100,100" marker-start="url(#r3)" marker-end="url(#r3)" filter="url(#r4)" fill="url(#r5) #000000"/>',
      '<text id="r6" fub:role="style" fub:name="T" fill="url(#r5) #000000"/>',
      '<text id="r6" fub:role="style" fub:name="T" fill="none"/>',
      '<text id="r6" fub:role="style" fub:name="T"/>',
      '<text id="r6" fub:role="style" fub:name="T" fub:leading="0.5"/>',
      '<text id="r6" fub:role="style" fub:name="T" fub:leading="10"/>',
      '<text id="r6" fub:role="style" fub:name="T" fub:leading="1.125"/>',
      '<text id="r6" fub:role="style" fub:name="T">\n  <title>Titolo</title>\n  <desc>Per i capitoli</desc>\n</text>',
      '<text id="r6" fub:role="style" fub:name="T" fub:nota="x"/>',
    ]) {
      const read = load(doc(`<defs>${marker}${filter}${gradient}${style}</defs>`));
      expect(at(read, [0, 3])?.lifecycle, style).toBe("style");
    }
    expect(at(load(doc(`<defs><text id="r1" fub:role="style" fub:name="T"><title>Titolo</title></text></defs>`)), [0, 0])!.title).toBe("Titolo");
  });

  it("uno stile senza la sua forma è estraneo", () => {
    for (const style of [
      '<text id="r1" fub:role="style" font-size="12"/>',
      '<text id="r1" fub:role="style" fub:name=" "/>',
      '<text fub:role="style" fub:name="T"/>',
      '<text id="" fub:role="style" fub:name="T"/>',
      '<text id="r1" fub:role="style" fub:name="T" x="0"/>',
      '<text id="r1" fub:role="style" fub:name="T" stroke="#000000"/>',
      '<text id="r1" fub:role="style" fub:name="T" opacity="0.5"/>',
      '<text id="r1" fub:role="style" fub:name="T"><tspan>Testo</tspan></text>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading="0.4"/>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading="10.5"/>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading="1.2345"/>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading="1e0"/>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading=".5"/>',
      '<text id="r1" fub:role="style" fub:name="T" fub:leading=""/>',
      '<text id="r1" fub:role="style" fub:name="T" font-weight="pesante"/>',
      '<text id="r1" fub:role="style" fub:name="T" fill="url(#r9) #000000"/>',
      '<polyline id="r1" fub:role="style" fub:name="R"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0 0 100 0 100 100"/>',
      '<polyline id="r1" fub:role="style" points="0,0 100,0 100,100"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" transform="scale(2)"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" font-size="12"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" display="none"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100" stroke-width="largo"/>',
      '<polyline id="r1" fub:role="style" fub:name="R" points="0,0 100,0 100,100"><rect/></polyline>',
    ]) {
      expect(role(load(doc(`<defs>${style}</defs>`)), [0, 0]), style).toBeNull();
    }
    // Fuori da una defs della radice fub:role non fa uno stile: una spezzata
    // fra gli oggetti resta una spezzata.
    expect(first('<polyline fub:role="style" fub:name="R" points="0,0 100,0 100,100"/>')).toBe("polyline");
  });

  it("un'altra risorsa con fub:role=style resta senza ciclo di vita", () => {
    const scene = load(doc('<defs><linearGradient id="r1" fub:role="style" fub:name="R"><stop offset="0" stop-color="#000000"/></linearGradient></defs>'));
    expect(at(scene, [0, 0])!.role).toBe("resource");
    expect(at(scene, [0, 0])!.lifecycle).toBeUndefined();
    expect(at(scene, [0, 0])!.style).toBeUndefined();
  });

  it("chi segue uno stile lo dice con fub:style, e uno stile che non c'è o dell'altro tipo è S018", () => {
    const swatch = '<linearGradient id="r3" fub:role="swatch" fub:name="Blu"><stop stop-color="#0072b2"/></linearGradient>';
    const broken = '<polyline id="r4" fub:role="style" fub:name="Rotto" points="0,0"/>';
    const scene = load(
      doc(
        `<defs>${TEXT}${GRAPHIC}${swatch}${broken}</defs>` +
          '<g id="l1" fub:layer="Livello 1" fub:style="r2">' +
          '<rect id="o1" fub:style="r2" width="10" height="10"/>' +
          '<text id="o2" fub:style="r1"><tspan>Titolo</tspan></text>' +
          '<g id="o3" fub:style="r2"><circle id="o4" r="5"/></g>' +
          '<rect id="o5" fub:style="r1" width="10" height="10"/>' +
          '<text id="o6" fub:style="r2"><tspan>Nota</tspan></text>' +
          '<circle id="o7" fub:style="r9" r="5"/>' +
          '<line id="o8" fub:style="r3" x2="10"/>' +
          '<ellipse id="o9" fub:style="r4" rx="5" ry="5"/>' +
          '<a id="oa" href="nota.md" fub:style="r9"><rect id="ob" width="1" height="1"/></a>' +
          '<rect id="oc" fub:style="r9" width="-1" height="1"/>' +
          "</g>",
      ),
    );
    expect(at(scene, [1, 0])!.follows).toBe("r2");
    expect(at(scene, [1, 1])!.follows).toBe("r1");
    expect(at(scene, [1, 2])!.follows).toBe("r2");
    expect(at(scene, [1, 3])!.follows).toBe("r1");
    // Un livello o un collegamento non seguono uno stile: fub:style resta
    // com'è e non dice niente; un estraneo non segue niente.
    expect(at(scene, [1])!.follows).toBeUndefined();
    expect(at(scene, [1, 8])!.follows).toBeUndefined();
    expect(role(scene, [1, 9])).toBeNull();
    // Lo stile rotto e il rettangolo estraneo sono S002.
    expect(findings(scene).filter((d) => d.code === "S002")).toHaveLength(2);
    expect(findings(scene).filter((d) => d.code !== "S002").map((d) => [d.code, d.detail])).toEqual([
      ["S018", "r1"],
      ["S018", "r2"],
      ["S018", "r9"],
      ["S018", "r3"],
      ["S018", "r4"],
    ]);
  });
});
