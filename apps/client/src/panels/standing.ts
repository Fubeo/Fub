// Il chip dello stato del documento, accanto al percorso: «Si scrive», «2
// parti chiuse», «Solo il testo», «Sola lettura», e il segno «Registra» quando
// le modifiche si registrano. Premuto, apre un riquadro che dice che cosa vuol
// dire, che cosa resta com'è e dove, e le azioni.
//
// Le parole e le azioni le dà la superficie (`EditorSurface.standing`): qui
// si disegnano soltanto. Il chip si annuncia una volta, quando il documento
// arriva; cambiare stato dopo non parla, ma la parola nuova sale di 4 px.
import type { SurfaceStanding, SurfaceStandingAction, SurfaceStandingState } from "../editors/core/registry";
import { t } from "../i18n/strings";
import { textButton } from "../kit/button";
import { openPopover, type PopoverHandle } from "../kit/popover";
import { animate } from "../moto";
import { focusableElements } from "../ui/a11y";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

/// Di quanto sale la parola nuova del chip (px).
const RISE_PX = 4;
/// Da quanto piccolo entra «Registra»: la molla elastica lo porta oltre la
/// misura, una volta, e lo posa.
const BEAT_SCALE = 0.6;

export interface StandingChip {
  /// Il chip e il segno «Registra», da posare nella testata.
  readonly element: HTMLElement;
  /// Segue lo stato di `standing`; `null` toglie il chip.
  follow(standing: SurfaceStanding | null): void;
  destroy(): void;
}

let ids = 0;

export function createStandingChip(): StandingChip {
  const life = openLifetime();
  const element = document.createElement("span");
  element.className = "pane-standing";
  element.hidden = true;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "pane-standing-chip";
  chip.setAttribute("aria-haspopup", "dialog");
  chip.setAttribute("aria-expanded", "false");
  const mark = document.createElement("span");
  mark.className = "pane-standing-mark";
  mark.setAttribute("aria-hidden", "true");
  const word = document.createElement("span");
  word.className = "pane-standing-text";
  chip.append(mark, word);
  const recording = document.createElement("span");
  recording.className = "pane-standing-rec";
  recording.hidden = true;
  // Annunciato una volta, quando il documento arriva.
  const said = document.createElement("span");
  said.className = "sr-only";
  said.setAttribute("role", "status");
  element.append(chip, recording, said);

  let followed: SurfaceStanding | null = null;
  let stop: (() => void) | null = null;
  let shown: SurfaceStandingState | null = null;
  let announced = false;
  let opened: { popover: PopoverHandle; drawn: Lifetime; body: HTMLElement } | null = null;

  function close(): void {
    opened?.popover.close();
  }

  function button(label: string, action: SurfaceStandingAction, drawn: Lifetime, kind: "normal" | "primary" = "normal", aria?: string): HTMLButtonElement {
    const control = textButton({
      label,
      kind,
      lifetime: drawn,
      onPress: () => {
        close();
        action.run();
      },
    });
    if (aria) control.setAttribute("aria-label", aria);
    return control;
  }

  /// Il contenuto del riquadro, per lo stato di adesso.
  function drawBody(): void {
    if (!opened || !shown) return;
    const { body, drawn } = opened;
    drawn.close();
    const fresh = openLifetime();
    opened.drawn = fresh;
    const title = document.createElement("h3");
    title.className = "pane-standing-title";
    title.id = `pane-standing-title-${++ids}`;
    title.textContent = shown.title;
    const text = document.createElement("p");
    text.className = "pane-standing-body";
    text.textContent = shown.body;
    const nodes: HTMLElement[] = [title, text];
    if (shown.places && shown.places.length > 0) {
      const list = document.createElement("ul");
      list.className = "pane-standing-places";
      list.setAttribute("aria-label", t("document.standing.places"));
      for (const place of shown.places) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = place.label;
        item.append(label, button(t("document.standing.go"), place, fresh, "normal", t("document.standing.go.label", { place: place.label })));
        list.append(item);
      }
      nodes.push(list);
    }
    if (shown.source) {
      const source = document.createElement("p");
      source.className = "pane-standing-source";
      source.textContent = shown.source;
      nodes.push(source);
    }
    if (shown.actions && shown.actions.length > 0) {
      const actions = document.createElement("div");
      actions.className = "pane-standing-actions";
      shown.actions.forEach((action, index) => actions.append(button(action.label, action, fresh, index === 0 ? "primary" : "normal")));
      nodes.push(actions);
    }
    body.replaceChildren(...nodes);
    body.setAttribute("aria-labelledby", title.id);
    opened.popover.reposition();
  }

  function open(): void {
    if (!shown) return;
    const body = document.createElement("div");
    body.className = "pane-standing-panel";
    const popover = openPopover({
      anchor: chip,
      content: body,
      placement: "bottom",
      align: "start",
      role: "dialog",
      label: shown.title,
      lifetime: life,
      onClose: () => {
        opened?.drawn.close();
        opened = null;
        chip.setAttribute("aria-expanded", "false");
      },
    });
    if (popover.closed) return;
    opened = { popover, drawn: openLifetime(), body };
    chip.setAttribute("aria-expanded", "true");
    drawBody();
    (focusableElements(popover.element)[0] ?? popover.element).focus({ preventScroll: true });
  }
  life.listen(chip, "click", () => {
    if (opened) close();
    else open();
  });

  function draw(): void {
    const next = followed?.current() ?? null;
    const before = shown;
    shown = next;
    element.hidden = next === null;
    if (!next) {
      close();
      return;
    }
    element.dataset.standing = next.kind;
    if (word.textContent !== next.text) {
      word.textContent = next.text;
      // Lo stato è cambiato sotto gli occhi: la parola nuova sale di poco.
      if (before !== null) animate(word, { from: { y: RISE_PX, opacity: 0 }, spring: "snap", whenReduced: "fade", lifetime: life });
    }
    chip.setAttribute("aria-label", t("document.standing.label", { state: next.text }));
    setTooltip(chip, next.title);
    const wasRecording = !recording.hidden;
    recording.hidden = !next.recording;
    recording.textContent = t("document.standing.recording");
    if (next.recordingHint) setTooltip(recording, next.recordingHint);
    // Un battito solo, con la molla elastica: niente lampeggio. Arrivare in un
    // documento che registra già non è un'accensione.
    if (next.recording && !wasRecording && before !== null) {
      animate(recording, { from: { scale: BEAT_SCALE, opacity: 0 }, spring: "elastic", whenReduced: "none", lifetime: life });
    }
    if (!announced) {
      announced = true;
      said.textContent = t("document.standing.announce", { state: next.text, title: next.title });
    }
    if (opened && (before?.kind !== next.kind || before.title !== next.title || before.places?.length !== next.places?.length)) drawBody();
  }

  return {
    element,
    follow(standing) {
      if (standing === followed) {
        draw();
        return;
      }
      stop?.();
      close();
      followed = standing;
      shown = null;
      announced = false;
      said.textContent = "";
      word.textContent = "";
      stop = standing?.subscribe(draw) ?? null;
      draw();
    },
    destroy() {
      stop?.();
      stop = null;
      followed = null;
      life.close();
      element.remove();
    },
  };
}
