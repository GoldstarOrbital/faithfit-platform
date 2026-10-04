import Foundation

/// A member-scoped snapshot of the Reels index. It is intentionally separate
/// from URLCache: this lets the screen draw immediately while a live request
/// updates ranking, reactions, and removals in the background.
enum ReelsCache {
    private static let writes = DispatchQueue(label: "functioningfaith.reels-cache", qos: .utility)
    private static var directory: URL? {
        try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("reels-cache", isDirectory: true)
    }

    private static func file(userID: UUID) -> URL? {
        guard let directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(userID.uuidString.lowercased()).json")
    }

    static func load(userID: UUID) -> ReelsFeedResponse? {
        guard let file = file(userID: userID),
              let data = try? Data(contentsOf: file),
              let response = try? JSONDecoder().decode(ReelsFeedResponse.self, from: data),
              !response.videos.isEmpty else { return nil }
        return response
    }

    static func save(_ response: ReelsFeedResponse, userID: UUID) {
        guard !response.videos.isEmpty else { return }
        // Retain enough cards for an immediate continuous scroll, but don't
        // turn a view cache into an unbounded offline download.
        let snapshot = ReelsFeedResponse(videos: Array(response.videos.prefix(20)), churchName: response.churchName)
        writes.async {
            guard let file = file(userID: userID),
                  let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    static func clearAll() {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
