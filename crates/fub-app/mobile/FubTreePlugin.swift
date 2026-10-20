// Fub — il plugin nativo `fub-tree` su iOS (P14/F37).
//
// Va nel target dell'app accanto a `FubTreeAccess.swift` (lo copia
// `mobile/install-mobile.sh`). Lo registra `tree_access.rs` con
// `register_ios_plugin(init_plugin_fub_tree)`; il webview non lo chiama mai.
//
// iOS consegna un path vero: il bookmark della cartella scelta, risolto, apre
// un accesso security-scoped che resta aperto finché il vault è montato
// (`access` … `release`). Il kernel ci lavora come su ogni cartella.
import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

class FubGrantArgs: Decodable {
    let uri: String
    let bookmark: String?
}

class FubReleaseArgs: Decodable {
    let path: String
}

class FubTreePlugin: Plugin, UIDocumentPickerDelegate {
    private var pending: Invoke?
    private var sessions: [String: FubTreeSession] = [:]

    @objc public func pick(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.pending == nil, let presenter = self.manager.viewController else {
                invoke.reject("selettore di cartella non disponibile")
                return
            }
            let picker = FubTreeAccess.makeFolderPicker()
            picker.delegate = self
            self.pending = invoke
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = pending else { return }
        pending = nil
        guard let url = urls.first, let bookmark = FubTreeAccess.bookmark(url: url) else {
            invoke.reject("il sistema non ha concesso la cartella scelta")
            return
        }
        invoke.resolve([
            "uri": url.absoluteString,
            "displayName": url.lastPathComponent,
            "persisted": true,
            "readWrite": true,
            "bookmark": bookmark,
        ])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["persisted": false, "readWrite": false])
        pending = nil
    }

    @objc public func verify(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FubGrantArgs.self)
        guard let bookmark = args.bookmark, let session = FubTreeAccess.openSession(bookmarkB64: bookmark) else {
            invoke.resolve(["state": "revoked"])
            return
        }
        session.close()
        invoke.resolve(["state": "granted"])
    }

    @objc public func access(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FubGrantArgs.self)
        guard let bookmark = args.bookmark, let session = FubTreeAccess.openSession(bookmarkB64: bookmark) else {
            invoke.reject("il permesso sulla cartella non c'è più")
            return
        }
        let path = session.url.path
        sessions[path]?.close()
        sessions[path] = session
        invoke.resolve(["path": path])
    }

    @objc public func release(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FubReleaseArgs.self)
        sessions.removeValue(forKey: args.path)?.close()
        invoke.resolve([:])
    }

    @objc public func copy(_ invoke: Invoke) {
        invoke.reject("su iOS la cartella condivisa si apre dov'è")
    }
}

@_cdecl("init_plugin_fub_tree")
func initPlugin() -> Plugin {
    return FubTreePlugin()
}
