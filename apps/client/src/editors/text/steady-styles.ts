// Il foglio di CodeMirror si riscrive solo quando cambia.
//
// CodeMirror mette i suoi stili (il tema di base, i temi delle estensioni, le
// classi della sintassi) in un `<style>` del documento, con il nonce della
// pagina (`ui/stylesheets.ts`): lo fa `style-mod`, e a **ogni** editor che si
// monta (e a ogni riconfigurazione che cambia i suoi temi) ne riscrive tutto
// il testo, anche quando è lo stesso. In WebKitGTK un `<style>` riscritto è un
// foglio nuovo: il motore rilegge le sue 330 regole e ricalcola lo stile di
// tutto il documento, ~25 ms su una pagina di 3.000 elementi. Passare a una
// scheda che non ha un editor montato lo riscriveva più volte: più di metà del
// tempo del gesto (`F3.scheda.mainBlocked`, 67 ms di mediana).
//
// Qui la riscrittura con lo stesso testo non arriva al documento. Quando il
// testo cambia (un editor con un tema che il foglio non aveva) passa com'è.
// Perché il testo resti lo stesso, chi fa un tema non ne fa uno nuovo a ogni
// editor: `editorTheme` ne tiene uno per luce.

const steady = new WeakSet<Document>();

/// Dopo il montaggio di `view`: il `<style>` di CodeMirror nel suo documento
/// smette di riscriversi con il testo che ha già. Una volta per documento;
/// le chiamate dopo non fanno niente. Un editor dentro uno shadow root non
/// passa da un `<style>` (`style-mod` usa un foglio costruito) e resta fuori.
export function keepEditorStylesSteady(view: { readonly dom: HTMLElement; readonly root: DocumentOrShadowRoot }): void {
  const doc = view.dom.ownerDocument;
  if (steady.has(doc) || view.root !== doc) return;
  const tag = editorStyleTag(doc, view.dom);
  if (!tag) return;
  const text = inheritedDescriptor(tag, "textContent");
  if (!text?.get || !text.set) return;
  const read = text.get;
  const write = text.set;
  Object.defineProperty(tag, "textContent", {
    configurable: true,
    enumerable: text.enumerable ?? true,
    get(this: HTMLStyleElement) {
      return read.call(this) as string | null;
    },
    set(this: HTMLStyleElement, next: string | null) {
      if (next === read.call(this)) return;
      write.call(this, next);
    },
  });
  steady.add(doc);
}

/// L'accessore che l'elemento eredita: nei browser sta su `Node.prototype`,
/// ma un DOM può ridefinirlo più in basso nella catena (`Element`).
function inheritedDescriptor(target: object, name: string): PropertyDescriptor | undefined {
  for (let proto = Object.getPrototypeOf(target) as object | null; proto; proto = Object.getPrototypeOf(proto) as object | null) {
    const found = Object.getOwnPropertyDescriptor(proto, name);
    if (found) return found;
  }
  return undefined;
}

/// Il `<style>` di `style-mod`: quello che porta le regole delle classi
/// `ͼ…` che CodeMirror ha messo sull'editor. Il portatore del nonce
/// (`data-fub-nonce`) è vuoto e resta fuori.
function editorStyleTag(doc: Document, dom: HTMLElement): HTMLStyleElement | null {
  const generated = [...dom.classList].find((name) => name.startsWith("ͼ"));
  if (!generated || !doc.head) return null;
  for (const tag of doc.head.querySelectorAll<HTMLStyleElement>("style:not([data-fub-nonce])")) {
    if ((tag.textContent ?? "").includes(`.${generated}`)) return tag;
  }
  return null;
}
