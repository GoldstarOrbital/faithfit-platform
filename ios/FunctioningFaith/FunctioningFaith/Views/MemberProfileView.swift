import SwiftUI

/// A read-only, privacy-respecting profile reached by tapping a post author.
/// Relationship actions stay on the server; this screen only renders fields
/// that the server elected to make visible to the current viewer.
struct MemberProfileView: View {
    let userID: UUID
    @State private var profile: MemberProfileResponse?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let profile {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(spacing: 14) {
                            Image(systemName: profile.user.hasAvatar ? "person.crop.circle.fill" : "person.crop.circle")
                                .font(.system(size: 54))
                                .foregroundStyle(FFTheme.meadow)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(profile.user.displayName).font(.title3.weight(.bold))
                                    if profile.user.verifiedDeveloper { Image(systemName: "checkmark.seal.fill").foregroundStyle(FFTheme.meadow) }
                                }
                                Text(profile.isFollowing ? "Following" : "Community member").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }

                        HStack(spacing: 0) {
                            stat("Workouts", profile.stats.workouts)
                            stat("Followers", profile.stats.followers)
                            stat("Following", profile.stats.following)
                        }
                        .padding(.vertical, 12)
                        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))

                        if let ref = profile.user.bioVerseRef {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(ref).font(.headline).foregroundStyle(FFTheme.scripture)
                                if let text = profile.user.bioVerseText { Text(text).font(.body).italic() }
                            }
                            .padding()
                            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                        }

                        if let label = profile.user.bioLinkLabel, let rawURL = profile.user.bioLinkURL, let url = URL(string: rawURL) {
                            Link(destination: url) { Label(label, systemImage: "link") }.buttonStyle(.ffPrimary)
                        }
                    }
                    .padding()
                }
            } else if let errorMessage {
                ContentUnavailableView("Profile unavailable", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(errorMessage))
            } else {
                ProgressView()
            }
        }
        .background(FFTheme.parchment0.ignoresSafeArea())
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func stat(_ label: String, _ value: Int?) -> some View {
        VStack(spacing: 3) {
            Text(value.map(String.init) ?? "Private").font(.headline.monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func load() async {
        do { profile = try await APIClient.shared.fetchMemberProfile(userID: userID) }
        catch { errorMessage = error.localizedDescription }
    }
}

#Preview { NavigationStack { MemberProfileView(userID: UUID()) } }
