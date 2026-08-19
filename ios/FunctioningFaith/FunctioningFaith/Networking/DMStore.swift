import Foundation
import CryptoKit

/// Orchestrates direct messages: raw network shapes from APIClient in,
/// decrypted display models out. Owns the crypto layer so APIClient itself
/// stays a plain networking client, mirroring the web app's own split
/// between api.js (transport) and e2e-crypto.js (encryption).
@MainActor
final class DMStore: ObservableObject {
    @Published private(set) var threads: [DMThreadPreview] = []
    @Published private(set) var unreadTotal: Int = 0
    @Published private(set) var loadError: String?

    private var myUserID: String?
    private var keyPublished = false

    /// Call once a session exists. Publishing the public key is best-effort
    /// and safe to call repeatedly -- it's a no-op on the server once the
    /// same key is already on file, matching e2e-crypto.js's own
    /// once-per-page-load behavior.
    func configure(myUserID: UUID) async {
        self.myUserID = myUserID.uuidString
        guard !keyPublished else { return }
        do {
            let jwk = try E2ECrypto.publicJWK(userID: myUserID.uuidString)
            try await APIClient.shared.publishE2EPublicKey(jwk)
            keyPublished = true
        } catch {
            // Best-effort, matching the web client: sending still works
            // (falls back to plaintext) if key publishing failed here.
        }
    }

    func loadInbox() async {
        do {
            let (raw, unread) = try await APIClient.shared.fetchDMInbox()
            unreadTotal = unread
            threads = raw.map { dto in
                DMThreadPreview(
                    threadID: dto.threadID,
                    otherUserID: dto.user.id,
                    otherName: dto.user.displayName,
                    otherHasAvatar: dto.user.hasAvatar,
                    // Matches the web inbox: an e2e-kind preview is never
                    // decrypted just to populate a list row -- that would mean
                    // deriving a shared key for every thread on every poll.
                    // The real content only decrypts once a thread is opened.
                    previewText: dto.lastKind == "e2e" ? nil : dto.lastBody,
                    lastKind: dto.lastKind ?? "text",
                    lastFromMe: dto.lastFromMe ?? false,
                    lastMessageAt: dto.lastMessageAt.flatMap(Self.parseDate),
                    unread: dto.unread ?? 0
                )
            }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Opens (or reopens) the conversation with someone and returns its
    /// thread id, for navigating there from a profile's "Message" button.
    func openThread(withUserID id: UUID) async throws -> String {
        try await APIClient.shared.openDMThread(withUserID: id).threadID
    }

    func loadThread(id: String) async throws -> DMConversation {
        let dto = try await APIClient.shared.fetchDMThread(id: id)
        guard let myUserID else { throw APIError.notSignedIn }

        // Derived once per thread open, not per message -- matches the web
        // client. Absent when either side has no public key on file (e.g.
        // hasn't opened a client with this feature yet); encrypted messages
        // simply can't be decrypted on this device in that case.
        let sharedKey: SymmetricKey? = try? await {
            guard let jwk = try await APIClient.shared.fetchE2EPublicKey(userID: dto.user.id) else { return nil }
            return try E2ECrypto.sharedKey(myUserID: myUserID, theirPublicKeyJWK: jwk)
        }()

        let messages: [DMMessage] = (dto.messages ?? []).map { m in
            let (body, verseRef) = Self.displayBody(for: m, sharedKey: sharedKey)
            return DMMessage(id: m.id, body: body, kind: m.kind, fromMe: m.fromMe,
                              createdAt: Self.parseDate(m.createdAt) ?? .now, read: m.read, verseReference: verseRef)
        }
        return DMConversation(threadID: dto.threadID, otherUserID: dto.user.id, otherName: dto.user.displayName,
                               otherHasAvatar: dto.user.hasAvatar, blocked: dto.blocked ?? false, messages: messages)
    }

    private static func displayBody(for m: DMMessageDTO, sharedKey: SymmetricKey?) -> (String, String?) {
        if m.kind == "verse", case .string(let ref)? = m.metadata?["reference"] {
            return (m.body, ref)
        }
        if m.kind == "e2e" {
            guard let sharedKey else { return ("🔒 Could not decrypt this message on this device.", nil) }
            guard let plain = try? E2ECrypto.decrypt(m.body, with: sharedKey) else {
                return ("🔒 Could not decrypt this message on this device.", nil)
            }
            return (plain, nil)
        }
        return (m.body, nil)
    }

    /// Sends `text`, encrypting automatically when a shared key can be
    /// derived and falling back to plaintext otherwise -- exactly the web
    /// client's own logic, not a user-facing toggle.
    func send(threadID: String, to otherUserID: UUID, text: String) async throws -> DMMessage {
        guard let myUserID else { throw APIError.notSignedIn }
        var body = text
        var isE2E = false
        if let jwk = try? await APIClient.shared.fetchE2EPublicKey(userID: otherUserID), let jwk,
           let key = try? E2ECrypto.sharedKey(myUserID: myUserID, theirPublicKeyJWK: jwk) {
            body = (try? E2ECrypto.encrypt(text, with: key)) ?? text
            isE2E = body != text
        }
        let dto = try await APIClient.shared.sendDM(threadID: threadID, body: body, isE2E: isE2E)
        // The just-sent message never needs decrypting -- it's our own
        // plaintext, already in hand, regardless of what ciphertext the
        // server echoes back.
        return DMMessage(id: dto.id, body: text, kind: dto.kind, fromMe: true,
                          createdAt: Self.parseDate(dto.createdAt) ?? .now, read: false, verseReference: nil)
    }

    private static func parseDate(_ s: String) -> Date? {
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.date(from: s)
    }
}
