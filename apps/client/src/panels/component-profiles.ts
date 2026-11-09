// La riga dei profili (§ componenti): la usano la pagina «Componenti» delle
// impostazioni e la schermata che chiede il profilo a un vault nuovo.
//
// Un profilo è un bottone con `aria-pressed`; uno «più avanti» resta
// raggiungibile ma grigio (`aria-disabled`), e dice perché al passaggio, al
// fuoco e quando lo si prova; «Studio» porta «consigliato». Chi usa la riga
// decide che cosa vuol dire premere: la pagina applica, la schermata sceglie.
import type { ComponentProfile } from "../host/contract";
import { plural, t } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

/// Il profilo consigliato: un consiglio della shell, non una regola dell'host.
/// È anche quello che la schermata del vault nuovo propone già scelto.
export const RECOMMENDED = "studio";

/// Perché un profilo «più avanti» non si applica ancora.
export function laterReason(profile: ComponentProfile): string {
  return plural(profile.arriva_con.length, "components.profile.later_why.one", "components.profile.later_why", {
    name: profile.etichetta,
  });
}

export interface ProfileButtonOptions {
  /// Se è il profilo scelto (`aria-pressed`).
  pressed: boolean;
  /// Un gesto è in corso: la riga intera si ferma.
  busy: boolean;
  /// Il gesto in corso è di questo profilo (`aria-busy`).
  busyHere: boolean;
  /// Premere un profilo «più avanti»: chi usa la riga dice il perché.
  onLater(profile: ComponentProfile): void;
  /// Premere un profilo che si può scegliere.
  onChoose(profile: ComponentProfile): void;
}

/// Un profilo della riga, con `data-focus-key` `profile:<nome>` e
/// `data-profile` per ritrovarlo dopo un ridisegno.
export function profileButton(profile: ComponentProfile, options: ProfileButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "components-profile";
  button.dataset.focusKey = `profile:${profile.nome}`;
  button.dataset.profile = profile.nome;
  button.setAttribute("aria-pressed", String(options.pressed));
  const name = document.createElement("span");
  name.textContent = profile.etichetta;
  button.append(name);
  if (profile.piu_avanti) {
    button.classList.add("components-profile--later");
    button.setAttribute("aria-disabled", "true");
    const later = document.createElement("span");
    later.className = "components-profile-later";
    later.textContent = t("components.profile.later");
    button.append(later);
    setTooltip(button, laterReason(profile));
  } else if (profile.nome === RECOMMENDED) {
    const recommended = document.createElement("span");
    recommended.className = "components-profile-rec";
    recommended.textContent = t("components.profile.recommended");
    button.append(recommended);
  }
  if (options.busy) button.setAttribute("aria-disabled", "true");
  if (options.busyHere) button.setAttribute("aria-busy", "true");
  button.addEventListener("click", () => {
    if (options.busy) return;
    if (profile.piu_avanti) {
      options.onLater(profile);
      return;
    }
    options.onChoose(profile);
  });
  return button;
}

/// Un controllo `aria-disabled` resta raggiungibile (per sentirne il perché)
/// ma Invio e Spazio non devono attivarlo: il tasto si ferma qui, prima che
/// il browser ne faccia un clic. Un profilo «più avanti» dice invece perché,
/// con `onLater`.
export function guardDisabledKeys(
  lifetime: Lifetime,
  root: HTMLElement,
  profileNamed: (name: string) => ComponentProfile | undefined,
  onLater: (profile: ComponentProfile) => void,
): void {
  const stop = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[aria-disabled="true"]');
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown" || event.repeat) return;
    const name = target.dataset.profile;
    const profile = name ? profileNamed(name) : undefined;
    if (profile?.piu_avanti) onLater(profile);
  };
  lifetime.listen(root, "keydown", stop, { capture: true });
  lifetime.listen(root, "keyup", stop, { capture: true });
}
