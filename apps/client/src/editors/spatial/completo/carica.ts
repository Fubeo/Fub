// Le famiglie del Disegno completo, una alla volta e solo quando servono
// (piano K6, T5; `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//
// `famiglia(id)` porta il chunk della famiglia (`famiglie/<id>/index.ts`, che
// Vite mette in `drawing-fam-<id>`) e, insieme, chiede al motore di
// prepararla (`disegno.famiglia.prepara`). Per ogni famiglia una macchina a
// stati:
//
//   assente → in arrivo → pronta
//                       ↘ errore → («Riprova») in arrivo
//
// Ogni giro ha un numero: l'esito di un giro che non è più l'ultimo (un
// «Riprova» a metà, il disegno chiuso) si butta. Due chiamate insieme fanno
// un giro solo. La famiglia pronta chiama `registra(ctx)` una volta sola.

import { DRAWING_COMMAND_FAMILY_PREPARE, DRAWING_FAMILIES } from "../../../host/contract";
import type { Lifetime, Teardown } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";

/// Ciò che il Completo aperto dà alle sue famiglie.
export interface ContestoCompleto {
  /// Il motore del disegno aperto; `null` se l'editor non ne ha uno.
  readonly motore: MotoreDelDisegno | null;
  /// La vita del Completo: si chiude col disegno.
  readonly life: Lifetime;
}

/// Ciò che il file `index.ts` di una famiglia esporta di serie.
export interface ModuloFamiglia {
  /// Monta i pezzi della famiglia (finestre, sezioni, strumenti): una volta
  /// sola per Completo aperto, quando la famiglia è pronta.
  registra(ctx: ContestoCompleto): void;
}

/// Perché una famiglia non è pronta: il motore non ha memoria per lei, il
/// motore manca o l'ha rifiutata, o il suo chunk non è arrivato (o non si è
/// montato).
export type PercheErrore = "no-memory" | "motore" | "chunk";

export type StatoFamiglia =
  | { readonly kind: "assente" }
  | { readonly kind: "in-arrivo"; readonly giro: number }
  | { readonly kind: "pronta" }
  | { readonly kind: "errore"; readonly perche: PercheErrore };

/// Che cosa ha risposto il motore a `disegno.famiglia.prepara`: pronta,
/// un errore, o `null` se la risposta non conta più (la sessione si è chiusa
/// col disegno).
export type EsitoPrepara = "pronta" | { readonly errore: PercheErrore } | null;

export interface Caricatore {
  /// Porta la famiglia: la promessa si risolve con `pronta` o con `errore`,
  /// mai con un rifiuto. Pronta, o già in arrivo, non fa un giro nuovo; in
  /// errore aspetta «Riprova».
  famiglia(id: string): Promise<StatoFamiglia>;
  stato(id: string): StatoFamiglia;
  /// «Riprova»: un giro nuovo per una famiglia in errore (o in arrivo da
  /// troppo). Su una famiglia pronta non fa niente.
  riprova(id: string): Promise<StatoFamiglia>;
  /// Avvisa a ogni cambio di stato, con la famiglia che è cambiata.
  quandoCambia(listener: (id: string) => void): Teardown;
  /// Il disegno si chiude: gli esiti in volo si buttano, e nessuna famiglia
  /// si prepara più.
  chiudi(): void;
}

type Moduli = Record<string, () => Promise<unknown>>;

export interface OpzioniCaricatore {
  readonly ctx: ContestoCompleto;
  /// I chunk delle famiglie, per percorso (`./famiglie/<id>/index.ts`); di
  /// serie quelli veri.
  readonly moduli?: Moduli;
  /// La preparazione nel motore; di serie `disegno.famiglia.prepara` sulla
  /// sessione del disegno aperto.
  readonly prepara?: (famiglia: string) => Promise<EsitoPrepara>;
}

const ASSENTE: StatoFamiglia = { kind: "assente" };

/// Quanto si aspetta che la sessione del motore si apra, come
/// `ATTESA_APERTURA_MS` di `../motore/gesti.ts`: qui un numero suo, perché un
/// import di valore da lì porterebbe la superficie nel chunk del Completo, e
/// la build lo vieta.
const ATTESA_MOTORE_MS = 2_000;

/// `disegno.famiglia.prepara` sulla sessione del motore di `motore`.
export async function preparaNelMotore(motore: MotoreDelDisegno | null, famiglia: string): Promise<EsitoPrepara> {
  if (!motore) return { errore: "motore" };
  const sessione = await motore.pronta(ATTESA_MOTORE_MS);
  if (!sessione) return { errore: "motore" };
  const esito = await sessione.comando({ id: DRAWING_COMMAND_FAMILY_PREPARE, selection: [], value: { famiglia } });
  if (esito === null) return null;
  if ("kind" in esito) return { errore: "motore" };
  if (esito.refused === "no_memory") return { errore: "no-memory" };
  if (esito.refused !== null) return { errore: "motore" };
  // «in-corso» vale pronta: un comando della famiglia aspetta la nascita già
  // partita (`crates/fub-disegno/src/famiglie/mod.rs`).
  const stato = (esito.reading as { stato?: unknown } | null | undefined)?.stato;
  return stato === "pronta" || stato === "in-corso" ? "pronta" : { errore: "motore" };
}

