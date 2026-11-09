// Le app Craft installate (N7), per «Apri con un'altra app». Qui si tiene
// soltanto se ce n'è almeno una: all'apertura del vault si chiede all'host
// l'elenco delle sette (`externalEditors(null)`), e lo si richiede quando
// cambia `craft.editor-paths` o quando il componente «File delle app Craft»
// si accende o si spegne. Un rifiuto del comando (un'app vecchia, il vault
// che se ne va) vale «nessuna»: la voce resta quella dell'app di sistema.
//
// Le voci del sottomenu, invece, si chiedono ogni volta che il menu si apre
// (`externalEditors(doc)`): dicono quali app aprono quel file e quali Fub ha
// avviato, e non si tengono qui perché invecchierebbero.

import { api, type ExternalEditor, type OpenedWith } from "../host/ipc";
import { CRAFT_PREVIEW_COMMAND } from "../host/craft";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { on, openVaultRoot, state } from "./store";

/// La chiave dell'impostazione, gemella di `CRAFT_EDITOR_PATHS` in
/// `crates/fub-host/src/settings.rs`.
export const CRAFT_EDITOR_PATHS_KEY = "craft.editor-paths";

/// Le domande all'host che «Apri con» fa, per vault esplicito: una risposta
/// arrivata dopo il cambio di vault parla del vault di prima.
export interface OpenWithHost {
  /// Almeno un'app Craft è installata: senza, la voce è quella di sempre.
  installed(): boolean;
  /// Le app che aprono `doc`, nell'ordine della tabella dell'host.
  editors(doc: string, vault: string | undefined): Promise<readonly ExternalEditor[]>;
  /// Apre `doc` con l'app `editor`.
  open(doc: string, editor: string, vault: string | undefined): Promise<OpenedWith>;
}

/// Una voce del sottomenu, nella forma che sia il menu dell'albero sia quello
/// di un editor sanno disegnare. `note` è la riga che la spiega: «Non
/// installata» sulla voce spenta, «Già aperta» su quella avviata da Fub.
export interface OpenWithChoice {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly note?: string;
  run(): void;
}

/// L'id della prima voce, l'app predefinita del sistema.
export const SYSTEM_CHOICE = "system";

let installed = false;
let craftServed: boolean | null = null;
const race = new Race();

/// Se il vault aperto ha almeno un'app Craft installata.
export function craftEditorsInstalled(): boolean {
  return installed;
}

/// La strada vera: l'IPC della shell principale.
export const shellOpenWith: OpenWithHost = {
  installed: craftEditorsInstalled,
  editors: (doc, vault) => api.externalEditors(doc, vault ?? null),
  open: (doc, editor, vault) => api.openWith(doc, editor, null, vault ?? null),
};

/// Le voci di «Apri con» per `doc`: per prima l'app di sistema (`system`),
/// poi le app Craft che l'host dà per quel file. Un elenco che non arriva
/// lascia la sola app di sistema; un'apertura che fallisce dice la frase
/// dell'host. Il vault è quello di quando il menu si è aperto: chiuso nel
/// frattempo, l'host rifiuta e la frase lo dice.
export async function openWithChoices(
  doc: string,
  system: () => void,
  host: OpenWithHost = shellOpenWith,
): Promise<OpenWithChoice[]> {
  const vault = openVaultRoot();
  const first: OpenWithChoice = { id: SYSTEM_CHOICE, label: t("open_with.system"), disabled: false, run: system };
  const editors = await host.editors(doc, vault).catch((): readonly ExternalEditor[] => []);
  return [
    first,
    ...editors.map((editor): OpenWithChoice => ({
      id: editor.id,
      label: editor.name,
      disabled: !editor.installed,
      note: !editor.installed ? t("open_with.not_installed") : editor.running ? t("open_with.running") : undefined,
      run: () => {
        void host.open(doc, editor.id, vault).catch((error: unknown) => notify(errorText(error), "guasto"));
      },
    })),
  ];
}

/// Il componente «File delle app Craft» serve il vault: il kernel elenca il
/// suo comando.
function craftIsServed(): boolean {
  return state.commandSpecs.some((spec) => spec.id === CRAFT_PREVIEW_COMMAND);
}

async function refresh(
  vault: string | undefined,
  list: (vault: string) => Promise<readonly ExternalEditor[]>,
): Promise<void> {
  await race.last(async (expected) => {
    const editors = vault === undefined ? [] : await expected(list(vault).catch((): readonly ExternalEditor[] => []));
    installed = editors.some((editor) => editor.installed);
  });
}

/// Tiene allineato «c'è un'app Craft installata» finché `lifetime` è vivo.
/// `list` è la domanda all'host, sostituibile nei test.
export function mountExternalEditors(
  lifetime: Lifetime,
  list: (vault: string) => Promise<readonly ExternalEditor[]> = (vault) => api.externalEditors(null, vault),
): void {
  const again = (vault = openVaultRoot()): void => void refresh(vault, list);
  lifetime.add(on("vault", (root) => {
    craftServed = null;
    again(root || undefined);
  }));
  lifetime.add(onEvent("vault_closed", () => {
    race.cancel();
    installed = false;
    craftServed = null;
  }));
  lifetime.add(onEvent("setting_changed", (event) => {
    if (event.key === CRAFT_EDITOR_PATHS_KEY) again();
  }));
  // L'elenco dei comandi si rilegge all'apertura del vault, alla palette e
  // dopo aver acceso o spento un componente: conta soltanto quando il
  // comando del componente compare o sparisce.
  lifetime.add(on("commands", () => {
    const served = craftIsServed();
    const changed = craftServed !== null && craftServed !== served;
    craftServed = served;
    if (changed) again();
  }));
  lifetime.add(() => {
    race.cancel();
    installed = false;
    craftServed = null;
  });
  if (openVaultRoot() !== undefined) again();
}
