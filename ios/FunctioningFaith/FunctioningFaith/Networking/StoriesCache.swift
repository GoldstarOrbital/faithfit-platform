import Foundation

/// Member-scoped Moments snapshot. Home reads this synchronously on its first
/// frame, then refreshes from the network, so rings do not pop in after the
/// rest of the feed is already visible.
enum StoriesCache {
    private static let writes = DispatchQueue(label: "functioningfaith.stories-cache", qos: .utility)
    private static var directory: URL? {
        try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("stories-cache", isDirectory: true)
    }

    private static func file(userID: UUID) -> URL? {
        guard let directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(userID.uuidString.lowercased()).json")
    }

    static func load(userID: UUID) -> [Story]? {
        guard let file = file(userID: userID),
              let data = try? Data(contentsOf: file),
              let stories = try? JSONDecoder().decode([Story].self, from: data) else { return nil }
        let formatter = ISO8601DateFormatter()
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let active = stories.filter { story in
            guard let expiry = formatter.date(from: story.expiresAt) ?? fractionalFormatter.date(from: story.expiresAt) else { return false }
            return expiry > Date()
        }
        return active.isEmpty ? nil : active
    }

    static func save(_ stories: [Story], userID: UUID) {
        let snapshot = Array(stories.prefix(30))
        writes.async {
            guard let file = file(userID: userID) else { return }
            guard !snapshot.isEmpty else {
                try? FileManager.default.removeItem(at: file)
                return
            }
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    static func clearAll() {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
