// La sezione «Simboli» della scheda Risorse del Completo (piano K6, simboli; `docs/product/drawing-symbols.md`,
// «Nel Disegno completo»). Come il pannello Simboli di VectorCraft (`ui-egui/src/panels/symbols.rs`): la
// lista dei simboli del documento, il simbolo scelto, che è anche il simbolo corrente degli strumenti
// Spruzzo e Simbolismo, e i comandi del pannello; sotto, le librerie di VectorCraft da cui si aggiunge un
// simbolo al disegno.
//
// - **Letture e comandi.** La lista (`symbol.list`), i non usati (`symbol.unused`) e le librerie
//   (`symbol.libraries`, `symbol.library`) sono letture: nessun passo d'annulla. Ogni altro pulsante
//   manda il suo comando dal percorso unico (`eseguiPerId`), che fa il passo e lo dice.
// - **Ogni giro rilegge.** La sezione si rifà quando il disegno o la selezione cambiano: la lista si
//   rilegge, e una risposta di un giro chiuso si scarta. Fino alla risposta resta la lista di prima.
// - **Mai un comando che il motore rifiuta come sbagliato.** Il pulsante che ha bisogno di un simbolo
//   scelto, di oggetti scelti o di un nome libero è spento finché non li ha, e lo dice.

import { textButton } from "../../../kit";
import { formText } from "../../../kit/form";
import type { Lifetime, Teardown } from "../../../ui/lifetime";
import { t, type DrawKey } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";

/// Un simbolo del documento, come lo dà `symbol.list`.
export interface Simbolo {
  readonly nome: string;
  readonly istanze: number;
}

/// Una libreria di simboli, come la dà `symbol.libraries`.
export interface LibreriaSimboli {
  readonly id: string;
  readonly nome: string;
  readonly quanti: number;
}

/// Il simbolo corrente del Completo aperto: quello scelto nella sezione, che Spruzzo e Simbolismo
/// usano. Non sta nel file (`docs/reference/scene-format-symbols.md`, §10).
export interface SimboloCorrente {
  nome: string | null;
}

/// Ciò che la sezione chiede al Completo.
export interface AzioniSimboli {
  /// Una lettura del motore (`disegno.<id>`): ciò che rende, o `null` se non risponde o rifiuta.
  leggi(id: string, valore: Readonly<Record<string, unknown>>): Promise<unknown>;
  /// Un comando dell'indice, senza la sua finestra, dal percorso unico.
  esegui(id: string, valori: Readonly<Record<string, unknown>>): Promise<void>;
}

/// I simboli di una lettura di `symbol.list`; quelli che non si leggono si saltano.
export function simboliDi(lettura: unknown): Simbolo[] {
  const righe = (lettura as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(righe)) return [];
  const fuori: Simbolo[] = [];
  for (const riga of righe as unknown[]) {
    const { name, instances } = (riga ?? {}) as { name?: unknown; instances?: unknown };
    if (typeof name !== "string" || name === "") continue;
    fuori.push({ nome: name, istanze: typeof instances === "number" && Number.isFinite(instances) ? instances : 0 });
  }
  return fuori;
}

/// I nomi di una lettura di `symbol.unused`, o della lista dei simboli di una libreria.
export function nomiDi(lettura: unknown, chiave: "names" | "symbols"): string[] {
  const righe = (lettura as Record<string, unknown> | null)?.[chiave];
  if (!Array.isArray(righe)) return [];
  return (righe as unknown[])
    .map((riga) => (typeof riga === "string" ? riga : (riga as { name?: unknown } | null)?.name))
    .filter((nome): nome is string => typeof nome === "string" && nome !== "");
}

/// Le librerie di una lettura di `symbol.libraries`.
export function librerieDi(lettura: unknown): LibreriaSimboli[] {
  const righe = (lettura as { libraries?: unknown } | null)?.libraries;
  if (!Array.isArray(righe)) return [];
  const fuori: LibreriaSimboli[] = [];
  for (const riga of righe as unknown[]) {
    const { id, name, count } = (riga ?? {}) as { id?: unknown; name?: unknown; count?: unknown };
    if (typeof id !== "string" || typeof name !== "string") continue;
    fuori.push({ id, nome: name, quanti: typeof count === "number" ? count : 0 });
  }
  return fuori;
}

/// Che cosa non va nel nome per rinominare `vecchio`: vuoto, o già di un altro simbolo. `null` se va.
export function problemaDelNome(nome: string, vecchio: string | null, simboli: readonly Simbolo[]): "vuoto" | "preso" | null {
  const pulito = nome.trim();
  if (pulito === "") return "vuoto";
  return simboli.some((s) => s.nome === pulito && s.nome !== vecchio) ? "preso" : null;
}

