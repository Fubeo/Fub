// Lo spazio di lavoro che la superficie del disegno offre alla banda (piano K6,
// T7; D4: la banda lo mostra accanto alla modalità). Mette insieme ciò che
// sa `preferences.ts` (lo spazio scritto, gli spazi salvati, il componente) con
// le azioni: ripristina, salva lo spazio con un nome, gestisci, e con il
// componente spento, apri Componenti. La banda (chunk principale) lo legge
// con `SurfaceWorkspace` e non sa niente di tutto questo.
//
// Le finestre (il nome da salvare, Gestisci) sono quelle del kit o di
// `ui/dialogs.ts`: niente DOM proprio qui oltre a quelle.

import type { SurfaceWorkspace, SurfaceWorkspaceAction, SurfaceWorkspaceChoice } from "../core/registry";
import { notify } from "../../ui/notify";
import { pickFromList, promptText } from "../../ui/dialogs";
import { t, type DrawKey } from "./strings";
import { eliminaSpazio, nuovoIdSpazio, rinominaSpazio, salvaSpazio, stessoNome, type SpazioSalvato } from "./tools/saved-workspaces";
import { NOME_PRESET, spaziDisponibili, type SpaziDisponibili } from "./tools/workspace-choices";
import type { WorkspaceChoice } from "./preferences";

/// Ciò che la superficie del disegno dà a questo pezzo: lo stato letto, le
/// scritture, e l'editor aperto (la colonna, la scheda e la sezione in uso).
export interface WorkspaceBandDeps {
  /// Lo stato letto dalle impostazioni, come `currentWorkspace()`.
  readonly read: () => WorkspaceChoice;
  /// Il componente «Disegno completo» è acceso adesso.
  readonly componente: () => boolean;
  /// Scrive lo spazio scelto (`draw.workspace`).
  readonly choose: (space: string) => void;
  /// Scrive l'elenco degli spazi salvati, come le voci vanno lette.
  readonly writeSaved: (raw: readonly string[]) => void;
  /// La colonna, la scheda e la sezione dell'editor aperto, per salvarle.
  readonly snapshot: () => Omit<SpazioSalvato, "id" | "nome">;
  /// Riporta lo spazio in uso ai suoi dati di serie (il preset o Completo).
  readonly reset: () => void;
  /// Apre Componenti sulla riga del Disegno completo.
  readonly openComponents: () => void;
  /// Il Completo non si è caricato: lo dice il menu, con «Riprova».
  readonly failed: () => boolean;
  readonly retry: () => void;
  /// Chiamata quando lo spazio, gli spazi o le azioni possono essere cambiati.
  readonly subscribe: (listener: () => void) => () => void;
}

/// I nomi di serie tradotti (Completo, Semplice e gli otto preset), per non
/// salvare uno spazio col nome di uno di serie.
function nomiPreset(): string[] {
  const chiavi: DrawKey[] = ["draw.workspace.base.full", "draw.workspace.base.simple", ...Object.values(NOME_PRESET)];
  return chiavi.map((chiave) => t(chiave));
}

