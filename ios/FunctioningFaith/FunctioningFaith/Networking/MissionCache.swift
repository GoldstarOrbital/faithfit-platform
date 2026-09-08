import Foundation

/// Last Scripture in Motion card a member saw, kept on disk so Home paints
/// the verse on the first frame instead of a ProgressView skeleton.
///
/// Same contract as FeedCache: the network fetch always runs and always wins;
/// the stored copy only decides what is on screen until it lands. Scoped per
/// member so two accounts on one device never share a mission. Cleared on
/// sign-out / session expiry with FeedCache.
enum MissionCache {
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

    static func load(userID: UUID) -> ScriptureMission? {
        guard let file = file(userID: userID),
              let data = try? Data(contentsOf: file),
              let mission = try? JSONDecoder().decode(ScriptureMission.self, from: data)
        else { return nil }
        return mission
    }

    private static let writes = DispatchQueue(label: "functioningfaith.mission-cache", qos: .utility)

    static func save(_ mission: ScriptureMission, userID: UUID) {
        writes.async {
            guard let file = file(userID: userID),
                  let data = try? JSONEncoder().encode(mission) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    static func clearAll() {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }
}
