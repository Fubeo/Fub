// Il palco: il server, il browser, e **le sei cose che il banco tiene ferme**.
//
// Le usano in due — il fotografo (`foto.mjs`) e il controllo di accessibilità
// (`a11y.mjs`) — e stanno qui perché una stabilità dichiarata in due posti è
// una stabilità che divergerà: basterebbe che uno dei due scattasse in un altro
// fuso, e metà delle sue misure smetterebbe di parlare delle stesse immagini.
//
// # La stabilità è una decisione, non un'impostazione (§31.1)
//
// Sono sei, e ognuna è qui perché senza di lei il banco sfarfalla — e un banco
// visivo che sfarfalla si spegne da solo entro tre settimane, perché il primo
// rosso che nessuno sa spiegare insegna a non guardarlo più.
//
// 1. **Il browser è pinnato.** `playwright` è in `package.json` senza `^`: la
//    revisione di Chromium **è parte della baseline**, e una minore che cambia
//    il rasterizzatore invalida quaranta PNG senza che sia cambiata una riga di
//    CSS. Si alza a mano, rifotografando.
// 2. **I caratteri si aspettano.** `document.fonts.ready` prima di ogni scatto:
//    senza, si fotografa il ripiego di sistema per i primi fotogrammi, e quale
//    fotogramma tocchi dipende dal carico della macchina.
// 3. **L'ora è congelata.** La barra di stato e gli avvisi scrivono un orario,
//    e un orologio che gira è un pixel che cambia a ogni corsa.
// 4. **Il moto è ridotto.** `reducedMotion: "reduce"`, che è ciò che
//    `structure.css` già ascolta: si fotografa lo stato d'arrivo e mai un
//    fotogramma di transizione.
// 5. **La lingua è l'italiano.** Il locale del sistema decide quello della
//    shell, e un banco che gira in `en-US` fotografa un'app in inglese —
//    è successo alla prima corsa di questo file.
// 6. **La finestra è una.** Viewport fisso e `deviceScaleFactor: 1`: la
//    baseline è per una misura, non per lo schermo di chi passa.
//
// La settima non sta qui perché non è del palco: le baseline sono **solo
// Linux**. Il perché sta in `foto.mjs`, accanto alla soglia.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

/// L'istante congelato. Un martedì mattina d'agosto, cioè un momento qualunque:
/// conta che sia sempre lo stesso, non quale sia.
export const MOMENT = new Date("2026-08-19T09:30:00+02:00");

/// La finestra del banco. 1280×800 è la più piccola misura su cui questa shell
/// abbia ancora tre colonne: sotto, la sidebar destra si chiude e metà delle
/// scene fotograferebbe un layout diverso invece di un tema diverso.
export const WINDOW = { width: 1280, height: 800 };

/// Il fuso, il locale, la lingua: tre cose che decidono del testo a schermo e
/// che nessuna macchina ha uguali all'altra.
const TIMEZONE = "Europe/Rome";
const LOCALE = "it-IT";

/// Ciò che si spegne prima di scattare, e la sola cosa che il banco cambia
/// nella pagina.
///
/// Il cursore di CodeMirror **lampeggia**: è un'animazione sua, non passa dai
/// token del moto e quindi `prefers-reduced-motion` non la tocca. Due scatti
/// della stessa scena a mezzo secondo di distanza differiscono di quaranta
/// pixel, e quaranta pixel che vanno e vengono sono il modo in cui un banco
/// visivo diventa «ogni tanto rosso». Si nasconde il livello, non il tema:
/// quello che si fotografa resta il CSS vero.
const QUIET = `
  .cm-cursorLayer { visibility: hidden !important; }
`;

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

/// La cartella delle baseline, versionata.
export const BASELINE = here("./baseline");
/// La cartella di ciò che una corsa produce. Non versionata: è il referto, non
/// il termine di paragone.
export const OUTPUT = here("./.output");

/// Apre il palco: server di Vite e browser. Restituisce anche come si chiude,
/// perché un banco che lascia in giro un server è un banco che alla seconda
/// corsa non parte.
export async function openStage({ quiet = true } = {}) {
  const server = await createServer({
    configFile: here("../vite.bench.config.ts"),
    logLevel: quiet ? "warn" : "info",
  });
  await server.listen();
  const base = `http://localhost:${server.config.server.port}`;

  const browser = await chromium.launch({
    args: [
      // Tre bandiere che tolgono al rasterizzatore ciò che dipende dalla
      // macchina: l'hinting dei caratteri, il subpixel antialiasing (che
      // colora i bordi delle lettere secondo la disposizione dei subpixel di
      // *quello* schermo) e il profilo colore del monitor.
      "--font-render-hinting=none",
      "--disable-lcd-text",
      "--force-color-profile=srgb",
      // La memoria condivisa piccola dei container fa cadere Chromium a metà
      // corsa, e cade in un modo che somiglia a un guasto della pagina.
      "--disable-dev-shm-usage",
    ],
  });

  return {
    base,
    browser,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/// Una pagina pronta a fotografare, in una luce.
///
/// `colorScheme` segue la luce **anche se** il tema non la legge da lì: la shell
/// risolve la propria luce dall'impostazione, non da `prefers-color-scheme`
/// (`theme.ts` spiega perché). Metterle d'accordo lo stesso toglie di mezzo
/// l'unica cosa che potrebbe ancora differire — la resa dei controlli nativi,
/// che il sistema disegna secondo *quella* preferenza e non secondo la nostra.
export async function openPage(browser, light) {
  const context = await browser.newContext({
    viewport: WINDOW,
    deviceScaleFactor: 1,
    locale: LOCALE,
    timezoneId: TIMEZONE,
    reducedMotion: "reduce",
    colorScheme: light,
  });
  const page = await context.newPage();
  // Prima di ogni navigazione: si installa come script d'avvio, quindi la
  // pagina nasce già con l'ora ferma. Dopo il `goto` sarebbe tardi — chi legge
  // l'orologio lo legge montandosi.
  await page.clock.setFixedTime(MOMENT);
  return page;
}
