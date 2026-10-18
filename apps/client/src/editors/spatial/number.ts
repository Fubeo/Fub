// I numeri del formato dell'inchiostro e della scena stanno nel nucleo
// dell'inchiostro (`ink/number.ts`), perché i tipi del tratto li usano e il
// nucleo non può dipendere da un editor. Chi scrive la scena li importa da
// qui come prima.
export * from "../../ink/number";
