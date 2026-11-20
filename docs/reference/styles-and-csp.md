# Gli stili e la CSP

> **Ambito:** come la shell mette i suoi stili con una CSP che non ammette
> stili in linea, che cosa resta fuori e chi lo controlla.
> **Fonti autorevoli:** `crates/fub-app/tauri.conf.json`,
> `apps/client/src/ui/stylesheets.ts`, `apps/client/src/theme/loader.ts`,
> `.github/scripts/check-inline-styles.mjs`.

Il resto della CSP, e il modello di fiducia da cui viene, è in
[Permessi e sicurezza](permissions-and-security.md#webview).

## La regola

`style-src` è `'self'` e `style-src-attr` è `'none'`: nessuno stile in linea.
Un markup che arriva da un documento, da un tema o da un plugin non può
portarsi dietro CSS: un `<style>` iniettato, o un attributo `style` che mette
un pezzo sopra la UI o chiama una risorsa, la WebView lo rifiuta. Il rifiuto è
silenzioso: il pezzo resta senza stile, la pagina in piedi.

## Le quattro strade

Lo stile passa da quattro strade, e nessun'altra:

- **i file** del bundle e di `public/` (`'self'`), compreso lo strato d'avvio
  (`public/avvio/avvio.css`), che serve prima di ogni modulo;
- **i fogli costruiti** (`new CSSStyleSheet()` in
  `document.adoptedStyleSheets`), che la CSP non guarda perché non sono markup:
  il tema li usa per ogni suo strato (`theme/loader.ts`, vedi
  [il frontend](../architecture/frontend-and-ipc.md); le sue `@font-face`
  diventano `FontFace` in `document.fonts`, che la CSP guarda solo con
  `font-src`), e `ui/stylesheets.ts`
  (`adoptSheet`) per gli altri fogli che l'app scrive da sé, come la stampa e
  la vista dei contorni della lavagna. Il CSS di un tema e dei frammenti passa
  prima dal sanitizer, come sempre;
- **CSSOM**: `element.style.x = …`, `style.setProperty`, `style.cssText`. È
  stile scritto da uno script, e la CSP non lo guarda. Il sanitizer dell'HTML
  dei documenti ammette uno `style` soltanto sulle celle e soltanto per
  l'allineamento, e lo riscrive così (`element.style.textAlign`); lo stesso
  fanno le marche di Scrittura e della superficie ricca, che un `toDOM` di
  ProseMirror scriverebbe con `setAttribute`, e il contenitore dove Mermaid
  misura: `cssomStyleChildren()` di `ui/stylesheets.ts` fa diventare CSSOM lo
  `style` che Mermaid scrive con `setAttribute` sul `<div>` che vi monta;
- **il nonce della pagina**, per chi i suoi stili li mette in un `<style>` e un
  foglio costruito non lo sa usare: CodeMirror (`EditorView.cspNonce`) e
  Mermaid, che durante il disegno mette il foglio del diagramma in un
  `<style>` dell'SVG di prova e misura le etichette con quei caratteri
  (`withPageNonce()` mette il nonce sui `<style>` creati mentre disegna). Ogni
  pagina porta un `<style data-fub-nonce></style>` vuoto; Tauri, servendola,
  gli scrive un nonce casuale, uno per caricamento, e lo aggiunge a
  `style-src`. Lo legge `pageNonce()` di `ui/stylesheets.ts`. Un markup
  iniettato non conosce il nonce: la sola cosa che lo apre è uno script
  dell'app, e gli script vengono soltanto dagli asset.

## Il caricatore del tema

`theme/loader.ts` monta gli strati del tema (caratteri, foglio, pelli,
preferenze, frammenti) come fogli costruiti. Un canale ha al più un foglio; il
caricatore li tiene nell'ordine dichiarato (`ORDER`), davanti agli altri fogli
costruiti della pagina, e sostituisce quelli di un tema con una sola
assegnazione, cioè tutti insieme o nessuno. Vengono dopo i file CSS della
pagina, quindi vincono su di loro a parità di specificità. Il testo montato di
un canale lo dice `mountedCss()`.

Le `@font-face` dei due canali dei caratteri (`caratteri`, `caratteri-tema`)
non restano nel loro foglio: il caricatore ne fa altrettante `FontFace` in
`document.fonts`, nell'ordine dei canali, e il foglio resta montato vuoto. In
Chromium una `@font-face` di un foglio costruito si ricrea e si ricarica ogni
volta che la pagina riceve un altro foglio con una sua `@font-face` (il CSS di
KaTeX alla prima formula), e per qualche fotogramma il testo si misura col
carattere di riserva; una `FontFace` aggiunta a mano resta la stessa. Rimontare
lo stesso testo dei caratteri tiene le stesse facce.

## Che cosa resta fuori

Quello che resta fuori, e perché non conta: Mermaid scrive anche attributi
`style` sugli elementi dell'SVG di prova (il carattere del contenitore, i
`classDef`), che durante la misura non valgono ma restano nel testo dell'SVG,
e il disegno si mostra come immagine `blob:`, dove la CSP della pagina non
entra; solo un `classDef` che cambia il carattere di un'etichetta si misura
col carattere del diagramma invece che col suo. Il browser segnala anche lo
`style` di un markup parsato in un documento inerte (il `DOMParser` del
sanitizzatore): lì nessuno stile si applica, e il banco lo tiene ma non lo
conta. KaTeX scrive uno
`style` come attributo solo nel MathML nascosto, per i lettori di schermo; la
formula che si vede ha gli stili via CSSOM. Con `cargo tauri dev` la pagina
arriva dal server di Vite e Tauri non mette la CSP: le violazioni si vedono
nel banco, che la mette.

Un foglio costruito su un documento chiede il WebKit di Safari 16.4
(WebKitGTK 2.40); pdf.js chiede già di più (`Promise.withResolvers`, Safari
17.4, WebKitGTK 2.44), quindi la WebView minima non cambia.

## I presidi

I presidi sono cinque. `crates/fub-app/tests/platform_configs.rs` tiene
`style-src` esattamente `'self'` e `style-src-attr` esattamente `'none'` sulla
config fusa di ogni piattaforma, senza `style-src-elem`, `'unsafe-inline'`,
`'unsafe-hashes'` né nonce o hash scritti a mano.
`.github/scripts/check-inline-styles.mjs` rifiuta nei sorgenti del client un
`<style>` creato da uno script, `setAttribute("style", …)`, un `style` scritto
come markup in una stringa o in un `toDOM`, e nelle pagine ogni `<style>` che
non sia il portatore vuoto del nonce; le eccezioni sono documenti che la CSP
della pagina non governa (un `DOMParser`, un SVG che diventa un'immagine o un
file), contate per file. Il banco Chromium serve le pagine con la CSP di
`tauri.conf.json` e il nonce come Tauri (`vite.bench.config.ts`) e fa fallire
una scena alla prima `securitypolicyviolation` su un elemento della pagina
(`bench/stage.mjs`); con la stessa CSP anche il banco non usa `eval`, quindi
un predicato di Playwright si passa come funzione, non come testo. Nella
WebView vera, lo scenario S7 di `bench:webview` vede un editor di testo senza
stile. `src/avvio/pagine.test.ts` tiene le pagine col solo portatore e senza
script in linea.
