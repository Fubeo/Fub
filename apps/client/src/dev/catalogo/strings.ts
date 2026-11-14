// Le stringhe della pagina «Tutti i componenti».
//
// Arrivano con la pagina, che Aspetto carica con un `import()` quando la si
// apre: chi non la apre non le scarica. La lingua, la scala di ripiego, i nomi
// fra graffe e i plurali sono quelli della shell (`catalog` in
// `i18n/strings.ts`). Il nome del bottone che la apre e l'avviso di una pagina
// che non arriva restano nel catalogo della shell. I testi dei campioni del kit
// sono dati d'esempio, in italiano come nel banco.
import { catalog } from "../../i18n/strings";

const IT = {
  "page.title": "Tutti i componenti",
  "page.light": "Luce della pagina",
  "page.light.light": "Chiaro",
  "page.light.dark": "Scuro",
  "page.light.missing": "«{theme}» non ha la luce «{light}».",
  "page.contrast": "Contrasto alto",
  "page.close": "Chiudi «Tutti i componenti»",
  "page.tabs": "Che cosa guardare",
  "page.subtitle": "{theme} · {trust}",
  "page.subtitle.reloaded": "{theme} · {trust} · ricaricato alle {time}",
  "page.preview_failed": "La pagina non ha potuto cambiare luce o contrasto: {reason}",
  "tab.components": "Componenti",
  "tab.palette": "Tavolozza",
  "tab.fonts": "Caratteri",
  "tab.kit": "Primitivi del kit",
  "state.rest": "riposo",
  "state.hover": "passaggio",
  "state.pressed": "premuto",
  "state.selected": "selezionato",
  "state.focused": "a fuoco",
  "state.disabled": "disabilitato",
  "state.dragging": "trascinamento",
  "states.1": "Uno stato: {list}.",
  "states.2": "Due stati: {list}.",
  "states.3": "Tre stati: {list}.",
  "states.4": "Quattro stati: {list}.",
  "states.5": "Cinque stati: {list}.",
  "states.6": "Sei stati: {list}.",
  "states.7": "Sette stati: {list}.",
  "info.lede": "Pezzo {part}, strato {layer}. {states}",
  "info.view_lede": "Vista dei componenti: {kinds}. {states}",
  "info.views": "viste dei componenti",
  "info.no_hooks": "Nessun hook del tema.",
  "info.copy": "Copia gli hook",
  "info.copied": "Hook di «{name}» copiati.",
  "info.copy_failed": "Gli hook non si sono copiati: {reason}",
  "palette.contrast": "Contrasto di --text su --sheet: {text}:1. Di --muted su --sheet: {muted}:1 (serve almeno {minimum}).",
  "palette.unmeasured": "Il contrasto di --text e --muted su --sheet non si misura: uno dei colori non è pieno.",
  "fonts.stack.one": "{first}",
  "fonts.stack": "{first}, poi {second}",
  "fonts.sample.ui": "Il foglio è salvato. Tre schede, un filo.",
  "fonts.sample.reading": "La varianza misura quanto i dati si allontanano dalla media.",
  "fonts.sample.mono": "=MEDIA(B2:B40) · 0123456789",
} as const;

/// Una chiave del catalogo della pagina.
export type CatalogPageKey = keyof typeof IT;

const EN: Record<CatalogPageKey, string> = {
  "page.title": "All components",
  "page.light": "Page light",
  "page.light.light": "Light",
  "page.light.dark": "Dark",
  "page.light.missing": "“{theme}” has no {light} light.",
  "page.contrast": "High contrast",
  "page.close": "Close “All components”",
  "page.tabs": "What to look at",
  "page.subtitle": "{theme} · {trust}",
  "page.subtitle.reloaded": "{theme} · {trust} · reloaded at {time}",
  "page.preview_failed": "The page could not change light or contrast: {reason}",
  "tab.components": "Components",
  "tab.palette": "Palette",
  "tab.fonts": "Fonts",
  "tab.kit": "Kit primitives",
  "state.rest": "rest",
  "state.hover": "hover",
  "state.pressed": "pressed",
  "state.selected": "selected",
  "state.focused": "focused",
  "state.disabled": "disabled",
  "state.dragging": "dragging",
  "states.1": "One state: {list}.",
  "states.2": "Two states: {list}.",
  "states.3": "Three states: {list}.",
  "states.4": "Four states: {list}.",
  "states.5": "Five states: {list}.",
  "states.6": "Six states: {list}.",
  "states.7": "Seven states: {list}.",
  "info.lede": "Part {part}, layer {layer}. {states}",
  "info.view_lede": "Component view: {kinds}. {states}",
  "info.views": "component views",
  "info.no_hooks": "No theme hooks.",
  "info.copy": "Copy the hooks",
  "info.copied": "Hooks of “{name}” copied.",
  "info.copy_failed": "The hooks were not copied: {reason}",
  "palette.contrast": "Contrast of --text on --sheet: {text}:1. Of --muted on --sheet: {muted}:1 (at least {minimum} is needed).",
  "palette.unmeasured": "The contrast of --text and --muted on --sheet can't be measured: one of the colours is not solid.",
  "fonts.stack.one": "{first}",
  "fonts.stack": "{first}, then {second}",
  "fonts.sample.ui": "The sheet is saved. Three tabs, one thread.",
  "fonts.sample.reading": "Variance measures how far the data stray from the mean.",
  "fonts.sample.mono": "=AVERAGE(B2:B40) · 0123456789",
};

/// Il catalogo della pagina: `t` e `plural` come quelli della shell.
export const catalogPageStrings = catalog(IT, { en: EN });
export const { t } = catalogPageStrings;
