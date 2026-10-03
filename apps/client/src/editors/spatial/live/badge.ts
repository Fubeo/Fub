// L'indicatore della sessione live, in cima a ogni foglio del disegno.
//
// Dice chi scrive e quanto ci mette l'inchiostro ad arrivare, e porta
// «Segui il tablet». È una riga sopra l'editor e non un elemento sul foglio:
// non copre il disegno, e c'è anche in Lettura. Lo stato è un pulsante che
// apre il pannello della sessione.

import { onLanguage, resolvedLanguage, t } from "../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { LiveStage } from "./registry";
import type { LiveControl, LiveState } from "./session";
import { formatLeft, formatMs } from "./stats";

interface Bar {
  /// I suoi ascolti, chiusi quando il foglio se ne va.
  readonly life: Lifetime;
  readonly element: HTMLElement;
  readonly status: HTMLButtonElement;
  readonly follow: HTMLButtonElement;
}

export interface LiveBars {
  /// I fogli montati adesso: chi è nuovo riceve la riga, chi se n'è andato
  /// la perde.
  sync(stages: readonly LiveStage[]): void;
  dispose(): void;
}

/// Il testo dello stato: chi scrive, o perché nessuno scrive.
export function statusText(state: LiveState, language: string): string {
  switch (state.phase) {
    case "connected": {
      const name = t("live.connected", { name: state.writer?.device.name ?? "" });
      return state.median === null ? name : `${name} · ${formatMs(state.median, language)}`;
    }
    case "away":
      return t("live.away", { time: formatLeft(state.resumeLeftMs ?? 0) });
    case "ended":
      return t("live.ended");
    case "waiting":
      return t("live.waiting");
  }
}

export function createLiveBars(control: LiveControl): LiveBars {
  const life: Lifetime = openLifetime();
  const bars = new Map<LiveStage, Bar>();
  let tick: ReturnType<typeof setInterval> | null = null;

  const render = (): void => {
    const state = control.state();
    const language = resolvedLanguage();
    const text = statusText(state, language);
    for (const bar of bars.values()) {
      bar.element.dataset.phase = state.phase;
      bar.element.setAttribute("aria-label", t("live.title"));
      if (bar.status.textContent !== text) bar.status.textContent = text;
      bar.follow.textContent = t("live.follow");
      bar.follow.setAttribute("aria-pressed", String(state.follow));
    }
  };

  const mount = (stage: LiveStage): Bar => {
    const element = document.createElement("div");
    element.className = "live-bar";
    element.setAttribute("role", "group");
    const status = document.createElement("button");
    status.type = "button";
    status.className = "live-state";
    status.setAttribute("aria-haspopup", "dialog");
    const follow = document.createElement("button");
    follow.type = "button";
    follow.className = "live-follow";
    element.append(status, follow);
    const own = openLifetime();
    own.listen(status, "click", () => control.show());
    own.listen(follow, "click", () => control.setFollow(!control.state().follow));
    // Sopra l'editor e l'immagine, sotto l'avviso del documento.
    stage.root.insertBefore(element, stage.root.querySelector(":scope > .vector-draw"));
    own.add(() => element.remove());
    return { life: own, element, status, follow };
  };

  life.add(control.subscribe(render));
  life.add(onLanguage(render));
  life.add(() => {
    if (tick !== null) clearInterval(tick);
    tick = null;
  });

  return {
    sync(stages) {
      if (life.closed) return;
      for (const [stage, bar] of bars) {
        if (stages.includes(stage)) continue;
        bar.life.close();
        bars.delete(stage);
      }
      for (const stage of stages) if (!bars.has(stage)) bars.set(stage, mount(stage));
      // Il tempo della ripresa e la latenza cambiano senza eventi: un giro al
      // secondo, solo finché c'è una riga da aggiornare.
      if (bars.size > 0 && tick === null) tick = setInterval(render, 1000);
      if (bars.size === 0 && tick !== null) {
        clearInterval(tick);
        tick = null;
      }
      render();
    },
    dispose() {
      for (const bar of bars.values()) bar.life.close();
      bars.clear();
      life.close();
    },
  };
}
