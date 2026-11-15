// L'etichetta di un gruppo nella lingua dei menu: quieta, 11,5 px, in grigio,
// come la scrive il «/». Sta sopra le righe del suo gruppo (`row.ts`) nel
// menu, nello spazio comandi e nel «/».
//
// Il gruppo, per chi ascolta, lo dice chi lo monta: un `role="group"` col suo
// nome. L'etichetta è per chi guarda; con `labels` diventa anche il nome del
// gruppo (`aria-labelledby`), senza dirlo due volte.

export interface GroupLabelOptions {
  readonly text: string;
  /// Resta in cima mentre l'elenco scorre (il «/», lo spazio comandi).
  readonly sticky?: boolean;
  /// Il gruppo che l'etichetta nomina: prende `aria-labelledby`. Senza,
  /// l'etichetta non si legge a chi ascolta, che sente il nome del gruppo.
  readonly labels?: HTMLElement;
  readonly className?: string;
}

let next = 0;

/// Un'etichetta di gruppo.
export function createGroupLabel(options: GroupLabelOptions): HTMLElement {
  const label = document.createElement("div");
  label.className = options.className ? `kit-group-label ${options.className}` : "kit-group-label";
  label.textContent = options.text;
  if (options.sticky) label.dataset.sticky = "";
  if (options.labels) {
    next += 1;
    label.id = `kit-group-label-${next}`;
    options.labels.setAttribute("aria-labelledby", label.id);
    options.labels.removeAttribute("aria-label");
  } else {
    label.setAttribute("aria-hidden", "true");
  }
  return label;
}
