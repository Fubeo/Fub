// Il vault del banco: **fisso**, e fisso è una decisione.
//
// Un banco visivo confronta due immagini, quindi tutto ciò che entra nella
// prima deve entrare identico nella seconda. Il corpus è la prima delle sei
// cose che il §31.1 dichiara stabili (le altre cinque le tiene il fotografo:
// caratteri attesi, ora congelata, moto ridotto, soglia del diff, baseline solo
// Linux) — e sta qui, versionato, invece di essere una cartella su disco che
// qualcuno popola: una nota in più aggiunta per provare una cosa sposta ogni
// baseline di ogni scena, e va vista nel diff del commit come si vede il resto.
//
// **Copre per costruzione, non per campione.** Ogni costrutto che il renderer
// del kernel sa emettere compare almeno una volta in `Guida/Sintassi di Fub.md`,
// e la resa che il banco serve (`RESA`) è scritto nelle forme esatte di
// `crates/fub-format-markdown/src/render.rs` — `<li class="task">` con la
// casella disabilitata, `<div class="callout" data-callout="…">`, `<a
// class="wikilink" data-wikilink-page="…" href="#">`, `<span class="tag"
// data-tag="…">`. Se quel file cambia forma, questa smette di essere la resa
// vera: è il limite del banco, ed è dichiarato qui perché nessuno lo deduca.
//
// La nota lunga si **genera** invece di stare scritto: diecimila parole
// versionate sarebbero mezzo megabyte di prosa finta nel repo, e ciò che serve
// al banco non è quel testo — è che ce ne sia tanto e che sia sempre lo stesso.
// Il generatore è deterministico e non usa `Math.random`.

const SHEET_WORKBOOK = JSON.stringify({
  version: 1,
  sheets: [{
    id: "budget",
    name: "Budget 2026",
    rows: Array.from({ length: 24 }, (_, index) => ({ id: `r${index}`, hidden: false })),
    columns: Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, hidden: false })),
    cells: [
      { row: "r0", column: "c0", input: "Voce" },
      { row: "r0", column: "c1", input: "Gennaio" },
      { row: "r0", column: "c2", input: "Febbraio" },
      { row: "r1", column: "c0", input: "Ricavi" },
      { row: "r1", column: "c1", input: "12500" },
      { row: "r1", column: "c2", input: "13200" },
      { row: "r2", column: "c0", input: "Costi" },
      { row: "r2", column: "c1", input: "7800" },
      { row: "r2", column: "c2", input: "8100" },
      { row: "r3", column: "c0", input: "Margine" },
      { row: "r3", column: "c1", input: "=B2-B3" },
      { row: "r3", column: "c2", input: "=C2-C3" },
    ],
  }],
});

