# Le tessere delle mappe

> **Ambito:** come la vista Mappa di una Base ottiene le tessere di sfondo:
> la riga di macchina che ammette i siti, il comando `map_tile`, le regole
> che l'host fa rispettare e gli errori.
> **Fonti autorevoli:** `crates/fub-host/src/map_tiles.rs`
> (`Host::map_tile`), `crates/fub-host/src/settings.rs` (`map.tile-hosts`),
> `crates/fub-app/src/lib.rs` (`map_tile`); lato shell `appMapTiles` in
> `apps/client/src/editors/base/surface.ts` e il campo
> `apps/client/src/ui/map-tile-hosts-field.ts`; le prove in
> `crates/fub-host/tests/map_tiles.rs`.

Come la mappa si usa: [La Base](../product/bases-map.md). Il modello di
fiducia generale: [Permessi e sicurezza](permissions-and-security.md).

## Il comando

`map_tile(url, kind)` porta i byte di una tessera della vista Mappa di una
Base come corpo binario (un `ArrayBuffer` in JS, mai un array JSON di
numeri). `kind` è `"raster"` o `"vector"`, il genere del fornitore del
`.base`. Nessuna porta generica porta byte che non stanno nel vault, e a chi
chiedere non lo decide un vault ma la riga di macchina `map.tile-hosts`. La
risponde soltanto una finestra locale fidata, fuori dal thread principale;
regole ed errori sono sotto.

## Le regole

La vista Mappa di una Base disegna di serie griglia e segnaposti, senza rete.
Un `.base` può dichiarare un fornitore di tessere (`provider` con
`url_template` e `network: true`), ma il file sta nel vault e un vault
scaricato non può far uscire richieste: decide **la macchina**, con
`map.tile-hosts`, una lista di macchina vuota di serie nel gruppo Privacy, che
un programma non può scrivere. La shell ne mostra le pastiglie, una casella
per aggiungere un sito e OpenStreetMap (`tile.openstreetmap.org`) con un clic,
con la sua attribuzione. Un valore che non è un nome di host lo rifiuta l'host.

Con il sito nella lista la mappa offre «Attiva le mappe online», il consenso
per quella vista; senza, dice «Tessere non ammesse» con il rimando alle
Impostazioni e non chiede niente. La `connect-src` della webview resta chiusa a
`https:`: le tessere le scarica l'host (`map_tile`, `Host::map_tile` in
`crates/fub-host/src/map_tiles.rs`) con il filo verso fuori di tutti
(`UreqNetwork`), e le regole le fa rispettare lui:

- soltanto `https` sulla porta 443, senza credenziali, query o frammento, e
  l'host **esattamente** nella lista (un sottodominio è un sito a parte);
- nessun redirect: un `3xx` è un rifiuto, anche verso un sito ammesso;
- al più 1 MiB per tessera, entro 15 secondi;
- PNG, JPEG o WebP per un fornitore raster, controllati sul `Content-Type`
  **e** sui primi byte; SVG soltanto per un fornitore vettoriale, testo con la
  radice `<svg` e senza DOCTYPE, mostrato come `<image>` di un SVG, dove script
  e risorse esterne non partono;
- al più due tessere insieme in tutto il processo, e due per vista;
- un `User-Agent` che dice soltanto `Fub/<versione>`; niente cookie, `Referer`
  o credenziali.

Le tessere arrivate restano nella memoria dell'host, fino a 8 MiB, e non si
riscaricano: niente va su disco né nel vault. Gli errori sono tipizzati:
`permission_denied` per un sito o un indirizzo non ammesso e per un redirect,
`unserved` senza un filo verso fuori, `io` per la rete, uno stato non 2xx, una
tessera troppo grande o di un tipo che la mappa non accetta.
