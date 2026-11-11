// @vitest-environment happy-dom
// I livelli di dettaglio della lavagna (N6 T54, A-22): le soglie, l'attributo
// di una scheda, il titolo grande e il giro che scrive solo dove cambia.
import { describe, expect, it } from "vitest";
import { LIVE_ZOOM_MIN } from "./cards";
import {
  applyCardDetails,
  BLOCK_ZOOM_MAX,
  cardDetail,
  detailLevel,
  FAR_ZOOM_MAX,
  farTitle,
  type CardDetail,
  type DetailTarget,
} from "./lod";
import type { CanvasNode } from "./model";

function node(change: Partial<CanvasNode>): CanvasNode {
  return { id: "n1", type: "file", x: 0, y: 0, width: 240, height: 160, ...change };
}

describe("detailLevel", () => {
  it("la soglia di lontano è quella delle schede vive, e il blocco sta sotto", () => {
    expect(FAR_ZOOM_MAX).toBe(LIVE_ZOOM_MIN);
    expect(BLOCK_ZOOM_MAX).toBe(0.15);
    expect(BLOCK_ZOOM_MAX).toBeLessThan(FAR_ZOOM_MAX);
  });

  it("da 0,35 viva, fra 0,15 e 0,35 lontana, sotto 0,15 blocco; le soglie stanno nel livello di sopra", () => {
    expect(detailLevel(4)).toBe("live");
    expect(detailLevel(1)).toBe("live");
    expect(detailLevel(LIVE_ZOOM_MIN)).toBe("live");
    expect(detailLevel(0.3499)).toBe("far");
    expect(detailLevel(0.25)).toBe("far");
    expect(detailLevel(0.15)).toBe("far");
    expect(detailLevel(0.1499)).toBe("block");
    expect(detailLevel(0.1)).toBe("block");
    expect(detailLevel(0.05)).toBe("block");
  });

  it("uno zoom che non è un numero finito positivo resta vivo", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(detailLevel(zoom)).toBe("live");
    }
  });
});

describe("cardDetail", () => {
  it("da vicino nessun attributo; da lontano ferma se vista, sennò il titolo; sotto, il blocco", () => {
    expect(cardDetail("live", true)).toBeNull();
    expect(cardDetail("live", false)).toBeNull();
    expect(cardDetail("far", true)).toBe("still");
    expect(cardDetail("far", false)).toBe("far");
    expect(cardDetail("block", true)).toBe("block");
    expect(cardDetail("block", false)).toBe("block");
  });

  it("la scheda tenuta viva (attiva, che scrive) resta come da vicino a ogni livello", () => {
    expect(cardDetail("far", false, true)).toBeNull();
    expect(cardDetail("block", true, true)).toBeNull();
  });
});

describe("farTitle", () => {
  it("una scheda di file senza titolo mostra il nome del file, senza cartella", () => {
    expect(farTitle(node({ file: "Statistica/Varianza.md" }))).toBe("Varianza.md");
    expect(farTitle(node({ file: "foto.png" }))).toBe("foto.png");
    expect(farTitle(node({ file: "Note/Varianza.md", subpath: "#Formula" }))).toBe("Varianza.md › Formula");
    expect(farTitle(node({ file: "Note/Varianza.md", subpath: "#Capitolo#Formula" }))).toBe("Varianza.md › Capitolo › Formula");
    // Senza file: l'id, come la testata.
    expect(farTitle(node({ file: "" }))).toBe("n1");
    expect(farTitle(node({}))).toBe("n1");
  });

  it("una pagina web mostra l'indirizzo senza schema e senza la barra finale", () => {
    expect(farTitle(node({ type: "link", url: "https://example.com/" }))).toBe("example.com");
    expect(farTitle(node({ type: "link", url: "http://it.wikipedia.org/wiki/Varianza" }))).toBe("it.wikipedia.org/wiki/Varianza");
    expect(farTitle(node({ type: "link" }))).toBe("n1");
  });

  it("un testo mostra la sua prima riga scritta, senza i segni davanti", () => {
    expect(farTitle(node({ type: "text", text: "Domande per giovedì\naltro" }))).toBe("Domande per giovedì");
    expect(farTitle(node({ type: "text", text: "\n\n  ## Da rifare  \n- uno" }))).toBe("Da rifare");
    expect(farTitle(node({ type: "text", text: "- [ ] portare il libro" }))).toBe("portare il libro");
    expect(farTitle(node({ type: "text", text: "> una citazione" }))).toBe("una citazione");
    expect(farTitle(node({ type: "text", text: "#tag non è un titolo" }))).toBe("#tag non è un titolo");
    expect(farTitle(node({ type: "text", text: "   \n  " }))).toBe("");
  });

  it("un titolo lunghissimo resta intero: lo taglia il CSS", () => {
    const long = "Una nota con un titolo lunghissimo ".repeat(20).trim();
    expect(farTitle(node({ type: "text", text: long }))).toBe(long);
    expect(farTitle(node({ file: `Cartella/${long}.md` }))).toBe(`${long}.md`);
  });

  it("un gruppo mostra il suo nome; senza nome niente", () => {
    expect(farTitle(node({ type: "group", label: " Statistica " }))).toBe("Statistica");
    expect(farTitle(node({ type: "group" }))).toBe("");
  });
});

describe("applyCardDetails", () => {
  function targets(count: number): Map<string, DetailTarget> {
    const map = new Map<string, DetailTarget>();
    for (let index = 0; index < count; index++) {
      const article = document.createElement("article");
      map.set(`c${index}`, { article, detail: null });
    }
    return map;
  }

  it("scrive l'attributo solo dove cambia, e lo toglie da vicino", () => {
    const map = targets(3);
    const wanted = new Map<string, CardDetail | null>([["c0", "far"], ["c1", "still"], ["c2", null]]);
    expect(applyCardDetails(map, (id) => wanted.get(id) ?? null)).toBe(2);
    expect(map.get("c0")!.article.dataset.cardDetail).toBe("far");
    expect(map.get("c1")!.article.dataset.cardDetail).toBe("still");
    expect(map.get("c2")!.article.hasAttribute("data-card-detail")).toBe(false);
    // Lo stesso livello di nuovo: niente da scrivere.
    expect(applyCardDetails(map, (id) => wanted.get(id) ?? null)).toBe(0);
    // Di nuovo da vicino: l'attributo va via.
    expect(applyCardDetails(map, () => null)).toBe(2);
    expect(map.get("c0")!.article.hasAttribute("data-card-detail")).toBe(false);
    expect(map.get("c0")!.detail).toBeNull();
  });

  it("2000 schede al 5%: un solo cambio di attributo per scheda, e il giro dopo non scrive niente", () => {
    const map = targets(2000);
    const writes = new Map<string, number>();
    for (const [id, target] of map) {
      new MutationObserver((records) => writes.set(id, (writes.get(id) ?? 0) + records.length))
        .observe(target.article, { attributes: true });
    }
    const level = detailLevel(0.05);
    expect(applyCardDetails(map, () => cardDetail(level, false))).toBe(2000);
    expect(applyCardDetails(map, () => cardDetail(level, false))).toBe(0);
    return Promise.resolve().then(() => {
      expect(writes.size).toBe(2000);
      expect([...writes.values()].every((count) => count === 1)).toBe(true);
      for (const target of map.values()) expect(target.article.dataset.cardDetail).toBe("block");
    });
  });
});
