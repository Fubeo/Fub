// In che lingua gira il banco di prova (§12.4).
//
// Un presidio che guarda del testo scritto per una persona deve sapere **in
// che lingua** se lo aspetta, e dopo il catalogo della shell la risposta non è
// più ovvia: `t()` risolve sulla lingua di chi guarda, e nei test chi guarda è
// `navigator.language` — cioè il locale del sistema su cui gira `vitest`.
// Lasciato così, `scopeLabel` restituisce «scrive · più note» sulla macchina
// di chi ha scritto il presidio e «writes · several notes» su quella di
// chiunque altro, e la suite passa o fallisce **secondo chi la lancia**. È il
// difetto peggiore che un presidio possa avere: non dice il falso, dice cose
// diverse a persone diverse.
//
// Qui la si fissa, una volta, per tutta la suite: **l'italiano**, che è la
// lingua in cui questa shell è scritto e quella in cui i presidi scrivono le
// proprie attese. Chi vuole provare *la traduzione* — che è un'altra domanda —
// non passa da qui: passa da `catalogoPer`, che prende la lingua come
// argomento apposta (`i18n/strings.test.ts`).
//
// `navigator` ha un solo campo perché uno solo se ne legge. Il giorno che un
// presidio avrà bisogno degli appunti (`navigator.clipboard`, che
// `ui/intents.ts` usa) è qui che glielo si aggiunge, invece di in dodici file.
import { vi } from "vitest";

vi.stubGlobal("navigator", { language: "it-IT" });
