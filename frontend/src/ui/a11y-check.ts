// Il **check di accessibilità** che gira coi test (§12.4).
//
// La voce chiedeva una passata di accessibilità *e il suo presidio, nello
// stesso giro*, ed è la regola della
// [decisione 0014](../../../docs/decisions/0197-documentazione-presente-git-storia.md):
// una promessa senza presidio meccanico decade. Qui decadrebbe in fretta e
// senza rumore — un pannello nuovo che dimentica un `aria-label` non rompe
// niente, non fa diventare rosso niente, e semplicemente non esiste per chi non
// vede lo schermo.
//
// # Perché regole scritte a mano e non uno strumento
//
// Lo strumento standard è `axe-core`, e non è qui per una ragione tecnica e
// non di gusto: metà delle sue regole — contrasto, bersagli troppo piccoli,
// contenuto coperto da altro contenuto — hanno bisogno di **layout**, e in un
// DOM senza motore di rendering (`happy-dom`) restituiscono «impossibile
// determinare» o, peggio, passano a vuoto. Un presidio che non può fallire è
// peggio di nessun presidio, ed è già scritto nel commento del presidio di
// `hidden`. Le regole che invece si possono decidere leggendo **solo la
// struttura** sono quelle qui sotto, sono poche, e sono esattamente quelle che
// la passata di questa voce ha stabilito.
//
// Il contrasto — che axe-core saprebbe fare e noi no, senza layout — ha un
// presidio suo che non passa dal DOM affatto: `theme/contrast.test.ts` legge i
// token e fa i conti sulle coppie dichiarate.

/// Un problema trovato: cosa non va, e su quale elemento.
export interface AccessibilityIssue {
  /// La regola violata, in forma breve — è ciò su cui un test raggruppa.
  rule: string;
  /// Dove: un selettore leggibile da un umano, non un percorso completo.
  where: string;
  /// Cosa fare. Un messaggio che non dice come si ripara è un messaggio che
  /// costringe chi lo legge a rileggere questo file.
  detail: string;
}

/// I ruoli che sono **comandi**: qualcuno li preme, e prima di premerli deve
/// sapere cosa fanno.
const COMMANDS = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary';

/// I controlli di un form.
const FORM_CONTROLS = "input, select, textarea";

/// I tipi di `<input>` che non sono controlli da nominare: `hidden` non si vede
/// e non si raggiunge, e i pulsanti prendono il nome dal proprio `value`.
const INPUT_WITHOUT_NAME = new Set(["hidden", "submit", "reset", "button", "image"]);

/// Un selettore leggibile per dire *dove*.
function where(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const role = el.getAttribute("role");
  const className = el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "";
  return `${tag}${id}${id ? "" : className}${role ? `[role=${role}]` : ""}`;
}

/// Il **nome accessibile** di un elemento, nella misura che serve qui.
///
/// Non è l'algoritmo completo dello standard — quello tiene conto di
/// `aria-owns`, dei pseudo-elementi `::before`, della visibilità calcolata, e
/// senza layout non si può fare per intero. È la sua parte decidibile leggendo
/// la struttura, ed è quella che copre i modi in cui un nome *manca davvero*:
/// nessun testo, nessuna etichetta, nessun attributo.
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;

  // `aria-labelledby` vince su tutto, e per questo è anche il modo più facile
  // di perdere il nome per sempre: basta che l'id non esista più.
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const texts = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean);
    if (texts.length > 0) return texts.join(" ");
  }

  const label = el.getAttribute("aria-label")?.trim();
  if (label) return label;

  // Le due forme dell'etichetta di un controllo: quella che lo nomina per id, e
  // quella che lo avvolge.
  if (el.matches(FORM_CONTROLS)) {
    if (el.id) {
      const labelFor = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = labelFor?.textContent?.trim();
      if (text) return text;
    }
    const wraps = el.closest("label")?.textContent?.trim();
    if (wraps) return wraps;
  }

  const alt = el.getAttribute("alt")?.trim();
  if (alt) return alt;

  // Il contenuto testuale vale come nome per i comandi (un `<button>Salva`),
  // non per i controlli: il testo *dentro* un `<input>` non esiste.
  if (!el.matches(FORM_CONTROLS)) {
    const text = el.textContent?.trim();
    if (text) return text;
  }

  return el.getAttribute("title")?.trim() ?? "";
}

