// Il cursore morbido (`editor.soft-cursor`, N13): nei Blocchi il cursore
// scivola fra due posizioni invece di saltare. Spento di serie. Il facet sta
// qui perché lo scrive il motore, che non conosce i profili; lo legge il moto
// dei Blocchi (`profiles/markdown/blocks/motion.ts`).
import { Facet } from "@codemirror/state";

export const softCursor = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });
