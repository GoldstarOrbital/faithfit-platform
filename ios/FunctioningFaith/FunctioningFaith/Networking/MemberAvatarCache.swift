import Foundation

/// A bounded, session-only avatar cache. Feed and inbox loaders warm it before
/// publishing rows, so a post and its author arrive as one visual unit instead
/// of the photo popping in afterward. It intentionally never persists member
/// photos to disk and is cleared on every sign-out/account boundary.
actor MemberAvatarCache {
    static let shared = MemberAvatarCache()

    private var values: [UUID: String] = [:]
    private var order: [UUID] = []
    private var inFlight: [UUID: Task<String?, Never>] = [:]
    private let maximumItems = 128

    func dataURL(for userID: UUID, hasAvatar: Bool = true) async -> String? {
        guard hasAvatar else { return nil }
        if let value = values[userID] {
            touch(userID)
            return value
        }
        if let task = inFlight[userID] { return await task.value }

        let task = Task { try? await APIClient.shared.fetchAvatarData(userID: userID) }
        inFlight[userID] = task
        let value = await task.value
        inFlight[userID] = nil
        if let value { store(value, for: userID) }
        return value
    }

    func prefetch(_ members: [(id: UUID, hasAvatar: Bool)]) async {
        let unique = Dictionary(members.map { ($0.id, $0.hasAvatar) }, uniquingKeysWith: { $0 || $1 })
        await withTaskGroup(of: Void.self) { group in
            for (id, hasAvatar) in unique where hasAvatar {
                group.addTask { _ = await self.dataURL(for: id) }
            }
        }
    }

    func replace(_ dataURL: String?, for userID: UUID) {
        values.removeValue(forKey: userID)
        order.removeAll { $0 == userID }
        if let dataURL { store(dataURL, for: userID) }
    }

    func clearAll() {
        inFlight.values.forEach { $0.cancel() }
        inFlight.removeAll()
        values.removeAll()
        order.removeAll()
    }

    private func store(_ value: String, for id: UUID) {
        values[id] = value
        touch(id)
        while order.count > maximumItems {
            values.removeValue(forKey: order.removeFirst())
        }
    }

    private func touch(_ id: UUID) {
        order.removeAll { $0 == id }
        order.append(id)
    }
}