/// Il modulo di una famiglia, se ha la forma che serve.
function moduloDi(caricato: unknown): ModuloFamiglia | null {
  const modulo = (caricato as { default?: unknown } | null)?.default as { registra?: unknown } | undefined;
  return typeof modulo?.registra === "function" ? (modulo as ModuloFamiglia) : null;
}

interface Voce {
  stato: StatoFamiglia;
  /// La promessa del giro in corso; `null` se non ce n'è uno.
  promessa: Promise<StatoFamiglia> | null;
}

export function caricatore(opzioni: OpzioniCaricatore): Caricatore {
  const { ctx } = opzioni;
  const moduli: Moduli = opzioni.moduli ?? import.meta.glob("./famiglie/*/index.ts");
  const prepara = opzioni.prepara ?? ((famiglia: string) => preparaNelMotore(ctx.motore, famiglia));
  const voci = new Map<string, Voce>();
  const registrate = new Set<string>();
  const ascolti = new Set<(id: string) => void>();
  let giri = 0;
  let chiuso = false;

  const voce = (id: string): Voce => {
    let v = voci.get(id);
    if (!v) {
      v = { stato: ASSENTE, promessa: null };
      voci.set(id, v);
    }
    return v;
  };

  const cambia = (id: string, stato: StatoFamiglia): void => {
    voce(id).stato = stato;
    for (const ascolto of [...ascolti]) ascolto(id);
  };

  /// Un giro: il chunk e la preparazione insieme, poi `registra`.
  const giro = (id: string): Promise<StatoFamiglia> => {
    const v = voce(id);
    const numero = ++giri;
    const vecchio = (): boolean => chiuso || v.stato.kind !== "in-arrivo" || v.stato.giro !== numero;
    cambia(id, { kind: "in-arrivo", giro: numero });
    const carica = moduli[`./famiglie/${id}/index.ts`];
    const chunk: Promise<ModuloFamiglia | null> = carica
      ? carica().then(moduloDi, () => null)
      : Promise.resolve(null);
    const motore: Promise<EsitoPrepara> = prepara(id).catch((): EsitoPrepara => ({ errore: "motore" }));
    const promessa = Promise.all([chunk, motore]).then(([modulo, esito]): Promise<StatoFamiglia> | StatoFamiglia => {
      // Un giro vecchio: vale l'esito del giro che ne ha preso il posto.
      if (vecchio()) return chiuso ? ASSENTE : (v.promessa ?? v.stato);
      let finale: StatoFamiglia;
      if (esito === null) {
        // La sessione si è chiusa col disegno: la risposta non conta.
        finale = ASSENTE;
      } else if (!modulo) {
        finale = { kind: "errore", perche: "chunk" };
      } else if (esito !== "pronta") {
        finale = { kind: "errore", perche: esito.errore };
      } else {
        finale = { kind: "pronta" };
        if (!registrate.has(id)) {
          try {
            modulo.registra(ctx);
            registrate.add(id);
          } catch {
            finale = { kind: "errore", perche: "chunk" };
          }
        }
      }
      v.promessa = null;
      cambia(id, finale);
      return finale;
    });
    v.promessa = promessa;
    return promessa;
  };

  const noto = (id: string): boolean => (DRAWING_FAMILIES as readonly string[]).includes(id);

  return {
    famiglia(id) {
      if (chiuso) return Promise.resolve(ASSENTE);
      if (!noto(id)) return Promise.resolve<StatoFamiglia>({ kind: "errore", perche: "chunk" });
      const v = voce(id);
      if (v.stato.kind === "pronta") return Promise.resolve(v.stato);
      if (v.promessa) return v.promessa;
      if (v.stato.kind === "errore") return Promise.resolve(v.stato);
      return giro(id);
    },
    stato: (id) => voci.get(id)?.stato ?? ASSENTE,
    riprova(id) {
      if (chiuso) return Promise.resolve(ASSENTE);
      if (!noto(id)) return Promise.resolve<StatoFamiglia>({ kind: "errore", perche: "chunk" });
      const v = voce(id);
      if (v.stato.kind === "pronta") return Promise.resolve(v.stato);
      return giro(id);
    },
    quandoCambia(listener) {
      ascolti.add(listener);
      return () => {
        ascolti.delete(listener);
      };
    },
    chiudi() {
      if (chiuso) return;
      chiuso = true;
      ascolti.clear();
      for (const v of voci.values()) v.promessa = null;
    },
  };
}
