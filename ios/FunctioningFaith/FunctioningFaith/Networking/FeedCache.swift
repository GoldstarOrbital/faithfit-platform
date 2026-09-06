import Foundation

/// The last feed a member saw, kept on disk so Home paints content on the
/// first frame instead of a spinner.
///
/// This is deliberately NOT an HTTP cache. The obvious way to make the feed
/// open instantly is to let the server mark it cacheable and let URLCache
/// serve it, but the feed is reloaded right after composing a post -- and a
/// cached reload would hand the member back a feed with their own new post
/// missing, which is worse than a spinner. Here the network fetch always
/// happens and always wins; the stored copy only decides what is on screen
/// while that fetch is in flight.
///
/// Everything is best effort. Any failure to read, write, decode or encode is
/// swallowed and leaves the caller behaving exactly as it did before this
/// existed -- a stale-cache bug on the app's main screen is not worth trading
/// for a first paint.
enum FeedCache {
    /// Caches, not Documents: this is regenerable, must not be backed up, and
    /// the system may reclaim it under storage pressure, all of which is fine.
    private static var directory: URL? {
        try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("feed-cache", isDirectory: true)
    }

    /// Scoped per member and per mode. Two accounts on one device must never
    /// see each other's feed, and For You is not the Following feed.
    private static func file(userID: UUID, mode: String) -> URL? {
        guard let directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(userID.uuidString.lowercased())-\(mode).json")
    }

    static func load(userID: UUID, mode: String) -> [FeedPost]? {
        guard let file = file(userID: userID, mode: mode),
              let data = try? Data(contentsOf: file),
              let posts = try? JSONDecoder().decode([FeedPost].self, from: data),
              !posts.isEmpty
        else { return nil }
        return posts
    }

    /// Off the main thread: the read has to be synchronous to beat the first
    /// frame, but nothing is waiting on the write, and it runs after every
    /// feed load and every pull to refresh.
    private static let writes = DispatchQueue(label: "functioningfaith.feed-cache", qos: .utility)

    static func save(_ posts: [FeedPost], userID: UUID, mode: String) {
        guard !posts.isEmpty else { return }
        // One screenful is all this is for. Storing a long scrollback would
        // cost disk and startup decode time for rows the member will not see
        // before the live feed replaces them anyway. Media is fetched
        // separately now (see the deferred media endpoint), so these rows carry
        // no base64 payload and the file stays small enough to read on launch.
        let head = Array(posts.prefix(15))
        writes.async {
            guard let file = file(userID: userID, mode: mode),
                  let data = try? JSONEncoder().encode(head) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    /// Feed content is member data. It leaves the device's disk on sign-out and
    /// on account deletion, for the same reason APIClient clears its response
    /// cache there -- whoever signs in next must not inherit it.
    static func clearAll() {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
