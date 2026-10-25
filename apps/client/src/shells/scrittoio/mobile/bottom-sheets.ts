// I cassetti di un telefono: fogli che salgono dal basso.
//
// Aprire e chiudere resta della shell comune (`desktop-shell.ts`): sotto i 960
// px un cassetto è già in sovrapposizione, uno alla volta, col suo velo, con
// Esc che lo chiude e il fuoco che torna a chi l'aveva aperto. Qui sta ciò che
// un telefono aggiunge:
//
// - **il movimento**: il foglio sale da sotto e scende dove è venuto. Lo stato
//   cambia subito — la shell ha già chiuso — e l'uscita è solo ciò che si vede:
//   finché dura, una classe su `#layout` (`sheet-leaving-*`) tiene a vista il
//   cassetto `hidden`, inerte, come fa il cassetto che si affaccia;
// - **la maniglia**: un bottone in testa al foglio. Trascinata verso il basso
//   lo porta con sé e, oltre un terzo della corsa o con uno slancio, lo chiude;
//   toccata, lo chiude. È anche ciò che prende il fuoco all'apertura, al posto
//   del campo di ricerca: su un telefono un campo col fuoco alza la tastiera;
// - **«indietro»**: il gesto o il tasto del sistema chiude il foglio aperto
//   invece di lasciare l'applicazione (`back.ts`).
//
// La geometria è di `mobile.css`, e vale sotto `PHONE_BELOW`: da lì in su i
// cassetti restano quelli di lato, e questo modulo non muove niente.
import { onLanguage, t } from "../../../i18n/strings";
import { animate, drag, DURATION, motionDriver, motionLevel, type Motion } from "../../../moto";
import type { Lifetime } from "../../../ui/lifetime";
import { toggleSidePanel, type SidePanel } from "../../../ui/side-panels";
import { byId, follow } from "../frame/dom";
import { mountBackClose } from "./back";

/// Sotto questa larghezza (px) la finestra è una colonna. È la soglia di
/// `mobile.css` e quella di `data-mobile-form-factor`.
export const PHONE_BELOW = 600;
/// La frazione della corsa oltre la quale il foglio rilasciato si chiude.
export const CLOSE_FRACTION = 1 / 3;
/// Lo slancio verso il basso (px al millisecondo) che lo chiude comunque.
export const FLING = 0.5;

const SIDES: readonly SidePanel[] = ["sidebar", "inspector"];
const PANEL: Record<SidePanel, string> = { sidebar: "sidebar", inspector: "right-pane" };
const SCRIM: Record<SidePanel, string> = { sidebar: "sidebar-scrim", inspector: "inspector-scrim" };
const OPEN: Record<SidePanel, string> = { sidebar: "drawer-sidebar-open", inspector: "drawer-inspector-open" };
const LEAVING: Record<SidePanel, string> = {
  sidebar: "sheet-leaving-sidebar",
  inspector: "sheet-leaving-inspector",
};
const VEIL_LEAVING: Record<SidePanel, string> = {
  sidebar: "veil-leaving-sidebar",
  inspector: "veil-leaving-inspector",
};

