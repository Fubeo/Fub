// «Vai alla tavola da disegno…» (`view.goToArtboard`, VectorCraft: Go to Artboard): chiede quale
// tavola e la inquadra nella finestra, come fa un clic nell'elenco delle tavole. È della vista, non
// del file: niente passo di Annulla. L'elenco parte dalla tavola di adesso; Invio va, Esc annulla.
import { openDialog } from "../../../../../kit/dialog";
import { openLifetime } from "../../../../../ui/lifetime";
import { t } from "../../../strings";

/// Il dialogo: i nomi delle tavole in ordine e il posto di quella di adesso; il posto scelto, o
/// `null` se si annulla.
export function chiediTavola(nomi: readonly string[], attuale: number): Promise<number | null> {
  const vita = openLifetime();
  const corpo = document.createElement("label");
  corpo.className = "draw-view-goto-field";
  const etichetta = document.createElement("span");
  etichetta.textContent = t("draw.view.goto.label");
  const elenco = document.createElement("select");
  elenco.className = "draw-properties-input";
  nomi.forEach((nome, i) => {
    const voce = document.createElement("option");
    voce.value = String(i);
    voce.textContent = `${i + 1}. ${nome}`;
    elenco.append(voce);
  });
  elenco.value = String(Math.min(Math.max(attuale, 0), nomi.length - 1));
  corpo.append(etichetta, elenco);
  const dialogo = openDialog<"vai" | "annulla">({
    title: t("draw.view.goto.title"),
    description: t("draw.view.goto.description"),
    body: corpo,
    actions: [
      { id: "cancel", label: t("draw.view.goto.cancel"), value: "annulla" },
      { id: "apply", label: t("draw.view.goto.apply"), kind: "primary", value: "vai" },
    ],
    dismissValue: "annulla",
    lifetime: vita,
    submit: "apply",
    className: "draw-view-goto-dialog",
  });
  return dialogo.result.then((scelta) => {
    const posto = Number(elenco.value);
    vita.close();
    return scelta === "vai" && Number.isInteger(posto) ? posto : null;
  });
}
