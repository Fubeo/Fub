// «Ruota vista…» (`view.rotate`, K6 T11): chiede un angolo in gradi e gira la vista di quello. È della
// vista, non del file: la rotazione non entra in nessun passo di Annulla e in nessuna scrittura. Il campo
// è il numero dei dialoghi del kit (`numberField`, con la virgola dei decimali); Invio applica, Esc annulla.
// Un testo che non è un numero resta nel campo con la sua frase, e il dialogo non si chiude.
import { openDialog } from "../../../../../kit/dialog";
import { numberField } from "../../../../../kit/number-field";
import { openLifetime } from "../../../../../ui/lifetime";
import { t } from "../../../strings";
import { normalTurn } from "../../../view";

/// L'angolo scritto: i gradi (con la virgola o il punto per i decimali), o perché non va.
export type EsitoAngolo = { readonly ok: true; readonly gradi: number } | { readonly ok: false };

/// Legge un angolo scritto. Accetta un segno e i decimali con la virgola o il punto; l'angolo esce
/// nell'intervallo della vista (`normalTurn`: 360 è 0, 270 è -90).
export function angoloDaTesto(testo: string): EsitoAngolo {
  const pulito = testo.trim().replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(pulito)) return { ok: false };
  return { ok: true, gradi: normalTurn(Number(pulito)) };
}

/// Il dialogo «Ruota vista»: l'angolo della vista come punto di partenza, o `null` se si annulla.
export function chiediAngoloVista(corrente: number): Promise<number | null> {
  const vita = openLifetime();
  const campo = numberField({
    label: t("draw.view.rotate.label"),
    value: corrente,
    unit: "°",
    places: 2,
    mixedText: "",
    problem: () => t("draw.view.rotate.invalid"),
    onCommit: () => undefined,
    lifetime: vita,
  });
  let gradi: number | null = null;
  const dialogo = openDialog<"applica" | "annulla">({
    title: t("draw.view.rotate.title"),
    description: t("draw.view.rotate.description"),
    body: campo.element,
    actions: [
      { id: "cancel", label: t("draw.view.rotate.cancel"), value: "annulla" },
      { id: "apply", label: t("draw.view.rotate.apply"), kind: "primary", value: "applica" },
    ],
    dismissValue: "annulla",
    lifetime: vita,
    submit: "apply",
    className: "draw-view-rotate-dialog",
    confirm: (scelta) => {
      if (scelta !== "applica") return true;
      const esito = angoloDaTesto(campo.input.value);
      if (!esito.ok) {
        campo.setError(t("draw.view.rotate.invalid"));
        return false;
      }
      gradi = esito.gradi;
      return true;
    },
  });
  return dialogo.result.then((scelta) => {
    vita.close();
    return scelta === "applica" ? gradi : null;
  });
}
