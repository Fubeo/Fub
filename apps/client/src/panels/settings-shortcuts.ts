// Il modulo «Impostazioni»: la scheda delle scorciatoie.
import { api } from "../host/ipc";
import { settings } from "../host/query";
import {
  allCommands,
  displayBinding,
  keybindingIssues,
  keybindingKey,
  keyboardPlatform,
  reservedChord,
  validateKeybinding,
  type CommandEntry,
  type KeybindingValidation,
} from "../ui/commands";
import { t, type Key } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";
import { normalizeSearch } from "./settings-model";
import { DRAW_KEYS_SETTING, riempiTastiDisegno } from "./settings-disegno";
import { row } from "./settings-vault";
import { type SectionParts, markModified, render, sectionBlock, write } from "./settings";
import { renderRow } from "./settings-fields";

// --- la scheda delle scorciatoie (§18.2) ------------------------------------
//
// Questa scheda **non ha un pannello suo**: è la scheda della configurazione con
// un filtro, e disegna le sue righe con la stessa `renderRow` di tutte le
// altre. È la conseguenza di aver deciso che una scorciatoia è una chiave di
// impostazione e non un formato nuovo: il campo di testo, il «vale per questo
// vault» e l'«azzera» ci sono già, e nessuno li ha scritti due volte.

