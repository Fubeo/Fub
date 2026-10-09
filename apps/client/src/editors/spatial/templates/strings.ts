// Le stringhe della galleria di «Nuovo disegno».
//
// Arrivano con la galleria, che la shell carica con un `import()` quando
// qualcuno chiede un disegno nuovo (`gallery.ts`): chi non ne crea uno non le
// scarica. La lingua, la scala di ripiego, i nomi fra graffe sono quelli della
// shell (`catalog` in `i18n/strings.ts`). I nomi dei modelli non stanno qui:
// li dà il comando, con le sue scelte; qui c'è soltanto il ripiego di «Vuoto»
// e le righe che dicono a che cosa serve ogni modello.

import { catalog } from "../../../i18n/strings";

/// Il catalogo italiano, che è anche la forma dell'inglese.
const IT = {
  "draw.new.title": "Nuovo disegno",
  "draw.new.name": "Nome",
  "draw.new.name.placeholder": "Disegno",
  "draw.new.folder": "Cartella",
  "draw.new.folder.placeholder": "Radice del vault",
  "draw.new.templates": "Modello",
  "draw.new.vault": "Dal vault",
  "draw.new.vault.in_folder": "I disegni della cartella «{folder}»: se ne crea una copia, l’originale non cambia.",
  "draw.new.vault.in_root": "I disegni della radice del vault: se ne crea una copia, l’originale non cambia.",
  "draw.new.vault.empty": "Nella cartella «{folder}» non c’è ancora nessun disegno. Mettici quelli da copiare e compariranno qui; la cartella si cambia nelle impostazioni del disegno.",
  "draw.new.vault.empty_root": "Nella radice del vault non c’è ancora nessun disegno. Mettici quelli da copiare e compariranno qui; la cartella si cambia nelle impostazioni del disegno.",
  "draw.new.create": "Crea",
  "draw.new.blank": "Vuoto",
  "draw.new.note.blank": "Un foglio libero, 1600 × 1000, per cominciare da zero.",
  "draw.new.note.a4-portrait": "Un foglio A4 in verticale, per ciò che poi si stampa.",
  "draw.new.note.a4-landscape": "Un foglio A4 in orizzontale, per schemi larghi e tabelle da stampare.",
  "draw.new.note.slide": "Una diapositiva 16:9 con il titolo e il sottotitolo da scrivere.",
  "draw.new.note.diagram": "Un diagramma di flusso già avviato, con il bivio Sì e No.",
  "draw.new.note.lesson": "Una lavagna a quadretti per la lezione, col titolo già al suo posto.",
  "draw.new.note.storyboard": "Sei scene 16:9 in fila, per raccontare per immagini.",
  "draw.new.note.concept-map": "Un argomento al centro e quattro idee attorno, già legate.",
} as const;

const EN: Readonly<Record<keyof typeof IT, string>> = {
  "draw.new.title": "New drawing",
  "draw.new.name": "Name",
  "draw.new.name.placeholder": "Drawing",
  "draw.new.folder": "Folder",
  "draw.new.folder.placeholder": "Vault root",
  "draw.new.templates": "Template",
  "draw.new.vault": "From the vault",
  "draw.new.vault.in_folder": "The drawings in the “{folder}” folder: you get a copy, and the original stays as it is.",
  "draw.new.vault.in_root": "The drawings in the vault root: you get a copy, and the original stays as it is.",
  "draw.new.vault.empty": "There are no drawings in the “{folder}” folder yet. Put the ones you want to copy there and they will show up here; you can change the folder in the drawing settings.",
  "draw.new.vault.empty_root": "There are no drawings in the vault root yet. Put the ones you want to copy there and they will show up here; you can change the folder in the drawing settings.",
  "draw.new.create": "Create",
  "draw.new.blank": "Blank",
  "draw.new.note.blank": "A free sheet, 1600 × 1000, to start from scratch.",
  "draw.new.note.a4-portrait": "An A4 sheet, portrait, for what you will print.",
  "draw.new.note.a4-landscape": "An A4 sheet, landscape, for wide diagrams and tables to print.",
  "draw.new.note.slide": "A 16:9 slide with a title and a subtitle to write.",
  "draw.new.note.diagram": "A flowchart to start from, with the Yes and No fork.",
  "draw.new.note.lesson": "A squared board for the lesson, with the title already in place.",
  "draw.new.note.storyboard": "Six 16:9 scenes in a row, to tell a story in pictures.",
  "draw.new.note.concept-map": "A topic in the middle and four ideas around it, already linked.",
};

/// Il catalogo della galleria: `t` come quello della shell, sulle chiavi sue.
export const galleryStrings = catalog(IT, { en: EN });
export const { t } = galleryStrings;
