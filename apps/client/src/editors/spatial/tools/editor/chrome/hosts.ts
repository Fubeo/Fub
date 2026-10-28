// Le cromature del disegno (B1): dove stanno la barra in alto, la colonna
// degli strumenti, il foglio, i pannelli e la banda. L'editor fa i pezzi,
// chi lo ospita li mette a posto: l'editor non sa dove stanno i suoi
// pannelli.
//
// - `inlineChrome` mette tutto dentro la radice dell'editor: la barra sopra,
//   la colonna a sinistra del foglio, i pannelli a destra. La usano i test e,
//   domani, i disegni dentro i documenti.
// - `inspectorChrome` (C1) tiene barra, colonna e foglio nella radice e dà i
//   pannelli all'ispettore dello Scrittoio, in cinque schede: Design,
//   Livelli, Risorse, Cronologia, Accessibilità.

import type { SurfacePanel, SurfacePanels } from "../../../../core/registry";

/// Le schede dei pannelli, con gli id che l'ispettore ricorda.
export type DrawPanelId = "design" | "layers" | "resources" | "history" | "accessibility";

/// Un pannello dell'editor, come lo sposta una cromatura.
export interface DrawPanelPiece {
  readonly element: HTMLElement;
  /// Vero se gli strumenti offerti lo comprendono adesso.
  offered(): boolean;
  /// Lo apre al suo posto, senza prendere il fuoco.
  open(): void;
  /// Lo chiude.
  close(): void;
}

/// Una scheda: i pannelli che ci stanno, in ordine.
export interface DrawPanelPart {
  readonly id: DrawPanelId;
  title(): string;
  readonly icon: string;
  readonly pieces: readonly DrawPanelPiece[];
  /// I pannelli che la scheda montata ha dentro adesso; nessuno quando si
  /// smonta.
  arranged?(inside: readonly DrawPanelPiece[]): void;
}

/// I pezzi che l'editor ha fatto.
export interface DrawChromeParts {
  /// La radice dell'editor, `.draw-editor`.
  readonly root: HTMLElement;
  /// La barra in alto: menu, annulla, opzioni, esporta.
  readonly top: HTMLElement;
  /// La colonna degli strumenti.
  readonly rail: HTMLElement;
  /// Il foglio con le sue barre.
  readonly stage: HTMLElement;
  /// I pannelli: proprietà, oggetti, cronologia…
  readonly dock: HTMLElement;
  /// Gli stessi pannelli, divisi in schede.
  readonly panels: readonly DrawPanelPart[];
  /// Ciò che sta in fondo alla radice: suggerimenti, testi per chi legge con
  /// la voce.
  readonly tail: readonly HTMLElement[];
}

export interface DrawChrome {
  /// Mette i pezzi al loro posto, una volta, dentro `host`.
  place(host: HTMLElement, parts: DrawChromeParts): void;
  /// Con i pannelli fuori dall'editor: aprirne uno chiede la sua scheda a
  /// chi la tiene, invece di aprirlo nel dock.
  reveal?(id: DrawPanelId): void;
  /// Gli strumenti offerti possono essere cambiati: le schede si rileggono.
  refresh?(): void;
}

/// La barra sopra, poi la colonna, il foglio e, se c'è, il dock in fila.
function placeBody(host: HTMLElement, parts: DrawChromeParts, dock: boolean): void {
  const body = document.createElement("div");
  body.className = "draw-body";
  body.append(parts.rail, parts.stage);
  if (dock) body.append(parts.dock);
  parts.root.append(parts.top, body, ...parts.tail);
  host.append(parts.root);
}

/// Tutto dentro la radice: la barra sopra, poi la colonna, il foglio e i
/// pannelli in fila.
export function inlineChrome(): DrawChrome {
  return { place: (host, parts) => placeBody(host, parts, true) };
}

/// La cromatura dello Scrittoio: i pannelli nell'ispettore, come `panels`
/// della superficie.
export interface InspectorChrome extends DrawChrome {
  readonly panels: SurfacePanels;
  /// Chiude i pannelli e smette di avvisare l'ispettore, prima che l'editor
  /// se ne vada; le schede vuote le smonta lui.
  dispose(): void;
}

