// Il chip del vault: dice quale vault è aperto e porta agli altri.
//
// Il nome lo scrive la shell comune dentro `#vault-path`; qui lo si segue per
// dare al chip il suo nome accessibile e il suo stato vuoto. L'elenco viene dal
// registro dei vault conosciuti, preferiti in testa.
import { openVault } from "../../../desktop-shell";
import { errorText } from "../../../host/errors";
import { api } from "../../../host/ipc";
import type { KnownVault } from "../../../host/contract";
import { onLanguage, t } from "../../../i18n/strings";
import { state } from "../../../state/store";
import type { Lifetime } from "../../../ui/lifetime";
import type { MenuItem } from "../../../ui/menu";
import { notify } from "../../../ui/notify";
import { run } from "./commands";
import { below, byId, follow, menuTrigger } from "./dom";

/** Quanti vault il chip propone: oltre, c'è l'elenco intero nelle preferenze. */
const LISTED = 8;

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/** I vault da proporre: i preferiti, poi i più recenti. */
export function listedVaults(known: readonly KnownVault[]): KnownVault[] {
  return [...known]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.last_opened - a.last_opened)
    .slice(0, LISTED);
}

export function mountVaultChip(lifetime: Lifetime): void {
  const chip = byId<HTMLButtonElement>("vault-chip");
  const name = byId("vault-path");
  if (!chip || !name) return;
  const none = byId("vault-chip-none");
  const label = (): void => {
    const shown = name.textContent?.trim() ?? "";
    chip.toggleAttribute("data-empty", shown === "");
    if (none) none.hidden = shown !== "";
    chip.setAttribute("aria-label", shown === "" ? t("frame.vault_chip") : t("frame.vault_chip.named", { name: shown }));
  };
  label();
  follow(lifetime, name, label);
  lifetime.add(onLanguage(label));

  const menu = menuTrigger(chip);
  // L'elenco arriva dopo un'attesa: una seconda pressione nel frattempo vale
  // più della prima, e la risposta vecchia non apre niente.
  let asked = 0;
  const open = async (): Promise<void> => {
    if (!state.vaultRoot) {
      run("shell.vault.open");
      return;
    }
    const mine = ++asked;
    // Premuto a menu aperto lo chiude.
    if (menu.open) {
      menu.close();
      return;
    }
    let known: KnownVault[] = [];
    try {
      known = await api.knownVaults();
    } catch {
      // Senza registro resta la voce che apre una cartella: il chip non
      // diventa un vicolo cieco perché l'elenco non è arrivato.
    }
    if (lifetime.closed || mine !== asked) return;
    const items: MenuItem[] = listedVaults(known).map((vault) => ({
      label: `${vault.icon ?? ""} ${vault.name || folderName(vault.root)}`.trim(),
      description: vault.root,
      choice: "radio",
      checked: vault.root === state.vaultRoot,
      selected: vault.root === state.vaultRoot,
      run: () => {
        if (vault.root === state.vaultRoot) return;
        openVault(vault.root).catch((error: unknown) => notify(errorText(error), "guasto"));
      },
    }));
    items.push({ label: t("app.open_vault"), separator: items.length > 0, run: () => run("shell.vault.open") });
    menu.show(below(chip), items);
  };
  lifetime.listen(chip, "click", (event) => {
    event.stopPropagation();
    void open();
  });
}
