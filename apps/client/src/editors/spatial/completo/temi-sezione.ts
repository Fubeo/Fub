// Il pannello «Temi di colore» della scheda Risorse del Completo (K6 T14, temi; riga `pannello
// color_themes`): la lista dei temi della libreria con i loro colori, Salva tema dai colori scelti e
// Togli tema. Parla con il motore dalla porta (`temi-porta.ts`): nessun salvataggio nuovo.
//
// - **Lo stato di ogni momento.** Caricamento, libreria vuota (con la frase), un tema o più temi, il
//   motore che non risponde: ognuno ha la sua frase.
// - **Salva.** Prende i colori del riempimento e del contorno della selezione. Senza nessun colore
//   scelto il pulsante è spento e lo dice; un nome vuoto o già di un tema è un errore sotto il campo,
//   e il motore non lo riceve mai (un suo errore fermerebbe la sessione).
// - **Togli.** Spento finché non c'è un tema scelto. Dopo, la lista si rifà dal motore.
// - **Sola lettura.** Salvare e togliere un tema non scrive il disegno: restano accesi anche su un
//   disegno di sola lettura.

import { textButton } from "../../../kit";
import { formText } from "../../../kit/form";
import type { Lifetime, Teardown } from "../../../ui/lifetime";
import { t } from "../strings";
import { registraSezione, type ContestoSezione, type Sezione, type Sezioni } from "./sezioni";
import { problemaDelTema, type EsitoTema, type EsitoTemi, type PortaTemi, type Tema } from "./temi-porta";

/// Un colore `#rrggbb` (in minuscolo) o `null`: quello che il pannello dà al tema.
const HEX = /^#[0-9a-f]{6}$/i;

/// I colori della selezione per un tema: il riempimento e il contorno, senza doppioni e nell'ordine in cui si
/// leggono (il riempimento prima). Vuoto se la selezione non ha colori pieni.
export function coloriDellaSelezione(colori: ContestoSezione["colori"] | undefined): string[] {
  const fuori: string[] = [];
  for (const valore of [colori?.riempimento?.valore, colori?.contorno?.valore]) {
    if (typeof valore !== "string" || !HEX.test(valore)) continue;
    const minuscolo = valore.toLowerCase();
    if (!fuori.includes(minuscolo)) fuori.push(minuscolo);
  }
  return fuori.slice(0, 5);
}

/// Lo stato del pannello, che resta da un giro all'altro della sezione.
interface Stato {
  /// La lista, o `null` finché non arriva.
  temi: readonly Tema[] | null;
  /// Il motore non ha risposto all'ultima lettura.
  assente: boolean;
  /// Il tema scelto nella lista, se c'è ancora.
  scelto: string | null;
  /// L'ultimo esito da dire sotto i pulsanti.
  messaggio: string | null;
  /// Il nome che si sta scrivendo nel campo.
  nome: string;
}

