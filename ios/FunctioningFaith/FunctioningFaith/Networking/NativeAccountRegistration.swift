import Foundation

/// Native registration is intentionally separate from the general API client
/// while the composer work is in progress. It keeps the iOS sign-up contract
/// aligned with the server's age and terms requirements without widening the
/// client-side session surface.
extension APIClient {
    func registerForAppStore(
        name: String,
        email: String,
        password: String,
        dateOfBirth: Date,
        acceptedTerms: Bool
    ) async throws -> UserProfile {
        if useMock { return MockData.profile }

        let calendar = Calendar(identifier: .gregorian)
        guard calendar.dateComponents([.year], from: dateOfBirth, to: .now).year ?? 0 >= 13 else {
            throw NativeRegistrationError.minimumAge
        }
        guard acceptedTerms else { throw NativeRegistrationError.termsRequired }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"

        guard let url = URL(string: "/api/auth/register", relativeTo: baseURL) else {
            throw APIError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(NativeRegistrationBody(
            displayName: name,
            email: email,
            password: password,
            dateOfBirth: formatter.string(from: dateOfBirth),
            termsAccepted: acceptedTerms
        ))

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 403 { throw NativeRegistrationError.minimumAge }
            throw APIError.requestFailed(http.statusCode, nil)
        }
        return try await fetchProfile()
    }

    func completeNativeAccountSetup(dateOfBirth: Date, acceptedTerms: Bool) async throws {
        if useMock { return }
        let calendar = Calendar(identifier: .gregorian)
        guard calendar.dateComponents([.year], from: dateOfBirth, to: .now).year ?? 0 >= 13 else {
            throw NativeRegistrationError.minimumAge
        }
        guard acceptedTerms else { throw NativeRegistrationError.termsRequired }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"

        guard let url = URL(string: "/api/account/setup", relativeTo: baseURL) else {
            throw APIError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(NativeAccountSetupBody(
            dateOfBirth: formatter.string(from: dateOfBirth),
            termsAccepted: acceptedTerms
        ))
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let server = try? JSONDecoder().decode(NativeSetupError.self, from: data)
            if server?.error == "minimum_age" { throw NativeRegistrationError.minimumAge }
            throw APIError.requestFailed(http.statusCode, server?.error?.replacingOccurrences(of: "_", with: " "))
        }
    }
}

enum NativeRegistrationError: LocalizedError {
    case minimumAge
    case termsRequired

    var errorDescription: String? {
        switch self {
        case .minimumAge:
            return "Functioning Faith is currently available to people age 13 and older."
        case .termsRequired:
            return "Please accept the Terms and Privacy Policy to create your account."
        }
    }
}

private struct NativeRegistrationBody: Encodable {
    let displayName: String
    let email: String
    let password: String
    let dateOfBirth: String
    let termsAccepted: Bool

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case email, password
        case dateOfBirth = "date_of_birth"
        case termsAccepted = "terms_accepted"
    }
}

private struct NativeAccountSetupBody: Encodable {
    let dateOfBirth: String
    let termsAccepted: Bool
    enum CodingKeys: String, CodingKey {
        case dateOfBirth = "date_of_birth"
        case termsAccepted = "terms_accepted"
    }
}

private struct NativeSetupError: Decodable { let error: String? }
