// L'editor del disegno: le barre della selezione, dei nodi, del gruppo isolato
// e dei tracciati. Un pezzo di createDrawEditor (`../editor.ts`): lavora sul
// contesto che i pezzi condividono.

import { identifier } from "../../../../ui/a11y";
import { ariaBinding, displayBinding, modifierName } from "../../../../ui/commands";
import { iconEl } from "../../../../ui/icons";
import { linkName } from "../../describe";
import { t, type DrawKey } from "../../strings";
import { NAME_MAX } from "../naming";
import { ensureTextFont } from "../text";
import { createTextField, type TextField } from "../text-field";
import type { EditorContext } from "./context";

/// Un'azione della barra della selezione, col suo pulsante.
export interface BarCommand {
  readonly id: string;
  readonly label: () => string;
  readonly icon: string;
  readonly binding: string | null;
  readonly control: HTMLButtonElement;
  readonly run: () => void;
}

/// Ciò che le barre della selezione, dei nodi, del gruppo isolato e dei tracciati dà agli altri pezzi dell'editor.
export interface BarsContext {
  arrangeBar: HTMLDivElement;
  nameArrange: (control: HTMLButtonElement, text: string, binding: string | null) => void;
  arrangeButtons: HTMLButtonElement[];
  /// Le azioni della barra per il catalogo dei comandi: si vedono quando il
  /// loro pulsante si vede.
  barCommands: BarCommand[];
  /// «…» della barra: le azioni oltre le prime `ARRANGE_SHOWN`, in un menu.
  arrangeMore: HTMLButtonElement;
  textButton: HTMLButtonElement;
  duplicateButton: HTMLButtonElement;
  groupButton: HTMLButtonElement;
  ungroupButton: HTMLButtonElement;
  shownLink: { readonly target: string | null } | null;
  linkText: () => string;
  openLinkText: () => string;
  linkButton: HTMLButtonElement;
  openLinkButton: HTMLButtonElement;
  unlinkButton: HTMLButtonElement;
  orderButton: HTMLButtonElement;
  intoButton: HTMLButtonElement;
  alignButton: HTMLButtonElement;
  opacityField: HTMLLabelElement;
  opacityInput: HTMLInputElement;
  /// Ciò che il campo dice: l'opacità degli oggetti scelti in percentuale
  /// (`null` se hanno valori diversi), il testo con cui la mostra, e di
  /// quale selezione. Un numero scritto a metà per la stessa selezione resta
  /// dov'è.
  opacityShown: { readonly percent: number | null; readonly text: string; readonly keys: string } | null;
  connectButton: HTMLButtonElement;
  shapeButton: HTMLButtonElement;
  cropButton: HTMLButtonElement;
  uncropButton: HTMLButtonElement;
  isolationBar: HTMLElement;
  isolationPath: HTMLOListElement;
  nameIsolation: (symbol: boolean) => void;
  textLayer: HTMLDivElement;
  field: TextField;
  textInput: HTMLElement;
  labelText: () => void;
  linkLayer: HTMLDivElement;
  progressBar: HTMLDivElement;
  progressLabel: HTMLSpanElement;
  progressMeter: HTMLProgressElement;
  progressStop: HTMLButtonElement;
  describeBar: HTMLDivElement;
  describeLabel: HTMLLabelElement;
  describeInput: HTMLInputElement;
  describeWrite: HTMLButtonElement;
  describeDecorative: HTMLButtonElement;
  describeSkip: HTMLButtonElement;
}

