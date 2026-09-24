// Fub — widget Android (MobileOwner P14/F37).
//
// Posizione finale: `gen/android/app/src/main/java/dev/fub/app/FubWidgetProvider.kt`
// + `res/xml/fub_widget_info.xml` + `res/layout/fub_widget.xml`, fusi da
// `mobile/install-mobile.sh`. Registrazione del receiver e `shortcuts.xml`
// nel manifest a cura dello stesso script (snippet `AndroidManifest.snippet.xml`).
//
// Azioni reali: 4 deep link `fub://` (stessi comandi del picker rapido:
// note.create, note.daily, ricerca, switcher), classificati in Rust da
// `OpenedUrlKind`. Nessuna scrittura dal widget: solo navigazione.

package dev.fub.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class FubWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (appWidgetId in ids) {
            val views = RemoteViews(context.packageName, R.layout.fub_widget)
            views.setOnClickPendingIntent(R.id.fub_widget_new, deepLink(context, "fub://new", 1))
            views.setOnClickPendingIntent(R.id.fub_widget_daily, deepLink(context, "fub://daily", 2))
            views.setOnClickPendingIntent(R.id.fub_widget_search, deepLink(context, "fub://mobile-search", 3))
            views.setOnClickPendingIntent(R.id.fub_widget_switcher, deepLink(context, "fub://mobile-switcher", 4))
            manager.updateAppWidget(appWidgetId, views)
        }
    }

    private fun deepLink(context: Context, uri: String, code: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
            `package` = context.packageName
        }
        return PendingIntent.getActivity(
            context,
            code,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
