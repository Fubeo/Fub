// L'elenco degli spazi di lavoro che il menu della banda e il menu ≡ mostrano
// (piano K6, T7). Un solo posto lo decide: Semplice e Completo, i preset del
// Disegno completo, poi gli spazi salvati. Con il componente «Disegno completo»
// spento i preset sono grigi, con il perché, e lo spazio in uso è Completo
// nativo: il valore scritto resta nel vault, com'è.
//
// Qui niente DOM e niente impostazioni: si passa lo stato letto, e si ottengono
// le voci con i nomi già tradotti.

import type { SurfaceWorkspaceChoice } from "../../core/registry";
import { t, type DrawKey } from "../strings";
import { leggiSpazi, spaziUsabili, type SpazioSalvato, type VoceSalvata } from "./saved-workspaces";
import { SPAZI_COMPLETO } from "./registry";

/// Il nome di ciascun preset nel catalogo: la chiave è controllata dal tipo, e
/// un preset nuovo senza nome non compila.
export const NOME_PRESET: Readonly<Record<string, DrawKey>> = {
  "completo-classico": "draw.workspace.preset.completo-classico",
  automazione: "draw.workspace.preset.automazione",
  impaginazione: "draw.workspace.preset.impaginazione",
  pittura: "draw.workspace.preset.pittura",
  ricalco: "draw.workspace.preset.ricalco",
  "stampa-e-prova": "draw.workspace.preset.stampa-e-prova",
  tipografia: "draw.workspace.preset.tipografia",
  web: "draw.workspace.preset.web",
};

/// Che cosa si sa dello stato dei spazi per disegnarne il menu.
export interface StatoSpazi {
  /// L'id scritto nel vault (`draw.workspace`), come l'ha letto la superficie.
  readonly space: string;
  /// Il componente «Disegno completo» è acceso.
  readonly componente: boolean;
  /// Le voci di `draw.workspaces` come stanno nel vault.
  readonly savedRaw: readonly string[];
}

/// Gli spazi per il menu, e quale è in uso adesso.
export interface SpaziDisponibili {
  readonly corrente: SurfaceWorkspaceChoice;
  readonly elenco: readonly SurfaceWorkspaceChoice[];
  /// Gli spazi salvati che si usano, per «Gestisci» e per il menu.
  readonly salvati: readonly SpazioSalvato[];
  /// Le voci che non si usano: una versione più nuova, o rotte (per dirlo).
  readonly nonUsabili: readonly VoceSalvata[];
}

/// Le voci del menu con i nomi già tradotti, e lo spazio in uso. Uno spazio
/// del Completo o uno salvato, con il componente spento, è in uso come
/// Completo nativo.
export function spaziDisponibili(stato: StatoSpazi): SpaziDisponibili {
  const voci = leggiSpazi(stato.savedRaw);
  const salvati = spaziUsabili(voci);
  const nonUsabili = voci.filter((voce) => voce.kind !== "spazio");
  const semplice: SurfaceWorkspaceChoice = {
    id: "simple",
    name: t("draw.workspace.base.simple"),
    description: t("draw.workspace.base.simple.description"),
    group: "base",
    enabled: true,
  };
  const completo: SurfaceWorkspaceChoice = {
    id: "full",
    name: t("draw.workspace.base.full"),
    description: t("draw.workspace.base.full.description"),
    group: "base",
    enabled: true,
  };
  const reason = stato.componente ? undefined : t("draw.workspace.off.reason");
  const preset: SurfaceWorkspaceChoice[] = SPAZI_COMPLETO.map((id) => ({
    id,
    name: t(NOME_PRESET[id]),
    group: "completo",
    enabled: stato.componente,
    ...(reason !== undefined ? { reason } : {}),
  }));
  const dalSalvato: SurfaceWorkspaceChoice[] = salvati.map((spazio) => ({
    id: spazio.id,
    name: spazio.nome,
    group: "salvato",
    enabled: stato.componente,
    ...(reason !== undefined ? { reason } : {}),
  }));
  const nonUsabiliVoci: SurfaceWorkspaceChoice[] = nonUsabili.map((voce, indice) => ({
    id: `non-usabile-${indice}`,
    name: voce.kind === "piuNuova" && voce.nome !== null ? voce.nome : t("draw.workspace.saved.unreadable"),
    group: "salvato",
    enabled: false,
    reason: voce.kind === "piuNuova" ? t("draw.workspace.saved.newer") : t("draw.workspace.saved.broken"),
  }));
  const elenco = [semplice, completo, ...preset, ...dalSalvato, ...nonUsabiliVoci];
  const corrente = trovaCorrente(stato.space, stato.componente, elenco, completo);
  return { corrente, elenco, salvati, nonUsabili };
}

/// Lo spazio in uso: quello scritto, se si può usare adesso; altrimenti
/// Completo.
function trovaCorrente(space: string, componente: boolean, elenco: readonly SurfaceWorkspaceChoice[], completo: SurfaceWorkspaceChoice): SurfaceWorkspaceChoice {
  const scelto = elenco.find((voce) => voce.id === space);
  if (scelto === undefined) return completo;
  if (scelto.group === "base") return scelto;
  if (!componente) return completo;
  return scelto;
}
