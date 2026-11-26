// I metodi di una classe divisa in più file.
//
// I due motori (la Lavagna, `editors/canvas/engine.ts`, e la griglia,
// `editors/grid/engine.ts`) sono una classe ciascuno, con migliaia di righe di
// metodi che leggono gli stessi campi. Per tenerli in file per tema senza
// riscriverne i corpi, un gruppo di metodi sta in un oggetto in
// `engine-<tema>.ts`, coi metodi scritti come nella classe e `this: Motore`
// in testa ai parametri:
//
//   export const cropMethods = {
//     _beginCrop(this: CanvasEngine, id: string): void { … },
//   };
//   export type CropMethods = typeof cropMethods;
//
// e accanto alla classe due righe di colla:
//
//   export interface CanvasEngine extends CropMethods {}
//   mixMethods(CanvasEngine.prototype, cropMethods);
//
// I metodi finiscono sul prototipo come quelli scritti nella classe: non
// enumerabili, scrivibili e configurabili, gli stessi per ogni istanza (un
// ascoltatore tolto con `removeEventListener` trova la stessa funzione). Un
// nome che il prototipo ha già è un errore: due pacchetti non si coprono a
// vicenda in silenzio, e un pacchetto non copre un metodo della classe.
// I getter e i setter restano nella classe (in un oggetto non possono
// dichiarare `this`).

/// Mette i metodi di `methods` sul prototipo `target`, come metodi di classe.
export function mixMethods(target: object, methods: object): void {
  const descriptors = Object.getOwnPropertyDescriptors(methods);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      throw new Error(`mixMethods: «${name}» c'è già sul prototipo`);
    }
    if (typeof descriptor.value !== "function") {
      throw new Error(`mixMethods: «${name}» non è un metodo`);
    }
    descriptors[name] = { value: descriptor.value, writable: true, configurable: true, enumerable: false };
  }
  Object.defineProperties(target, descriptors);
}
