// Il dialogo: una domanda che ferma tutto finché non ha risposta.
//
// La risposta arriva sempre. Esc, un clic sul velo e lo smontaggio valgono
// `dismissValue`: chi aspetta `result` non resta mai appeso, e «niente» è una
// risposta che il chiamante ha scelto, non un caso da ricordarsi.
//
// La trappola del fuoco è quella di `ui/a11y.ts`: tiene Tab dentro, dà Esc
// solo al dialogo in cima e riporta il fuoco a chi l'aveva.
import { DURATION, animate, exitGhost } from "../moto";
import { focusableElements, identifier, trapFocus } from "../ui/a11y";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import { dismissChildren, openLayer } from "./layers";
import { adopt } from "./owned";
import { textButton, type ButtonKind } from "./button";

export type DialogActionKind = ButtonKind;

export interface DialogAction<T> {
  /// Stabile: finisce in `data-action`, per chi cerca il pulsante.
  id: string;
  label: string;
  /// Di serie `normal`.
  kind?: DialogActionKind;
  /// Ciò che `result` rende quando si sceglie questa azione.
  value: T;
  /// Il fuoco parte da qui. Senza, vedi `openDialog`.
  autofocus?: boolean;
}

export interface DialogOptions<T> {
  title: string;
  description?: string;
  /// Contenuto fra la descrizione e le azioni: un campo, un elenco.
  body?: Node;
  actions: readonly DialogAction<T>[];
  /// La risposta di Esc, del clic sul velo e dello smontaggio.
  dismissValue: T;
  /// Chiuderla chiude il dialogo con `dismissValue`.
  lifetime: Lifetime;
  /// Chiesto prima di chiudere con un'azione: falso tiene aperto il dialogo,
  /// che dice da sé perché. Mentre una risposta asincrona è in viaggio il
  /// dialogo è occupato e le azioni non rispondono. Esc, il velo e lo
  /// smontaggio non chiedono.
  confirm?: (value: T) => boolean | Promise<boolean>;
  /// L'azione che Invio in un campo del corpo preme, come in un modulo.
  submit?: string;
  /// Una classe in più sulla superficie, per chi la veste.
  className?: string;
}

export interface DialogHandle<T> {
  /// La superficie con `role="dialog"`.
  readonly element: HTMLElement;
  /// Si risolve una volta, quando il dialogo si chiude. Non rigetta mai.
  readonly result: Promise<T>;
  /// Chiude con `value`. Vale una volta.
  close(value: T): void;
}

const ENTER_SCALE = 0.94;
const ENTER_OFFSET_PX = 16;

