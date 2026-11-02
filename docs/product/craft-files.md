# File delle app Craft

> **Per chi:** chi tiene nel vault disegni, immagini, progetti e foto fatti
> con le app Craft.
> **Risultato:** sapere che cosa Fub legge di un file Craft, che cosa mostra
> e che cosa lascia all'app che lo ha scritto.

I disegni di VectorCraft, le immagini di PhotoCraft, i progetti di FigCraft
e gli XMP che LightCraft scrive accanto alle foto sono file del vault come
gli altri. Fub li legge soltanto: il titolo, il testo per la ricerca, i file
collegati e l'anteprima che il file porta. Non li scrive mai, e per
modificarli li lascia all'app che li ha creati. Gli id dei formati e la
forma dell'anteprima sono in [Formati dei file Craft](../reference/craft-formats.md).

Il lettore sta nel crate `fub-format-craft`, che l'host non monta ancora:
finché non lo monta, un file Craft resta nel vault come un file di un formato
che Fub non conosce.