/// I file del vault: path → sorgente. Le cartelle si deducono dai path, come
/// sul disco e come nell'host finto.
export const CORPUS: Record<string, string> = {
  "Dati/Budget.fubsheet": SHEET_WORKBOOK,

  "Benvenuto.md": [
    "# Benvenuto in Fub",
    "",
    "Questa è la nota che il banco apre per prima. Serve a fotografare lo stato",
    "normale: un titolo, due paragrafi di prosa, un elenco e un paio di",
    "riferimenti — cioè quello che si vede il novantanove per cento del tempo.",
    "",
    "La sintassi per intero sta in [[Sintassi di Fub]], i colori dei linguaggi",
    "in [[Frammenti di codice]]. #tema #banco",
    "",
    "- Un elenco corto",
    "- con tre voci",
    "- e nient'altro dentro",
    "",
    "> Ciò che non si guarda non si migliora.",
  ].join("\n"),

  "Guida/Sintassi di Fub.md": [
    "# Sintassi di Fub",
    "",
    "## Titoli",
    "",
    "### Terzo livello",
    "",
    "#### Quarto livello",
    "",
    "##### Quinto livello",
    "",
    "###### Sesto livello",
    "",
    "## Testo",
    "",
    "Prosa normale, con **grassetto**, *corsivo*, ~~barrato~~, `codice in riga`,",
    "==evidenziato==, un^apice^ e una nota a piè di pagina[^1].",
    "",
    "[^1]: E questa è la nota.",
    "",
    "## Riferimenti",
    "",
    "Un wikilink risolto: [[Benvenuto]].",
    "Uno con alias: [[Frammenti di codice|i frammenti]]. Un tag: #sintassi. Un link esterno:",
    "[la specifica](https://commonmark.org).",
    "",
    "## Elenchi",
    "",
    "1. Primo",
    "2. Secondo",
    "3. Terzo",
    "",
    "- [ ] Da fare",
    "- [x] Fatto",
    "",
    "## Citazione",
    "",
    "> Un paragrafo citato, che va a capo",
    "> e continua sulla riga dopo.",
    "",
    "## Callout",
    "",
    "> [!note] Una nota",
    "> Il corpo del callout.",
    "",
    "> [!warning] Un avvertimento",
    "> Il corpo del secondo.",
    "",
    "## Tabella",
    "",
    "| Strato | Di chi è | Si sostituisce |",
    "| --- | :---: | ---: |",
    "| struttura | della scocca | no |",
    "| foglio | del tema | sì |",
    "| pelle | del tema | sì |",
    "",
    "## Codice",
    "",
    "```rust",
    "pub fn contrasto(a: &str, b: &str) -> f64 {",
    "    let (x, y) = (luminanza(a), luminanza(b));",
    "    (x.max(y) + 0.05) / (x.min(y) + 0.05)",
    "}",
    "```",
    "",
    "---",
    "",
    "E una riga dopo la linea.",
  ].join("\n"),

  "Guida/Frammenti di codice.md": [
    "# Frammenti di codice",
    "",
    "I dieci colori della tavolozza di sintassi, uno per volta.",
    "",
    "```typescript",
    'import { monta } from "./loader";',
    "",
    "/// Monta uno strato a sostituzione.",
    'export function applica(testo: string, strato: "foglio" | "pelle"): void {',
    "  const n = 1024;",
    "  monta(testo, strato);",
    "  if (!testo) throw new Error(`lo strato ${strato} è vuoto`);",
    "}",
    "```",
    "",
    "```css",
    ":root {",
    "  --accent: #6ea8fe;",
    "  --text: #e6e6e6;",
    "}",
    "```",
  ].join("\n"),

  "Diario/2026-08-19.md": [
    "# 19 agosto",
    "",
    "Il banco vede. Le scene sono diciotto e le luci due.",
    "",
    "- [x] Il secondo ingresso",
    "- [ ] I caratteri",
  ].join("\n"),

  "Diario/2026-08-18.md": [
    "# 18 agosto",
    "",
    "Contati i token: ottantatré per foglio, gemelli.",
  ].join("\n"),

  "Progetti/Il banco che vede.md": [
    "# Il banco che vede",
    "",
    "La voce [[31.1]] della seduta trentuno. Vedi anche [[Sintassi di Fub]] e una",
    "nota che non esiste: [[Questa non c'è]].",
    "",
    "#seduta-31",
  ].join("\n"),

  "Progetti/Archivio/Prima idea.md": [
    "# Prima idea",
    "",
    "Archiviata. Serve al banco per avere una cartella a due livelli.",
  ].join("\n"),

  // Un disegno di FubDraw, scritto dagli strumenti del livello Essenziale: le
  // scene del disegno lo aprono. Sta in `Risorse/`, che nessuna scena apre,
  // così l'albero delle altre foto resta com'era.
  "Risorse/Ciclo dell'acqua.svg": [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 1600 1000\" width=\"1600\" height=\"1000\">",
    "  <title>Il ciclo dell'acqua</title>",
    "  <desc>Il sole scalda il mare e l'acqua sale in vapore; le nuvole portano la pioggia sui monti, e il fiume la riporta al mare.</desc>",
    "  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"1600\" height=\"1000\" fill=\"#ffffff\"/>",
    "  <g id=\"l7c1a0e2b\" fub:layer=\"Livello 1\">",
    "    <rect id=\"o2k8d4m1s\" x=\"80\" y=\"780\" width=\"900\" height=\"160\" fill=\"none\" stroke=\"#0072b2\" stroke-width=\"4\"/>",
    "    <ellipse id=\"o5v1c9h3t\" cx=\"220\" cy=\"180\" rx=\"90\" ry=\"90\" fill=\"none\" stroke=\"#d55e00\" stroke-width=\"8\"/>",
    "    <line id=\"o3m7q2w8e\" x1=\"1000\" y1=\"820\" x2=\"1260\" y2=\"380\" stroke=\"#009e73\" stroke-width=\"4\" stroke-linecap=\"round\"/>",
    "    <line id=\"o9r4t6y1u\" x1=\"1260\" y1=\"380\" x2=\"1520\" y2=\"820\" stroke=\"#009e73\" stroke-width=\"4\" stroke-linecap=\"round\"/>",
    "    <ellipse id=\"o1p6a3s7d\" cx=\"1170\" cy=\"215\" rx=\"190\" ry=\"75\" fill=\"none\" stroke=\"#000000\" stroke-width=\"4\"/>",
    "    <path id=\"o8f2g5h9j\" fub:shape=\"arrow\" fub:geom=\"600 760 950 260\" d=\"M600 760 L950 260 M948.43 277.93 L950 260 L933.69 267.61\" fill=\"none\" stroke=\"#000000\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
    "    <path id=\"o4k7l1z3x\" fub:shape=\"arrow\" fub:geom=\"300 260 420 730\" d=\"M300 260 L420 730 M407.42 717.12 L420 730 L424.86 712.67\" fill=\"none\" stroke=\"#d55e00\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
    "    <path id=\"o6c2v8b5n\" fub:tool=\"pen\" fub:at=\"2026-10-03T09:12:04.120Z\" fub:brush=\"pf1 size=8 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=1\" d=\"M1252.12 420.76 Q1252.03 421.01 1249.6 425.79 Q1247.17 430.56 1243.73 437.38 Q1240.29 444.2 1236.43 451.89 Q1232.57 459.57 1228.53 467.63 Q1224.48 475.68 1220.36 483.89 Q1216.24 492.1 1212.09 500.39 Q1207.94 508.67 1202.71 515.24 Q1197.47 521.81 1191.88 527.48 Q1186.28 533.15 1180.54 538.44 Q1174.8 543.72 1169 548.84 Q1163.2 553.96 1157.39 559.01 Q1151.57 564.06 1145.76 569.07 Q1139.94 574.07 1136.24 580.75 Q1132.53 587.42 1129.49 595.03 Q1126.44 602.64 1123.71 610.67 Q1120.97 618.7 1118.37 626.91 Q1115.76 635.11 1113.22 643.39 Q1110.68 651.67 1108.15 660 Q1105.62 668.32 1100.1 675.97 Q1094.57 683.62 1087.89 690.69 Q1081.21 697.75 1074.06 704.58 Q1066.9 711.41 1059.55 718.14 Q1052.2 724.87 1044.76 731.57 Q1037.32 738.27 1029.85 744.95 Q1022.38 751.62 1015.77 756.44 Q1009.16 761.26 1002.99 765.23 Q996.81 769.2 990.83 772.81 Q984.84 776.41 978.94 779.86 Q973.04 783.31 967.18 786.69 Q961.32 790.07 951.16 795.9 Q941 801.73 940.7 801.85 Q940.39 801.96 940.07 801.97 Q939.74 801.98 939.43 801.89 Q939.12 801.8 938.86 801.61 Q938.59 801.42 938.4 801.16 Q938.21 800.9 938.12 800.59 Q938.02 800.28 938.03 799.96 Q938.03 799.64 938.14 799.34 Q938.25 799.03 938.46 798.78 Q938.66 798.52 938.93 798.35 Q939.2 798.17 939.52 798.09 Q939.83 798.01 940.15 798.04 Q940.47 798.06 940.77 798.19 Q941.07 798.31 941.31 798.53 Q941.55 798.74 941.71 799.02 Q941.87 799.3 941.94 799.62 Q942 799.93 941.96 800.26 Q941.92 800.58 941.78 800.87 Q941.63 801.16 941.41 801.39 Q941.18 801.62 940.89 801.77 Q940.6 801.91 940.28 801.96 Q939.96 802 939.64 801.94 Q939.32 801.88 939.04 801.73 Q938.76 801.57 938.54 801.33 Q938.32 801.09 938.19 800.79 Q938.06 800.49 938.04 800.17 Q938.01 799.85 938.09 799.54 Q938.16 799.22 938.33 798.95 Q938.5 798.67 938.76 798.47 Q939.01 798.27 939.01 798.27 Q939 798.27 949.17 792.44 Q959.33 786.6 965.18 783.23 Q971.02 779.85 976.9 776.42 Q982.78 772.98 988.72 769.41 Q994.65 765.83 1000.73 761.93 Q1006.81 758.02 1013.26 753.33 Q1019.71 748.64 1027.18 741.97 Q1034.65 735.29 1042.08 728.61 Q1049.5 721.92 1056.82 715.22 Q1064.14 708.51 1071.23 701.76 Q1078.31 695 1084.83 688.13 Q1091.34 681.26 1096.59 674.18 Q1101.83 667.1 1104.34 658.8 Q1106.85 650.49 1109.4 642.2 Q1111.95 633.9 1114.57 625.66 Q1117.18 617.41 1119.95 609.28 Q1122.72 601.15 1125.88 593.3 Q1129.04 585.45 1133.16 578.27 Q1137.27 571.09 1143.11 566.06 Q1148.94 561.03 1154.74 555.99 Q1160.54 550.94 1166.31 545.85 Q1172.07 540.75 1177.74 535.53 Q1183.4 530.31 1188.86 524.8 Q1194.31 519.28 1199.31 513.06 Q1204.3 506.83 1208.44 498.55 Q1212.57 490.27 1216.67 482.05 Q1220.77 473.82 1224.79 465.76 Q1228.81 457.69 1232.64 449.99 Q1236.47 442.28 1239.86 435.45 Q1243.25 428.61 1245.61 423.8 Q1247.97 418.99 1248.13 418.76 Q1248.28 418.53 1248.48 418.35 Q1248.68 418.16 1248.92 418.03 Q1249.16 417.9 1249.42 417.83 Q1249.68 417.76 1249.96 417.76 Q1250.23 417.75 1250.5 417.81 Q1250.76 417.87 1251.01 417.99 Q1251.25 418.11 1251.46 418.29 Q1251.66 418.47 1251.82 418.69 Q1251.98 418.91 1252.09 419.16 Q1252.19 419.41 1252.23 419.69 Q1252.26 419.96 1252.24 420.23 Q1252.21 420.5 1252.12 420.76 Z\" fill=\"#0072b2\" fub:ink=\"1 s100 cxyt 125000,42000,0 -833,1667,8 -834,1666,8 -833,1667,8 -833,1667,8 -834,1666,8 -833,1667,8 -1167,1000,8 -1166,1000,8 -1167,1000,8 -1167,1000,8 -1166,1000,8 -1167,1000,8 -500,1667,8 -500,1666,8 -500,1667,8 -500,1667,8 -500,1666,8 -500,1667,8 -1500,1333,8 -1500,1334,8 -1500,1333,8 -1500,1333,8 -1500,1334,8 -1500,1333,8 -1167,667,8 -1166,666,8 -1167,667,8 -1167,667,8 -1166,666,8 -1167,667,8\"/>",
    "    <path id=\"o7m3n9b2v\" fub:tool=\"pen\" fub:at=\"2026-10-03T09:12:09.480Z\" fub:brush=\"pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=1\" d=\"M1081.16 320.31 Q1081.12 320.45 1080.14 322.84 Q1079.15 325.22 1077.77 328.63 Q1076.38 332.03 1074.83 335.87 Q1073.28 339.71 1071.66 343.74 Q1070.03 347.77 1068.38 351.88 Q1066.73 355.98 1063.85 363.18 Q1060.96 370.38 1060.87 370.53 Q1060.78 370.67 1060.66 370.78 Q1060.53 370.88 1060.38 370.95 Q1060.22 371.01 1060.06 371.02 Q1059.89 371.02 1059.73 370.98 Q1059.57 370.93 1059.43 370.84 Q1059.29 370.75 1059.19 370.62 Q1059.09 370.48 1059.04 370.33 Q1058.98 370.17 1058.98 370 Q1058.98 369.83 1059.04 369.68 Q1059.09 369.52 1059.19 369.39 Q1059.29 369.25 1059.43 369.16 Q1059.57 369.06 1059.73 369.02 Q1059.89 368.98 1060.06 368.99 Q1060.22 368.99 1060.38 369.06 Q1060.53 369.12 1060.66 369.23 Q1060.79 369.33 1060.88 369.48 Q1060.96 369.62 1061 369.79 Q1061.03 369.95 1061.01 370.12 Q1060.99 370.28 1060.92 370.43 Q1060.85 370.58 1060.74 370.7 Q1060.62 370.82 1060.48 370.9 Q1060.33 370.98 1060.17 371.01 Q1060 371.03 1059.84 371.01 Q1059.67 370.98 1059.53 370.9 Q1059.38 370.82 1059.27 370.7 Q1059.15 370.58 1059.08 370.43 Q1059.01 370.27 1058.99 370.11 Q1058.97 369.94 1059.01 369.78 Q1059.04 369.62 1061.92 362.42 Q1064.8 355.21 1066.44 351.1 Q1068.07 346.98 1069.67 342.95 Q1071.27 338.91 1072.8 335.06 Q1074.32 331.21 1075.67 327.79 Q1077.02 324.36 1077.95 321.96 Q1078.88 319.55 1078.95 319.43 Q1079.02 319.3 1079.12 319.19 Q1079.22 319.08 1079.34 319 Q1079.46 318.92 1079.6 318.87 Q1079.73 318.82 1079.88 318.81 Q1080.02 318.79 1080.17 318.81 Q1080.31 318.83 1080.45 318.89 Q1080.58 318.94 1080.7 319.03 Q1080.82 319.11 1080.91 319.22 Q1081 319.33 1081.07 319.46 Q1081.13 319.59 1081.17 319.74 Q1081.2 319.88 1081.2 320.03 Q1081.19 320.17 1081.16 320.31 Z\" fill=\"#0072b2\" fub:ink=\"1 s100 cxyt 108000,32000,0 -333,833,8 -334,834,8 -333,833,8 -333,833,8 -334,834,8 -333,833,8\"/>",
    "    <path id=\"o2q8w4e6r\" fub:tool=\"pen\" fub:at=\"2026-10-03T09:12:10.020Z\" fub:brush=\"pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=1\" d=\"M1151.16 320.31 Q1151.12 320.45 1150.14 322.84 Q1149.15 325.22 1147.77 328.63 Q1146.38 332.03 1144.83 335.87 Q1143.28 339.71 1141.66 343.74 Q1140.03 347.77 1138.38 351.88 Q1136.73 355.98 1133.85 363.18 Q1130.96 370.38 1130.87 370.53 Q1130.78 370.67 1130.66 370.78 Q1130.53 370.88 1130.38 370.95 Q1130.22 371.01 1130.06 371.02 Q1129.89 371.02 1129.73 370.98 Q1129.57 370.93 1129.43 370.84 Q1129.29 370.75 1129.19 370.62 Q1129.09 370.48 1129.04 370.33 Q1128.98 370.17 1128.98 370 Q1128.98 369.83 1129.04 369.68 Q1129.09 369.52 1129.19 369.39 Q1129.29 369.25 1129.43 369.16 Q1129.57 369.06 1129.73 369.02 Q1129.89 368.98 1130.06 368.99 Q1130.22 368.99 1130.38 369.06 Q1130.53 369.12 1130.66 369.23 Q1130.79 369.33 1130.88 369.48 Q1130.96 369.62 1131 369.79 Q1131.03 369.95 1131.01 370.12 Q1130.99 370.28 1130.92 370.43 Q1130.85 370.58 1130.74 370.7 Q1130.62 370.82 1130.48 370.9 Q1130.33 370.98 1130.17 371.01 Q1130 371.03 1129.84 371.01 Q1129.67 370.98 1129.53 370.9 Q1129.38 370.82 1129.27 370.7 Q1129.15 370.58 1129.08 370.43 Q1129.01 370.27 1128.99 370.11 Q1128.97 369.94 1129.01 369.78 Q1129.04 369.62 1131.92 362.42 Q1134.8 355.21 1136.44 351.1 Q1138.07 346.98 1139.67 342.95 Q1141.27 338.91 1142.8 335.06 Q1144.32 331.21 1145.67 327.79 Q1147.02 324.36 1147.95 321.96 Q1148.88 319.55 1148.95 319.43 Q1149.02 319.3 1149.12 319.19 Q1149.22 319.08 1149.34 319 Q1149.46 318.92 1149.6 318.87 Q1149.73 318.82 1149.88 318.81 Q1150.02 318.79 1150.17 318.81 Q1150.31 318.83 1150.45 318.89 Q1150.58 318.94 1150.7 319.03 Q1150.82 319.11 1150.91 319.22 Q1151 319.33 1151.07 319.46 Q1151.13 319.59 1151.17 319.74 Q1151.2 319.88 1151.2 320.03 Q1151.19 320.17 1151.16 320.31 Z\" fill=\"#0072b2\" fub:ink=\"1 s100 cxyt 115000,32000,0 -333,833,8 -334,834,8 -333,833,8 -333,833,8 -334,834,8 -333,833,8\"/>",
    "    <path id=\"o5t1y7u3i\" fub:tool=\"pen\" fub:at=\"2026-10-03T09:12:10.560Z\" fub:brush=\"pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=1\" d=\"M1221.16 320.31 Q1221.12 320.45 1220.14 322.84 Q1219.15 325.22 1217.77 328.63 Q1216.38 332.03 1214.83 335.87 Q1213.28 339.71 1211.66 343.74 Q1210.03 347.77 1208.38 351.88 Q1206.73 355.98 1203.85 363.18 Q1200.96 370.38 1200.87 370.53 Q1200.78 370.67 1200.66 370.78 Q1200.53 370.88 1200.38 370.95 Q1200.22 371.01 1200.06 371.02 Q1199.89 371.02 1199.73 370.98 Q1199.57 370.93 1199.43 370.84 Q1199.29 370.75 1199.19 370.62 Q1199.09 370.48 1199.04 370.33 Q1198.98 370.17 1198.98 370 Q1198.98 369.83 1199.04 369.68 Q1199.09 369.52 1199.19 369.39 Q1199.29 369.25 1199.43 369.16 Q1199.57 369.06 1199.73 369.02 Q1199.89 368.98 1200.06 368.99 Q1200.22 368.99 1200.38 369.06 Q1200.53 369.12 1200.66 369.23 Q1200.79 369.33 1200.88 369.48 Q1200.96 369.62 1201 369.79 Q1201.03 369.95 1201.01 370.12 Q1200.99 370.28 1200.92 370.43 Q1200.85 370.58 1200.74 370.7 Q1200.62 370.82 1200.48 370.9 Q1200.33 370.98 1200.17 371.01 Q1200 371.03 1199.84 371.01 Q1199.67 370.98 1199.53 370.9 Q1199.38 370.82 1199.27 370.7 Q1199.15 370.58 1199.08 370.43 Q1199.01 370.27 1198.99 370.11 Q1198.97 369.94 1199.01 369.78 Q1199.04 369.62 1201.92 362.42 Q1204.8 355.21 1206.44 351.1 Q1208.07 346.98 1209.67 342.95 Q1211.27 338.91 1212.8 335.06 Q1214.32 331.21 1215.67 327.79 Q1217.02 324.36 1217.95 321.96 Q1218.88 319.55 1218.95 319.43 Q1219.02 319.3 1219.12 319.19 Q1219.22 319.08 1219.34 319 Q1219.46 318.92 1219.6 318.87 Q1219.73 318.82 1219.88 318.81 Q1220.02 318.79 1220.17 318.81 Q1220.31 318.83 1220.45 318.89 Q1220.58 318.94 1220.7 319.03 Q1220.82 319.11 1220.91 319.22 Q1221 319.33 1221.07 319.46 Q1221.13 319.59 1221.17 319.74 Q1221.2 319.88 1221.2 320.03 Q1221.19 320.17 1221.16 320.31 Z\" fill=\"#0072b2\" fub:ink=\"1 s100 cxyt 122000,32000,0 -333,833,8 -334,834,8 -333,833,8 -333,833,8 -334,834,8 -333,833,8\"/>",
    "  </g>",
    "</svg>",
    "",
  ].join("\n"),

};

