// Il cambio di luce, e la sua scena.
//
// La scena: un cerchio del colore della scrivania nuova si allarga dal bottone,
// il tema cambia sotto di lui, il cerchio svanisce. Si recita solo a movimento
// pieno e solo quando il colore nuovo si può sapere prima di montarlo (la
// serie); altrimenti la luce cambia e basta. Il cerchio non prende mai il
// puntatore: una scena non mette in attesa nessuno.
//
// Finché il cerchio cresce la luce nuova non è ancora scritta, e la scena si
// può disfare (`turnLight`): il cerchio rientra nel bottone da dove è arrivato.
import { api } from "../../../host/ipc";
import { t } from "../../../i18n/strings";
import { animate, DURATION, motionLevel } from "../../../moto";
import {
  currentContrast,
  currentPreferences,
  currentTheme,
  currentThemeId,
  preferenceTokens,
  SERIES_THEME_ID,
  THEME_KEY,
  themeSeries,
  type Theme,
} from "../../../theme/theme";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { keepLabelled, labelCommandButton, run } from "./commands";
import { byId, follow } from "./dom";

const LIGHT_COMMAND = "shell.light.toggle";

/** Quanto si aspetta che il tema nuovo sia montato prima di scoprirlo comunque. */
const MOUNT_WAIT_MS = 600;

/** Il colore della scrivania in una luce, se lo si sa senza montarla. */
export function deskColour(light: Theme): string | null {
  if (currentThemeId() !== SERIES_THEME_ID) return null;
  const contrast = currentContrast();
  const chosen = preferenceTokens(currentPreferences(), light, contrast)["bg"];
  if (chosen) return chosen;
  return /--bg:\s*([^;}]+)[;}]/.exec(themeSeries().sheet(light, contrast))?.[1]?.trim() ?? null;
}

function mounted(light: Theme, lifetime: Lifetime): Promise<void> {
  return new Promise((resolve) => {
    const root = document.documentElement;
    if (root.dataset.theme === light || typeof MutationObserver === "undefined") {
      resolve();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (root.dataset.theme === light) finish();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const timer = window.setTimeout(finish, MOUNT_WAIT_MS);
    lifetime.add(finish);
  });
}

/** Il cerchio appena nato: un punto sul bottone. */
const SEED_SCALE = 0.02;
/** Cresce partendo piano, come una macchia che si allarga. */
const GROW_EASING = "cubic-bezier(0.32, 0, 0.67, 0)";
/** Rientra subito, e si posa. */
const RETREAT_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

/** La scena in corso. Finché il cerchio cresce la luce non è scritta. */
interface Flight {
  readonly growing: boolean;
  turn(): void;
}

let flight: Flight | null = null;

/**
 * Disfa la scena in corso, se si può ancora: il cerchio che cresce rientra nel
 * bottone e la luce resta quella; quello che rientra torna a crescere. Dice
 * se l'ha fatto: a luce già scritta la scena non torna indietro, e un gesto
 * nuovo è un altro cambio.
 */
export function turnLight(): boolean {
  if (!flight?.growing) return false;
  flight.turn();
  return true;
}

async function scene(origin: HTMLElement, colour: string, light: Theme, write: () => Promise<void>, lifetime: Lifetime): Promise<void> {
  const rect = origin.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const circle = document.createElement("div");
  circle.className = "light-scene";
  circle.setAttribute("aria-hidden", "true");
  circle.style.left = `${x - radius}px`;
  circle.style.top = `${y - radius}px`;
  circle.style.width = `${radius * 2}px`;
  circle.style.height = `${radius * 2}px`;
  circle.style.background = colour;
  document.body.append(circle);
  lifetime.add(() => circle.remove());

  let forward = true;
  let growing = true;
  let motion = animate(circle, {
    from: { scale: SEED_SCALE },
    duration: DURATION.large,
    easing: GROW_EASING,
    lifetime,
  });
  const own: Flight = {
    get growing() {
      return growing;
    },
    turn() {
      if (!growing) return;
      forward = !forward;
      // Ogni giro parte da dove il cerchio è adesso: lo prende la corsa nuova.
      if (forward) {
        circle.style.removeProperty("opacity");
        motion = animate(circle, { duration: DURATION.large, easing: GROW_EASING, lifetime });
      } else {
        // Rientrando si spegne, e spento resta, come alla fine della scena.
        circle.style.opacity = "0";
        motion = animate(circle, {
          from: { opacity: 1 },
          to: { scale: SEED_SCALE, opacity: 0 },
          duration: DURATION.short,
          easing: RETREAT_EASING,
          lifetime,
        });
      }
    },
  };
  flight = own;
  try {
    // Un giro sostituisce la corsa e chiude quella di prima: conta l'ultima.
    for (let current = motion; ; current = motion) {
      await current.finished;
      if (current === motion) break;
    }
    growing = false;
    if (!forward) return;
    await write();
    await mounted(light, lifetime);
    // Lo stato finale è «non c'è»: lo si scrive prima, così a corsa finita il
    // cerchio non torna a coprire la finestra per un fotogramma.
    circle.style.opacity = "0";
    await animate(circle, { from: { opacity: 1 }, to: { opacity: 0 }, duration: DURATION.short, lifetime }).finished;
  } finally {
    if (flight === own) flight = null;
    circle.remove();
  }
}

/**
 * Passa all'altra luce. La scena parte da `origin`, se c'è e si vede: a binario
 * nascosto il bottone non ha un posto, e la luce cambia e basta.
 */
export async function switchLight(origin: HTMLElement | null, lifetime: Lifetime): Promise<void> {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  const write = (): Promise<void> => api.setSetting(THEME_KEY, next).then(() => undefined);
  const visible = origin !== null && origin.getClientRects().length > 0;
  const colour = visible && motionLevel() === "full" ? deskColour(next) : null;
  if (origin && colour) await scene(origin, colour, next, write, lifetime);
  else await write();
}

export function mountLightSwitch(lifetime: Lifetime): void {
  const button = byId<HTMLButtonElement>("toggle-light");
  if (!button) return;
  const draw = (): void => {
    const dark = currentTheme() === "dark";
    button.innerHTML = icon(dark ? "sun" : "moon");
    labelCommandButton(button, t(dark ? "frame.light.to_light" : "frame.light.to_dark"), LIGHT_COMMAND);
  };
  keepLabelled(lifetime, draw);
  follow(lifetime, document.documentElement, draw, { attributes: ["data-theme"] });
  // Il bottone preme il comando, come ogni altro della cornice: la scena e la
  // guardia contro il doppio gesto stanno con chi lo dichiara.
  lifetime.listen(button, "click", () => run(LIGHT_COMMAND));
}
