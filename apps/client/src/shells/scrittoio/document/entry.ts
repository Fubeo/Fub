// L'ingresso di `document.html`: la finestra documento con la serie
// dello Scrittoio. La struttura è quella dei fogli della finestra principale;
// la serie qui sotto è il ripiego, finché il ponte non porta il tema vero.
import "../../../theme/scrittoio/structure.css";
import "./document.css";
import fonts from "../../../theme/scrittoio/fonts.css?raw";
import sheetDark from "../../../theme/scrittoio/sheet-dark.css?raw";
import sheetLight from "../../../theme/scrittoio/sheet-light.css?raw";
import skin from "../../../theme/scrittoio/skin.css?raw";
import { bootDocumentWindow } from "./window";

bootDocumentWindow({ fonts, sheetLight, sheetDark, skin });

/// La finestra si monta in un giro solo: l'avvio è già finito. Lo esporta
/// perché sia osservabile come quello degli altri ingressi.
export const startup: Promise<void> = Promise.resolve();
