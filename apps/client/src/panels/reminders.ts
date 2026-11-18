// I promemoria passati, all'avvio (E10, T36).
//
// Ciò che è suonato mentre l'app era chiusa non arriva come una raffica di
// notifiche (il notificatore dell'app non fa suonare niente al primo sguardo,
// `fub-features/src/tasks/reminders.rs`): arriva qui, in un dialogo solo
// quando il vault si apre e il suo indice è pronto. Ogni riga ha «Apri», che
// porta al compito, e «Fatto», che lo spunta nella nota d'origine.
//
// Perché un dialogo e non gli avvisi della barra di stato: gli avvisi sono al
// più tre, uno per riga, e le loro azioni muoiono con loro; un elenco con due
// azioni per voce è una lista da leggere, e i promemoria sono cose che
// l'utente ha chiesto esplicitamente che gli si dicessero. All'apertura del
// vault la shell chiede già così ciò che non può aspettare (i link `fub://`,
// il visore web).
//
// L'indice dei promemoria vive in memoria e non ricorda chi li ha visti: un
// promemoria passato e aperto torna a ogni apertura del vault finché non è
// fatto, spostato o tolto. È la stessa regola della nota, che lo tiene.
//
// Qui si legge anche il permesso delle notifiche dei compiti, per la
// pastiglia e la scelta nella nota (`setReminderNotifications`).
import { api } from "../host/ipc";
import { settings, vaultStatus } from "../host/query";
import { errorText } from "../host/errors";
import { openDialog, textButton } from "../kit";
import { t, resolvedLanguage } from "../i18n/strings";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { permissionKey } from "../ui/permissions";
import { onEvent } from "../state/kernel";
import { on, openVaultRoot, vaultArg } from "../state/store";
import { settingTouches } from "../state/setting-change";
import { pageName } from "../rules/mirrored";
import {
  reminderLong,
  reminderTimeOf,
  setReminderNotifications,
} from "../editors/text/profiles/markdown/task-reminder";

/// Il componente dei compiti, che tiene l'indice dei promemoria e la
/// spunta (`note.task.toggle`).
const TASKS = "fub.tasks";
/// L'impostazione del permesso delle notifiche dei compiti.
export const NOTIFICATIONS_SETTING = permissionKey(TASKS, "fub:notifications");
/// Quanti se ne mostrano al più: oltre, una riga dice quanti altri.
export const STARTUP_LIMIT = 50;
/// Ogni quanto si guarda se l'indice dell'apertura è arrivato in fondo, e
/// per quanto al più.
const INDEX_POLL_MS = 1_500;
const INDEX_WAIT_MS = 180_000;

/// Un promemoria come lo porta l'indice (`ReminderEntry` in `fub-features`).
export interface ReminderEntry {
  readonly doc: string;
  /// Il byte del segno del compito nel file.
  readonly at: number;
  /// `AAAA-MM-GG HH:MM`, l'ora del muro.
  readonly when: string;
  readonly text: string;
  readonly heading?: string | null;
}

export interface ReminderList {
  readonly reminders: readonly ReminderEntry[];
  readonly more: boolean;
}

