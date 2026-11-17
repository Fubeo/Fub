// Ciò che la scheda di un file Craft offre quando l'anteprima manca e
// un'app installata saprebbe farla (N7, T23), secondo il consenso che la
// risposta porta (`render.consent`, cioè `craft.cli-previews`):
//
// - `ask`: la domanda, con «Sì, accendi» e «No, lasciale spente». «Sì» salva
//   `on` e chiede l'anteprima (il clic è il gesto); «No» salva `off`. Se il
//   salvataggio non riesce la domanda resta e dice perché, e niente parte;
// - `off`: la riga «spente», col link al gruppo «App esterne»;
// - `on`: il pulsante «Crea l'anteprima con …».
//
// Il modulo non chiede mai l'anteprima da sé: chiama `deps.render`, che è
// della scheda. Tutto ciò che accende vive in `life`, e una risposta che
// arriva a scheda chiusa o ridisegnata si scarta.

import type { CraftRenderOffer } from "../../host/craft";
import { api } from "../../host/ipc";
import { errorText } from "../../host/errors";
import { t } from "../../i18n/strings";
import type { Lifetime } from "../../ui/lifetime";
import { CRAFT_CONSENT_SETTING, forgetConsent } from "../../state/craft-previews";

/// Ciò che la domanda chiede alla scheda.
export interface ConsentDeps {
  /// Chiede l'anteprima all'app: soltanto dopo un gesto, cioè un clic qui.
  readonly render: () => void;
  /// Apre le impostazioni sul gruppo della riga `key`. Senza, niente link.
  readonly openSettings?: (key: string) => void;
  /// La scheda aveva il fuoco: allora lo prende il primo pulsante.
  readonly focused: boolean;
  /// Tiene il fuoco nella scheda: un pulsante che si spegne col fuoco lo
  /// manderebbe a `<body>` (Chromium). Senza, il fuoco resta al browser.
  readonly holdFocus?: () => void;
}

/// Spegne `node`; se aveva il fuoco, prima lo passa alla scheda. Vero se lo
/// aveva.
function switchOff(node: HTMLButtonElement, deps: ConsentDeps): boolean {
  const had = document.activeElement === node;
  if (had) deps.holdFocus?.();
  node.disabled = true;
  return had;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

/// Il link alle impostazioni sul gruppo della riga `key`, o `null` se la
/// shell non sa aprirle lì.
export function settingsLink(key: string, open: ((key: string) => void) | undefined, life: Lifetime): HTMLButtonElement | null {
  if (!open) return null;
  const link = button("link-button", t("craft.consent.settings"));
  life.listen(link, "click", () => open(key));
  return link;
}

/// Mette in `root` ciò che l'offerta `offer` dice, secondo il consenso.
export function mountConsent(root: HTMLElement, offer: CraftRenderOffer, deps: ConsentDeps, life: Lifetime): void {
  if (life.closed) return;
  switch (offer.consent) {
    case "ask":
      ask(root, offer, deps, life);
      return;
    case "off": {
      const line = element("p", "craft-off");
      line.append(element("span", "", t("craft.consent.off")));
      const link = settingsLink(CRAFT_CONSENT_SETTING, deps.openSettings, life);
      if (link) line.append(link);
      root.append(line);
      return;
    }
    case "on": {
      const render = button("craft-render", t("craft.render", { app: offer.app }));
      life.listen(render, "click", () => {
        if (render.disabled) return;
        switchOff(render, deps);
        deps.render();
      });
      root.append(render);
      if (deps.focused) render.focus();
      return;
    }
  }
}

function ask(root: HTMLElement, offer: CraftRenderOffer, deps: ConsentDeps, life: Lifetime): void {
  const region = element("section", "craft-ask");
  region.setAttribute("aria-label", t("craft.consent.region"));
  const actions = element("div", "craft-ask-actions");
  const yes = button("craft-ask-answer", t("craft.consent.yes"));
  yes.dataset.answer = "on";
  const no = button("craft-ask-answer", t("craft.consent.no"));
  no.dataset.answer = "off";
  actions.append(yes, no);
  const error = element("p", "setting-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  region.append(element("p", "craft-ask-text", t("craft.consent.ask", { app: offer.app })), actions, element("p", "craft-ask-hint", t("craft.consent.hint")), error);
  root.append(region);

  /// Una risposta sola alla volta: «Sì» premuto due volte salva una volta.
  let pending = false;
  async function answer(value: "on" | "off"): Promise<void> {
    if (pending || life.closed) return;
    pending = true;
    const pressed = value === "on" ? yes : no;
    const hadYes = switchOff(yes, deps);
    const hadNo = switchOff(no, deps);
    const had = hadYes || hadNo;
    error.hidden = true;
    try {
      await api.setSetting(CRAFT_CONSENT_SETTING, value);
    } catch (failure) {
      if (life.closed) return;
      pending = false;
      yes.disabled = false;
      no.disabled = false;
      error.textContent = errorText(failure);
      error.hidden = false;
      // Il fuoco era sul pulsante e la scheda l'ha tenuto: torna lì, se nel
      // frattempo nessuno l'ha portato altrove.
      const now = document.activeElement;
      if (had && (now === null || now === document.body || now.contains(region))) pressed.focus();
      return;
    }
    if (life.closed) return;
    // «Sì»: il clic è il gesto, e l'anteprima si chiede adesso. La risposta
    // in coda ridisegna la scheda. «No»: le risposte tenute dicono ancora
    // `ask`, e si dimenticano; la scheda richiede e trova la riga «spente».
    if (value === "on") deps.render();
    else forgetConsent();
  }
  // Un `button` dà già un clic per Invio e uno per Spazio: ascoltare i tasti
  // ne farebbe due.
  life.listen(yes, "click", () => void answer("on"));
  life.listen(no, "click", () => void answer("off"));
  if (deps.focused) yes.focus();
}
