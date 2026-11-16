// Fub — Application Android: dice alla libreria Rust dove sta la cartella
// privata dell'app (issue #409).
//
// Posizione finale: `gen/android/app/src/main/java/dev/fub/app/FubApplication.kt`,
// fusa da `mobile/install-mobile.sh`, che registra anche
// `android:name=".FubApplication"` sull'`<application>` del manifest.
//
// Perché qui: su Android il processo non ha né `HOME` né `XDG_CONFIG_HOME`, e
// la cartella privata dell'app (`Context.getFilesDir()`) la sa dire solo il
// lato Java. Android chiama `Application.onCreate` prima di creare qualunque
// activity, quindi prima che `MainActivity` carichi la libreria Rust e che il
// bootstrap (`fub_host::config_dir`) scelga la cartella, una volta sola.
// Questo file passa il fatto, non sceglie: la cartella di Fub è
// `<filesDir>/fub`, e `FUB_CONFIG_DIR`, se c'è, vince ancora.

package dev.fub.app

import android.app.Application
import android.system.ErrnoException
import android.system.Os
import android.util.Log

class FubApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            // Il nome è `fub_host::config::ANDROID_FILES_DIR_VAR`.
            Os.setenv("FUB_ANDROID_FILES_DIR", filesDir.absolutePath, true)
        } catch (error: ErrnoException) {
            // Senza la variabile Fub parte lo stesso e lavora in memoria:
            // l'avviso all'avvio lo dice. Meglio di un'app che non parte.
            Log.w("Fub", "cartella privata non passata a Rust", error)
        }
    }
}
