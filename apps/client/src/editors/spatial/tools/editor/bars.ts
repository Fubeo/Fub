// L'editor del disegno: le barre della selezione, dei nodi, del gruppo isolato
// e dei tracciati. Un pezzo di createDrawEditor (`../editor.ts`): lavora sul
// contesto che i pezzi condividono.

import { identifier } from "../../../../ui/a11y";
import { ariaBinding, displayBinding, modifierName } from "../../../../ui/commands";
import { iconEl } from "../../../../ui/icons";
import { linkName } from "../../describe";
import type { LengthUnit } from "../../scene/rulers";
import { t, type DrawKey } from "../../strings";
import type { OverlayHandle } from "../../painter/overlay";
import type { Join } from "../offset";
import { SceneIndex } from "../hit";
import { NAME_MAX } from "../naming";
import { ensureTextFont } from "../text";
import { createTextField, type TextField } from "../text-field";
import { JOIN_NAMES, SIMPLIFY_STEPS, TRANSFORM_BINDING } from "./constants";
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
  transformButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  pathButton: HTMLButtonElement;
  booleanButton: HTMLButtonElement;
  maskButton: HTMLButtonElement;
  motifButton: HTMLButtonElement;
  symbolButton: HTMLButtonElement;
  detachButton: HTMLButtonElement;
  repeatButton: HTMLButtonElement;
  outlineButton: HTMLButtonElement;
  traceButton: HTMLButtonElement;
  textPathButton: HTMLButtonElement;
  nodesBar: HTMLDivElement;
  insertNodesButton: HTMLButtonElement;
  deleteNodesButton: HTMLButtonElement;
  cornerButton: HTMLButtonElement;
  smoothButton: HTMLButtonElement;
  symmetricButton: HTMLButtonElement;
  linesButton: HTMLButtonElement;
  curvesButton: HTMLButtonElement;
  breakButton: HTMLButtonElement;
  joinButton: HTMLButtonElement;
  alignNodesButton: HTMLButtonElement;
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
  pathsBar: HTMLDivElement;
  pathsTitle: HTMLSpanElement;
  pathsField: (control: HTMLInputElement | HTMLSelectElement) => { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement };
  offsetInput: HTMLInputElement;
  offsetField: { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement; };
  joinSelect: HTMLSelectElement;
  joinField: { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement; };
  limitInput: HTMLInputElement;
  limitField: { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement; };
  amountInput: HTMLInputElement;
  amountField: { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement; };
  pathsStatus: HTMLOutputElement;
  pathsAction: () => HTMLButtonElement;
  pathsApply: HTMLButtonElement;
  pathsCancel: HTMLButtonElement;
  /// Il comando della barra aperta; `null` se è chiusa.
  pathsMode: "offset" | "simplify" | null;
  /// L'anteprima di adesso, con la selezione e l'indice per cui vale: le
  /// regole della barra che cambiano la tolgono.
  pathsShown: { readonly selection: readonly string[]; readonly index: SceneIndex; readonly handles: readonly OverlayHandle[] } | null;
  /// L'unità in cui è scritta la distanza.
  offsetUnit: LengthUnit;
  /// L'ultima distanza dello scostamento, in unità della scena, gli ultimi
  /// angoli e l'ultima semplificazione: la barra riapre con quelli.
  offsetLast: number | null;
  joinLast: Join;
  limitLast: number;
  amountLast: number;
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
  // Dal livello Esperto: ruotare, scalare e inclinare di quanto si scrive.
  // Col pannello delle proprietà, porta ai campi di «Trasforma».
  const transformButton = arrangeButton("draw.transform", "draw-transform", TRANSFORM_BINDING, () => {
    if (!ctx.focusTransform()) void ctx.transformDialog();
  });
  ctx.transformButton = transformButton;
  // Dal livello Esperto: la trasformazione passa nella geometria.
  const applyButton = arrangeButton("draw.apply_transform", "draw-apply-transform", null, () => ctx.applySelection());
  ctx.applyButton = applyButton;
  // Dal livello Esperto, il menu Tracciato: gli oggetti e i contorni
  // diventano tracciati, l'inchiostro i suoi nodi; lo scostamento e la
  // semplificazione si regolano in una barra, con l'anteprima.
  const pathButton = arrangeButton("draw.path", "draw-to-path", null, () => ctx.openMenu(pathButton, ctx.pathItems()));
  ctx.pathButton = pathButton;
  // Dal livello Esperto: unione, differenza, intersezione, esclusione e
  // divisione, in un menu.
  const booleanButton = arrangeButton("draw.boolean", "draw-boolean", null, () => ctx.openMenu(booleanButton, ctx.booleanItems()));
  ctx.booleanButton = booleanButton;
  // Dal livello Esperto: l'oggetto più in alto ritaglia gli altri, o ne fa
  // la trasparenza, e una maschera si toglie; in un menu.
  const maskButton = arrangeButton("draw.mask", "draw-mask", null, () => ctx.openMenu(maskButton, ctx.maskItems()));
  ctx.maskButton = maskButton;
  // Dal livello Esperto: gli oggetti scelti diventano un motivo del
  // documento, che i riempimenti possono usare.
  const motifButton = arrangeButton("draw.hatch.motif.make", "draw-hatch-pattern", null, () => ctx.motifFromSelection());
  ctx.motifButton = motifButton;
  // Dal livello Esperto: gli oggetti scelti diventano un simbolo, con
  // un'istanza al loro posto, e un'istanza torna un gruppo che si modifica
  // da solo.
  const symbolButton = arrangeButton("draw.symbol.make", "draw-symbol", null, () => ctx.symbolFromSelection());
  ctx.symbolButton = symbolButton;
  const detachButton = arrangeButton("draw.symbol.detach", "draw-detach", null, () => ctx.detachSelection());
  ctx.detachButton = detachButton;
  // Dal livello Esperto, il menu Ripeti: l'oggetto scelto si ripete intorno
  // a un centro, in griglia o allo specchio, e una ripetizione cambia tipo o
  // si espande in oggetti.
  const repeatButton = arrangeButton("draw.repeat", "draw-repeat", null, () => ctx.openMenu(repeatButton, ctx.repeatItems()));
  ctx.repeatButton = repeatButton;
  // Dal livello Esperto: tratteggio, estremi e angoli dei contorni scelti.
  const outlineButton = arrangeButton("draw.outline", "draw-outline", null, () => ctx.openMenu(outlineButton, ctx.outlineItems()));
  ctx.outlineButton = outlineButton;
  // Dal livello Esperto: un'immagine scelta da sola diventa tracciati
  // pieni, regolati in una barra con l'anteprima.
  const traceButton = arrangeButton("draw.trace_image", "draw-trace-image", null, () => void ctx.openTracing());
  ctx.traceButton = traceButton;
  // Dal livello Esperto, con un testo scelto: metterlo su una forma,
  // toglierlo dal suo tracciato e rovesciarlo, in un menu.
  const textPathButton = arrangeButton("draw.text_path", "draw-text-path", null, () => ctx.openMenu(textPathButton, ctx.textPathItems()));
  ctx.textPathButton = textPathButton;
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
  for (const control of [arrangeMore, orderButton, intoButton, alignButton, pathButton, booleanButton, maskButton, repeatButton, outlineButton, textPathButton]) {
    control.setAttribute("aria-haspopup", "menu");
    control.setAttribute("aria-expanded", "false");
  }
  // I comandi dei nodi, dal livello Esperto: con lo strumento Nodi e una
  // forma da modificare prendono il posto di quelli della selezione, con le
  // scorciatoie di Inkscape, e «Allinea» allinea i nodi scelti.
  const nodesBar = document.createElement("div");
  ctx.nodesBar = nodesBar;
  nodesBar.className = "draw-arrange";
  nodesBar.setAttribute("role", "toolbar");
  nodesBar.hidden = true;
  relabels.push(() => nodesBar.setAttribute("aria-label", t("draw.nodes.bar")));
  const nodesButton = (label: DrawKey, iconName: string, binding: string | null, run: () => void): HTMLButtonElement => {
    const control = button(nodesBar, "draw-button", () => t(label), iconName, run);
    if (binding !== null) control.setAttribute("aria-keyshortcuts", ariaBinding(binding) || binding);
    relabels.push(() => nameArrange(control, t(label), binding));
    return control;
  };
  const insertNodesButton = nodesButton("draw.nodes.insert", "draw-node-add", "Insert", () => ctx.insertSelectedNodes());
  ctx.insertNodesButton = insertNodesButton;
  const deleteNodesButton = nodesButton("draw.nodes.delete", "draw-node-delete", "Delete", () => ctx.deleteSelectedNodes());
  ctx.deleteNodesButton = deleteNodesButton;
  const cornerButton = nodesButton("draw.nodes.corner", "draw-node-corner", "Shift-c", () => ctx.kindSelectedNodes("corner"));
  ctx.cornerButton = cornerButton;
  const smoothButton = nodesButton("draw.nodes.smooth", "draw-node-smooth", "Shift-s", () => ctx.kindSelectedNodes("smooth"));
  ctx.smoothButton = smoothButton;
  const symmetricButton = nodesButton("draw.nodes.symmetric", "draw-node-symmetric", "Shift-y", () => ctx.kindSelectedNodes("symmetric"));
  ctx.symmetricButton = symmetricButton;
  const linesButton = nodesButton("draw.nodes.line", "draw-segment-line", "Shift-l", () => ctx.linkSelectedNodes("line"));
  ctx.linesButton = linesButton;
  const curvesButton = nodesButton("draw.nodes.curve", "draw-segment-curve", "Shift-u", () => ctx.linkSelectedNodes("curve"));
  ctx.curvesButton = curvesButton;
  const breakButton = nodesButton("draw.nodes.break", "draw-node-break", "Shift-b", () => ctx.breakSelectedNodes());
  ctx.breakButton = breakButton;
  const joinButton = nodesButton("draw.nodes.join", "draw-node-join", "Shift-j", () => ctx.joinSelectedNodes());
  ctx.joinButton = joinButton;
  const alignNodesButton = nodesButton("draw.nodes.align", "draw-align", null, () => ctx.openMenu(alignNodesButton, ctx.nodeAlignItems()));
  ctx.alignNodesButton = alignNodesButton;
  alignNodesButton.setAttribute("aria-haspopup", "menu");
  alignNodesButton.setAttribute("aria-expanded", "false");
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
  for (const bar of [arrangeBar, nodesBar, isolationBar]) {
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

  // Lo scostamento e la semplificazione, dal menu Tracciato: in fondo al
  // foglio, come la descrizione delle immagini. Non è una finestra: mentre
  // si regola, il disegno si guarda da vicino e gli oggetti scelti
  // cambiano, e l'anteprima li segue.
  const pathsBar = document.createElement("div");
  ctx.pathsBar = pathsBar;
  pathsBar.className = "draw-paths";
  pathsBar.setAttribute("role", "group");
  pathsBar.hidden = true;
  const pathsTitle = document.createElement("span");
  ctx.pathsTitle = pathsTitle;
  pathsTitle.className = "draw-paths-title";
  pathsTitle.id = identifier("draw-paths");
  pathsBar.setAttribute("aria-labelledby", pathsTitle.id);
  /// Un campo della barra: il nome, e accanto `control`.
  const pathsField = (control: HTMLInputElement | HTMLSelectElement): { readonly field: HTMLLabelElement; readonly name: HTMLSpanElement } => {
    const field = document.createElement("label");
    field.className = "draw-paths-field";
    const name = document.createElement("span");
    field.append(name, control);
    return { field, name };
  };
  ctx.pathsField = pathsField;
  const offsetInput = document.createElement("input");
  ctx.offsetInput = offsetInput;
  offsetInput.type = "number";
  offsetInput.inputMode = "decimal";
  offsetInput.step = "any";
  offsetInput.autocomplete = "off";
  const offsetField = pathsField(offsetInput);
  ctx.offsetField = offsetField;
  const joinSelect = document.createElement("select");
  ctx.joinSelect = joinSelect;
  const joinOptions = new Map<Join, HTMLOptionElement>();
  for (const join of JOIN_NAMES.keys()) {
    const option = document.createElement("option");
    option.value = join;
    joinOptions.set(join, option);
    joinSelect.append(option);
  }
  const joinField = pathsField(joinSelect);
  ctx.joinField = joinField;
  const limitInput = document.createElement("input");
  ctx.limitInput = limitInput;
  limitInput.type = "number";
  limitInput.inputMode = "decimal";
  limitInput.step = "any";
  limitInput.min = "1";
  limitInput.autocomplete = "off";
  const limitField = pathsField(limitInput);
  ctx.limitField = limitField;
  const amountInput = document.createElement("input");
  ctx.amountInput = amountInput;
  amountInput.type = "range";
  amountInput.min = "0";
  amountInput.max = String(SIMPLIFY_STEPS);
  amountInput.step = "1";
  const amountField = pathsField(amountInput);
  ctx.amountField = amountField;
  const pathsStatus = document.createElement("output");
  ctx.pathsStatus = pathsStatus;
  pathsStatus.className = "draw-paths-status";
  pathsStatus.setAttribute("aria-live", "polite");
  const pathsAction = (): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "draw-button draw-paths-action";
    return control;
  };
  ctx.pathsAction = pathsAction;
  const pathsApply = pathsAction();
  ctx.pathsApply = pathsApply;
  const pathsCancel = pathsAction();
  ctx.pathsCancel = pathsCancel;
  pathsBar.append(pathsTitle, offsetField.field, joinField.field, limitField.field, amountField.field, pathsApply, pathsCancel, pathsStatus);
  ctx.pathsMode = null;
  ctx.pathsShown = null;
  ctx.offsetUnit = "px";
  ctx.offsetLast = null;
  ctx.joinLast = "miter";
  ctx.limitLast = 4;
  ctx.amountLast = SIMPLIFY_STEPS / 2;
  relabels.push(() => {
    joinField.name.textContent = t("draw.offset.join");
    for (const [join, label] of JOIN_NAMES) joinOptions.get(join)!.textContent = t(label);
    limitField.name.textContent = t("draw.offset.limit");
    amountField.name.textContent = t("draw.simplify.amount");
    pathsApply.textContent = t("draw.paths.apply");
    pathsCancel.textContent = t("draw.paths.cancel");
    ctx.showPaths();
  });
}