/// Lo spazio della banda: ciò che è in uso, l'elenco e le azioni.
export function createWorkspaceBand(deps: WorkspaceBandDeps): SurfaceWorkspace {
  const leggi = (): SpaziDisponibili => spaziDisponibili({ space: deps.read().space, componente: deps.componente(), savedRaw: deps.read().savedRaw });

  const salva = async (): Promise<void> => {
    const nome = await promptText({
      title: t("draw.workspace.save.title"),
      label: t("draw.workspace.save.label"),
      okLabel: t("draw.workspace.save.ok"),
    });
    if (nome === null) return;
    const pulito = nome.trim();
    if (pulito === "") {
      notify(t("draw.workspace.save.empty"), "guasto");
      return;
    }
    if (nomiPreset().some((preset) => stessoNome(preset, pulito))) {
      notify(t("draw.workspace.save.preset", { name: pulito }), "guasto");
      return;
    }
    const stato = deps.read();
    const esistente = leggi().salvati.find((spazio) => stessoNome(spazio.nome, pulito));
    const id = esistente?.id ?? nuovoIdSpazio(stato.savedRaw);
    const esito = salvaSpazio(stato.savedRaw, { id, nome: pulito, ...deps.snapshot() });
    if (typeof esito === "string") {
      notify(t("draw.workspace.save.taken"), "guasto");
      return;
    }
    deps.writeSaved(esito);
    deps.choose(id);
    notify(t("draw.workspace.saved", { name: pulito }));
  };

  /// «Gestisci»: si sceglie uno spazio salvato, poi lo si rinomina o lo si
  /// elimina. Le voci che non si capiscono restano nell'elenco come sono.
  const gestisci = async (): Promise<void> => {
    const stato = deps.read();
    const salvati = leggi().salvati;
    if (salvati.length === 0) {
      notify(t("draw.workspace.manage.none"));
      return;
    }
    const id = await pickFromList<string>({
      title: t("draw.workspace.manage.title"),
      placeholder: t("draw.workspace.manage.pick"),
      items: salvati.map((spazio) => ({ label: spazio.nome, value: spazio.id })),
    });
    if (id === null) return;
    const spazio = salvati.find((each) => each.id === id);
    if (spazio === undefined) return;
    const azione = await pickFromList<"rinomina" | "elimina">({
      title: spazio.nome,
      placeholder: "",
      items: [
        { label: t("draw.workspace.manage.rename"), value: "rinomina" },
        { label: t("draw.workspace.manage.delete"), value: "elimina" },
      ],
    });
    if (azione === null) return;
    if (azione === "rinomina") {
      const nuovo = await promptText({
        title: t("draw.workspace.manage.rename"),
        label: t("draw.workspace.save.label"),
        value: spazio.nome,
        okLabel: t("draw.workspace.manage.rename"),
      });
      if (nuovo === null) return;
      const esito = rinominaSpazio(stato.savedRaw, id, nuovo);
      if (typeof esito === "string") {
        notify(esito === "nome-occupato" ? t("draw.workspace.save.taken") : t("draw.workspace.manage.failed", { reason: esito }), "guasto");
        return;
      }
      deps.writeSaved(esito);
      notify(t("draw.workspace.manage.rename.done"));
      return;
    }
    const esito = eliminaSpazio(stato.savedRaw, id);
    if (typeof esito === "string") {
      notify(t("draw.workspace.manage.failed", { reason: esito }), "guasto");
      return;
    }
    deps.writeSaved(esito);
    // Lo spazio in uso, se è questo, torna al Completo di serie.
    if (stato.space === id) deps.choose("full");
    notify(t("draw.workspace.manage.delete.done"));
  };

  const azioni = (corrente: SurfaceWorkspaceChoice, componente: boolean): SurfaceWorkspaceAction[] => {
    const lista: SurfaceWorkspaceAction[] = [];
    if (deps.failed()) {
      lista.push({ id: "riprova", label: t("draw.workspace.load.retry"), description: t("draw.workspace.load.failed"), enabled: true, run: deps.retry });
    }
    if (corrente.id !== "simple") {
      if (corrente.group !== "salvato") {
        lista.push({
          id: "ripristina",
          label: t("draw.workspace.reset", { name: corrente.name }),
          description: t("draw.workspace.reset.hint"),
          enabled: componente || corrente.id === "full",
          run: deps.reset,
        });
      }
      lista.push({
        id: "salva",
        label: t("draw.workspace.save"),
        description: t("draw.workspace.save.hint"),
        enabled: componente || corrente.id === "full",
        run: () => void salva(),
      });
    }
    lista.push({ id: "gestisci", label: t("draw.workspace.manage"), enabled: true, run: () => void gestisci() });
    if (!componente) {
      lista.push({ id: "spenti", label: t("draw.workspace.off.others"), description: t("draw.workspace.off.others.hint"), enabled: false, run: () => undefined });
      lista.push({ id: "componenti", label: t("draw.workspace.off.open"), enabled: true, run: deps.openComponents });
    }
    return lista;
  };

  return {
    current: () => leggi().corrente,
    choices: () => leggi().elenco,
    actions: () => {
      const dati = leggi();
      return azioni(dati.corrente, deps.componente());
    },
    choose(id) {
      const voce = leggi().elenco.find((each) => each.id === id);
      if (voce === undefined || !voce.enabled) return;
      deps.choose(id);
    },
    subscribe: deps.subscribe,
  };
}
