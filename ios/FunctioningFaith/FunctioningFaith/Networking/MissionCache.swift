import Foundation

/// Last Scripture in Motion card a member saw. Home must paint this on the
/// *first* frame when present — never a ProgressView spiral on a cache hit.
///
/// Memory is checked first (warmed at session restore / last save), then disk.
/// Network fetch always runs afterward and always wins. Scoped per member;
/// cleared on sign-out / session expiry with FeedCache.
enum MissionCache {
    private static var memory: [UUID: ScriptureMission] = [:]
    private static let lock = NSLock()

    private static var directory: URL? {
        try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("mission-cache", isDirectory: true)
    }

    private static func file(userID: UUID) -> URL? {
        guard let directory else { return nil }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(userID.uuidString.lowercased()).json")
    }

    /// Synchronous. Safe to call from `View.body` for first-frame paint.
    static func load(userID: UUID) -> ScriptureMission? {
        lock.lock()
        if let hit = memory[userID] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        guard let file = file(userID: userID),
              let data = try? Data(contentsOf: file),
              let mission = try? JSONDecoder().decode(ScriptureMission.self, from: data)
        else { return nil }
        lock.lock()
        memory[userID] = mission
        lock.unlock()
        return mission
    }

    /// Alias used by launch warm / body paint call sites.
    static func peek(userID: UUID) -> ScriptureMission? { load(userID: userID) }

    private static let writes = DispatchQueue(label: "functioningfaith.mission-cache", qos: .utility)

    static func save(_ mission: ScriptureMission, userID: UUID) {
        lock.lock()
        memory[userID] = mission
        lock.unlock()
        writes.async {
            guard let file = file(userID: userID),
                  let data = try? JSONEncoder().encode(mission) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    /// Warm memory from disk at launch so Home's first body pass hits RAM.
    @discardableResult
    static func warmFromDisk(userID: UUID) -> ScriptureMission? {
        load(userID: userID)
    }

    static func clearAll() {
        lock.lock()
        memory.removeAll()
        lock.unlock()
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
