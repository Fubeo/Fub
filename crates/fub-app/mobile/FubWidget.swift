// Fub — widget iOS WidgetKit (MobileOwner P14/F37).
//
// Posizione finale: `gen/ios/Sources/<App>/FubWidget.swift`, fuso da
// `mobile/install-mobile.sh` come target Widget Extension dedicato
// (membership a cura di Xcode: lo script stampa il promemoria e fallisce
// solo se gen/ manca, mai per il target).
//
// Azioni reali: 3 Link `fub://` (stessi comandi del picker rapido).
// Timeline statica, nessun polling, nessuna rete, nessuna scrittura:
// solo navigazione verso l'app host. Solo SwiftUI/WidgetKit.

import SwiftUI
import WidgetKit

struct FubQuickActionsEntry: TimelineEntry {
    let date: Date
}

struct FubQuickActionsProvider: TimelineProvider {
    func placeholder(in context: Context) -> FubQuickActionsEntry {
        FubQuickActionsEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (FubQuickActionsEntry) -> Void) {
        completion(FubQuickActionsEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FubQuickActionsEntry>) -> Void) {
        completion(Timeline(entries: [FubQuickActionsEntry(date: Date())], policy: .never))
    }
}

struct FubQuickActionsView: View {
    var body: some View {
        VStack(spacing: 8) {
            Link("Nuova", destination: URL(string: "fub://new")!)
            Link("Giornaliera", destination: URL(string: "fub://daily")!)
            Link("Cerca", destination: URL(string: "fub://mobile-search")!)
            Link("Vai", destination: URL(string: "fub://mobile-switcher")!)
        }
        .font(.headline)
    }
}

struct FubQuickActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "dev.fub.app.quickactions",
            provider: FubQuickActionsProvider(),
        ) { _ in
            FubQuickActionsView()
        }
        .configurationDisplayName("Fub")
        .description("Nuova nota, giornaliera, cerca, vai alla nota.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct FubWidgetBundle: WidgetBundle {
    var body: some Widget {
        FubQuickActionsWidget()
    }
}
