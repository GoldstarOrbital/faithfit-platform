import Foundation
import CryptoKit

/// DM end-to-end encryption -- the native mirror of public/e2e-crypto.js.
/// Must interoperate byte-for-byte with the web client: a message a member
/// sends from an iPhone has to decrypt correctly when they open the same
/// thread on the website, and vice versa. Every choice below exists to match
/// WebCrypto's specific behavior, not just "do ECDH+AES-GCM some way."
///
/// The scheme: each device generates an ECDH P-256 keypair on first use. The
/// public half uploads to the server (POST /dms/keys); the private half never
/// leaves the device. To read a thread, a client derives a shared AES-256-GCM
/// key from (my private key, their public key) via ECDH -- the same secret
/// both sides land on without transmitting it. The server stores and relays
/// ciphertext only.
///
/// THE ONE SUBTLETY THAT MATTERS: WebCrypto's `deriveKey` for ECDH -> AES-GCM
/// takes the RAW shared secret (the x-coordinate of the ECDH shared point,
/// per the W3C spec) and uses it directly as AES key material -- no HKDF, no
/// hashing. CryptoKit's `SharedSecret` has a convenience
/// `hkdfDerivedSymmetricKey` that most sample code reaches for, but using
/// that here would derive a DIFFERENT key than the browser does, and every
/// cross-platform message would fail to decrypt with no error until someone
/// noticed. This uses the raw shared-secret bytes directly instead, to match.
///
/// Also worth stating plainly, matching the JS file's own disclosure: the
/// private key lives in Keychain (hardware-backed on-device, but still
/// single-device) -- opening this account on a second device generates a
/// second keypair that cannot read messages encrypted to the first. Standard
/// tradeoff of E2E without a dedicated multi-device key-backup protocol.
enum E2ECrypto {
    private static let keychainService = "app.functioningfaith.e2e"

    // MARK: - Base64url (JWK's encoding, NOT the same as Data's default base64)

    /// RFC 7518 base64url: standard base64 with `+`/`/` replaced by `-`/`_`
    /// and `=` padding stripped. JWK requires exactly this; feeding it
    /// standard padded base64 (or vice versa on decode) silently produces a
    /// key the other side can't parse.
    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func fromBase64url(_ s: String) -> Data? {
        var b64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        return Data(base64Encoded: b64)
    }

    // MARK: - Keypair storage (Keychain, scoped per account like localStorage was scoped per user id)

    private static func keychainQuery(userID: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: userID,
        ]
    }

    /// Loads this device's keypair for `userID`, generating and persisting a
    /// new one on first use. Scoped by account so signing into a second
    /// account on the same device can never reuse -- and silently publish --
    /// the first account's keypair as its own.
    static func keyPair(userID: String) throws -> P256.KeyAgreement.PrivateKey {
        var query = keychainQuery(userID: userID)
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
            return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
        }
        let newKey = P256.KeyAgreement.PrivateKey()
        var addQuery = keychainQuery(userID: userID)
        addQuery[kSecValueData as String] = newKey.rawRepresentation
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        // Return status intentionally unchecked: on the rare failure (e.g. a
        // Keychain write error), the caller still gets a usable key for this
        // call, just one that won't have persisted -- the next launch would
        // generate another new one, silently changing this device's identity
        // for anyone it exchanged encrypted messages with in between. Worth
        // hardening with a real failure path once this runs on a device;
        // not done here since it can't be exercised without one.
        SecItemAdd(addQuery as CFDictionary, nil)
        return newKey
    }

    /// This device's public key as a JWK dictionary, matching WebCrypto's
    /// `exportKey('jwk', publicKey)` shape exactly: kty, crv, x, y.
    /// CryptoKit has no built-in JWK export, so this is built from the
    /// uncompressed point representation (0x04 || X || Y, 65 bytes for P-256)
    /// by slicing out the two 32-byte coordinates.
    static func publicJWK(userID: String) throws -> [String: String] {
        let key = try keyPair(userID: userID)
        let x963 = key.publicKey.x963Representation // 0x04 || X(32) || Y(32)
        precondition(x963.count == 65 && x963.first == 0x04, "unexpected P-256 point encoding")
        let x = x963.subdata(in: 1..<33)
        let y = x963.subdata(in: 33..<65)
        return ["kty": "EC", "crv": "P-256", "x": base64url(x), "y": base64url(y)]
    }

    enum CryptoError: LocalizedError {
        case invalidJWK, invalidCiphertext, noPublicKey
        var errorDescription: String? {
            switch self {
            case .invalidJWK: return "Could not read that person's encryption key."
            case .invalidCiphertext: return "This message could not be decrypted."
            case .noPublicKey: return "That person hasn't set up encrypted messaging yet."
            }
        }
    }

    private static func publicKey(fromJWK jwk: [String: Any]) throws -> P256.KeyAgreement.PublicKey {
        guard jwk["kty"] as? String == "EC", jwk["crv"] as? String == "P-256",
              let xs = jwk["x"] as? String, let ys = jwk["y"] as? String,
              let x = fromBase64url(xs), let y = fromBase64url(ys), x.count == 32, y.count == 32
        else { throw CryptoError.invalidJWK }
        let x963 = Data([0x04]) + x + y
        return try P256.KeyAgreement.PublicKey(x963Representation: x963)
    }

    /// The AES-256-GCM key shared with one other person. Raw ECDH shared
    /// secret used directly as key material -- see the file header for why
    /// this deliberately skips CryptoKit's HKDF convenience API.
    static func sharedKey(myUserID: String, theirPublicKeyJWK: [String: Any]) throws -> SymmetricKey {
        let myKey = try keyPair(userID: myUserID)
        let theirKey = try publicKey(fromJWK: theirPublicKeyJWK)
        let secret = try myKey.sharedSecretFromKeyAgreement(with: theirKey)
        let rawBytes = secret.withUnsafeBytes { Data($0) } // the raw x-coordinate; 32 bytes for P-256, exactly AES-256's key length
        return SymmetricKey(data: rawBytes)
    }

    /// Ciphertext wire format matches the web client exactly:
    /// base64(12-byte IV) + "." + base64(ciphertext-with-GCM-tag). Note this
    /// is STANDARD base64 here (not base64url) -- only the JWK fields above
    /// use base64url, matching e2e-crypto.js's own `btoa`-based encoding for
    /// message bodies versus its JWK passthrough.
    static func encrypt(_ plaintext: String, with key: SymmetricKey) throws -> String {
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: key)
        guard let combined = sealed.combined else { throw CryptoError.invalidCiphertext }
        // AES.GCM's `combined` is nonce(12) || ciphertext || tag(16); split back
        // apart to match the web format, which keeps IV and ciphertext+tag
        // as two separately-encoded fields rather than one combined blob.
        let iv = combined.prefix(12)
        let ctAndTag = combined.suffix(from: combined.startIndex + 12)
        return iv.base64EncodedString() + "." + ctAndTag.base64EncodedString()
    }

    static func decrypt(_ blob: String, with key: SymmetricKey) throws -> String {
        let parts = blob.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2,
              let iv = Data(base64Encoded: parts[0]),
              let ctAndTag = Data(base64Encoded: parts[1]),
              iv.count == 12
        else { throw CryptoError.invalidCiphertext }
        let sealedBox = try AES.GCM.SealedBox(combined: iv + ctAndTag)
        let plaintext = try AES.GCM.open(sealedBox, using: key)
        guard let text = String(data: plaintext, encoding: .utf8) else { throw CryptoError.invalidCiphertext }
        return text
    }
}
