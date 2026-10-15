// Ciò che la shell Scrittoio dichiara **prima** che la shell comune si avvii.
//
// Sta in un modulo suo perché l'ordine conta e gli `import` sono l'unico modo
// di imporlo: `bootstrap.ts` importa questo file prima di `desktop-shell`, che
// all'import legge capacità e tema. Una dichiarazione fatta nel corpo di
// `bootstrap.ts` arriverebbe dopo, a tema già montato.
import { declareShell } from "../../platform/capabilities";
import { SCRITTOIO_SERIES } from "../../theme/scrittoio/series";
import { declareThemeSeries } from "../../theme/theme";
import { DESKTOP_SHELL } from "../desktop/index";

declareShell(DESKTOP_SHELL);
declareThemeSeries(SCRITTOIO_SERIES);
