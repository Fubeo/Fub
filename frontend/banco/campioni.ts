// Il catalogo dei componenti, come **dati**.
//
// # Perché è un elenco e non una pagina
//
// «Ogni componente in ogni stato» è una promessa che si mantiene o si perde, e
// perderla è silenzioso: un nodo nuovo del contratto compare, nessuno lo mette
// in catalogo, e il catalogo continua a sembrare completo. Quindi l'elenco sta
// in un modulo di dati che due lettori guardano: `catalogo.ts`, che lo disegna,
// e `scene.test.ts`, che confronta le specie coperte qui con i `case` che
// `src/ui/node.ts` sa disegnare davvero — cioè con la sola definizione di
// «tutti» che esista in questo repo.
//
// # Cosa vuol dire «stato»
//
// Non la variante del contratto: quella è la specie. Uno stato è ciò che rende
// **lo stesso** nodo diverso a schermo — i tre `Intent` di un bottone, una
// barra determinata contro una indeterminata, una riga selezionata contro una
// no, un vuoto con l'azione e uno senza. Sono le differenze che un tema deve
// distinguere, ed è precisamente il posto in cui un tema le sbaglia: la
// selezione che non si vede, il `danger` che è uguale al `primary`.
//
// Gli stati che il DOM porta e il contratto no — `:hover`, `:focus-visible`,
// `:disabled` — non sono qui: non si dichiarano, si **provocano**, e a
// provocarli è il fotografo (`foto.mjs`) sulla scena `componenti-fuoco`.
import type { UiKind, UiNode } from "../src/host/contract";

/// La specie di un nodo, cioè il tag del contratto.
export type Specie = UiKind["node"];

export interface Stato {
  /// Come si chiama a schermo, sotto il campione.
  nome: string;
  node: UiNode;
}

export interface Campione {
  /// Il titolo della sezione del catalogo.
  titolo: string;
  /// Le specie che questa sezione mette a schermo. Ce n'è più di una quando una
  /// specie non esiste da sola: un `list_item` fuori da una `list` non è un
  /// componente, è un frammento.
  copre: Specie[];
  stati: Stato[];
}

const AZIONE = { action: "niente", payload: null };

