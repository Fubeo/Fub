# Il Flatpak di Fub

Il pacchetto Flatpak `io.github.Fubeo.Fub`: Fub costruito dai sorgenti sul
runtime GNOME 51, con una WebKitGTK scelta da noi e costruita nel manifest,
quindi la stessa su ogni distribuzione. La
release lo allega come `Fub-<versione>-linux-x86_64.flatpak`; Flathub per ora
resta fuori. I permessi, e perché sono questi, stanno in
[`docs/development/versioning-and-releases.md`](../../docs/development/versioning-and-releases.md#flatpak).

| File | Che cos'è |
|---|---|
| `io.github.Fubeo.Fub.yml` | il manifest di `flatpak-builder` |
| `io.github.Fubeo.Fub.desktop` | la voce del menu delle applicazioni, con i link `fub://` |
| `io.github.Fubeo.Fub.metainfo.xml` | i metadati AppStream |
| `genera-sorgenti.sh` | genera in `generated/` le sorgenti offline di Cargo e npm |
| `fontconfig-local.conf` | scarta i caratteri dell'host che il runtime legge senza famiglia (`.woff`, `.woff2`): con loro il processo web di WebKitGTK gira all'infinito e la finestra resta vuota |

## Costruirlo

Il builder non ha la rete: le dipendenze di Cargo e di npm sono sorgenti del
manifest, generate dai lockfile. Da una copia pulita del repository (un
`git clone` o un worktree: la build copia la cartella, e un `target/` locale
la rallenterebbe):

```bash
# 1. le sorgenti offline (Python 3.10+ con i moduli di requisiti-generatori.txt)
packaging/flatpak/genera-sorgenti.sh

# 2. runtime, SDK ed estensione di Node, da Flathub
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Platform//51 org.gnome.Sdk//51 \
  org.freedesktop.Sdk.Extension.node22//26.08

# 3. la build, con stato e risultato fuori dal repository
flatpak-builder --user --force-clean \
  --state-dir ~/.cache/fub-flatpak/stato --repo ~/.cache/fub-flatpak/repo \
  ~/.cache/fub-flatpak/app packaging/flatpak/io.github.Fubeo.Fub.yml

# 4. il file da installare
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  ~/.cache/fub-flatpak/repo Fub.flatpak io.github.Fubeo.Fub
```

Con il builder installato come Flatpak (`org.flatpak.Builder`) il comando del
passo 3 diventa `flatpak run --env=FLATPAK_USER_DIR=$HOME/.local/share/flatpak
--command=flatpak-builder org.flatpak.Builder …`: dentro la sua sandbox
`XDG_DATA_HOME` è un altro, e senza la variabile il builder non trova il SDK
installato con `--user` («Unable to find sdk org.gnome.Sdk version 51»).

Il toolchain Rust è l'1.95 fissato dalla CI, scaricato come sorgente del
manifest insieme alla libreria per `wasm32-unknown-unknown`; Node viene
dall'estensione `node22`. Il primo giro compila WebKitGTK (vedi sotto) e tutto
il workspace in release: contare un paio d'ore su una macchina da 20 thread e
qualche decina di GB; dal secondo giro WebKitGTK viene dalla cache di
`--state-dir`, finché il suo modulo non cambia. WebKit con GCC prende 1–2 GB di
memoria per processo di compilazione: su una macchina con poca memoria si
limita con `--jobs=<n>`.

## La WebKitGTK del pacchetto

Il primo modulo del manifest, `webkit2gtk-4.1`, costruisce WebKitGTK dal
tarball ufficiale di webkitgtk.org e lo installa in `/app`. Fub usa quella
copia e non quella del runtime: il linker della sandbox cerca in `/app/lib`
prima che in `/usr/lib`, WebKit avvia i suoi processi dal percorso con cui è
compilato (`/app/libexec/webkit2gtk-4.1`), e la build di Fub trova prima
`/app/lib/pkgconfig`.

Perché: il runtime GNOME 51 porta WebKitGTK 2.54.1, che dopo un'animazione
rimette sullo schermo per un istante pezzi di un fotogramma vecchio (la
diagnosi è in
[`docs/architecture/desktop-webview.md`](../../docs/architecture/desktop-webview.md)).
Con un modulo nostro la versione la sceglie il manifest, non il runtime.

Le opzioni seguono quelle con cui gnome-build-meta costruisce il runtime
(`elements/sdk/webkit2gtk-4.1.bst` e `webkitgtk.inc`, ramo `gnome-51`); le
differenze, e il perché, sono nel commento del modulo.

**Gli aggiornamenti di sicurezza di WebKitGTK ora sono a carico nostro.** Il
runtime GNOME riceve le correzioni da Flathub; il nostro modulo no. A ogni
release stabile di WebKitGTK (le annuncia <https://webkitgtk.org/news.html>,
con gli avvisi WSA in <https://webkitgtk.org/security.html>):

1. in `url` si cambia la versione;
2. in `sha256` si mette l'impronta che webkitgtk.org pubblica accanto al
   tarball, nel file `webkitgtk-<versione>.tar.xz.sums` (riga `sha256sum`);
3. una patch in `patches/` che la nuova versione contiene già si toglie, con
   la sua voce in `sources`;
4. si ricostruisce e si prova a occhio lo sfarfallio, poi si fa la release.

Quando il runtime GNOME arriverà a una WebKitGTK senza il difetto, il modulo
si può togliere e la libreria torna a essere quella del runtime, aggiornata da
Flathub.

## Installarlo e avviarlo

```bash
flatpak install --user ./Fub-<versione>-linux-x86_64.flatpak
flatpak run io.github.Fubeo.Fub
flatpak run --command=fub-cli io.github.Fubeo.Fub --help
```

L'installazione scarica da Flathub il runtime GNOME 51, se manca. La
configurazione dell'app sta in `~/.var/app/io.github.Fubeo.Fub/config/fub`,
non in `~/.config/fub`: il primo avvio la crea, e i vault non cambiano.
