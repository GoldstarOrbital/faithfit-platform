import Foundation
import Security

struct WidgetScriptureSnapshot: Codable {
    let reference: String
    let text: String
    let context: String
    let updatedAt: Date
}

/// A tiny, non-sensitive bridge shared by the app and widget extension. It
/// contains scripture and a generic workout context only--never health data,
/// identity, location, or an authenticated token.
enum WidgetScriptureStore {
    private static let service = "com.functioningfaith.app.widget-scripture"
    private static let account = "latest"
    private static let accessGroup = "P3999S6HG4.com.functioningfaith.shared"

    static let fallback = WidgetScriptureSnapshot(
        reference: "Isaiah 40:31",
        text: "Those who hope in the Lord will renew their strength.",
        context: "Strength for the journey",
        updatedAt: .distantPast
    )

    static func save(reference: String, text: String, context: String) {
        let snapshot = WidgetScriptureSnapshot(reference: reference, text: text, context: context, updatedAt: .now)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(key as CFDictionary)
        var item = key
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load() -> WidgetScriptureSnapshot {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let value = try? JSONDecoder().decode(WidgetScriptureSnapshot.self, from: data) else { return fallback }
        return value
    }
}
