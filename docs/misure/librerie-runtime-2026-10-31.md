# 2026-10-31, le librerie a runtime sui tre sistemi

Questa pagina conserva la prova di K0 sul livello 3 del piano dei componenti:
componenti Rust in librerie dinamiche, caricati a runtime, con le dipendenze
comuni in una libreria condivisa.

> **Per chi:** chi decide fra edizioni (livello 2) e librerie a runtime
> (livello 3).
> **Risultato:** sapere che cosa tiene sui tre sistemi e quanto pesa la
> consegna contro un ospite statico.

## Chi, cosa, quando

- `tools/librerie-runtime` al commit `956b7323`, ramo `fase/k0-misure`;
- job `librerie-runtime` della CI, run 41161092194, 2026-10-31: runner
  `ubuntu-latest` (x86-64), `macos-latest` (arm64), `windows-latest`
  (x86-64);
- Rust 1.95.0, profilo `release` con `strip = true`, `-C prefer-dynamic`;
- comando: `node tools/librerie-runtime/prova.mjs --out DIR`; i referti sono
  gli artifact `librerie-runtime-<sistema>-<sha>`.

## Le prove

| Prova | Linux | macOS | Windows |
|---|---|---|---|
| due componenti caricati | passa | passa | passa |
| una libreria comune sola in memoria | passa | passa | passa |
| tolto il file di B, resta A | passa | passa | passa |
| l'ospite statico dà gli stessi risultati | passa | passa | passa |
| firma ad hoc valida di ogni file (`codesign -v`) | — | passa | — |

## Il peso, in byte

| File | Linux | macOS | Windows |
|---|---|---|---|
| ospite | 50.384 | 91.520 | 58.880 |
| comune (`serde_json` dentro) | 229.720 | 236.176 | 203.264 |
| libreria standard di Rust | 5.418.488 | 1.451.616 | 839.680 |
| componente A | 32.608 | 53.760 | 33.792 |
| componente B | 24.176 | 55.200 | 27.136 |
| **consegna dinamica** | **5.755.376** | **1.888.272** | **1.162.752** |
| ospite statico con A e B dentro | 526.928 | 479.872 | 323.072 |

## Che cosa ne segue

- Il caricamento tiene sui tre sistemi, anche con la firma ad hoc di macOS:
  un file si toglie e il suo componente sparisce, gli altri restano.
- La libreria standard dinamica è un costo fisso della consegna: 5,2 MiB su
  Linux, 1,4 su macOS, 0,8 su Windows. Lo si paga una volta, non per
  componente.
- Ogni componente deve uscire dallo stesso compilatore e dalla stessa
  release di `comune` e dell'ospite: Rust non ha un'ABI stabile. Un
  componente non si aggiorna da solo.
- Il compilatore non ottimizza attraverso il confine fra due librerie
  (niente inlining né LTO fra un componente e `comune`).
- Le edizioni (livello 2) tolgono già il codice dei motori che un profilo
  non usa (fra 6,5 e 64,6 MiB per motore, vedi
  [I sei motori da soli](motori-2026-10-31-linux-ryzen.md)) senza nessuno di
  questi vincoli.

Restano fuori dalla prova la firma vera (notarizzazione, Authenticode), il
caricamento con `$ORIGIN` o `@loader_path` al posto delle variabili
d'ambiente e un componente con un motore vero dentro.
