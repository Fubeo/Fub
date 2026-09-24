// Android OS share intake. The Activity must present these proposals to the Host;
// none of them writes a vault or silently discards another selected stream.
package dev.fub.app

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

sealed interface SharedInbound {
    data class Text(val text: String, val mime: String) : SharedInbound
    data class File(val file: java.io.File, val mime: String, val displayName: String) : SharedInbound
    data class Rejected(val reason: String) : SharedInbound
}

object FubShareBridge {
    const val CHUNK_BYTES = 64 * 1024
    const val INLINE_MAX_BYTES = 64L * 1024 * 1024

    @Suppress("DEPRECATION")
    private fun streams(intent: Intent): List<Uri> {
        val items = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }
        return items ?: emptyList()
    }

    /** A list of proposals, never a first-only result that loses a multi-share. */
    fun resolveAll(intent: Intent, resolver: ContentResolver, cacheDir: File): List<SharedInbound> =
        when (intent.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
                val uris = streams(intent).ifEmpty {
                    @Suppress("DEPRECATION")
                    val single = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    } else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                    listOfNotNull(single)
                }
                if (uris.isNotEmpty()) uris.map { copyStream(resolver, cacheDir, it, intent.type) }
                else listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT)?.let {
                    SharedInbound.Text(it, intent.type ?: "text/plain")
                })
            }
            Intent.ACTION_VIEW -> listOfNotNull(intent.data?.let {
                if (it.scheme == "content") copyStream(resolver, cacheDir, it, intent.type)
                else SharedInbound.Rejected("Unsupported VIEW URI; choose a SAF document")
            })
            else -> emptyList()
        }

    private fun displayName(resolver: ContentResolver, uri: Uri): String = try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "shared-file"
    } catch (_: Exception) {
        "shared-file"
    }

    private fun copyStream(resolver: ContentResolver, cacheDir: File, uri: Uri, mime: String?): SharedInbound {
        if (uri.scheme != "content") return SharedInbound.Rejected("Only content:// share streams are accepted")
        val name = displayName(resolver, uri)
        val out = File(cacheDir, "fub-share-${UUID.randomUUID()}")
        return try {
            val input = resolver.openInputStream(uri)
                ?: return SharedInbound.Rejected("Cannot open shared content")
            var total = 0L
            input.use { stream ->
                FileOutputStream(out).use { output ->
                    val buffer = ByteArray(CHUNK_BYTES)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        total += count
                        if (total > INLINE_MAX_BYTES) {
                            throw IOException("Shared file exceeds 64 MiB")
                        }
                        output.write(buffer, 0, count)
                    }
                }
            }
            SharedInbound.File(out, mime ?: "application/octet-stream", name)
        } catch (error: IOException) {
            out.delete()
            SharedInbound.Rejected(error.message ?: "Failed to copy shared file")
        } catch (_: SecurityException) {
            out.delete()
            SharedInbound.Rejected("Shared content permission denied")
        }
    }
}
