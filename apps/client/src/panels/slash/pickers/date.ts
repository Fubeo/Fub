// Il passo della data: quattro giorni a portata (oggi, domani, venerdì, fra
// una settimana) e il calendario del mese, che comincia di lunedì. Le frecce
// muovono di un giorno o di una settimana, Pagina su e giù di un mese.
import { t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { isoOf, longDay, resolveDay } from "../quick";
import type { SlashStep, StepContext } from "./index";

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const shifted = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export function dateStep(context: StepContext): SlashStep {
  const { host, life, deps } = context;
  const today = deps.today();
  const chips: readonly { label: string; day: Date }[] = [
    { label: t("slash.step.date.today"), day: today },
    { label: t("slash.step.date.tomorrow"), day: shifted(today, 1) },
    { label: t("slash.step.date.friday"), day: resolveDay("venerdi", today)! },
    { label: t("slash.step.date.week"), day: shifted(today, 7) },
  ];
  const locale = t("slash.locale");
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: "narrow" });

  const dom = document.createElement("div");
  dom.className = "slash-step is-date";
  const row = document.createElement("div");
  row.className = "slash-step-chips";
  row.setAttribute("aria-hidden", "true");
  const month = document.createElement("div");
  month.className = "slash-step-label";
  const calendar = document.createElement("div");
  calendar.className = "slash-step-calendar";
  calendar.setAttribute("role", "listbox");
  calendar.setAttribute("aria-label", t("slash.step.date.label"));
  dom.append(row, month, calendar);

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.textContent = chip.label;
    button.dataset["iso"] = isoOf(chip.day);
    row.append(button);
  }

  let chosen = shifted(today, 1);
  let cells: HTMLElement[] = [];

  const draw = (): void => {
    for (const button of row.querySelectorAll<HTMLElement>("button")) {
      button.classList.toggle("is-on", button.dataset["iso"] === isoOf(chosen));
    }
    month.textContent = `${monthName.format(chosen)} · ${longDay(chosen)}`;
    const first = new Date(chosen.getFullYear(), chosen.getMonth(), 1);
    // Il lunedì della settimana del primo del mese.
    const start = shifted(first, -((first.getDay() + 6) % 7));
    const heads = Array.from({ length: 7 }, (_, i) => {
      const head = document.createElement("b");
      head.setAttribute("aria-hidden", "true");
      head.textContent = weekdayName.format(shifted(start, i));
      return head;
    });
    cells = [];
    for (let k = 0; k < 42; k++) {
      const day = shifted(start, k);
      if (k === 35 && day.getMonth() !== chosen.getMonth()) break;
      const cell = document.createElement("span");
      cell.id = identifier("slash-day");
      cell.setAttribute("role", "option");
      cell.setAttribute("aria-label", longDay(day));
      cell.dataset["iso"] = isoOf(day);
      cell.textContent = String(day.getDate());
      cell.classList.toggle("is-out", day.getMonth() !== chosen.getMonth());
      cell.classList.toggle("is-today", sameDay(day, today));
      const on = sameDay(day, chosen);
      cell.classList.toggle("is-selected", on);
      cell.setAttribute("aria-selected", String(on));
      cells.push(cell);
    }
    calendar.replaceChildren(...heads, ...cells);
    host.changed();
  };
  const move = (date: Date): void => {
    chosen = date;
    draw();
  };
  const fromIso = (iso: string): Date => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  };
  const done = (): void => host.done({ params: { date: isoOf(chosen) } });
  draw();

  life.listen(dom, "click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-iso]");
    if (!target) return;
    chosen = fromIso(target.dataset["iso"]!);
    done();
  });

  return {
    dom,
    hint: () => t("slash.step.date.quick"),
    active: () => cells.find((cell) => cell.classList.contains("is-selected"))?.id ?? null,
    key(event) {
      switch (event.key) {
        case "ArrowRight": move(shifted(chosen, 1)); return true;
        case "ArrowLeft": move(shifted(chosen, -1)); return true;
        case "ArrowDown": move(shifted(chosen, 7)); return true;
        case "ArrowUp": move(shifted(chosen, -7)); return true;
        case "PageDown": move(new Date(chosen.getFullYear(), chosen.getMonth() + 1, Math.min(chosen.getDate(), 28))); return true;
        case "PageUp": move(new Date(chosen.getFullYear(), chosen.getMonth() - 1, Math.min(chosen.getDate(), 28))); return true;
        case "Enter": done(); return true;
      }
      return false;
    },
    typing: () => false,
    dispose: () => {},
  };
}
