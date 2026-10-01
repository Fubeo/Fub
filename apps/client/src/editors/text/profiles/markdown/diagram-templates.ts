// I modelli di diagramma: dentro un recinto `mermaid` ancora vuoto il
// completamento propone quattordici scheletri pronti, uno per tipo. Qui ci sono
// i dati e la scelta, puri: niente CodeMirror, niente DOM. La sorgente che li
// offre sta in `completions.ts`, accanto alle altre.
//
// Il corpo di un modello non passa dal catalogo delle stringhe: le graffe di
// Mermaid (`B{Decisione}`, `CLIENTE { … }`) sono i segnaposti del catalogo, e
// un modello scritto lì andrebbe riscritto con le graffe raddoppiate. I nomi e
// le descrizioni sì, perché sono interfaccia; i corpi hanno una versione per
// lingua di catalogo, qui sotto.

import type { Key } from "../../../../i18n/strings";

/// Le lingue che hanno un corpo scritto; le altre cadono sull'italiano, che è
/// il ripiego del catalogo.
export type TemplateLanguage = "it" | "en";

export interface DiagramTemplate {
  /// Stabile: lo usano i test e nessun'altra cosa lo mostra.
  readonly id: string;
  /// La prima parola del sorgente, cioè il tipo per Mermaid.
  readonly keyword: string;
  readonly name: Key;
  readonly description: Key;
  /// Le parole che lo trovano oltre al nome, in tutte e due le lingue: chi
  /// scrive `torta` e chi scrive `pie` cercano la stessa cosa.
  readonly aliases: readonly string[];
  /// Senza a-capo finale: la riga dopo è la chiusura del recinto. `{today}` è
  /// la data di oggi in `YYYY-MM-DD`, perché un Gantt parta da adesso.
  readonly body: Readonly<Record<TemplateLanguage, string>>;
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: "flowchart",
    keyword: "flowchart",
    name: "mermaid.template.flowchart",
    description: "mermaid.template.flowchart.desc",
    aliases: ["graph", "flusso", "diagramma", "schema", "processo", "flow"],
    body: {
      it: `flowchart LR
  A[Inizio] --> B{Decisione}
  B -- sì --> C[Azione]
  B -- no --> D[Alternativa]
  C --> E((Fine))
  D --> E`,
      en: `flowchart LR
  A[Start] --> B{Decision}
  B -- yes --> C[Action]
  B -- no --> D[Alternative]
  C --> E((End))
  D --> E`,
    },
  },
  {
    id: "sequence",
    keyword: "sequenceDiagram",
    name: "mermaid.template.sequence",
    description: "mermaid.template.sequence.desc",
    aliases: ["sequenza", "sequence", "messaggi", "messages"],
    body: {
      it: `sequenceDiagram
  autonumber
  participant C as Cliente
  participant S as Server
  C->>S: richiesta
  activate S
  S-->>C: risposta
  deactivate S
  Note over C,S: il giro completo`,
      en: `sequenceDiagram
  autonumber
  participant C as Client
  participant S as Server
  C->>S: request
  activate S
  S-->>C: response
  deactivate S
  Note over C,S: the full round trip`,
    },
  },
  {
    id: "class",
    keyword: "classDiagram",
    name: "mermaid.template.class",
    description: "mermaid.template.class.desc",
    aliases: ["classi", "class", "uml", "oggetti", "objects"],
    body: {
      it: `classDiagram
  class Animale {
    +String nome
    +muoviti()
  }
  class Cane {
    +abbaia()
  }
  Animale <|-- Cane`,
      en: `classDiagram
  class Animal {
    +String name
    +move()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog`,
    },
  },
  {
    id: "state",
    keyword: "stateDiagram-v2",
    name: "mermaid.template.state",
    description: "mermaid.template.state.desc",
    aliases: ["stati", "state", "transizioni", "transitions", "macchina"],
    body: {
      it: `stateDiagram-v2
  [*] --> Bozza
  Bozza --> Revisione: invia
  Revisione --> Pubblicato: approva
  Revisione --> Bozza: correggi
  Pubblicato --> [*]`,
      en: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review: submit
  Review --> Published: approve
  Review --> Draft: fix
  Published --> [*]`,
    },
  },
  {
    id: "er",
    keyword: "erDiagram",
    name: "mermaid.template.er",
    description: "mermaid.template.er.desc",
    aliases: ["er", "entità", "relazioni", "entity", "relationship", "database", "tabelle", "tables"],
    body: {
      it: `erDiagram
  CLIENTE ||--o{ ORDINE : effettua
  ORDINE ||--|{ RIGA : contiene
  CLIENTE {
    string nome
    string email
  }`,
      en: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    string name
    string email
  }`,
    },
  },
  {
    id: "gantt",
    keyword: "gantt",
    name: "mermaid.template.gantt",
    description: "mermaid.template.gantt.desc",
    aliases: ["piano", "calendario", "scadenze", "plan", "schedule"],
    body: {
      it: `gantt
  title Piano del progetto
  dateFormat YYYY-MM-DD
  section Preparazione
    Ricerca :done, r1, {today}, 5d
    Stesura :active, s1, after r1, 7d
  section Uscita
    Revisione :crit, v1, after s1, 3d
    Pubblicazione :milestone, p1, after v1, 0d`,
      en: `gantt
  title Project plan
  dateFormat YYYY-MM-DD
  section Preparation
    Research :done, r1, {today}, 5d
    Drafting :active, s1, after r1, 7d
  section Release
    Review :crit, v1, after s1, 3d
    Publication :milestone, p1, after v1, 0d`,
    },
  },
  {
    id: "pie",
    keyword: "pie",
    name: "mermaid.template.pie",
    description: "mermaid.template.pie.desc",
    aliases: ["torta", "percentuali", "parti", "percentages"],
    body: {
      it: `pie title Come passa il tempo
  "Scrivere" : 45
  "Leggere" : 30
  "Altro" : 25`,
      en: `pie title Where the time goes
  "Writing" : 45
  "Reading" : 30
  "Other" : 25`,
    },
  },
  {
    id: "mindmap",
    keyword: "mindmap",
    name: "mermaid.template.mindmap",
    description: "mermaid.template.mindmap.desc",
    aliases: ["mappa", "mentale", "mind", "map", "idee", "ideas"],
    body: {
      it: `mindmap
  root((Idea centrale))
    Primo ramo
      Un dettaglio
      Un altro dettaglio
    Secondo ramo
      Un esempio`,
      en: `mindmap
  root((Central idea))
    First branch
      A detail
      Another detail
    Second branch
      An example`,
    },
  },
  {
    id: "timeline",
    keyword: "timeline",
    name: "mermaid.template.timeline",
    description: "mermaid.template.timeline.desc",
    aliases: ["linea", "tempo", "cronologia", "tappe", "milestones"],
    body: {
      it: `timeline
  title Le tappe
  2024 : Prima idea
  2025 : Prototipo : Primi lettori
  2026 : Versione stabile`,
      en: `timeline
  title Milestones
  2024 : First idea
  2025 : Prototype : First readers
  2026 : Stable release`,
    },
  },
  {
    id: "git",
    keyword: "gitGraph",
    name: "mermaid.template.git",
    description: "mermaid.template.git.desc",
    aliases: ["git", "rami", "commit", "branch", "merge"],
    body: {
      it: `gitGraph
  commit
  branch bozza
  checkout bozza
  commit
  commit
  checkout main
  merge bozza
  commit`,
      en: `gitGraph
  commit
  branch draft
  checkout draft
  commit
  commit
  checkout main
  merge draft
  commit`,
    },
  },
  {
    id: "journey",
    keyword: "journey",
    name: "mermaid.template.journey",
    description: "mermaid.template.journey.desc",
    aliases: ["percorso", "utente", "esperienza", "user", "experience"],
    body: {
      it: `journey
  title Una giornata di scrittura
  section Mattina
    Raccogliere idee: 4: Io
    Scrivere la bozza: 3: Io
  section Pomeriggio
    Rileggere: 5: Io, Revisore`,
      en: `journey
  title A writing day
  section Morning
    Gather ideas: 4: Me
    Write the draft: 3: Me
  section Afternoon
    Proofread: 5: Me, Reviewer`,
    },
  },
  {
    id: "quadrant",
    keyword: "quadrantChart",
    name: "mermaid.template.quadrant",
    description: "mermaid.template.quadrant.desc",
    aliases: ["quadranti", "quadrant", "priorità", "matrice", "priority", "matrix"],
    body: {
      it: `quadrantChart
  title Priorità
  x-axis Poco sforzo --> Molto sforzo
  y-axis Poco valore --> Molto valore
  quadrant-1 Pianificare
  quadrant-2 Fare subito
  quadrant-3 Rimandare
  quadrant-4 Evitare
  Idea A: [0.3, 0.8]
  Idea B: [0.7, 0.6]
  Idea C: [0.2, 0.3]`,
      en: `quadrantChart
  title Priorities
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Later
  quadrant-4 Avoid
  Idea A: [0.3, 0.8]
  Idea B: [0.7, 0.6]
  Idea C: [0.2, 0.3]`,
    },
  },
  {
    id: "xychart",
    keyword: "xychart-beta",
    name: "mermaid.template.xychart",
    description: "mermaid.template.xychart.desc",
    aliases: ["xy", "grafico", "barre", "linee", "chart", "bar", "line"],
    body: {
      it: `xychart-beta
  title "Parole al giorno"
  x-axis [lun, mar, mer, gio, ven]
  y-axis "Parole" 0 --> 2000
  bar [800, 1200, 950, 1500, 1800]
  line [700, 1100, 1000, 1400, 1700]`,
      en: `xychart-beta
  title "Words per day"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Words" 0 --> 2000
  bar [800, 1200, 950, 1500, 1800]
  line [700, 1100, 1000, 1400, 1700]`,
    },
  },
  {
    id: "sankey",
    keyword: "sankey-beta",
    name: "mermaid.template.sankey",
    description: "mermaid.template.sankey.desc",
    aliases: ["sankey", "flussi", "quantità", "flows", "quantities"],
    // Le righe di un Sankey sono CSV: un rientro diventerebbe parte del nome.
    body: {
      it: `sankey-beta
Idee,Bozze,40
Idee,Archivio,10
Bozze,Pubblicate,30
Bozze,Archivio,10`,
      en: `sankey-beta
Ideas,Drafts,40
Ideas,Archive,10
Drafts,Published,30
Drafts,Archive,10`,
    },
  },
];

/// Minuscole e senza accenti: `entità` e `entita` si trovano uguali.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/// I modelli che una parola scritta nomina, dal più pertinente: prima quelli
/// il cui tipo comincia così, poi quelli con un nome o un alias che comincia
/// così, poi quelli che la contengono. A parità conta l'ordine della lista.
/// La parola vuota li vuole tutti. `name` è il nome nella lingua corrente, che
/// chi chiama traduce: così questo file non chiede al catalogo.
export function matchTemplates(
  query: string,
  name: (template: DiagramTemplate) => string = () => "",
  templates: readonly DiagramTemplate[] = DIAGRAM_TEMPLATES,
): DiagramTemplate[] {
  const wanted = fold(query.trim());
  if (wanted === "") return [...templates];
  const ranked: { template: DiagramTemplate; rank: number; order: number }[] = [];
  templates.forEach((template, order) => {
    const keyword = fold(template.keyword);
    const words = [...fold(name(template)).split(/[^\p{L}\p{N}]+/u), ...template.aliases.map(fold)]
      .filter((word) => word !== "");
    const rank = keyword.startsWith(wanted) ? 0
      : words.some((word) => word.startsWith(wanted)) ? 1
      : keyword.includes(wanted) || words.some((word) => word.includes(wanted)) ? 2
      : -1;
    if (rank >= 0) ranked.push({ template, rank, order });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.template);
}

/// La data locale in `YYYY-MM-DD`, come la vuole `dateFormat` del Gantt.
function isoDay(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/// Il testo da inserire: il corpo nella lingua chiesta, con la data di oggi,
/// e dalla seconda riga in poi il rientro della riga dove si scrive — un
/// recinto dentro una lista o una citazione resta dentro.
export function templateText(
  template: DiagramTemplate,
  language: string,
  indent = "",
  today: Date = new Date(),
): string {
  const body = (language === "en" ? template.body.en : template.body.it).replaceAll("{today}", isoDay(today));
  return body.split("\n").join(`\n${indent}`);
}