export function inspectorChrome(): InspectorChrome {
  let parts: DrawChromeParts | null = null;
  const listeners = new Set<() => void>();
  const reveals = new Set<(id: string) => void>();
  /// Una scheda per id, sempre la stessa: l'ispettore rifà le schede solo
  /// quando cambia quali sono.
  const tabs = new Map<DrawPanelId, SurfacePanel>();
  /// Le schede montate: dove, e quali pannelli ci sono adesso.
  const mounted = new Map<DrawPanelId, { readonly sheet: HTMLElement; inside: DrawPanelPiece[] }>();
  let offered: DrawPanelId[] = [];
  /// L'editor se n'è andato: niente più schede.
  let disposed = false;

  const offeredNow = (): DrawPanelId[] => (parts?.panels ?? []).filter((part) => part.pieces.some((piece) => piece.offered())).map((part) => part.id);

  /// Mette nella scheda `id` i pannelli offerti, apre quelli che arrivano e
  /// chiude quelli che escono, riportandoli nel dock.
  const arrange = (part: DrawPanelPart): void => {
    const at = mounted.get(part.id);
    if (!at || !parts) return;
    const want = part.pieces.filter((piece) => piece.offered());
    for (const piece of at.inside) {
      if (want.includes(piece)) continue;
      piece.close();
      // Un pannello che un altro ha già preso (gli attributi dentro le
      // proprietà) resta dov'è.
      if (piece.element.parentElement === at.sheet) parts.dock.append(piece.element);
    }
    const arrived = want.filter((piece) => !at.inside.includes(piece));
    const ordered = want.every((piece, index) => at.sheet.children[index] === piece.element) && at.sheet.children.length === want.length;
    if (!ordered) at.sheet.append(...want.map((piece) => piece.element));
    at.inside = want;
    for (const piece of arrived) piece.open();
    part.arranged?.(want);
  };

  /// Chiude i pannelli della scheda `id` e li riporta nel dock.
  const empty = (id: DrawPanelId): void => {
    const at = mounted.get(id);
    mounted.delete(id);
    for (const piece of at?.inside ?? []) {
      piece.close();
      if (parts && piece.element.parentElement === at?.sheet) parts.dock.append(piece.element);
    }
    if (at !== undefined) parts?.panels.find((part) => part.id === id)?.arranged?.([]);
  };

  const tabOf = (part: DrawPanelPart): SurfacePanel => {
    const known = tabs.get(part.id);
    if (known) return known;
    const tab: SurfacePanel = {
      id: `draw.${part.id}`,
      title: () => part.title(),
      icon: part.icon,
      mount(host) {
        const sheet = document.createElement("div");
        sheet.className = "draw-sheet";
        sheet.dataset.panel = part.id;
        host.append(sheet);
        if (disposed) return () => sheet.remove();
        mounted.set(part.id, { sheet, inside: [] });
        arrange(part);
        return () => {
          empty(part.id);
          sheet.remove();
        };
      },
    };
    tabs.set(part.id, tab);
    return tab;
  };

  return {
    place(host, placed) {
      parts = placed;
      offered = offeredNow();
      placeBody(host, placed, false);
    },
    reveal(id) {
      for (const listener of [...reveals]) listener(`draw.${id}`);
    },
    refresh() {
      if (!parts || disposed) return;
      for (const part of parts.panels) arrange(part);
      const now = offeredNow();
      if (now.length === offered.length && now.every((id, at) => offered[at] === id)) return;
      offered = now;
      for (const listener of [...listeners]) listener();
    },
    panels: {
      list: () => (disposed ? [] : parts?.panels ?? []).filter((part) => offered.includes(part.id)).map(tabOf),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onShow(listener) {
        reveals.add(listener);
        return () => reveals.delete(listener);
      },
    },
    dispose() {
      disposed = true;
      for (const id of [...mounted.keys()]) empty(id);
      listeners.clear();
      reveals.clear();
    },
  };
}