/// Monta le barre della selezione, dei nodi, del gruppo isolato e dei tracciati.
export function installBars(ctx: EditorContext): void {
  const {
    life, relabels, drawingFonts, surface, button, options
  } = ctx;
  // I comandi della selezione, dal livello Standard: una barra che galleggia
  // in cima al foglio finché c'è qualcosa di scelto, così sceglie non sposta
  // niente. Ordine e allineamento sono due menu: la barra resta corta anche
  // su un telefono.
  const arrangeBar = document.createElement("div");
  ctx.arrangeBar = arrangeBar;
  arrangeBar.className = "draw-arrange";
  arrangeBar.setAttribute("role", "toolbar");
  arrangeBar.hidden = true;
  relabels.push(() => arrangeBar.setAttribute("aria-label", t("draw.arrange")));
  /// Il nome di un pulsante della barra, e nel suggerimento la scorciatoia.
  const nameArrange = (control: HTMLButtonElement, text: string, binding: string | null): void => {
    control.setAttribute("aria-label", text);
    control.title = binding === null ? text : `${text} (${displayBinding(binding)})`;
  };
  ctx.nameArrange = nameArrange;
  /// I pulsanti della barra: se nessuno si vede, la barra non c'è.
  const arrangeButtons: HTMLButtonElement[] = [];
  ctx.arrangeButtons = arrangeButtons;
  ctx.barCommands = [];
  /// Un pulsante della barra; il nome è una chiave, o una funzione per quelli
  /// che cambiano nome con la selezione.
  const arrangeButton = (label: DrawKey | (() => string), iconName: string, binding: string | null, run: () => void): HTMLButtonElement => {
    const text = typeof label === "function" ? label : () => t(label);
    const control = button(arrangeBar, "draw-button", text, iconName, run);
    arrangeButtons.push(control);
    ctx.barCommands.push({ id: typeof label === "string" ? label : `draw.bar.${iconName}`, label: text, icon: iconName, binding, control, run });
    // Un tasto senza modificatori, come F2, si scrive com'è.
    if (binding !== null) control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
    relabels.push(() => nameArrange(control, text(), binding));
    return control;
  };
  // Un testo scelto da solo si cambia sul posto.
  const textButton = arrangeButton("draw.text.edit", "draw-text-edit", "F2", () => ctx.editSelectedText());
  ctx.textButton = textButton;
  const duplicateButton = arrangeButton("draw.duplicate", "draw-duplicate", "Mod-d", () => ctx.duplicateSelection());
  ctx.duplicateButton = duplicateButton;
  const groupButton = arrangeButton("draw.group", "draw-group", "Mod-g", () => ctx.groupSelection());
  ctx.groupButton = groupButton;
  const ungroupButton = arrangeButton("draw.ungroup", "draw-ungroup", "Mod-Shift-g", () => ctx.ungroupSelection());
  ctx.ungroupButton = ungroupButton;
  // Il collegamento scelto da solo: dove porta, e il suo nome. Il pulsante
  // che collega lo cambia, e quello che apre lo nomina.
  ctx.shownLink = null;
  const linkText = (): string => t(ctx.shownLink === null ? "draw.link" : "draw.link.change");
  ctx.linkText = linkText;
  const openLinkText = (): string => {
    const target = ctx.shownLink?.target ?? null;
    return t("draw.link.open", { note: target === null ? "" : linkName(target) });
  };
  ctx.openLinkText = openLinkText;
  const linkButton = arrangeButton(linkText, "draw-link", "Mod-k", () => void ctx.linkSelection());
  ctx.linkButton = linkButton;
  linkButton.setAttribute("aria-haspopup", "dialog");
  const openLinkButton = arrangeButton(openLinkText, "draw-open-link", "Alt-Enter", () => ctx.openSelectedLink());
  ctx.openLinkButton = openLinkButton;
  const unlinkButton = arrangeButton("draw.unlink", "draw-unlink", "Mod-Shift-k", () => ctx.unlinkSelection());
  ctx.unlinkButton = unlinkButton;
  const orderButton = arrangeButton("draw.order", "draw-order", null, () => ctx.openMenu(orderButton, ctx.orderItems()));
  ctx.orderButton = orderButton;
  const intoButton = arrangeButton("draw.into_layer", "draw-into-layer", null, () => ctx.openMenu(intoButton, ctx.intoItems()));
  ctx.intoButton = intoButton;
  const alignButton = arrangeButton("draw.align", "draw-align", null, () => ctx.openMenu(alignButton, ctx.alignItems()));
  ctx.alignButton = alignButton;
  // Dal livello Standard: l'opacità degli oggetti scelti, sempre sotto mano
  // come nel pannello. Un numero in percentuale col «%» accanto: le frecce, i
  // tasti di pagina, Inizio e Fine la cambiano subito, e un valore scritto
  // parte con Invio o lasciando il campo.
  const opacityField = document.createElement("label");
  ctx.opacityField = opacityField;
  opacityField.className = "draw-arrange-field";
  opacityField.hidden = true;
  const opacityInput = document.createElement("input");
  ctx.opacityInput = opacityInput;
  opacityInput.type = "text";
  opacityInput.className = "draw-arrange-input";
  opacityInput.setAttribute("role", "spinbutton");
  opacityInput.setAttribute("inputmode", "decimal");
  opacityInput.setAttribute("autocomplete", "off");
  opacityInput.spellcheck = false;
  opacityInput.setAttribute("aria-valuemin", "0");
  opacityInput.setAttribute("aria-valuemax", "100");
  const opacitySuffix = document.createElement("span");
  opacitySuffix.className = "draw-arrange-suffix";
  opacitySuffix.setAttribute("aria-hidden", "true");
  opacitySuffix.textContent = "%";
  opacityField.append(opacityInput, opacitySuffix);
  arrangeBar.append(opacityField);
  ctx.opacityShown = null;
  relabels.push(() => {
    const name = t("draw.opacity.field");
    opacityInput.setAttribute("aria-label", name);
    opacityField.title = name;
    ctx.opacityShown = null;
  });
  // Dal livello Standard, col Connettore: ogni oggetto scelto si unisce al
  // seguente sul foglio. C'è quando ce ne sono almeno due da unire.
  const connectButton = arrangeButton("draw.connect", "draw-connector", null, () => ctx.connectSelection());
  ctx.connectButton = connectButton;
  // Dal livello Standard: i tratti a penna scelti diventano le forme a cui
  // somigliano. C'è solo quando ce n'è uno.
  const shapeButton = arrangeButton("draw.to_shape", "draw-to-shape", null, () => ctx.shapeSelectedInk());
  ctx.shapeButton = shapeButton;
  // Dal livello Standard: un'immagine scelta da sola si ritaglia sul
  // foglio, coi segni e coi margini in una barra; le immagini ritagliate
  // tornano intere.
  const cropButton = arrangeButton("draw.crop", "draw-crop", null, () => ctx.openCrop(true));
  ctx.cropButton = cropButton;
  const uncropButton = arrangeButton("draw.uncrop", "draw-uncrop", null, () => ctx.uncropSelection());
  ctx.uncropButton = uncropButton;
  // Le azioni oltre le prime `ARRANGE_SHOWN` restano nella barra, nascoste
  // con `data-more`, e il «…» le offre in un menu: la barra resta una
  // pillola corta accanto alla selezione (B7).
  const arrangeMore = button(arrangeBar, "draw-button draw-arrange-more", () => t("draw.chrome.context.more"), "draw-more", () =>
    ctx.openMenu(arrangeMore, arrangeButtons.filter((control) => control.hasAttribute("data-more")).map((control) => ({
      label: control.getAttribute("aria-label") ?? "",
      hint: control.title.match(/\(([^)]*)\)$/)?.[1],
      disabled: control.disabled,
      run: () => control.click(),
    }))));
  ctx.arrangeMore = arrangeMore;
  arrangeMore.hidden = true;
  relabels.push(() => nameArrange(arrangeMore, t("draw.chrome.context.more"), null));
  for (const control of [arrangeMore, orderButton, intoButton, alignButton]) {
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
  }
  // Il gruppo isolato: una barra in fondo al foglio dice dove si è, dal
  // livello, o dal disegno, al gruppo; il pulsante ne esce di un gruppo, e
  // un gruppo del percorso ci riporta.
  const isolationBar = document.createElement("nav");
  ctx.isolationBar = isolationBar;
  isolationBar.className = "draw-isolation";
  isolationBar.hidden = true;
  const isolationBack = document.createElement("button");
  isolationBack.type = "button";
  isolationBack.className = "draw-button";
  isolationBack.setAttribute("aria-keyshortcuts", "Escape");
  const backIcon = iconEl("draw-back");
  if (backIcon !== null) isolationBack.append(backIcon);
  life.listen(isolationBack, "click", () => ctx.leaveIsolation(false));
  const isolationPath = document.createElement("ol");
  ctx.isolationPath = isolationPath;
  isolationPath.className = "draw-isolation-path";
  isolationBar.append(isolationBack, isolationPath);
  life.listen(isolationPath, "click", (event) => {
    const crumb = event.target instanceof Element ? event.target.closest<HTMLElement>(".draw-isolation-crumb") : null;
    if (crumb instanceof HTMLButtonElement) ctx.isolateAt(Number(crumb.dataset.depth));
  });
  /// I nomi della barra e del pulsante: di un gruppo, o di un simbolo.
  const nameIsolation = (symbol: boolean): void => {
    isolationBar.setAttribute("aria-label", t(symbol ? "draw.isolation.of_symbol" : "draw.isolation"));
    const back = t(symbol ? "draw.isolate.exit.symbol" : "draw.isolate.exit");
    isolationBack.setAttribute("aria-label", back);
    isolationBack.title = `${back} (Esc)`;
  };
  ctx.nameIsolation = nameIsolation;
  relabels.push(() => {
    nameIsolation(false);
    ctx.isolationShown = null;
    ctx.showIsolation();
  });

  // Esc in una barra torna al foglio, con la selezione com'era.
  for (const bar of [arrangeBar, isolationBar]) {
    life.listen(bar, "keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      surface.focus({ preventScroll: true });
    });
  }

  // Il campo in cui si scrive un testo: sopra il foglio e fuori dalla sua
  // pipeline, nascosto finché non si scrive. Lo strato lo taglia ai bordi
  // del foglio e non scorre mai.
  const textLayer = document.createElement("div");
  ctx.textLayer = textLayer;
  textLayer.className = "draw-text-layer";
  textLayer.hidden = true;
  const field = createTextField(life, {
    onChange: () => {
      ctx.placeText();
      ctx.syncCharacter();
      ctx.proofText();
    },
    onFinish: () => ctx.finishText(),
    announce: (text) => ctx.announce(text),
    family: drawingFonts.live,
    onLook: () => ctx.syncCharacter(),
  });
  ctx.field = field;
  const textInput = field.element;
  ctx.textInput = textInput;
  const textHint = document.createElement("span");
  textHint.className = "sr-only";
  textHint.id = identifier("draw-text-hint");
  textInput.setAttribute("aria-describedby", textHint.id);
  textLayer.append(textInput, textHint);
  /// Il nome del campo: l'etichetta di una forma, un testo nuovo, o uno che
  /// c'è.
  const labelText = (): void =>
    textInput.setAttribute("aria-label", t(ctx.typing?.label != null ? "draw.label.field" : ctx.typing !== null && ctx.typing.key !== null ? "draw.text.change" : "draw.text.new"));
  ctx.labelText = labelText;
  relabels.push(() => {
    textHint.textContent = t("draw.text.hint", { key: modifierName("Mod") ?? "Ctrl" });
    labelText();
  });
  ensureTextFont();

  // I segni dei collegamenti: uno sull'angolo in alto a destra di ogni
  // collegamento che si vede, sopra il foglio e fuori dalla sua pipeline. Il
  // tocco apre la nota con lo strumento Selezione, o quando il disegno non si
  // scrive; con gli altri strumenti il foglio è di chi disegna, e il segno si
  // vede soltanto. Dalla tastiera si apre con Alt+Invio.
  const linkLayer = document.createElement("div");
  ctx.linkLayer = linkLayer;
  linkLayer.className = "draw-link-layer";
  linkLayer.hidden = options.links === undefined;

  // Un incolla lungo: in alto sul foglio, che cosa sta facendo, quanto ne ha
  // fatto e il pulsante che lo interrompe, come Esc.
  const progressBar = document.createElement("div");
  ctx.progressBar = progressBar;
  progressBar.className = "draw-progress";
  progressBar.hidden = true;
  const progressLabel = document.createElement("span");
  ctx.progressLabel = progressLabel;
  progressLabel.className = "draw-progress-label";
  progressLabel.id = identifier("draw-progress");
  const progressMeter = document.createElement("progress");
  ctx.progressMeter = progressMeter;
  progressMeter.className = "draw-progress-meter";
  progressMeter.setAttribute("aria-labelledby", progressLabel.id);
  const progressStop = document.createElement("button");
  ctx.progressStop = progressStop;
  progressStop.type = "button";
  progressStop.className = "draw-progress-stop";
  progressStop.setAttribute("aria-keyshortcuts", "Escape");
  progressBar.append(progressLabel, progressMeter, progressStop);
  relabels.push(() => {
    const text = t("draw.paste.stop");
    progressStop.textContent = text;
    progressStop.title = `${text} (Esc)`;
  });

  // La descrizione delle immagini appena entrate, dallo Standard: in fondo al
  // foglio, una alla volta, col campo, «Scrivi», «Decorativa» e «Salta». Non
  // è una finestra: il disegno resta di chi lo fa, e la barra aspetta.
  const describeBar = document.createElement("div");
  ctx.describeBar = describeBar;
  describeBar.className = "draw-describe";
  describeBar.setAttribute("role", "group");
  describeBar.hidden = true;
  const describeLabel = document.createElement("label");
  ctx.describeLabel = describeLabel;
  describeLabel.className = "draw-describe-label";
  describeLabel.id = identifier("draw-describe");
  const describeInput = document.createElement("input");
  ctx.describeInput = describeInput;
  describeInput.type = "text";
  describeInput.className = "draw-describe-input";
  describeInput.id = identifier("draw-describe-input");
  describeInput.autocomplete = "off";
  describeInput.maxLength = NAME_MAX;
  describeLabel.htmlFor = describeInput.id;
  describeBar.setAttribute("aria-labelledby", describeLabel.id);
  const describeHint = document.createElement("span");
  describeHint.className = "sr-only";
  describeHint.id = identifier("draw-describe-hint");
  describeInput.setAttribute("aria-describedby", describeHint.id);
  const describeButton = (action: string): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-describe-action";
    control.dataset.action = action;
    return control;
  };
  const describeWrite = describeButton("write");
  ctx.describeWrite = describeWrite;
  const describeDecorative = describeButton("decorative");
  ctx.describeDecorative = describeDecorative;
  const describeSkip = describeButton("skip");
  ctx.describeSkip = describeSkip;
  describeBar.append(describeLabel, describeInput, describeHint, describeWrite, describeDecorative, describeSkip);
  relabels.push(() => {
    describeInput.placeholder = t("draw.access.describe.placeholder");
    describeHint.textContent = t("draw.describe.hint");
    describeWrite.textContent = t("draw.describe.write");
    describeDecorative.textContent = t("draw.access.fix.decorative");
    describeDecorative.setAttribute("aria-label", t("draw.access.fix.decorative.label"));
    describeSkip.textContent = t("draw.describe.skip");
    describeSkip.setAttribute("aria-label", t("draw.describe.skip.label"));
    describeLabel.textContent = t("draw.describe");
    ctx.showDescription();
  });
}