// ---------------------------------------------------------------------------
// I file che **non** sono documenti.
// ---------------------------------------------------------------------------

/// Byte veri: l'host finto decide la specie dall'estensione, come il §14.1
/// dice che si decide, l'esploratore li disegna accanto alle note e le porte
/// risorsa li servono davvero — un'immagine citata da una nota si vede.
/// `schema.png` è uno schema di 240×150 a palette: tre riquadri e le frecce.
export const RESOURCES: Record<string, { bytes: Uint8Array }> = {
  "Risorse/schema.png": { bytes: base64("iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAMAAADXJvXnAAAAElBMVEX49vHEzdtcbozs8PfWelT///+HEQvFAAABnElEQVR42u3ay27DMAxEUYNN//+Xa2+yLWRSfGjurANwDsA6TqXrIoQQQgghhBBCCCHkiNjrTGxiznTQLjS5P/fjShg5p4l7Spg4qYl/yjMnBpzRJGJKjDipSciUe04AOKeJGtiixliPjf63CWDAgAEDBgz4O14ObHJgkwObHNiGgr3/iQLMSvPQ4muJFw9eLfnxABgwYMCtwZwtnQ9WOy6VOxDXu/Igd6lF79qS4MW0hV+t1fcF8+4ltuDm1WhAzq5QLS6YX0mumV2213V/UCWTa58f+cPLH5e5BTp8ISauWJMXgKweXbhZm9aIm1GnGXf3wlk/785WPbn79q4td0+51tz49bPu3tiOE7iRWziEG1V1EDdiGW2W19t4Hte3kyO574uP5b5bTZvsXe8/nbtKmM9dE5/AXXJM935eR0s70nw3/nVlGNntnSb2ex+xlneUOMR7iwEfvdGDdhowYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGvFXM2dLpYLXjUrkDcb0rD3KXWi65a0tO80UIIYQQQgghhJDI/AHm73+1IPHBOAAAAABJRU5ErkJggg==") },
};

