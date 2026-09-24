// Fub — accesso tree SAF (MobileOwner P14/F37).
//
// Posizione finale: `gen/android/app/src/main/java/dev/fub/app/FubTreeAccess.kt`
// dopo `cargo tauri android init`, fuso da `mobile/install-mobile.sh` (NON
// eseguito qui: nessun SDK installato, nessuna licenza accettata).
//
// Canale reale per il vault condiviso: ACTION_OPEN_DOCUMENT_TREE con grant
// persistable+prefix. Un file picker (ACTION_OPEN_DOCUMENT) NON conferisce
// alcun grant sulla cartella madre: chi apre il vault sul genitore di un file
// scelto legge senza permesso — è un bypass, e qui non esiste.
// Persistenza: takePersistableUriPermission subito dopo la scelta; verifica
// hasPersistedTreePermission a ogni avvio; revoca OS = NeedGrant esplicito,
// mai fallback silenzioso al privato. Scrittura nel vault solo via Host
// (Rust `mobile.rs`), mai da qui.

package dev.fub.app

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns

object FubTreeAccess {
    /**
     * Intent per il selettore di cartella. Va lanciato da MainActivity con un
     * ActivityResultLauncher (wiring a cura di NativeIntegration: registrare il
     * launcher e inoltrare l'URI risultante a `fub://mobile-tree?uri=...` verso
     * `OpenedUrlKind::TreeGrant`, oppure a `mobile_register_tree_grant`).
     */
    fun openTreeIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
        )
    }

    /**
     * Persiste il grant subito dopo la scelta. `false` = SecurityException:
     * ripetere il picker, mai assumere il permesso.
     */
    fun persistTreePermission(resolver: ContentResolver, treeUri: Uri, write: Boolean): Boolean {
        if (treeUri.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(treeUri)) {
            return false
        }
        val mode = if (write) {
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        } else {
            Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        return try {
            resolver.takePersistableUriPermission(treeUri, mode)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    /**
     * Il grant è ancora valido? Da chiamare a ogni avvio prima di aprire il
     * vault condiviso. Revoca OS = `false`: la UI mostra NeedGrant esplicito.
     */
    fun hasPersistedTreePermission(
        resolver: ContentResolver,
        treeUri: Uri,
        needWrite: Boolean,
    ): Boolean {
        if (treeUri.scheme != ContentResolver.SCHEME_CONTENT || !DocumentsContract.isTreeUri(treeUri)) {
            return false
        }
        return resolver.persistedUriPermissions.any { grant ->
            grant.uri == treeUri && grant.isReadPermission && (!needWrite || grant.isWritePermission)
        }
    }

    /** Explicit OS revocation: caller clears registry only after this succeeds. */
    fun releaseTreePermission(resolver: ContentResolver, treeUri: Uri): Boolean {
        val grant = resolver.persistedUriPermissions.firstOrNull { it.uri == treeUri } ?: return true
        val flags = (if (grant.isReadPermission) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0) or
            (if (grant.isWritePermission) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
        return try {
            resolver.releasePersistableUriPermission(treeUri, flags)
            !hasPersistedTreePermission(resolver, treeUri, false)
        } catch (_: SecurityException) {
            false
        }
    }

    /** Nome mostra per il grant; `null` = sconosciuto, mai inventato. */
    fun treeDisplayName(resolver: ContentResolver, treeUri: Uri): String? {
        val docId = DocumentsContract.getTreeDocumentId(treeUri) ?: return null
        val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
        return try {
            resolver.query(docUri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (_: SecurityException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