/// Apre un dialogo modale e rende la sua risposta.
///
/// Il fuoco parte dall'azione con `autofocus`; sennò dal primo campo del
/// corpo; sennò, se c'è un'azione di pericolo, dalla prima che non lo è; sennò
/// dalla primaria.
export function openDialog<T>(options: DialogOptions<T>): DialogHandle<T> {
  const doc = document;
  const origin = doc.activeElement;

  const scrim = doc.createElement("div");
  scrim.className = "kit-dialog-scrim";
  const dialog = doc.createElement("div");
  dialog.className = options.className ? `kit-dialog ${options.className}` : "kit-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;

  const title = doc.createElement("h2");
  title.className = "kit-dialog-title";
  title.id = identifier("kit-dialog-title");
  title.textContent = options.title;
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.append(title);

  if (options.description) {
    const description = doc.createElement("p");
    description.className = "kit-dialog-description";
    description.id = identifier("kit-dialog-description");
    description.textContent = options.description;
    dialog.setAttribute("aria-describedby", description.id);
    dialog.append(description);
  }

  let body: HTMLElement | null = null;
  if (options.body) {
    body = doc.createElement("div");
    body.className = "kit-dialog-body";
    body.append(options.body);
    dialog.append(body);
  }

  const own = openLifetime();
  let settled = false;
  let resolve!: (value: T) => void;
  const result = new Promise<T>((done) => {
    resolve = done;
  });
  /// Ritira il dialogo dalla vita che lo possiede.
  let released: Teardown = () => {};

  const finish = (value: T): void => {
    if (settled) return;
    // I popover aperti da qui dentro se ne vanno prima.
    dismissChildren(layer);
    settled = true;
    released();
    release();
    exitGhost(scrim, { to: { opacity: 0 }, duration: DURATION.swap });
    scrim.remove();
    // Scioglie la trappola: il fuoco torna a chi l'aveva.
    own.close();
    resolve(value);
  };

  let busy = false;
  const occupied = (on: boolean): void => {
    busy = on;
    if (on) dialog.setAttribute("aria-busy", "true");
    else dialog.removeAttribute("aria-busy");
  };
  const choose = (action: DialogAction<T>): void => {
    if (settled || busy) return;
    const answer = options.confirm ? options.confirm(action.value) : true;
    if (answer === true) {
      finish(action.value);
      return;
    }
    if (answer === false) return;
    occupied(true);
    answer.then(
      (yes) => {
        occupied(false);
        if (yes) finish(action.value);
      },
      () => occupied(false),
    );
  };

  const actions = doc.createElement("div");
  actions.className = "kit-dialog-actions";
  const buttons = options.actions.map((action) => {
    const button = textButton({
      label: action.label,
      kind: action.kind,
      onPress: () => choose(action),
      lifetime: own,
    });
    button.dataset.action = action.id;
    actions.append(button);
    return button;
  });
  dialog.append(actions);
  // Un tasto tenuto premuto non è una risposta. L'Invio che ha aperto il
  // dialogo, o che ha risposto a quello prima, si ripete sul pulsante che ha
  // il fuoco adesso: senza questo ascolto risponderebbe a una domanda che
  // nessuno ha letto. Solo sulle azioni: in un campo del corpo la ripetizione
  // resta scrittura.
  own.listen(
    actions,
    "keydown",
    (event) => {
      if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    },
    { capture: true },
  );
  const submit = options.actions.find((action) => action.id === options.submit);
  if (body && submit) {
    own.listen(body, "keydown", (event) => {
      const target = event.target;
      const field =
        (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset"].includes(target.type)) ||
        target instanceof HTMLSelectElement;
      if (event.key !== "Enter" || !field || event.defaultPrevented || event.isComposing || event.repeat) return;
      event.preventDefault();
      choose(submit);
    });
  }
  scrim.append(dialog);
  doc.body.append(scrim);

  // Un dialogo non muore col piano da cui è nato: chi lo ha aperto aspetta una
  // risposta, e gliela dà chi lo guarda. Sta nella pila perché un gesto qui
  // dentro non è «fuori» per quel piano, e perché Esc è suo finché è in cima.
  const { layer, release } = openLayer(dialog, origin, null, () => {});

  // Il velo chiude solo se il gesto è nato e finito su di lui: una selezione
  // trascinata fuori dal dialogo non è una risposta.
  let pressedInside = false;
  own.listen(scrim, "pointerdown", (event) => {
    pressedInside = event.target !== scrim;
  });
  own.listen(scrim, "click", (event) => {
    const inside = pressedInside;
    pressedInside = false;
    if (event.target === scrim && !inside) finish(options.dismissValue);
  });

  own.add(trapFocus(dialog, () => finish(options.dismissValue)));
  const kinds = options.actions.map((action) => action.kind ?? "normal");
  const wanted = options.actions.findIndex((action) => action.autofocus);
  const field = body ? focusableElements(body)[0] : undefined;
  const safe = kinds.includes("danger") ? kinds.findIndex((kind) => kind !== "danger") : -1;
  const primary = kinds.indexOf("primary");
  const initial =
    buttons[wanted] ?? field ?? buttons[safe] ?? buttons[primary] ?? buttons[0] ?? dialog;
  initial.focus({ preventScroll: true });

  animate(scrim, {
    from: { opacity: 0 },
    duration: DURATION.short,
    whenReduced: "fade",
    lifetime: own,
  });
  animate(dialog, {
    from: { opacity: 0, scale: ENTER_SCALE, y: ENTER_OFFSET_PX },
    spring: "wide",
    lifetime: own,
  });

  // Per ultima: su una vita già chiusa la risposta parte qui, a cose fatte.
  released = adopt(options.lifetime, () => finish(options.dismissValue));

  return { element: dialog, result, close: finish };
}