/// Passa `root` al setaccio e rende ciò che non va.
///
/// Le regole sono poche apposta. Ognuna è qui perché **è già stata sbagliata**
/// in questa shell prima di questa voce, non perché comparisse in un elenco:
/// un presidio che nasce da una lista di buoni propositi presidia il giorno che
/// è stato scritto, uno che nasce dai difetti trovati presidia quelli che
/// tornano.
export function checkAccessibility(root: ParentNode): AccessibilityIssue[] {
  const errors: AccessibilityIssue[] = [];
  const report = (rule: string, el: Element, detail: string) =>
    errors.push({ rule, where: where(el), detail });

  // 1. Un comando senza nome è un comando che non si può scegliere: chi
  //    ascolta sente «pulsante» e basta, tre volte di fila.
  for (const el of root.querySelectorAll(COMMANDS)) {
    if (accessibleName(el)) continue;
    report(
      "comando senza nome",
      el,
      "dagli un testo, un `aria-label` o un `title`: senza, viene annunciato come «pulsante» e nient'altro",
    );
  }

  // 2. Un campo senza nome è la stessa cosa, un passo più in là: si può
  //    compilare senza sapere cosa ci va.
  for (const el of root.querySelectorAll(FORM_CONTROLS)) {
    const type = el.getAttribute("type")?.toLowerCase() ?? "text";
    if (el.tagName === "INPUT" && INPUT_WITHOUT_NAME.has(type)) continue;
    if (accessibleName(el)) continue;
    report(
      "campo senza nome",
      el,
      "legalo a una `<label for>`, avvolgilo in una `<label>`, o dagli un `aria-label`: " +
        "un segnaposto non è un'etichetta — sparisce appena si scrive",
    );
  }

  // 3. Ciò che si clicca si raggiunge. È il difetto che la passata di questa
  //    voce ha riparato in blocco (`ui/a11y.ts`, `attivabile`), ed è quello che
  //    tornerebbe per primo: disegnare una riga cliccabile è naturale, darle un
  //    `tabindex` no.
  for (const el of root.querySelectorAll(".clickable")) {
    if (el.matches(COMMANDS) || el.matches(FORM_CONTROLS)) continue;
    if (el.getAttribute("tabindex") !== null) continue;
    report(
      "cliccabile ma irraggiungibile",
      el,
      "ha la classe `clickable` ma nessun `tabindex`: chi non usa il mouse non ci arriva. " +
        "Passa da `attivabile()` di `ui/a11y.ts`",
    );
  }

  // 4. Un `tabindex` positivo non mette un elemento «più avanti»: lo mette
  //    davanti a **tutto** il documento, e rompe l'ordine di lettura di ogni
  //    altra cosa. È sempre un errore, e non è mai voluto.
  for (const el of root.querySelectorAll("[tabindex]")) {
    const n = Number(el.getAttribute("tabindex"));
    if (Number.isFinite(n) && n > 0) {
      report(
        "tabindex positivo",
        el,
        `\`tabindex="${n}"\` scavalca l'ordine del documento per tutti gli altri elementi: usa 0 o -1`,
      );
    }
  }

  // 5. Un riferimento che non punta a niente è il modo più silenzioso di
  //    perdere un nome: l'attributo c'è, sembra a posto, e non nomina nessuno.
  for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const el of root.querySelectorAll(`[${attribute}]`)) {
      const missing = (el.getAttribute(attribute) ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((id) => !el.ownerDocument.getElementById(id));
      if (missing.length > 0) {
        report(
          "riferimento nel vuoto",
          el,
          `\`${attribute}\` punta a ${missing.map((m) => `«${m}»`).join(", ")}, che non esiste nel documento`,
        );
      }
    }
  }

  // 6. Una finestra di dialogo senza nome non si distingue dalle altre: chi ci
  //    entra sente «finestra di dialogo» e deve leggerla per capire quale sia.
  for (const el of root.querySelectorAll('[role="dialog"]')) {
    if (accessibleName(el) || el.getAttribute("aria-labelledby")) continue;
    report(
      "dialogo senza nome",
      el,
      "dagli un `aria-label` o un `aria-labelledby` che punti al suo titolo",
    );
  }

  // 7. I contenitori che promettono un contenuto: una barra di schede senza
  //    schede e un albero senza voci sono ruoli che mentono, e un lettore di
  //    schermo li annuncia lo stesso — «lista di schede, vuota».
  for (const [container, child] of [
    ['[role="tablist"]', '[role="tab"]'],
    ['[role="tree"]', '[role="treeitem"]'],
  ] as const) {
    for (const el of root.querySelectorAll(container)) {
      // Un albero vuoto perché il vault è vuoto è legittimo: la regola guarda
      // chi ha dei figli e non quelli giusti.
      if (el.children.length === 0) continue;
      if (el.querySelector(child)) continue;
      report(
        "contenitore senza il suo contenuto",
        el,
        `dichiara ${container} ma non contiene nessun ${child}`,
      );
    }
  }

  // 8. Un `<iframe>` senza titolo è, navigando, «frame»: non c'è modo di
  //    sapere se valga la pena entrarci.
  for (const el of root.querySelectorAll("iframe")) {
    if (el.getAttribute("title")?.trim()) continue;
    report("frame senza titolo", el, "dagli un `title`: è l'unico nome che un frame possa avere");
  }

  return errors;
}

/// I problemi in una riga per uno, pronti da mettere in un messaggio di test.
export function formatIssues(errors: AccessibilityIssue[]): string {
  return errors.map((p) => `  • [${p.rule}] ${p.where}: ${p.detail}`).join("\n");
}