interface Stato {
  /// La lista, o `null` finché non arriva la prima.
  simboli: readonly Simbolo[] | null;
  /// Il motore non ha risposto all'ultima lettura.
  assente: boolean;
  /// I simboli scelti nella lista (più d'uno solo con Ctrl o «Seleziona non usati»).
  scelti: readonly string[];
  /// Il nome scritto nel campo.
  nome: string;
  messaggio: string | null;
  /// Le librerie, se la parte delle librerie è aperta.
  librerie: readonly LibreriaSimboli[] | null;
  /// La libreria aperta, coi suoi simboli.
  libreria: { readonly id: string; readonly nome: string; readonly simboli: readonly string[] } | null;
}

function paragrafo(testo: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = testo;
  return p;
}

/// La sezione «Simboli» della scheda Risorse.
export function sezioneSimboli(azioni: AzioniSimboli, corrente: SimboloCorrente): Sezione {
  const stato: Stato = { simboli: null, assente: false, scelti: [], nome: "", messaggio: null, librerie: null, libreria: null };

  return {
    id: "simboli",
    scheda: "risorse",
    titolo: t("draw.simboli.titolo"),
    disegna(ctx: ContestoSezione): Teardown | void {
      const corpo = ctx.corpo;
      const vita: Lifetime = ctx.vita;
      const conOggetti = ctx.sel.numero > 0;

      const scegli = (nomi: readonly string[]): void => {
        stato.scelti = nomi;
        corrente.nome = nomi.length === 1 ? nomi[0]! : nomi.length === 0 ? null : corrente.nome;
        stato.messaggio = null;
      };

      const rileggi = (): void => {
        void azioni.leggi("symbol.list", {}).then((letto) => {
          if (vita.closed) return;
          stato.assente = letto === null;
          if (letto !== null) {
            stato.simboli = simboliDi(letto);
            const nomi = new Set(stato.simboli.map((s) => s.nome));
            const rimasti = stato.scelti.filter((n) => nomi.has(n));
            if (rimasti.length !== stato.scelti.length) scegli(rimasti);
            if (corrente.nome !== null && !nomi.has(corrente.nome)) corrente.nome = null;
          } else stato.simboli ??= [];
          costruisci();
        });
      };

      /// Un pulsante del pannello: spento con la sua frase quando `perche` non è `null`.
      const pulsante = (chiave: DrawKey, perche: DrawKey | null, fai: () => void): HTMLButtonElement => {
        const b = textButton({ label: t(chiave), kind: "normal", onPress: () => perche === null && fai(), lifetime: vita });
        b.disabled = perche !== null;
        if (perche !== null) b.title = t(perche);
        return b;
      };

      const manda = (id: string, valori: Readonly<Record<string, unknown>>): void => {
        void azioni.esegui(id, valori).then(() => {
          if (!vita.closed) rileggi();
        });
      };

      const costruisci = (): void => {
        corpo.replaceChildren();
        corpo.setAttribute("aria-label", t("draw.simboli.titolo"));
        const simboli = stato.simboli;
        if (simboli === null) {
          corpo.append(paragrafo(t("draw.simboli.caricamento")));
          return;
        }
        if (stato.assente && simboli.length === 0) corpo.append(paragrafo(t("draw.simboli.assente")));
        else if (simboli.length === 0) corpo.append(paragrafo(t("draw.simboli.vuoto")));
        else {
          const lista = document.createElement("div");
          lista.setAttribute("role", "list");
          lista.className = "draw-symbols-list";
          for (const simbolo of simboli) {
            const voce = textButton({
              label: simbolo.nome,
              kind: "normal",
              onPress: () => undefined,
              lifetime: vita,
            });
            voce.addEventListener("click", (evento) => {
              const gia = stato.scelti.includes(simbolo.nome);
              if (evento.ctrlKey || evento.metaKey) scegli(gia ? stato.scelti.filter((n) => n !== simbolo.nome) : [...stato.scelti, simbolo.nome]);
              else scegli(gia && stato.scelti.length === 1 ? [] : [simbolo.nome]);
              costruisci();
            });
            voce.setAttribute("aria-pressed", stato.scelti.includes(simbolo.nome) ? "true" : "false");
            const quante = document.createElement("span");
            quante.textContent = ` · ${t("draw.simboli.istanze", { count: simbolo.istanze })}`;
            voce.append(quante);
            lista.append(voce);
          }
          corpo.append(lista);
        }

        const uno = stato.scelti.length === 1 ? stato.scelti[0]! : null;
        const senzaUno: DrawKey | null = uno === null ? "draw.simboli.perche.uno" : null;
        const senzaOggetti: DrawKey | null = conOggetti ? null : "draw.simboli.perche.oggetti";

        const campo = formText({
          label: t("draw.simboli.nome"),
          blank: t("draw.simboli.nome.vuoto"),
          value: stato.nome,
          onChange: (valore) => {
            stato.nome = valore;
            campo.setError(null);
          },
          lifetime: vita,
        });
        corpo.append(campo.element);

        const fila = (...pulsanti: HTMLButtonElement[]): HTMLDivElement => {
          const riga = document.createElement("div");
          riga.className = "draw-symbols-actions";
          riga.append(...pulsanti);
          return riga;
        };

        corpo.append(
          fila(
            pulsante("draw.simboli.nuovo", senzaOggetti, () => {
              const nome = stato.nome.trim();
              if (nome !== "" && simboli.some((s) => s.nome === nome)) {
                campo.setError(t("draw.simboli.nome.preso"));
                return;
              }
              stato.nome = "";
              manda("symbol.new", nome === "" ? {} : { name: nome });
            }),
            pulsante("draw.simboli.inserisci", senzaUno, () => manda("symbol.place", { name: uno })),
            pulsante("draw.simboli.rinomina", senzaUno, () => {
              const problema = problemaDelNome(stato.nome, uno, simboli);
              if (problema !== null) {
                campo.setError(t(problema === "vuoto" ? "draw.simboli.nome.vuoto" : "draw.simboli.nome.preso"));
                return;
              }
              const nuovo = stato.nome.trim();
              stato.nome = "";
              scegli([nuovo]);
              manda("symbol.options", { name: uno, newName: nuovo });
            }),
            pulsante("draw.simboli.duplica", senzaUno, () => manda("symbol.duplicate", { name: uno })),
          ),
          fila(
            pulsante("draw.simboli.ridefinisci", senzaUno ?? senzaOggetti, () => manda("symbol.update", { name: uno })),
            pulsante("draw.simboli.sostituisci", senzaUno ?? senzaOggetti, () => manda("symbol.replace", { name: uno })),
            pulsante("draw.simboli.scollega", senzaOggetti, () => manda("symbol.breakLink", {})),
          ),
          fila(
            pulsante("draw.simboli.istanze.scegli", senzaUno, () => manda("symbol.selectInstances", { name: uno })),
            pulsante("draw.simboli.nonUsati", simboli.length === 0 ? "draw.simboli.perche.vuoto" : null, () => {
              void azioni.leggi("symbol.unused", {}).then((letto) => {
                if (vita.closed) return;
                const nomi = nomiDi(letto, "names");
                scegli(nomi);
                stato.messaggio = nomi.length === 0 ? t("draw.simboli.nonUsati.nessuno") : null;
                costruisci();
              });
            }),
            pulsante("draw.simboli.elimina", stato.scelti.length === 0 ? "draw.simboli.perche.scelti" : null, () => {
              const nomi = stato.scelti;
              scegli([]);
              manda("symbol.delete", nomi.length === 1 ? { name: nomi[0] } : { names: [...nomi] });
            }),
          ),
        );

        if (stato.messaggio !== null) {
          const nota = paragrafo(stato.messaggio);
          nota.setAttribute("role", "status");
          corpo.append(nota);
        }

        corpo.append(librerie());
      };

      /// La parte delle librerie: chiusa, la lista delle librerie, o i simboli di una libreria.
      const librerie = (): HTMLElement => {
        const parte = document.createElement("div");
        parte.className = "draw-symbols-libraries";
        if (stato.librerie === null) {
          parte.append(
            pulsante("draw.simboli.librerie", null, () => {
              void azioni.leggi("symbol.libraries", {}).then((letto) => {
                if (vita.closed) return;
                stato.librerie = librerieDi(letto);
                costruisci();
              });
            }),
          );
          return parte;
        }
        const aperta = stato.libreria;
        if (aperta === null) {
          parte.append(paragrafo(stato.librerie.length === 0 ? t("draw.simboli.librerie.vuote") : t("draw.simboli.librerie.scegli")));
          for (const libreria of stato.librerie) {
            const voce = textButton({
              label: `${libreria.nome} · ${t("draw.simboli.quanti", { count: libreria.quanti })}`,
              kind: "normal",
              onPress: () => {
                void azioni.leggi("symbol.library", { library: libreria.id }).then((letto) => {
                  if (vita.closed) return;
                  stato.libreria = { id: libreria.id, nome: libreria.nome, simboli: nomiDi(letto, "symbols") };
                  costruisci();
                });
              },
              lifetime: vita,
            });
            parte.append(voce);
          }
          parte.append(
            pulsante("draw.simboli.librerie.chiudi", null, () => {
              stato.librerie = null;
              costruisci();
            }),
          );
          return parte;
        }
        parte.append(paragrafo(t("draw.simboli.libreria.aggiungi", { nome: aperta.nome })));
        for (const nome of aperta.simboli) {
          const voce = textButton({
            label: nome,
            kind: "normal",
            onPress: () => manda("symbol.addFromLibrary", { library: aperta.id, name: nome }),
            lifetime: vita,
          });
          parte.append(voce);
        }
        parte.append(
          pulsante("draw.simboli.libreria.indietro", null, () => {
            stato.libreria = null;
            costruisci();
          }),
        );
        return parte;
      };

      costruisci();
      rileggi();
      return () => corpo.replaceChildren();
    },
  };
}

/// Registra la sezione «Simboli» nella scheda Risorse.
export function registraSimboli(sezioni: Sezioni, azioni: AzioniSimboli, corrente: SimboloCorrente): boolean {
  return registraSezione({ sezioni }, sezioneSimboli(azioni, corrente));
}