export function mountBottomSheets(lifetime: Lifetime): void {
  const layout = byId("layout");
  if (!layout) return;
  const view = layout.ownerDocument.defaultView ?? window;
  const phone = (): boolean => view.innerWidth < PHONE_BELOW;
  const panelOf = (side: SidePanel): HTMLElement | null => byId(PANEL[side]);
  const scrimOf = (side: SidePanel): HTMLElement | null => byId(SCRIM[side]);
  /// Quanto è lunga la corsa: l'altezza del foglio. Dove non c'è impaginazione
  /// vale quella della finestra.
  const travel = (panel: HTMLElement): number => panel.getBoundingClientRect().height || view.innerHeight;

  /// Il foglio che si vede aperto, lato per lato, all'ultima lettura.
  const shown: Record<SidePanel, boolean> = { sidebar: false, inspector: false };
  /// Le uscite in corso: il foglio è già chiuso, e si vede ancora.
  const leaving: Partial<Record<SidePanel, Motion>> = {};
  /// Il velo che sta sfumando: la shell l'ha già nascosto, e si vede ancora.
  /// Ha una corsa sua, più corta di quella del foglio: finita, non resta a vista.
  let veil: { side: SidePanel; motion: Motion } | null = null;
  /// La posa in cui un gesto ha lasciato il foglio e il velo: l'uscita riparte da lì.
  let released: { side: SidePanel; y: number; velocity: number; veil: number } | null = null;

  const clearVeil = (): void => {
    if (!veil) return;
    layout.classList.remove(VEIL_LEAVING[veil.side]);
    veil = null;
  };

  /// Toglie ciò che un'uscita aveva lasciato a vista. La corsa non la ferma
  /// qui: chi riapre la prosegue, chi smonta l'ha già annullata.
  const settle = (side: SidePanel): void => {
    if (!leaving[side]) return;
    delete leaving[side];
    layout.classList.remove(LEAVING[side]);
    panelOf(side)?.removeAttribute("inert");
  };

  const entered = (side: SidePanel, first: boolean): void => {
    const panel = panelOf(side);
    if (!panel) return;
    if (leaving[side]) {
      // Stava scendendo: risale da dov'è.
      settle(side);
      animate(panel, { spring: "wide", whenReduced: "none", lifetime });
    } else {
      animate(panel, { from: { y: travel(panel) }, spring: "wide", whenReduced: "fade", lifetime });
    }
    // Il velo compare col primo foglio; fra un foglio e l'altro resta.
    clearVeil();
    const scrim = scrimOf(side);
    if (scrim && first) {
      animate(scrim, { from: { opacity: 0 }, duration: DURATION.short, whenReduced: "none", lifetime });
    }
  };

  const left = (side: SidePanel): void => {
    const panel = panelOf(side);
    const from = released?.side === side ? released : null;
    released = null;
    // Chiuso dalla shell e su un telefono: altrimenti non c'è un'uscita da
    // mostrare (la finestra si è allargata, o il foglio non è nascosto).
    if (!panel || !panel.hidden || !phone()) return;
    if (motionLevel() === "reduced" || motionDriver().instant) return;
    layout.classList.add(LEAVING[side]);
    panel.setAttribute("inert", "");
    const distance = travel(panel);
    const motion = from
      ? animate(panel, {
          from: { y: from.y },
          to: { y: distance },
          velocity: { y: from.velocity },
          spring: "soft",
          whenReduced: "none",
          lifetime,
        })
      : // Chiuso senza il dito: un'uscita, breve come tutte (≤ `swap`).
        animate(panel, {
          to: { y: distance },
          duration: DURATION.swap,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          whenReduced: "none",
          lifetime,
        });
    leaving[side] = motion;
    void motion.finished.then(() => {
      if (leaving[side] === motion) settle(side);
    });
    // Il velo se ne va con l'ultimo foglio: se un altro è aperto, resta il suo.
    const scrim = scrimOf(side);
    if (!scrim || shown.sidebar || shown.inspector) return;
    clearVeil();
    layout.classList.add(VEIL_LEAVING[side]);
    const fade = animate(scrim, {
      from: { opacity: from ? from.veil : 1 },
      to: { opacity: 0 },
      duration: from ? DURATION.large : DURATION.swap,
      whenReduced: "none",
      lifetime,
    });
    veil = { side, motion: fade };
    void fade.finished.then(() => {
      if (veil?.motion === fade) clearVeil();
    });
  };

  const back = mountBackClose(lifetime, () => {
    for (const side of SIDES) if (shown[side]) toggleSidePanel(side);
  });

  /// Legge lo stato della shell e mette in moto ciò che è cambiato. Scrive
  /// soltanto quando qualcosa cambia: è chiamata anche dalle proprie scritture.
  const sync = (): void => {
    const before = shown.sidebar || shown.inspector;
    const changed: SidePanel[] = [];
    for (const side of SIDES) {
      const now = phone() && layout.classList.contains(OPEN[side]);
      if (now === shown[side]) continue;
      shown[side] = now;
      changed.push(side);
    }
    if (changed.length === 0) return;
    const after = shown.sidebar || shown.inspector;
    // Prima chi esce, poi chi entra: uno scambio non lascia due veli.
    for (const side of changed) if (!shown[side]) left(side);
    for (const side of changed) if (shown[side]) entered(side, !before);
    if (after !== before) back.set(after);
  };

  for (const side of SIDES) {
    const panel = panelOf(side);
    if (!panel) continue;
    const grip = panel.ownerDocument.createElement("button");
    grip.type = "button";
    grip.className = "sheet-grip";
    grip.setAttribute("aria-controls", panel.id);
    const label = (): void => grip.setAttribute("aria-label", t("mobile.sheet.close"));
    label();
    lifetime.add(onLanguage(label));
    panel.prepend(grip);
    lifetime.add(() => grip.remove());

    /// Di quanto il dito ha portato giù il foglio (px).
    let offset = 0;
    /// Quanto resta del velo a quel punto della corsa.
    const veilAt = (y: number): number => Math.max(0, 1 - y / travel(panel));
    /// Un trascinamento finito sulla maniglia genera anche un clic: non è un tocco.
    let dragged = false;
    const rest = (): void => {
      panel.style.removeProperty("translate");
      scrimOf(side)?.style.removeProperty("opacity");
    };
    const snapBack = (velocity: number): void => {
      const y = offset;
      offset = 0;
      rest();
      if (y <= 0) return;
      animate(panel, { from: { y }, velocity: { y: velocity }, spring: "snap", whenReduced: "none", lifetime });
      const scrim = scrimOf(side);
      if (scrim) animate(scrim, { from: { opacity: veilAt(y) }, duration: DURATION.short, whenReduced: "none", lifetime });
    };
    lifetime.listen(grip, "pointerdown", () => {
      dragged = false;
    });
    lifetime.listen(grip, "click", () => {
      if (dragged) {
        dragged = false;
        return;
      }
      if (shown[side]) toggleSidePanel(side);
    });
    drag(grip, {
      lifetime,
      threshold: 6,
      onStart: () => {
        dragged = true;
      },
      onMove: (info) => {
        if (!shown[side]) return;
        // Verso l'alto il foglio non segue: è già tutto fuori.
        offset = Math.max(0, info.dy);
        panel.style.setProperty("translate", `0 ${Math.round(offset)}px`);
        const scrim = scrimOf(side);
        if (scrim) scrim.style.opacity = String(veilAt(offset));
      },
      onEnd: (info) => {
        if (!shown[side]) return;
        const away = info.velocity.y > -0.1 && (offset > travel(panel) * CLOSE_FRACTION || info.velocity.y > FLING);
        if (!away) {
          snapBack(info.velocity.y);
          return;
        }
        released = { side, y: offset, velocity: Math.max(0, info.velocity.y), veil: veilAt(offset) };
        offset = 0;
        rest();
        toggleSidePanel(side);
        // Subito, senza aspettare l'osservatore: fra il rilascio e l'uscita
        // non passa un fotogramma col foglio a riposo.
        sync();
        released = null;
      },
      onCancel: () => snapBack(0),
    });
    lifetime.add(rest);
  }

  sync();
  follow(lifetime, layout, sync, { attributes: ["class"] });
  lifetime.listen(view, "resize", sync);
  lifetime.add(() => {
    clearVeil();
    for (const side of SIDES) {
      layout.classList.remove(LEAVING[side]);
      panelOf(side)?.removeAttribute("inert");
    }
  });
}
