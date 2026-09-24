// pdfjs-dist publishes types for the package entry, but not its minified build.
// The bundled build exports these same entry points; keep the import typed.
declare module "pdfjs-dist/build/pdf.min.mjs" {
  export { version, GlobalWorkerOptions, getDocument } from "pdfjs-dist";
}
