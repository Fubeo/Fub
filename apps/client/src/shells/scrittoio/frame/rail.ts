// Il binario oltre le sue icone: il piede (aiuto, preferenze, luce) e la tacca
// che segna il pannello aperto.
//
// Le icone le monta `panels/rail.ts`, e l'acceso è il loro `aria-pressed`: la
// tacca lo segue leggendo quello, senza un secondo stato da tenere allineato.
import { onLanguage, t } from "../../../i18n/strings";
import { springValue } from "../../../moto";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import type { MenuItem } from "../../../ui/menu";
import { setTooltip } from "../../../ui/tooltip";
import { chordOf, run } from "./commands";
import { beside, byId, follow, menuTrigger } from "./dom";
import { mountLightSwitch } from "./light";

/** Le voci dell'aiuto: comandi che ci sono già, con i loro tasti. */
const HELP: readonly { readonly label: "commands.palette" | "frame.help.switcher" | "app.settings"; readonly command: string }[] = [
  { label: "commands.palette", command: "shell.palette" },
  { label: "frame.help.switcher", command: "shell.switcher" },
  { label: "app.settings", command: "shell.settings" },
];

export function mountRailFoot(lifetime: Lifetime): void {
  const help = byId<HTMLButtonElement>("open-help");
  const settings = byId<HTMLButtonElement>("open-settings");
  if (settings) settings.innerHTML = icon("settings");
  if (help) {
    help.innerHTML = icon("help");
    const label = (): void => setTooltip(help, t("frame.help"));
    label();
    lifetime.add(onLanguage(label));
    const menu = menuTrigger(help);
    lifetime.listen(help, "click", (event) => {
      event.stopPropagation();
      // Premuto a menu aperto lo chiude: è un bottone, non una porta a senso unico.
      if (menu.open) {
        menu.close();
        return;
      }
      const items: MenuItem[] = HELP.map((entry) => ({
        label: t(entry.label),
        hint: chordOf(entry.command),
        run: () => run(entry.command),
      }));
      menu.show(beside(help), items);
    });
  }
  mountLightSwitch(lifetime);
}

export function mountRailNotch(lifetime: Lifetime): void {
  const rail = byId("rail");
  const notch = byId("rail-notch");
  if (!rail || !notch) return;
  let placed = false;
  const spring = springValue({
    spring: "snap",
    initial: 0,
    onUpdate: (y) => {
      notch.style.translate = `0 ${Math.round(y * 100) / 100}px`;
    },
    lifetime,
  });
  // L'acceso di un'icona dice quale pannello è scelto, non che il cassetto sia
  // aperto: a finestra stretta, o a cassetto nascosto, il pannello resta scelto
  // e non si vede. La tacca segna ciò che si vede, e il binario lo dice alla
  // pelle (`data-drawer="closed"`) perché l'icona non resti accesa da sola.
  const drawer = byId("sidebar");
  // La tacca sta dentro il binario, e il binario è seguito nei suoi `hidden`:
  // riscrivere quello della tacca al valore che ha già sveglierebbe di nuovo
  // chi la posa, senza fine. La si tocca solo quando cambia.
  const show = (visible: boolean): void => {
    if (notch.hidden === visible) notch.hidden = !visible;
  };
  const place = (): void => {
    const closed = drawer?.hidden ?? false;
    if (closed) {
      if (rail.dataset.drawer !== "closed") rail.dataset.drawer = "closed";
    } else if (rail.dataset.drawer !== undefined) delete rail.dataset.drawer;
    const lit = rail.querySelector<HTMLElement>('.rail-btn[aria-pressed="true"]:not([hidden])');
    if (!lit || rail.hidden || closed) {
      show(false);
      placed = false;
      return;
    }
    show(true);
    const y = lit.getBoundingClientRect().top - rail.getBoundingClientRect().top
      + (lit.offsetHeight - notch.offsetHeight) / 2;
    // La prima volta la tacca compare al suo posto: scivola solo da un'icona
    // all'altra, non dall'angolo del binario.
    if (placed) spring.set(y);
    else spring.jump(y);
    placed = true;
  };
  place();
  follow(lifetime, rail, place, { attributes: ["aria-pressed", "hidden"], subtree: true });
  if (drawer) follow(lifetime, drawer, place, { attributes: ["hidden"] });
  lifetime.add(() => delete rail.dataset.drawer);
  if (typeof MutationObserver !== "undefined") {
    const added = new MutationObserver(place);
    added.observe(rail, { childList: true, subtree: true });
    lifetime.add(() => added.disconnect());
  }
  if (typeof ResizeObserver !== "undefined") {
    const resized = new ResizeObserver(() => {
      placed = false;
      place();
    });
    resized.observe(rail);
    lifetime.add(() => resized.disconnect());
  }
}
