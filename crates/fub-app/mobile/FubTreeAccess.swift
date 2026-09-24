// iOS folder grants must be selected as folders and revalidated on every mount.
// This source belongs to the generated app target, not the Share extension.
import Foundation
import UIKit
import UniformTypeIdentifiers

final class FubTreeSession {
    let url: URL
    private var active = true

    fileprivate init(url: URL) { self.url = url }

    func close() {
        guard active else { return }
        active = false
        url.stopAccessingSecurityScopedResource()
    }

    deinit { close() }
}

enum FubTreeAccess {
    static func makeFolderPicker() -> UIDocumentPickerViewController {
        UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
    }

    /** Called only with the picker delegate's URL, never a file's parent. */
    static func bookmark(url: URL) -> String? {
        guard url.isFileURL,
              (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
              url.startAccessingSecurityScopedResource() else { return nil }
        defer { url.stopAccessingSecurityScopedResource() }
        // iOS security scope is conveyed by the document picker URL itself;
        // .withSecurityScope bookmark options are macOS-only.
        guard let data = try? url.bookmarkData(
            options: [], includingResourceValuesForKeys: nil, relativeTo: nil
        ) else { return nil }
        return data.base64EncodedString()
    }

    /** nil/stale/revoked/not a directory -> NeedGrant, never a private fallback. */
    static func openSession(bookmarkB64: String) -> FubTreeSession? {
        guard let data = Data(base64Encoded: bookmarkB64) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data, options: [], relativeTo: nil,
            bookmarkDataIsStale: &stale
        ), !stale, url.isFileURL,
              url.startAccessingSecurityScopedResource() else { return nil }
        guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
            url.stopAccessingSecurityScopedResource()
            return nil
        }
        return FubTreeSession(url: url)
    }
}
