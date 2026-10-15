// Vite entra da qui (`index.html`). La logica di avvio appartiene alla shell:
// lo Scrittoio dichiara shell e serie prima che la shell comune si avvii, e
// porta con sé il suo foglio di struttura.
//
// Esporta `startup` perché l'avvio sia osservabile: i test e il banco lo
// aspettano.
export { startup } from "./shells/scrittoio/bootstrap";
