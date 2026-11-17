// Ciò che si apre da una riga delle proprietà: gli editor dei valori
// (`editors.ts`) e il menu della proprietà (`menu.ts`). `row.ts` lo carica con
// un `import()`, perché serve soltanto dopo un clic e non all'apertura di una
// nota. Un modulo solo, e quindi un chunk solo.
export { openEditor, toggleCheckbox } from "./editors";
export { openPropertyMenu } from "./menu";
