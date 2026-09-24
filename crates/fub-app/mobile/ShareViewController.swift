// Share Extension template. The generated Xcode Share target and Host inbox
// drainer must be wired before a file can be reported as imported.
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private static let appGroup = "group.dev.fub.app"
    private static let inboxDir = "fub-share-inbox"
    private var handled = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !handled else { return }
        handled = true
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard providers.count == 1, let provider = providers.first else {
            reject("Choose one item at a time; none was silently dropped")
            return
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { [weak self] item, _ in
                guard let url = item as? URL, url.isFileURL else {
                    self?.reject("Shared file inaccessible"); return
                }
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                guard let inbox = self?.copyToInbox(url) else {
                    self?.reject("Shared file could not be copied into the app group"); return
                }
                // Do not invent a markdown note claiming that a file was imported:
                // the Host must read/ack this inbox entry through its artifact port.
                self?.reject("Saved to inbox as \(inbox.lastPathComponent), but not imported. Open Fub to finish importing.")
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
                guard let text = item as? String,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      text.utf8.count <= 1024 * 1024 else {
                    self?.reject("Shared text empty or larger than 1 MiB"); return
                }
                self?.openHost(query: ["mode": "create", "title": String(text.prefix(80)), "markdown": text])
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, _ in
                guard let url = item as? URL, ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                      url.absoluteString.utf8.count <= 2048 else {
                    self?.reject("Only http(s) URL shares are accepted"); return
                }
                self?.openHost(query: ["mode": "create", "title": String(url.absoluteString.prefix(80)),
                                       "markdown": url.absoluteString, "source_url": url.absoluteString])
            }
        } else {
            reject("Unsupported share type")
        }
    }

    private func copyToInbox(_ url: URL) -> URL? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 64 * 1024 * 1024,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
        else { return nil }
        let folder = container.appendingPathComponent(Self.inboxDir, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let dest = folder.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
            try FileManager.default.copyItem(at: url, to: dest)
            return dest
        } catch { return nil }
    }

    private func openHost(query: [String: String]) {
        var components = URLComponents()
        components.scheme = "fub"
        components.host = "capture"
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else { reject("Invalid capture URL"); return }
        extensionContext?.open(url) { [weak self] opened in
            if opened { self?.extensionContext?.completeRequest(returningItems: nil) }
            else { self?.reject("Fub did not accept this share") }
        }
    }

    private func reject(_ reason: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let alert = UIAlertController(title: "Condivisione non completata", message: reason, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.extensionContext?.cancelRequest(withError: NSError(
                    domain: "dev.fub.mobile.share", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: reason]
                ))
            })
            self.present(alert, animated: true)
        }
    }
}