/// **Ciò che il vault propone e nessuno ha guardato** (§23.13), in cima alla
/// scheda: quante sono, su quali comandi, e le due risposte.
///
/// Sta qui e non in un dialogo all'apertura per una ragione che il verbale
/// scrive: un momento di accettazione senza niente da guardare insegna a
/// cliccare «accetto». Qui sotto ci sono le righe vere — la combinazione, la
/// sourceLabel, l'«azzera» — quindi rispondere è una cosa che si fa **dopo**
/// aver visto, e chi non risponde non perde niente: finché non lo fa, quelle
/// combinazioni non premono.
async function drawSuggestedKeys(): Promise<HTMLElement[]> {
  // Il banner è un **di più**, e chi non riesce a dirlo non deve portarsi via la
  // scheda: questa chiamata può fallire per conto suo — nessun vault aperto, o
  // il registro dei vault che non si legge — e da dentro la `Promise.all` di
  // `renderShortcuts` un rifiuto sostituirebbe tutte le scorciatoie con
  // «non si è riusciti a leggere». È lo stesso silenzio di
  // `avvisaSeIlVaultPortaTasti` in `main.ts`, e per la stessa ragione: ciò che
  // si perde è la domanda, non il presidio — le chiavi restano sospese finché
  // qualcuno non risponde.
  const suggested = await api.pendingKeybindings().catch((): Record<string, string> => ({}));
  const keys = Object.keys(suggested);
  if (keys.length === 0) return [];

  const forKey = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
  const box = document.createElement("div");
  box.className = "settings-banner";
  box.append(row("setting-label", t("settings.vault_keys.title", { count: keys.length })));
  box.append(row("muted", t("settings.vault_keys.hint")));
  for (const key of keys) {
    const el = document.createElement("div");
    el.className = "setting-row";
    const text = document.createElement("div");
    text.className = "setting-text";
    const label = document.createElement("label");
    // Il titolo del comando, e la chiave nuda solo se questo montaggio quel
    // comando non ce l'ha. Non dovrebbe capitare — l'host le filtra a chi non è
    // dichiarato — e scriverlo comunque costa una riga e non lascia una casella
    // vuota il giorno che la filtrata cambia.
    label.textContent = forKey.get(key) ?? key;
    text.append(label);
    const kbd = document.createElement("kbd");
    kbd.textContent = suggested[key] ?? "";
    el.append(text, kbd);
    box.append(el);
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const adoptButton = document.createElement("button");
  adoptButton.className = "primary";
  adoptButton.textContent = t("settings.vault_keys.adopt");
  adoptButton.addEventListener("click", () => void write(() => api.adoptKeybindings()));
  const discardButton = document.createElement("button");
  discardButton.className = "settings-btn";
  discardButton.textContent = t("settings.vault_keys.discard");
  setTooltip(discardButton, t("settings.vault_keys.discard.hint"));
  discardButton.addEventListener("click", () => void write(() => api.discardKeybindings()));
  actions.append(adoptButton, discardButton);
  box.append(actions);
  return [box];
}

/// Le parole di ciò che non va in una scorciatoia scritta.
export const KEYBINDING_REASONS: Record<Extract<KeybindingValidation, { valid: false }>["reason"], Key> = {
  "empty-alternative": "settings.shortcut.empty_alternative",
  "too-many": "settings.shortcut.too_many",
  "invalid-chord": "settings.shortcut.invalid_chord",
  duplicate: "settings.shortcut.duplicate",
};

function shortcutDiagnostic(command: CommandEntry, binding: string, commands: CommandEntry[]): string {
  const validation = validateKeybinding(binding);
  if (!validation.valid) {
    return t("settings.shortcut.invalid_unsaved", { reason: t(KEYBINDING_REASONS[validation.reason]) });
  }
  // Il campo vuoto è «nessuna scorciatoia», come nel modello dei comandi
  // (`binding: null`), non una scorciatoia scritta male (IMP-140).
  const proposed = commands.map((item) =>
    item.id === command.id ? { ...item, binding: binding.trim() === "" ? null : binding } : item);
  const issues = keybindingIssues(proposed)
    .filter((issue) => issue.type === "invalid"
      ? issue.command.id === command.id
      : issue.type === "shadowed"
        ? issue.short.id === command.id || issue.long.some((other) => other.id === command.id)
        : issue.commands.some((other) => other.id === command.id))
    .map((issue) => issue.type === "collision"
      ? t("settings.shortcut.collision", {
          chord: issue.chord,
          commands: issue.commands.filter((other) => other.id !== command.id).map((other) => other.title).join(", "),
        })
      : issue.type === "shadowed"
        ? t("settings.shortcut.shadowed", {
            command: issue.short.title,
            commands: issue.long.map((other) => other.title).join(", "),
          })
        : t("settings.shortcut.invalid", { binding: issue.binding }));
  // Un accordo che il sistema si prende si salva lo stesso, e si dice.
  const platform = keyboardPlatform(navigator.platform);
  const reserved = reservedChord(binding, platform);
  if (reserved !== null) issues.unshift(t("settings.shortcut.reserved", { chord: displayBinding(reserved, platform) }));
  return issues.join("; ");
}

export async function renderShortcuts(): Promise<HTMLElement[]> {
  const [entries, suggested] = await Promise.all([settings(), drawSuggestedKeys()]);
  const byKey = new Map(entries.map((entry) => [entry.spec.key, entry]));
  const commands = allCommands();
  const nodes: HTMLElement[] = [...suggested, row("muted settings-note", t("settings.shortcuts_hint"))];
  let count = 0;
  const addCommand = (parts: SectionParts, command: CommandEntry, label?: string, description?: string) => {
    const entry = byKey.get(keybindingKey(command.id));
    if (!entry) return;
    const element = renderRow(entry, label, description);
    // La ricerca trova un comando per id, titolo o combinazione: è ciò che si
    // ricorda di una scorciatoia.
    element.dataset.search = normalizeSearch(`${command.id} ${command.title} ${String(entry.value)}`);
    const input = element.querySelector<HTMLInputElement>("input[type=text]");
    const diagnostic = row("setting-source setting-diagnostic", "");
    diagnostic.setAttribute("role", "status");
    if (input) {
      diagnostic.id = `shortcut-issue-${command.id.replace(/[^a-z0-9_-]/gi, "-")}`;
      input.setAttribute("aria-describedby", diagnostic.id);
      const update = () => {
        const issue = shortcutDiagnostic(command, input.value, commands);
        diagnostic.textContent = issue;
        // La riga dice da sé che c'è un problema: la pelle la veste con
        // `[data-issue]`. Un `:has(… :not(:empty)) + *` costava in WebKit
        // ogni testo cambiato in tutta la finestra (vedi `performance-webview.md`).
        element.toggleAttribute("data-issue", issue !== "");
        if (validateKeybinding(input.value).valid) input.removeAttribute("aria-invalid");
        else input.setAttribute("aria-invalid", "true");
      };
      input.addEventListener("input", update);
      update();
      element.querySelector(".setting-text")?.append(diagnostic);
    }
    parts.body.append(element);
    count++;
  };
  let index = 0;
  const finish = (parts: SectionParts) => {
    if (parts.body.childElementCount === 0) return;
    markModified(parts, parts.body.querySelectorAll('[data-modified="true"]').length);
    nodes.push(parts.section);
  };
  const declared = sectionBlock(t("settings.shortcuts.declared"), index++);
  for (const command of commands) {
    if (command.spec) addCommand(declared, command);
  }
  finish(declared);
  const fromShell = commands.filter((command) => command.run !== null);
  if (fromShell.length > 0) {
    const shell = sectionBlock(t("settings.shortcuts.shell.title"), index++, { hint: t("settings.shortcuts.shell") });
    for (const command of fromShell) addCommand(shell, command, command.title, command.description);
    finish(shell);
  }
  // I comandi del Disegno completo (K6 T9c): il loro modulo arriva solo a
  // riquadro aperto (`settings-disegno.ts`), e i tasti stanno in `draw.keys`.
  const drawKeys = byKey.get(DRAW_KEYS_SETTING);
  if (drawKeys) {
    const drawing = sectionBlock(t("settings.drawing_keys.title"), index++, { hint: t("settings.drawing_keys.hint") });
    const changed = await riempiTastiDisegno(drawing.body, drawKeys, {
      scrivi: (action) => write(action),
      ridisegna: () => void render(),
    });
    markModified(drawing, changed);
    nodes.push(drawing.section);
  }
  if (count === 0) nodes.push(row("muted settings-note", t("settings.shortcuts.none")));
  return nodes;
}