export const CAMPIONI: Campione[] = [
  {
    titolo: "Testo e titoli",
    copre: ["text", "heading"],
    stati: [
      { nome: "heading 1", node: { node: "heading", level: 1, content: "Primo livello" } },
      { nome: "heading 2", node: { node: "heading", level: 2, content: "Secondo livello" } },
      { nome: "heading 3", node: { node: "heading", level: 3, content: "Terzo livello" } },
      {
        nome: "text",
        node: {
          node: "text",
          content:
            "Una riga di prosa lunga abbastanza da mandare a capo, perché è a capo che si vede l'interlinea.",
        },
      },
    ],
  },
  {
    titolo: "Impilamento",
    copre: ["stack", "separator"],
    stati: [
      {
        nome: "stack in riga",
        node: {
          node: "stack",
          dir: "row",
          gap: 8,
          children: [
            { node: "badge", label: "uno", intent: "neutral" },
            { node: "badge", label: "due", intent: "neutral" },
            { node: "badge", label: "tre", intent: "neutral" },
          ],
        },
      },
      {
        nome: "stack in colonna",
        node: {
          node: "stack",
          dir: "column",
          gap: 4,
          children: [
            { node: "text", content: "sopra" },
            { node: "separator" },
            { node: "text", content: "sotto" },
          ],
        },
      },
    ],
  },
  {
    titolo: "Bottoni",
    copre: ["button"],
    stati: [
      { nome: "neutral", node: { node: "button", label: "Neutro", intent: "neutral", action: AZIONE } },
      { nome: "primary", node: { node: "button", label: "Primario", intent: "primary", action: AZIONE } },
      { nome: "danger", node: { node: "button", label: "Distruttivo", intent: "danger", action: AZIONE } },
    ],
  },
  {
    titolo: "Etichette",
    copre: ["badge", "icon"],
    stati: [
      { nome: "badge neutral", node: { node: "badge", label: "bozza", intent: "neutral" } },
      { nome: "badge primary", node: { node: "badge", label: "nuovo", intent: "primary" } },
      { nome: "badge danger", node: { node: "badge", label: "conflitto", intent: "danger" } },
      { nome: "icon", node: { node: "icon", name: "tag" } },
    ],
  },
  {
    titolo: "Elenchi",
    copre: ["list", "list_item"],
    stati: [
      {
        nome: "con sottotitolo, una selezionata",
        node: {
          node: "list",
          items: [
            { node: "list_item", title: "Benvenuto", subtitle: "Guida · 19 agosto", action: AZIONE, selected: false },
            { node: "list_item", title: "Sintassi di Fub", subtitle: "Guida · 18 agosto", action: AZIONE, selected: true },
            { node: "list_item", title: "Nota lunga", subtitle: null, action: AZIONE, selected: false },
          ],
        },
      },
      {
        nome: "senza azione",
        node: {
          node: "list",
          items: [
            { node: "list_item", title: "Una voce che non si clicca", subtitle: null, action: null, selected: false },
          ],
        },
      },
    ],
  },
  {
    titolo: "Alberi",
    copre: ["tree", "tree_item"],
    stati: [
      {
        nome: "aperto, chiuso, selezionato",
        node: {
          node: "tree",
          roots: [
            {
              node: "tree_item",
              label: "Guida",
              expanded: true,
              action: AZIONE,
              selected: false,
              children: [
                { node: "tree_item", label: "Sintassi di Fub", expanded: false, action: AZIONE, selected: true, children: [] },
                { node: "tree_item", label: "Frammenti di codice", expanded: false, action: AZIONE, selected: false, children: [] },
              ],
            },
            { node: "tree_item", label: "Diario", expanded: false, action: AZIONE, selected: false, children: [
              { node: "tree_item", label: "2026-08-19", expanded: false, action: AZIONE, selected: false, children: [] },
            ] },
          ],
        },
      },
    ],
  },
  {
    titolo: "Tabelle",
    copre: ["table", "row"],
    stati: [
      {
        nome: "tre colonne, tre allineamenti",
        node: {
          node: "table",
          columns: [
            { title: "Strato", align: "start" },
            { title: "Di chi è", align: "center" },
            { title: "Token", align: "end" },
          ],
          rows: [
            { node: "row", action: AZIONE, cells: [
              { node: "text", content: "struttura" },
              { node: "text", content: "della scocca" },
              { node: "text", content: "0" },
            ] },
            { node: "row", action: AZIONE, cells: [
              { node: "text", content: "foglio" },
              { node: "text", content: "del tema" },
              { node: "text", content: "83" },
            ] },
            { node: "row", action: null, cells: [
              { node: "text", content: "pelle" },
              { node: "text", content: "del tema" },
              { node: "text", content: "0" },
            ] },
          ],
        },
      },
    ],
  },
  {
    titolo: "Sezioni e schede",
    copre: ["section", "tabs", "tab"],
    stati: [
      {
        nome: "section aperta",
        node: { node: "section", title: "Aperta", collapsed: false, children: [{ node: "text", content: "Il corpo." }] },
      },
      {
        nome: "section chiusa",
        node: { node: "section", title: "Chiusa", collapsed: true, children: [{ node: "text", content: "Non si vede." }] },
      },
      {
        nome: "tabs, la seconda attiva",
        node: {
          node: "tabs",
          active: 1,
          tabs: [
            { node: "tab", label: "Prima", action: AZIONE, children: [{ node: "text", content: "Contenuto della prima." }] },
            { node: "tab", label: "Seconda", action: AZIONE, children: [{ node: "text", content: "Contenuto della seconda." }] },
            { node: "tab", label: "Terza", action: AZIONE, children: [{ node: "text", content: "Contenuto della terza." }] },
          ],
        },
      },
    ],
  },
  {
    titolo: "Coppie chiave-valore",
    copre: ["key_value"],
    stati: [
      {
        nome: "quattro righe",
        node: {
          node: "key_value",
          entries: [
            { label: "Parole", value: "412" },
            { label: "Collegamenti", value: "6" },
            { label: "Creata", value: "18 agosto 2026" },
            { label: "Modificata", value: "19 agosto 2026" },
          ],
        },
      },
    ],
  },
  {
    titolo: "Attesa e avanzamento",
    copre: ["progress", "pending"],
    stati: [
      { nome: "progress determinato", node: { node: "progress", value: 0.66, label: "Reindicizzazione: 340 di 512" } },
      { nome: "progress indeterminato", node: { node: "progress", value: null, label: "Snapshot in corso" } },
      { nome: "progress senza etichetta", node: { node: "progress", value: 0.25, label: null } },
      { nome: "pending", node: { node: "pending", label: "Sto leggendo il vault…" } },
      { nome: "pending muto", node: { node: "pending", label: null } },
    ],
  },
  {
    titolo: "Vuoti e guasti",
    copre: ["empty_state", "failed"],
    stati: [
      {
        nome: "vuoto con azione",
        node: { node: "empty_state", title: "Nessun backlink", detail: "Collega questa nota da un'altra.", action: AZIONE },
      },
      {
        nome: "vuoto senza azione",
        node: { node: "empty_state", title: "Il cestino è vuoto", detail: null, action: null },
      },
      {
        nome: "guasto con riprova",
        node: { node: "failed", message: "L'indice non risponde: riprova fra un istante.", retry: AZIONE },
      },
      {
        nome: "guasto senza riprova",
        node: { node: "failed", message: "Questo documento non esiste più.", retry: null },
      },
    ],
  },
  {
    titolo: "Campi di testo",
    copre: ["text_input", "text_area"],
    stati: [
      { nome: "text_input pieno", node: { node: "text_input", field: "nome", label: "Nome", value: "Sintassi di Fub", placeholder: null, action: null } },
      { nome: "text_input vuoto", node: { node: "text_input", field: "vuoto", label: "Cartella", value: "", placeholder: "Diario", action: null } },
      { nome: "text_area", node: { node: "text_area", field: "corpo", label: "Corpo", value: "Due righe\ndi testo.", rows: 3, action: null } },
    ],
  },
  {
    titolo: "Campi numerici",
    copre: ["number", "slider"],
    stati: [
      { nome: "number", node: { node: "number", field: "colonna", label: "Larghezza", value: 72, min: 40, max: 120, step: 1, action: null } },
      { nome: "number vuoto", node: { node: "number", field: "vuoto", label: "Senza valore", value: null, min: null, max: null, step: null, action: null } },
      { nome: "slider", node: { node: "slider", field: "opacita", label: "Opacità", value: 60, min: 0, max: 100, step: 5, action: null } },
    ],
  },
  {
    titolo: "Scelte",
    copre: ["checkbox", "select", "radio", "date_picker"],
    stati: [
      { nome: "checkbox acceso", node: { node: "checkbox", field: "righe", label: "Numeri di riga", value: true, action: null } },
      { nome: "checkbox spento", node: { node: "checkbox", field: "moto", label: "Riduci il moto", value: false, action: null } },
      {
        nome: "select",
        node: {
          node: "select",
          field: "tema",
          label: "Tema",
          value: ["dark"],
          options: [
            { value: "", label: "Come il sistema" },
            { value: "light", label: "Chiaro" },
            { value: "dark", label: "Scuro" },
          ],
          multiple: false,
          action: null,
        },
      },
      {
        nome: "select multipla",
        node: {
          node: "select",
          field: "cartelle",
          label: "Cartelle escluse",
          value: ["Risorse"],
          options: [
            { value: "Risorse", label: "Risorse" },
            { value: "Archivio", label: "Archivio" },
            { value: "Diario", label: "Diario" },
          ],
          multiple: true,
          action: null,
        },
      },
      {
        nome: "radio",
        node: {
          node: "radio",
          field: "modo",
          label: "Modalità",
          value: "live",
          options: [
            { value: "source", label: "Sorgente" },
            { value: "live", label: "Live" },
            { value: "reading", label: "Lettura" },
          ],
          action: null,
        },
      },
      { nome: "date_picker", node: { node: "date_picker", field: "giorno", label: "Giorno", value: "2026-08-19", action: null } },
    ],
  },
  {
    titolo: "Form",
    copre: ["form"],
    stati: [
      {
        nome: "tre campi e un invio",
        node: {
          node: "form",
          submit_label: "Crea",
          submit: AZIONE,
          children: [
            { node: "text_input", field: "titolo", label: "Titolo", value: "", placeholder: "Senza titolo", action: null },
            { node: "select", field: "cartella", label: "Cartella", value: ["Diario"], options: [
              { value: "Diario", label: "Diario" },
              { value: "Guida", label: "Guida" },
            ], multiple: false, action: null },
            { node: "checkbox", field: "apri", label: "Aprila subito", value: true, action: null },
          ],
        },
      },
    ],
  },
  {
    titolo: "Markup e finestre",
    copre: ["html", "web_view"],
    stati: [
      {
        nome: "html (passa dal sanitizer)",
        node: {
          node: "html",
          html: '<p>Un frammento con <strong>grassetto</strong>, <code>codice</code> e un <a href="https://example.org">link</a>.</p>',
        },
      },
      // `about:blank` e non un indirizzo vero: una foto che dipende dalla rete
      // non è una baseline, è il tempo che faceva quel giorno.
      { nome: "web_view", node: { node: "web_view", url: "about:blank", height: 80 } },
    ],
  },
  {
    titolo: "Il varco: ciò che la shell non conosce",
    copre: ["custom"],
    stati: [
      {
        nome: "ns sconosciuto → fallback",
        node: {
          node: "custom",
          ns: "terzi:qualcosa",
          payload: null,
          fallback: [
            { node: "text", content: "Questo componente vuole un tema che non c'è: si legge lo stesso." },
          ],
        },
      },
    ],
  },
];
