// Due testi a confronto, prima di scegliere quale tenere.
//
// Il banner di conflitto chiedeva «il mio o quello su disco?» senza far vedere
// né l'uno né l'altro. Qui c'è la vista minima che serve a rispondere: un diff
// per righe, con le righe tolte e aggiunte segnate, in una modale della shell.
// Non è un editor di fusione: si guarda, poi si sceglie dal banner.
import { t } from "../i18n/strings";
import { trapFocus } from "./a11y";
import { openLifetime } from "./lifetime";
import { enterSurface, exitSurface } from "./motion";

export type DiffLine = { kind: "same" | "mine" | "theirs"; text: string };

/// Oltre questa misura il confronto riga per riga costa troppo (è quadratico):
/// si mostrano i due testi interi senza allinearli.
const MAX_CELLS = 4_000_000;

/// Il diff per righe fra il testo su disco (`theirs`) e il mio (`mine`): la
/// più lunga sottosequenza comune, poi le righe che restano da una parte sola.
export function diffLines(theirs: string, mine: string): DiffLine[] {
  const a = theirs.split("\n");
  const b = mine.split("\n");
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: "theirs" as const, text })),
      ...b.map((text) => ({ kind: "mine" as const, text })),
    ];
  }
  // Tabella delle lunghezze dal fondo: `table[i][j]` è la LCS di a[i..] e b[j..].
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ kind: "theirs", text: a[i++]! });
    } else {
      out.push({ kind: "mine", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "theirs", text: a[i++]! });
  while (j < b.length) out.push({ kind: "mine", text: b[j++]! });
  return out;
}

/// Apre il confronto. Si chiude con Esc, col bottone o cliccando fuori.
export function openCompare(title: string, theirs: string, mine: string): void {
  const life = openLifetime();
  const overlay = document.createElement("div");
  overlay.className = "modale shell-dialog";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  const box = document.createElement("div");
  box.className = "palette-box compare-box";
  const heading = document.createElement("h2");
  heading.className = "palette-heading";
  heading.textContent = title;
  const legend = document.createElement("p");
  legend.className = "palette-desc";
  legend.textContent = t("compare.legend");
  const list = document.createElement("ol");
  list.className = "plain-list compare-lines";
  for (const line of diffLines(theirs, mine)) {
    const row = document.createElement("li");
    row.className = "compare-line";
    row.dataset.side = line.kind;
    const sign = line.kind === "mine" ? "+" : line.kind === "theirs" ? "−" : " ";
    row.textContent = `${sign} ${line.text}`;
    if (line.kind !== "same") {
      row.setAttribute("aria-label", `${t(line.kind === "mine" ? "compare.mine" : "compare.theirs")}: ${line.text}`);
    }
    list.append(row);
  }
  const actions = document.createElement("div");
  actions.className = "palette-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = t("app.close");
  actions.append(close);
  box.append(heading, legend, list, actions);
  overlay.append(box);
  const dismiss = () => life.close();
  close.addEventListener("click", dismiss);
  life.listen(overlay, "mousedown", (event) => {
    if (event.target === overlay) dismiss();
  });
  document.body.append(overlay);
  enterSurface(overlay, { viewTransition: false });
  life.add(() => exitSurface(overlay, () => overlay.remove(), { viewTransition: false }));
  life.add(trapFocus(overlay, dismiss));
  close.focus();
}
