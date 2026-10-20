// Fub — il plugin nativo `fub-tree` su Android (P14/F37).
//
// Posizione finale: `gen/android/app/src/main/java/dev/fub/app/FubTreePlugin.kt`,
// copiato da `mobile/install-mobile.sh`. Lo registra `tree_access.rs` con
// `register_android_plugin("dev.fub.app", "FubTreePlugin")`; il webview non lo
// chiama mai: nessuna capability lo nomina, lo raggiungono soltanto i comandi
// `mobile_*` dell'app.
//
// Quattro domande, una risposta ciascuna:
// - `pick`: il selettore di cartella (OPEN_DOCUMENT_TREE) e il grant persistito
//   subito, o `uri` assente se la persona chiude il selettore;
// - `verify`: il grant è ancora fra i permessi persistiti, adesso;
// - `copy`: l'albero dentro una cartella **nuova** del vault privato. SAF non
//   ha un path né una rinomina atomica, e il kernel lavora su path: la
//   cartella condivisa si apre come copia, mai scrivendo nell'originale;
// - `release`: non c'è niente da chiudere su Android (nessun accesso a tempo).

package dev.fub.app

import android.app.Activity
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@InvokeArg
class FubGrantArgs {
    lateinit var uri: String
    var readWrite: Boolean = true
}

@InvokeArg
class FubCopyArgs {
    lateinit var uri: String
    lateinit var dest: String
    var maxFiles: Long = 20_000
    var maxBytes: Long = 4L * 1024 * 1024 * 1024
}

@TauriPlugin
class FubTreePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pick(invoke: Invoke) {
        startActivityForResult(invoke, FubTreeAccess.openTreeIntent(), "picked")
    }

    @ActivityCallback
    fun picked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        val answer = JSObject()
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            answer.put("persisted", false)
            answer.put("readWrite", false)
            invoke.resolve(answer)
            return
        }
        val resolver = activity.contentResolver
        // Prima lettura e scrittura; se il provider non la concede, sola
        // lettura. Nessuna delle due = il grant non c'è, e lo si dice.
        val writable = FubTreeAccess.persistTreePermission(resolver, uri, true)
        val readable = writable || FubTreeAccess.persistTreePermission(resolver, uri, false)
        if (!readable) {
            invoke.reject("il sistema non ha concesso la cartella scelta")
            return
        }
        answer.put("uri", uri.toString())
        FubTreeAccess.treeDisplayName(resolver, uri)?.let { answer.put("displayName", it) }
        answer.put("persisted", true)
        answer.put("readWrite", writable)
        invoke.resolve(answer)
    }

    @Command
    fun verify(invoke: Invoke) {
        val args = invoke.parseArgs(FubGrantArgs::class.java)
        val held = FubTreeAccess.hasPersistedTreePermission(
            activity.contentResolver,
            Uri.parse(args.uri),
            args.readWrite,
        )
        val answer = JSObject()
        answer.put("state", if (held) "granted" else "revoked")
        invoke.resolve(answer)
    }

    @Command
    fun access(invoke: Invoke) {
        invoke.reject("su Android la cartella condivisa si apre come copia")
    }

    @Command
    fun release(invoke: Invoke) {
        invoke.resolve(JSObject())
    }

    @Command
    fun copy(invoke: Invoke) {
        val args = invoke.parseArgs(FubCopyArgs::class.java)
        // Fuori dal thread dell'interfaccia: una cartella grande richiede tempo.
        Thread {
            try {
                invoke.resolve(TreeCopy(activity, args).run())
            } catch (error: Exception) {
                invoke.reject(error.message ?: error.javaClass.simpleName)
            }
        }.start()
    }
}

/// Una copia, con i suoi conti. La cartella di destinazione non deve esistere:
/// la crea lei, e dentro scrive soltanto file nuovi.
private class TreeCopy(private val activity: Activity, private val args: FubCopyArgs) {
    private val tree = Uri.parse(args.uri)
    private val resolver = activity.contentResolver
    private var files = 0L
    private var bytes = 0L
    private var truncated = false
    private val skipped = mutableListOf<String>()

    fun run(): JSObject {
        if (!FubTreeAccess.hasPersistedTreePermission(resolver, tree, false)) {
            throw IllegalStateException("il permesso sulla cartella non c'è più")
        }
        val dest = File(args.dest)
        if (dest.exists()) throw IllegalStateException("la cartella di destinazione esiste già")
        if (!dest.mkdirs()) throw IllegalStateException("cartella di destinazione non creata")
        walk(DocumentsContract.getTreeDocumentId(tree), dest, "", 0)
        val answer = JSObject()
        answer.put("files", files)
        answer.put("bytes", bytes)
        answer.put("truncated", truncated)
        answer.put("skipped", org.json.JSONArray(skipped))
        return answer
    }

    private fun walk(parent: String, dir: File, prefix: String, depth: Int) {
        if (truncated) return
        if (depth > 64) {
            skipped.add(prefix)
            return
        }
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        resolver.query(children, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext() && !truncated) {
                val id = cursor.getString(0) ?: continue
                val name = cursor.getString(1) ?: ""
                val path = if (prefix.isEmpty()) name else "$prefix/$name"
                // Un nome che non è un nome di file non diventa un path.
                if (name.isEmpty() || name == "." || name == ".." || name.contains('/') || name.contains('\u0000')) {
                    skipped.add(path)
                    continue
                }
                val target = File(dir, name)
                if (target.exists()) {
                    // Due figli con lo stesso nome: il secondo si elenca, non
                    // si sovrascrive il primo.
                    skipped.add(path)
                    continue
                }
                if (cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (target.mkdir()) walk(id, target, path, depth + 1) else skipped.add(path)
                } else {
                    copyFile(id, target, path)
                }
            }
        } ?: skipped.add(prefix)
    }

    private fun copyFile(id: String, target: File, path: String) {
        if (files >= args.maxFiles) {
            truncated = true
            return
        }
        val source = DocumentsContract.buildDocumentUriUsingTree(tree, id)
        try {
            val input = resolver.openInputStream(source) ?: run {
                skipped.add(path)
                return
            }
            input.use { stream ->
                FileOutputStream(target).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = stream.read(buffer)
                        if (read < 0) break
                        if (bytes + read > args.maxBytes) {
                            truncated = true
                            break
                        }
                        out.write(buffer, 0, read)
                        bytes += read
                    }
                    out.fd.sync()
                }
            }
            if (truncated) {
                // Un file a metà non resta nella copia come se fosse intero.
                target.delete()
                skipped.add(path)
            } else {
                files += 1
            }
        } catch (error: Exception) {
            target.delete()
            skipped.add(path)
        }
    }
}
