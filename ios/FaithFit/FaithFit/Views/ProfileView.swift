import SwiftUI

struct ProfileView: View {
    @State private var profile: UserProfile?
    @State private var biometricConsent = false
    @State private var scripturePersonalization = false

    var body: some View {
        Form {
            if let profile {
                Section("Stats") {
                    Text("\(profile.displayName)")
                    Text("Level \(profile.level) · \(profile.xp) XP")
                }
                Section("Badges") {
                    ForEach(profile.badges) { badge in
                        Label(badge.name, systemImage: badge.iconURL)
                    }
                }
            }
            Section("Connected Devices") {
                Text("Apple Watch (HealthKit)")
                Text("Add device…")
            }
            Section("Privacy") {
                Toggle("Share biometrics for workout tracking", isOn: $biometricConsent)
                Toggle("Personalize scripture with my biometrics", isOn: $scripturePersonalization)
                    .disabled(!biometricConsent)
            }
        }
        .navigationTitle("Profile")
        .task { profile = try? await APIClient.shared.fetchProfile() }
    }
}

#Preview { NavigationStack { ProfileView() } }
