# Il Flatpak di Fub

Il pacchetto Flatpak `io.github.Fubeo.Fub`: Fub costruito dai sorgenti sul
runtime GNOME 51, quindi con lo stesso WebKitGTK su ogni distribuzione. La
release lo allega come `Fub-<versione>-linux-x86_64.flatpak`; Flathub per ora
resta fuori. I permessi, e perché sono questi, stanno in
[`docs/development/versioning-and-releases.md`](../../docs/development/versioning-and-releases.md#flatpak).

| File | Che cos'è |
|---|---|
| `io.github.Fubeo.Fub.yml` | il manifest di `flatpak-builder` |
| `io.github.Fubeo.Fub.desktop` | la voce del menu delle applicazioni, con i link `fub://` |
| `io.github.Fubeo.Fub.metainfo.xml` | i metadati AppStream |
| `genera-sorgenti.sh` | genera in `generated/` le sorgenti offline di Cargo e npm |

## Costruirlo

Il builder non ha la rete: le dipendenze di Cargo e di npm sono sorgenti del
manifest, generate dai lockfile. Da una copia pulita del repository (un
`git clone` o un worktree: la build copia la cartella, e un `target/` locale
la rallenterebbe):

```bash
# 1. le sorgenti offline (Python 3.10+ con aiohttp, tomlkit e PyYAML)
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

Il toolchain Rust è l'1.95 fissato dalla CI, scaricato come sorgente del
manifest insieme alla libreria per `wasm32-unknown-unknown`; Node viene
dall'estensione `node22`. Il primo giro compila tutto il workspace in release:
contare più di mezz'ora e una decina di GB.

## Installarlo e avviarlo

```bash
flatpak install --user ./Fub-<versione>-linux-x86_64.flatpak
flatpak run io.github.Fubeo.Fub
flatpak run --command=fub-cli io.github.Fubeo.Fub --help
```

L'installazione scarica da Flathub il runtime GNOME 51, se manca. La
configurazione dell'app sta in `~/.var/app/io.github.Fubeo.Fub/config/fub`,
non in `~/.config/fub`: il primo avvio la crea, e i vault non cambiano.
