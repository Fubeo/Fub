// La conferma dello Scrittoio: la domanda sì/no disegnata dentro la finestra.
//
// Chi domanda passa da `platform/confirm` e non sa che a rispondere è questo
// dialogo invece di quello del sistema. La porta tiene la fila (una domanda
// alla volta) e la regola del «no»; qui c'è soltanto la superficie, che è il
// dialogo del kit: Esc, un clic sul velo e la chiusura della vita rispondono
// «no» come il pulsante che lo dice, e un tasto tenuto premuto non risponde.
import { t } from "../../i18n/strings";
import { openDialog } from "../../kit";
import { declareConfirm, type ConfirmOptions } from "../../platform/confirm";
import type { Lifetime } from "../../ui/lifetime";

/// Disegna una domanda. Con `danger` il «sì» è l'azione di pericolo e il fuoco
/// parte dal «no»: un Invio premuto di slancio non distrugge niente.
function present(message: string, opts: ConfirmOptions, question: Lifetime): Promise<boolean> {
  const danger = opts.danger === true;
  return openDialog<boolean>({
    title: opts.title,
    description: message,
    actions: [
      {
        id: "cancel",
        label: opts.cancelLabel ?? t("app.cancel"),
        value: false,
        autofocus: danger,
      },
      {
        id: "confirm",
        label: opts.okLabel,
        kind: danger ? "danger" : "primary",
        value: true,
      },
    ],
    dismissValue: false,
    lifetime: question,
  }).result;
}

/// Da qui alla chiusura di `lifetime` le domande della shell si fanno in-app;
/// quella aperta in quel momento si chiude con «no».
export function mountConfirm(lifetime: Lifetime): void {
  lifetime.add(declareConfirm(present));
}
