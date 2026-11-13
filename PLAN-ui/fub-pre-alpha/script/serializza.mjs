// La serializzazione di una pagina viva in una cattura (DOM + CSS), condivisa da cattura.mjs e cattura-piani.mjs.
// Si passa a page.evaluate: deve restare autosufficiente.
export function serialize(inserimenti = []) {
  return (async () => {
    const root = document.documentElement;
    // Le immagini da un lease o dal server: dati in linea.
    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:")) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const data = await new Promise((r) => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.readAsDataURL(blob);
        });
        img.setAttribute("src", data);
        img.removeAttribute("srcset");
      } catch {}
    }
    for (const c of document.querySelectorAll("canvas")) {
      try {
        c.setAttribute("data-proto-src", c.toDataURL());
      } catch {}
      c.setAttribute("width", String(c.width));
      c.setAttribute("height", String(c.height));
    }
    for (const el of document.querySelectorAll("input")) {
      if (el.type === "checkbox" || el.type === "radio") el.toggleAttribute("checked", el.checked);
      else if (el.type !== "file") el.setAttribute("value", el.value);
    }
    for (const el of document.querySelectorAll("textarea")) el.textContent = el.value;
    for (const el of document.querySelectorAll("option")) el.toggleAttribute("selected", el.selected);
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollTop || el.scrollLeft) el.setAttribute("data-proto-scroll", `${el.scrollLeft},${el.scrollTop}`);
    }
    const active = document.activeElement;
    if (active && active !== document.body) active.setAttribute("data-proto-focus", "");
    for (const el of [root, ...document.querySelectorAll("[style]")]) {
      const s = el.getAttribute("style");
      if (s != null) {
        el.setAttribute("data-proto-style", s);
        el.removeAttribute("style");
      }
    }
    const body = document.body.cloneNode(true);
    // DOM che il codice costruirà dentro una superficie che si ridisegna da sé
    // (CodeMirror): entra solo nella copia, mai nella pagina viva.
    for (const { sel, where, html } of inserimenti) {
      const at = body.querySelector(sel);
      if (at) at.insertAdjacentHTML(where, html);
      else console.warn("inserimento senza bersaglio", sel);
    }
    // T3: il bottone della modalità esce dalla testata e diventa figlio del
    // foglio, dopo la barra di formato. Solo nella copia.
    for (const el of body.querySelectorAll("[data-proto-sposta]")) {
      el.removeAttribute("data-proto-sposta");
      const pane = el.closest(".pane");
      const after = pane?.querySelector(":scope > .format-bar") ?? pane?.querySelector(":scope > .pane-toolbar");
      if (after) after.after(el);
    }
    for (const el of body.querySelectorAll("script, style, link, noscript, #proto-nuovo")) el.remove();
    const attrs = [...root.attributes].map((a) => [a.name, a.value]);
    const bodyAttrs = [...document.body.attributes].map((a) => [a.name, a.value]);
    const css = [];
    for (const sheet of document.styleSheets) {
      const node = sheet.ownerNode;
      if (node?.id === "proto-nuovo") continue;
      if (sheet.disabled) continue;
      let text = "";
      if (node instanceof HTMLStyleElement) text = node.textContent ?? "";
      else if (node instanceof HTMLLinkElement) {
        try {
          text = await (await fetch(node.href)).text();
        } catch {}
      }
      const label = node?.dataset?.fub ? `fub:${node.dataset.fub}` : node?.dataset?.viteDevId?.replace(/^.*\/src\//, "src/") ?? node?.id ?? "stile";
      css.push({ label, media: node?.media || "", text });
    }
    for (const sheet of document.adoptedStyleSheets ?? []) {
      css.push({ label: "adottato", media: "", text: [...sheet.cssRules].map((r) => r.cssText).join("\n") });
    }
    return {
      attrs,
      bodyAttrs,
      body: body.innerHTML,
      css,
      title: document.title,
      viewport: { w: innerWidth, h: innerHeight },
    };
  })();
}
