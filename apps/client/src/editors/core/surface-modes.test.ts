import { describe, expect, it } from "vitest";
import type { PaneMode } from "../../host/contract";
import type { SurfaceMode } from "./registry";
import { modeForContext, offersContext, offersReadingToggle, readingToggleTarget } from "./surface-modes";

function mode(id: string, contextMode: PaneMode, presentation: SurfaceMode["presentation"] = "surface"): SurfaceMode {
  return { id, label: () => id, presentation, contextMode };
}

// Le modalità che le superfici della shell dichiarano davvero, più una
// superficie finta che chiama le sue due «draw» e «read»: i comandi devono
// trovarle dal ruolo, senza conoscerne il nome.
const MARKDOWN = [mode("source", "source"), mode("live_preview", "live_preview"), mode("reading", "reading", "rendered")];
const SVG = [mode("source", "source"), mode("live_preview", "live_preview"), mode("reading", "reading", "rendered")];
const PLAIN = [mode("source", "source")];
const CANVAS = [mode("canvas", "live_preview"), mode("source", "source")];
const GRID = [mode("sheet", "live_preview")];
const BASE = [mode("base", "live_preview")];
const MEDIA = [mode("view", "reading", "rendered")];
const ERROR = [mode("error", "reading", "rendered")];
const DRAW = [mode("draw", "live_preview"), mode("read", "reading", "rendered")];

describe("modalità per ruolo", () => {
  it("offre un comando di ruolo solo dove porterebbe a qualcosa", () => {
    const offered = (modes: readonly SurfaceMode[]) => ({
      reading: offersReadingToggle(modes),
      live: offersContext(modes, "live_preview"),
      source: offersContext(modes, "source"),
    });
    expect(offered(MARKDOWN)).toEqual({ reading: true, live: true, source: true });
    expect(offered(SVG)).toEqual({ reading: true, live: true, source: true });
    expect(offered(CANVAS)).toEqual({ reading: false, live: true, source: true });
    expect(offered(DRAW)).toEqual({ reading: true, live: true, source: false });
    // Una modalità sola: nessuno dei tre comandi, nemmeno quello del suo ruolo.
    for (const modes of [PLAIN, GRID, BASE, MEDIA, ERROR]) {
      expect(offered(modes)).toEqual({ reading: false, live: false, source: false });
    }
  });

  it("raggiunge la modalità dal ruolo dichiarato, non dall'id", () => {
    expect(modeForContext(CANVAS, "source", "live_preview")?.id).toBe("canvas");
    expect(modeForContext(CANVAS, "canvas", "source")?.id).toBe("source");
    expect(modeForContext(DRAW, "read", "live_preview")?.id).toBe("draw");
    expect(modeForContext(MARKDOWN, "reading", "source")?.id).toBe("source");
    expect(modeForContext(DRAW, "draw", "source")).toBeUndefined();
  });

  it("resta sulla modalità corrente quando ha già il ruolo chiesto", () => {
    const twoWritings = [mode("draw", "live_preview"), mode("ink", "live_preview"), mode("read", "reading", "rendered")];
    expect(modeForContext(twoWritings, "ink", "live_preview")?.id).toBe("ink");
    expect(modeForContext(twoWritings, "read", "live_preview")?.id).toBe("draw");
  });

  it("dalla scrittura il toggle porta alla prima lettura dichiarata", () => {
    expect(readingToggleTarget(MARKDOWN, "source", undefined, "live_preview")?.id).toBe("reading");
    expect(readingToggleTarget(DRAW, "draw", undefined, undefined)?.id).toBe("read");
  });

  it("dalla lettura il toggle torna alla scrittura ricordata", () => {
    expect(readingToggleTarget(MARKDOWN, "reading", "source", "live_preview")?.id).toBe("source");
    expect(readingToggleTarget(DRAW, "read", "draw", undefined)?.id).toBe("draw");
  });

  it("una scrittura ricordata che la superficie non dichiara ricade sulla predefinita, poi sulla prima scrittura", () => {
    // Markdown e SVG tornano a Live, la loro predefinita: è il comportamento
    // di prima, quando il ritorno era scritto qui come «live_preview».
    expect(readingToggleTarget(MARKDOWN, "reading", "canvas", "live_preview")?.id).toBe("live_preview");
    expect(readingToggleTarget(MARKDOWN, "reading", undefined, "live_preview")?.id).toBe("live_preview");
    // La superficie finta non ha una «live_preview»: il ritorno è la sua prima
    // scrittura, mai un id che non dichiara.
    expect(readingToggleTarget(DRAW, "read", "live_preview", undefined)?.id).toBe("draw");
    // Una predefinita di lettura non è un ritorno dalla lettura.
    const readFirst = [mode("read", "reading", "rendered"), mode("draw", "live_preview")];
    expect(readingToggleTarget(readFirst, "read", "reading", "read")?.id).toBe("draw");
    // Una ricordata che è una lettura non vale come scrittura.
    expect(readingToggleTarget(MARKDOWN, "reading", "reading", undefined)?.id).toBe("source");
  });

  it("non porta da nessuna parte su una superficie senza alternativa", () => {
    for (const modes of [PLAIN, CANVAS, GRID, MEDIA, ERROR]) {
      expect(readingToggleTarget(modes, modes[0]!.id, undefined, undefined)).toBeUndefined();
    }
  });
});