/// La sezione «Temi di colore» della scheda Risorse.
export function sezioneTemi(porta: PortaTemi, vita: Lifetime): Sezione {
  const stato: Stato = { temi: null, assente: false, scelto: null, messaggio: null, nome: "" };

  /// Rilegge la lista dal motore e la porta nello stato; `aggiorna` la rifà sul corpo.
  const rileggi = (aggiorna: () => void): void => {
    void porta.elenco().then((esito: EsitoTemi) => {
      if (vita.closed) return;
      if (esito.kind === "assente") {
        stato.assente = true;
        stato.temi = stato.temi ?? [];
      } else {
        stato.assente = false;
        stato.temi = esito.temi;
        if (stato.scelto !== null && !esito.temi.some((tema) => tema.nome === stato.scelto)) stato.scelto = null;
      }
      aggiorna();
    });
  };

  /// La frase di un esito di salvataggio o di rimozione.
  const frase = (esito: EsitoTema, fatto: string): string => {
    if (esito.kind === "fatto") return fatto;
    if (esito.kind === "assente") return t("draw.temi.assente");
    return t("draw.temi.non.salvato");
  };

  return {
    id: "temi",
    scheda: "risorse",
    titolo: t("draw.temi.titolo"),
    disegna(ctx: ContestoSezione): Teardown | void {
      const corpo = ctx.corpo;
      const costruisci = (): void => {
        corpo.replaceChildren();
        corpo.setAttribute("aria-label", t("draw.temi.aria"));
        if (stato.temi === null) {
          corpo.append(testo(t("draw.temi.caricamento")));
          return;
        }
        if (stato.assente && stato.temi.length === 0) {
          corpo.append(testo(t("draw.temi.assente")));
        } else if (stato.temi.length === 0) {
          corpo.append(testo(t("draw.temi.vuoto")));
        } else {
          const lista = document.createElement("div");
          lista.setAttribute("role", "list");
          for (const tema of stato.temi) {
            const voce = textButton({
              label: tema.nome,
              kind: "normal",
              onPress: () => {
                stato.scelto = stato.scelto === tema.nome ? null : tema.nome;
                stato.messaggio = null;
                costruisci();
              },
              lifetime: vita,
            });
            voce.setAttribute("aria-pressed", stato.scelto === tema.nome ? "true" : "false");
            const colori = document.createElement("span");
            colori.textContent = t("draw.temi.colori", { count: tema.colori.length });
            voce.append(colori);
            for (const colore of tema.colori) {
              const chip = document.createElement("span");
              chip.className = "draw-resources-themes-chip";
              chip.style.backgroundColor = colore;
              voce.append(chip);
            }
            lista.append(voce);
          }
          corpo.append(lista);
        }

        // Il nome del tema da salvare.
        const campo = formText({
          label: t("draw.temi.nome"),
          value: stato.nome,
          blank: t("draw.temi.nome.vuoto"),
          onChange: (valore) => {
            stato.nome = valore;
            campo.setError(null);
          },
          lifetime: vita,
        });
        corpo.append(campo.element);

        const colori = coloriDellaSelezione(ctx.colori);
        // Senza colori scelti Salva è spento, e la frase dice perché (sempre, non solo dopo un clic).
        if (colori.length === 0) corpo.append(testo(t("draw.temi.nessuna.scelta")));
        const salva = textButton({
          label: t("draw.temi.salva"),
          kind: "normal",
          onPress: () => {
            const problema = problemaDelTema(stato.nome, stato.temi ?? []);
            if (problema === "vuoto") {
              campo.setError(t("draw.temi.nome.vuoto"));
              return;
            }
            if (problema === "preso") {
              campo.setError(t("draw.temi.nome.preso"));
              return;
            }
            const nome = stato.nome.trim();
            void porta.salva(nome, colori).then((esito) => {
              if (vita.closed) return;
              stato.messaggio = frase(esito, t("draw.temi.salvato", { nome }));
              if (esito.kind === "fatto") {
                stato.nome = "";
                stato.scelto = esito.nome;
              }
              rileggi(costruisci);
            });
          },
          lifetime: vita,
        });
        salva.disabled = colori.length === 0;
        corpo.append(salva);

        // Togli il tema scelto.
        const togli = textButton({
          label: t("draw.temi.togli"),
          kind: "normal",
          onPress: () => {
            const nome = stato.scelto;
            if (nome === null) return;
            void porta.togli(nome).then((esito) => {
              if (vita.closed) return;
              stato.messaggio = frase(esito, t("draw.temi.tolto", { nome }));
              stato.scelto = null;
              rileggi(costruisci);
            });
          },
          lifetime: vita,
        });
        togli.disabled = stato.scelto === null || stato.temi.length === 0;
        corpo.append(togli);

        if (stato.messaggio !== null) {
          const nota = document.createElement("p");
          nota.setAttribute("role", "status");
          nota.textContent = stato.messaggio;
          corpo.append(nota);
        }
      };
      costruisci();
      if (stato.temi === null) rileggi(costruisci);
      return undefined;
    },
  };
}

/// Un paragrafo del corpo.
function testo(parola: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = parola;
  return p;
}

/// Registra il pannello dei temi nella scheda Risorse.
export function registraTemi(sezioni: Sezioni, porta: PortaTemi, vita: Lifetime): boolean {
  return registraSezione({ sezioni }, sezioneTemi(porta, vita));
}