/// Ciò che l'elenco chiede al resto della shell: i test lo danno finto.
export interface RemindersPort {
  /// I promemoria con l'ora fino a `until` compreso, in ordine d'ora.
  ask(until: string, limit: number): Promise<ReminderList>;
  /// Spunta il compito della nota `doc` al byte `at`.
  done(doc: string, at: number): Promise<void>;
  /// Apre la nota sul compito.
  open(doc: string, at: number): void;
  /// L'indice del vault aperto è pronto.
  indexed(): Promise<boolean>;
  /// Le notifiche dei compiti sono accese.
  notificationsOn(): Promise<boolean>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/// L'ora del muro di adesso, nella forma dell'indice.
export function wallMinute(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/// La risposta dell'indice, letta: `null` se non ha la forma.
export function readReminderList(value: unknown): ReminderList | null {
  if (typeof value !== "object" || value === null) return null;
  const { reminders, more } = value as { reminders?: unknown; more?: unknown };
  if (!Array.isArray(reminders)) return null;
  const out: ReminderEntry[] = [];
  for (const item of reminders) {
    if (typeof item !== "object" || item === null) return null;
    const { doc, at, when, text, heading } = item as Record<string, unknown>;
    if (typeof doc !== "string" || typeof at !== "number" || typeof when !== "string" || typeof text !== "string") return null;
    out.push({ doc, at, when, text, heading: typeof heading === "string" ? heading : null });
  }
  return { reminders: out, more: more === true };
}

/// La porta vera: il canale dati, il registro dei comandi e le impostazioni.
export function hostRemindersPort(open: (doc: string, at: number) => void): RemindersPort {
  return {
    ask: async (until, limit) => {
      const answer = await api.queryIndex(
        { kind: "custom", ns: TASKS, query: { kind: "reminders", version: 1, until, limit } },
        ...vaultArg(openVaultRoot()),
      );
      const list = answer.kind === "custom" ? readReminderList(answer.value) : null;
      if (!list) throw new Error(t("reminders.startup.unreadable"));
      return list;
    },
    done: async (doc, at) => {
      await api.invokeCommand("note.task.toggle", { doc, at: [at] }, "apply", ...vaultArg(openVaultRoot()));
    },
    open,
    indexed: async () => (await vaultStatus()).indexing !== "running",
    notificationsOn: async () => (await settings(TASKS)).find((entry) => entry.spec.key === NOTIFICATIONS_SETTING)?.value !== false,
  };
}

/// Il dialogo dei promemoria passati. Si chiude da sé quando l'ultimo è
/// fatto; `lifetime` lo chiude con la finestra o col vault.
export function showPastReminders(list: ReminderList, port: RemindersPort, lifetime: Lifetime, now = new Date()): void {
  const own = openLifetime();
  lifetime.add(() => own.close());
  const language = resolvedLanguage();
  const body = document.createElement("ul");
  body.className = "reminders-list";
  const rows = new Map<HTMLElement, ReminderEntry>();
  let handle: ReturnType<typeof openDialog<null>> | null = null;

  for (const entry of list.reminders) {
    const row = document.createElement("li");
    row.className = "reminders-row";
    const text = document.createElement("div");
    text.className = "reminders-text";
    const title = document.createElement("span");
    title.className = "reminders-task";
    title.textContent = entry.text.trim() || t("reminders.startup.untitled");
    const where = document.createElement("span");
    where.className = "reminders-where";
    const when = reminderTimeOf(entry.when);
    const place = entry.heading ? `${pageName(entry.doc)} › ${entry.heading}` : pageName(entry.doc);
    where.textContent = t("reminders.startup.where", { when: when ? reminderLong(when, language) : entry.when, note: place });
    text.append(title, where);
    const say = document.createElement("span");
    say.className = "reminders-error";
    say.setAttribute("role", "alert");
    say.hidden = true;
    text.append(say);
    const actions = document.createElement("div");
    actions.className = "reminders-actions";
    const openButton = textButton({
      label: t("reminders.startup.open"),
      lifetime: own,
      onPress: () => {
        handle?.close(null);
        port.open(entry.doc, entry.at);
      },
    });
    openButton.setAttribute("aria-label", t("reminders.startup.open_named", { task: title.textContent }));
    const doneButton = textButton({
      label: t("reminders.startup.done"),
      lifetime: own,
      onPress: () => void markDone(row, entry, doneButton, say),
    });
    doneButton.setAttribute("aria-label", t("reminders.startup.done_named", { task: title.textContent }));
    actions.append(openButton, doneButton);
    row.append(text, actions);
    rows.set(row, entry);
    body.append(row);
  }
  if (list.more) {
    const more = document.createElement("li");
    more.className = "reminders-more";
    more.textContent = t("reminders.startup.more");
    body.append(more);
  }

  /// «Fatto»: prima si rilegge l'indice, perché il compito potrebbe essere
  /// cambiato da quando l'elenco è apparso (la spunta non porta una
  /// revisione: rovescerebbe un compito già spuntato altrove).
  const markDone = async (row: HTMLElement, entry: ReminderEntry, button: HTMLButtonElement, say: HTMLElement): Promise<void> => {
    button.disabled = true;
    say.hidden = true;
    try {
      const fresh = await port.ask(wallMinute(now), STARTUP_LIMIT * 4);
      if (own.closed) return;
      const still = fresh.reminders.some((each) => each.doc === entry.doc && each.at === entry.at && each.when === entry.when);
      if (still) await port.done(entry.doc, entry.at);
      if (own.closed) return;
      row.remove();
      rows.delete(row);
      if (rows.size === 0) handle?.close(null);
    } catch (error) {
      if (own.closed) return;
      button.disabled = false;
      say.hidden = false;
      say.textContent = t("reminders.startup.failed", { reason: errorText(error) });
    }
  };

  const count = list.reminders.length;
  handle = openDialog<null>({
    title: count === 1 ? t("reminders.startup.title.one") : t("reminders.startup.title", { count: list.more ? `${count}+` : String(count) }),
    description: t("reminders.startup.description"),
    body,
    actions: [{ id: "close", label: t("reminders.startup.close"), kind: "primary", value: null, autofocus: true }],
    dismissValue: null,
    lifetime: own,
    className: "reminders-dialog",
  });
  void handle.result.then(() => own.close());
}

/// Monta l'elenco dei promemoria passati e il permesso delle notifiche.
/// Una volta per vault e per finestra: riaprire lo stesso vault non lo
/// ripete; il vault cambiato lo chiede di nuovo.
export function mountReminders(lifetime: Lifetime, port: RemindersPort): void {
  const shown = new Set<string>();
  let current: Lifetime | null = null;

  const readPermission = (): void => {
    void port.notificationsOn().then(
      (on) => { if (!lifetime.closed) setReminderNotifications(on); },
      () => {},
    );
  };

  const startup = (): void => {
    current?.close();
    const root = openVaultRoot();
    if (!root) return;
    readPermission();
    if (shown.has(root)) return;
    const own = openLifetime();
    current = own;
    lifetime.add(() => own.close());
    const since = Date.now();
    const look = async (): Promise<void> => {
      if (own.closed || openVaultRoot() !== root) return;
      const ready = await port.indexed().catch(() => false);
      if (own.closed || openVaultRoot() !== root) return;
      if (!ready) {
        if (Date.now() - since < INDEX_WAIT_MS) later();
        return;
      }
      shown.add(root);
      const now = new Date();
      const list = await port.ask(wallMinute(now), STARTUP_LIMIT).catch(() => null);
      if (own.closed || openVaultRoot() !== root || !list || list.reminders.length === 0) return;
      showPastReminders(list, port, own, now);
    };
    const later = (): void => {
      const timer = setTimeout(() => void look(), INDEX_POLL_MS);
      own.add(() => clearTimeout(timer));
    };
    // Il primo sguardo aspetta un giro anche lui: l'apertura del vault ha i
    // suoi passi (registri, viste, prima nota), e l'elenco viene dopo di loro,
    // non in mezzo.
    later();
  };

  lifetime.add(on("vault", startup));
  lifetime.add(onEvent("vault_closed", () => current?.close()));
  lifetime.add(onEvent("setting_changed", (event) => {
    if (settingTouches(event.key, (key) => key === NOTIFICATIONS_SETTING)) readPermission();
  }));
  lifetime.add(() => current?.close());
  if (openVaultRoot()) startup();
}