function base64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// La nota lunga, generata.
// ---------------------------------------------------------------------------

/// Un generatore deterministico a 32 bit (xorshift). **Non** `Math.random`: due
/// corse dello stesso banco devono produrre lo stesso testo, o il diff fra una
/// foto e la sua baseline non misura più il CSS.
function seed(s: number): () => number {
  let x = s >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const WORDS = [
  "foglio", "pelle", "struttura", "banco", "scena", "luce", "token", "contrasto",
  "soglia", "baseline", "corpus", "moto", "gradino", "ombra", "velo", "fondo",
  "inchiostro", "misura", "cancello", "presidio", "verbale", "seduta", "voce",
  "riquadro", "cornice", "margine", "ritmo", "scala", "carattere", "riga",
];

/// Diecimila parole in paragrafi da quaranta. Il numero non è tondo per vezzo:
/// è l'ordine di grandezza di una nota vera che qualcuno abbia scritto per un
/// anno, cioè il caso in cui una misura di larghezza sbagliata si vede e una
/// nota di prova da dieci righe non la mostrerebbe mai.
function longNote(): string {
  const rnd = seed(31_1);
  const rows: string[] = ["# Una nota lunga", ""];
  let words = 0;
  let section = 1;
  while (words < 10_000) {
    if (words > 0 && words % 1_000 < 40) {
      rows.push(`## Sezione ${section}`, "");
      section += 1;
    }
    const n = 40;
    const p: string[] = [];
    for (let i = 0; i < n; i += 1) p.push(WORDS[Math.floor(rnd() * WORDS.length)]!);
    p[0] = p[0]!.charAt(0).toUpperCase() + p[0]!.slice(1);
    rows.push(`${p.join(" ")}.`, "");
    words += n;
  }
  return rows.join("\n");
}

CORPUS["Guida/Nota lunga.md"] = longNote();

// ---------------------------------------------------------------------------
// La resa: l'HTML che il kernel emetterebbe.
// ---------------------------------------------------------------------------

/// Ciò che `render_preview` risponde, per i documenti che una scena legge in
/// modalità Lettura. Chi non è qui dentro si rende come paragrafo unico —
/// l'host finto sa già farlo, ed è la risposta onesta per una nota che nessuna
/// scena fotografa resa.
export const OUTPUT: Record<string, string> = {
  "Benvenuto.md": [
    "<h1>Benvenuto in Fub</h1>",
    "<p>Questa è la nota che il banco apre per prima. Serve a fotografare lo",
    "stato normale: un titolo, due paragrafi di prosa, un elenco e un paio di",
    "riferimenti — cioè quello che si vede il novantanove per cento del tempo.</p>",
    '<p>La sintassi per intero sta in <a class="wikilink" data-wikilink-page="Sintassi di Fub" href="#">Sintassi di Fub</a>,',
    'i colori dei linguaggi in <a class="wikilink" data-wikilink-page="Frammenti di codice" href="#">Frammenti di codice</a>.',
    '<span class="tag" data-tag="tema">#tema</span> <span class="tag" data-tag="banco">#banco</span></p>',
    "<ul><li>Un elenco corto</li><li>con tre voci</li><li>e nient'altro dentro</li></ul>",
    "<blockquote><p>Ciò che non si guarda non si migliora.</p></blockquote>",
  ].join("\n"),

  "Guida/Sintassi di Fub.md": [
    "<h1>Sintassi di Fub</h1>",
    "<h2>Titoli</h2>",
    "<h3>Terzo livello</h3>",
    "<h4>Quarto livello</h4>",
    "<h5>Quinto livello</h5>",
    "<h6>Sesto livello</h6>",
    "<h2>Testo</h2>",
    "<p>Prosa normale, con <strong>grassetto</strong>, <em>corsivo</em>,",
    "<del>barrato</del>, <code>codice in riga</code>,",
    '<span class="inline-highlight">evidenziato</span>, un<sup>apice</sup> e una',
    'nota a piè di pagina<sup class="footnote-ref" data-label="1">1</sup>.</p>',
    "<h2>Riferimenti</h2>",
    '<p>Un wikilink risolto: <a class="wikilink" data-wikilink-page="Benvenuto" href="#">Benvenuto</a>.',
    'Uno con alias: <a class="wikilink" data-wikilink-page="Frammenti di codice" href="#">i frammenti</a>.',
    'Un tag: <span class="tag" data-tag="sintassi">#sintassi</span>. Un link esterno:',
    '<a href="https://commonmark.org">la specifica</a>.</p>',
    "<h2>Elenchi</h2>",
    "<ol><li>Primo</li><li>Secondo</li><li>Terzo</li></ol>",
    '<ul><li class="task" data-task=" "><input type="checkbox" disabled aria-label="Attività da completare">Da fare</li>',
    '<li class="task" data-task="x"><input type="checkbox" disabled checked aria-label="Attività completata">Fatto</li></ul>',
    "<h2>Citazione</h2>",
    "<blockquote><p>Un paragrafo citato, che va a capo e continua sulla riga dopo.</p></blockquote>",
    "<h2>Callout</h2>",
    '<div class="callout" data-callout="note"><div class="callout-title">Una nota</div>',
    "<p>Il corpo del callout.</p></div>",
    '<div class="callout" data-callout="warning"><div class="callout-title">Un avvertimento</div>',
    "<p>Il corpo del secondo.</p></div>",
    "<h2>Tabella</h2>",
    "<table><thead><tr><th>Strato</th><th>Di chi è</th><th>Si sostituisce</th></tr></thead>",
    '<tbody><tr><td style="text-align:left">struttura</td><td style="text-align:center">della scocca</td><td style="text-align:right">no</td></tr>',
    '<tr><td style="text-align:left">foglio</td><td style="text-align:center">del tema</td><td style="text-align:right">sì</td></tr>',
    '<tr><td style="text-align:left">pelle</td><td style="text-align:center">del tema</td><td style="text-align:right">sì</td></tr></tbody></table>',
    "<h2>Codice</h2>",
    '<pre><code class="language-rust">pub fn contrasto(a: &amp;str, b: &amp;str) -&gt; f64 {',
    "    let (x, y) = (luminanza(a), luminanza(b));",
    "    (x.max(y) + 0.05) / (x.min(y) + 0.05)",
    "}",
    "</code></pre>",
    "<hr>",
    "<p>E una riga dopo la linea.</p>",
  ].join("\n"),
};
