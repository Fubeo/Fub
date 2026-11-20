// Il campo di `map.tile-hosts`, nelle Impostazioni: i siti da cui la vista
// Mappa di una Base può scaricare le tessere. Una pastiglia per sito con il
// suo «Rimuovi», una casella per aggiungerne uno e OpenStreetMap con un clic.
// Il pannello carica questo modulo quando la riga c'è.
//
// Chi decide è l'host: rifiuta da sé un valore che non è un nome di host
// (`user_value_problem`) e scarica soltanto dai siti della riga
// (`Host::map_tile`). Qui il controllo serve a dire subito che cosa non va.
import type { SettingEntry } from "../host/contract";
import { t } from "../i18n/strings";
import { icon } from "./icons";
import { setTooltip } from "./tooltip";

/// Il sito delle tessere di OpenStreetMap.
export const OPENSTREETMAP_HOST = "tile.openstreetmap.org";

/// Un nome di host come lo accetta l'host (`map_tiles::is_host_name`).
export function isHostName(host: string): boolean {
  return host.length > 0 && host.length <= 253 && host.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-") && /^[a-z0-9-]+$/i.test(label));
}

/// Il nome di host da ciò che si è scritto: il nome com'è, oppure il sito di
/// un indirizzo incollato intero (`https://tile.example.org/{z}/…`). In
/// minuscolo; `null` se non ne esce un nome.
export function hostFromInput(raw: string): string | null {
  const text = raw.trim();
  if (text.includes("://")) {
    try {
      const url = new URL(text.replace(/\{[a-z]\}/gi, "0"));
      return url.protocol === "https:" && isHostName(url.hostname) ? url.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  const host = text.toLowerCase();
  return isHostName(host) ? host : null;
}

function hostsOf(entry: SettingEntry): string[] {
  return Array.isArray(entry.value) ? entry.value.filter((item): item is string => typeof item === "string") : [];
}

export function mapTileHostsField(
  entry: SettingEntry,
  id: string,
  write: (value: string[], part: string, checked: boolean) => void,
): HTMLElement {
  const hosts = hostsOf(entry);
  const has = (host: string) => hosts.some((other) => other.trim().toLowerCase() === host);
  const editor = document.createElement("div");
  editor.className = "setting-list";
  editor.setAttribute("role", "group");
  editor.setAttribute("aria-labelledby", `${id}-label`);

  if (hosts.length === 0) {
    const none = document.createElement("p");
    none.className = "muted";
    none.textContent = t("map.hosts.none");
    editor.append(none);
  } else {
    const list = document.createElement("ul");
    list.className = "setting-chips";
    for (const host of hosts) {
      const item = document.createElement("li");
      item.className = "setting-chip";
      item.append(document.createTextNode(host));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "setting-chip-remove";
      remove.innerHTML = icon("close");
      remove.setAttribute("aria-label", t("map.hosts.remove.hint", { site: host }));
      setTooltip(remove, t("map.hosts.remove"));
      remove.addEventListener("click", () => write(hosts.filter((other) => other !== host), host, false));
      item.append(remove);
      list.append(item);
    }
    editor.append(list);
  }

  const form = document.createElement("form");
  form.className = "setting-list-add";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "setting-input";
  input.id = id;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = t("map.hosts.placeholder");
  const error = document.createElement("p");
  error.className = "setting-field-error";
  error.id = `${id}-error`;
  error.setAttribute("role", "alert");
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);
  const add = document.createElement("button");
  add.type = "submit";
  add.className = "settings-btn";
  add.textContent = t("map.hosts.add");
  form.append(input, add, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const refuse = (message: string) => {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
    };
    if (input.value.trim() === "") return refuse(t("map.hosts.empty"));
    const host = hostFromInput(input.value);
    if (host === null) return refuse(t("map.hosts.invalid", { value: input.value.trim() }));
    if (has(host)) return refuse(t("map.hosts.duplicate", { site: host }));
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    write([...hosts, host], host, true);
  });
  editor.append(form);

  // OpenStreetMap con un clic, con la sua attribuzione e la sua regola.
  if (!has(OPENSTREETMAP_HOST)) {
    const preset = document.createElement("div");
    preset.className = "setting-preset";
    const osm = document.createElement("button");
    osm.type = "button";
    osm.className = "settings-btn";
    osm.textContent = t("map.hosts.osm");
    osm.addEventListener("click", () => write([...hosts, OPENSTREETMAP_HOST], OPENSTREETMAP_HOST, true));
    const note = document.createElement("p");
    note.className = "setting-description";
    note.textContent = t("map.hosts.osm.note");
    preset.append(osm, note);
    editor.append(preset);
  }
  return editor;
}

/// La lista come la dice il campo: i siti, separati da virgole.
export function describeMapTileHosts(value: readonly string[]): string {
  return value.join(", ");
}
