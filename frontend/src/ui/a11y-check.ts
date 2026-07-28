// Il **check di accessibilità** che gira coi test (§12.4).
//
// La voce chiedeva una passata di accessibilità *e il suo presidio, nello
// stesso giro*, ed è la regola della
// [decisione 0014](../../../docs/decisions/0014-i-verbali-fuori-da-todo.md):
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
export interface Problema {
  /// La regola violata, in forma breve — è ciò su cui un test raggruppa.
  regola: string;
  /// Dove: un selettore leggibile da un umano, non un percorso completo.
  dove: string;
  /// Cosa fare. Un messaggio che non dice come si ripara è un messaggio che
  /// costringe chi lo legge a rileggere questo file.
  dettaglio: string;
}

/// I ruoli che sono **comandi**: qualcuno li preme, e prima di premerli deve
/// sapere cosa fanno.
const COMANDI = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary';

/// I controlli di un form.
const CONTROLLI = "input, select, textarea";

/// I tipi di `<input>` che non sono controlli da nominare: `hidden` non si vede
/// e non si raggiunge, e i pulsanti prendono il nome dal proprio `value`.
const INPUT_SENZA_NOME = new Set(["hidden", "submit", "reset", "button", "image"]);

/// Un selettore leggibile per dire *dove*.
function dove(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const ruolo = el.getAttribute("role");
  const classe = el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "";
  return `${tag}${id}${id ? "" : classe}${ruolo ? `[role=${ruolo}]` : ""}`;
}

/// Il **nome accessibile** di un elemento, nella misura che serve qui.
///
/// Non è l'algoritmo completo dello standard — quello tiene conto di
/// `aria-owns`, dei pseudo-elementi `::before`, della visibilità calcolata, e
/// senza layout non si può fare per intero. È la sua parte decidibile leggendo
/// la struttura, ed è quella che copre i modi in cui un nome *manca davvero*:
/// nessun testo, nessuna etichetta, nessun attributo.
export function nomeAccessibile(el: Element): string {
  const doc = el.ownerDocument;

  // `aria-labelledby` vince su tutto, e per questo è anche il modo più facile
  // di perdere il nome per sempre: basta che l'id non esista più.
  const rif = el.getAttribute("aria-labelledby");
  if (rif) {
    const testi = rif
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean);
    if (testi.length > 0) return testi.join(" ");
  }

  const etichetta = el.getAttribute("aria-label")?.trim();
  if (etichetta) return etichetta;

  // Le due forme dell'etichetta di un controllo: quella che lo nomina per id, e
  // quella che lo avvolge.
  if (el.matches(CONTROLLI)) {
    if (el.id) {
      const per = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const testo = per?.textContent?.trim();
      if (testo) return testo;
    }
    const avvolge = el.closest("label")?.textContent?.trim();
    if (avvolge) return avvolge;
  }

  const alt = el.getAttribute("alt")?.trim();
  if (alt) return alt;

  // Il contenuto testuale vale come nome per i comandi (un `<button>Salva`),
  // non per i controlli: il testo *dentro* un `<input>` non esiste.
  if (!el.matches(CONTROLLI)) {
    const testo = el.textContent?.trim();
    if (testo) return testo;
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
export function verificaAccessibilita(root: ParentNode): Problema[] {
  const problemi: Problema[] = [];
  const segnala = (regola: string, el: Element, dettaglio: string) =>
    problemi.push({ regola, dove: dove(el), dettaglio });

  // 1. Un comando senza nome è un comando che non si può scegliere: chi
  //    ascolta sente «pulsante» e basta, tre volte di fila.
  for (const el of root.querySelectorAll(COMANDI)) {
    if (nomeAccessibile(el)) continue;
    segnala(
      "comando senza nome",
      el,
      "dagli un testo, un `aria-label` o un `title`: senza, viene annunciato come «pulsante» e nient'altro",
    );
  }

  // 2. Un campo senza nome è la stessa cosa, un passo più in là: si può
  //    compilare senza sapere cosa ci va.
  for (const el of root.querySelectorAll(CONTROLLI)) {
    const tipo = el.getAttribute("type")?.toLowerCase() ?? "text";
    if (el.tagName === "INPUT" && INPUT_SENZA_NOME.has(tipo)) continue;
    if (nomeAccessibile(el)) continue;
    segnala(
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
    if (el.matches(COMANDI) || el.matches(CONTROLLI)) continue;
    if (el.getAttribute("tabindex") !== null) continue;
    segnala(
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
      segnala(
        "tabindex positivo",
        el,
        `\`tabindex="${n}"\` scavalca l'ordine del documento per tutti gli altri elementi: usa 0 o -1`,
      );
    }
  }

  // 5. Un riferimento che non punta a niente è il modo più silenzioso di
  //    perdere un nome: l'attributo c'è, sembra a posto, e non nomina nessuno.
  for (const attributo of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const el of root.querySelectorAll(`[${attributo}]`)) {
      const mancanti = (el.getAttribute(attributo) ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((id) => !el.ownerDocument.getElementById(id));
      if (mancanti.length > 0) {
        segnala(
          "riferimento nel vuoto",
          el,
          `\`${attributo}\` punta a ${mancanti.map((m) => `«${m}»`).join(", ")}, che non esiste nel documento`,
        );
      }
    }
  }

  // 6. Una finestra di dialogo senza nome non si distingue dalle altre: chi ci
  //    entra sente «finestra di dialogo» e deve leggerla per capire quale sia.
  for (const el of root.querySelectorAll('[role="dialog"]')) {
    if (nomeAccessibile(el) || el.getAttribute("aria-labelledby")) continue;
    segnala(
      "dialogo senza nome",
      el,
      "dagli un `aria-label` o un `aria-labelledby` che punti al suo titolo",
    );
  }

  // 7. I contenitori che promettono un contenuto: una barra di schede senza
  //    schede e un albero senza voci sono ruoli che mentono, e un lettore di
  //    schermo li annuncia lo stesso — «lista di schede, vuota».
  for (const [contenitore, figlio] of [
    ['[role="tablist"]', '[role="tab"]'],
    ['[role="tree"]', '[role="treeitem"]'],
  ] as const) {
    for (const el of root.querySelectorAll(contenitore)) {
      // Un albero vuoto perché il vault è vuoto è legittimo: la regola guarda
      // chi ha dei figli e non quelli giusti.
      if (el.children.length === 0) continue;
      if (el.querySelector(figlio)) continue;
      segnala(
        "contenitore senza il suo contenuto",
        el,
        `dichiara ${contenitore} ma non contiene nessun ${figlio}`,
      );
    }
  }

  // 8. Un `<iframe>` senza titolo è, navigando, «frame»: non c'è modo di
  //    sapere se valga la pena entrarci.
  for (const el of root.querySelectorAll("iframe")) {
    if (el.getAttribute("title")?.trim()) continue;
    segnala("frame senza titolo", el, "dagli un `title`: è l'unico nome che un frame possa avere");
  }

  return problemi;
}

/// I problemi in una riga per uno, pronti da mettere in un messaggio di test.
export function raccontaProblemi(problemi: Problema[]): string {
  return problemi.map((p) => `  • [${p.regola}] ${p.dove}: ${p.dettaglio}`).join("\n");
}
