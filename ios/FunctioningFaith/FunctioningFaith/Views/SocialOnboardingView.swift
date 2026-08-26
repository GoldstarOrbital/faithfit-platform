import SwiftUI

enum SocialOnboardingGate {
    static func shouldPresent(pendingUserID: String, profileID: UUID?) -> Bool {
        guard !pendingUserID.isEmpty, let profileID else { return false }
        return pendingUserID.caseInsensitiveCompare(profileID.uuidString) == .orderedSame
    }
}

/// A short, choice-led first run for newly created accounts. The goal is a
/// meaningful community connection, not compulsory engagement: every action
/// can be skipped and notification permission is requested only after opt-in.
struct SocialOnboardingView: View {
    let onComplete: () -> Void

    @State private var step = 0
    @State private var suggestions: [SuggestedUser] = []
    @State private var groups: [ExploreGroup] = []
    @State private var isLoading = true
    @State private var joinedGroupIDs = Set<String>()
    @State private var followedUserIDs = Set<UUID>()
    @AppStorage("notifications.scripture") private var scriptureNotifications = true
    @AppStorage("notifications.community") private var communityNotifications = true
    @State private var statusMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ProgressView(value: Double(step + 1), total: 3)
                    .tint(FFTheme.hearth)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)

                Group {
                    switch step {
                    case 0: welcomeStep
                    case 1: communityStep
                    default: notificationStep
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                HStack(spacing: 12) {
                    if step > 0 {
                        Button("Back") { step -= 1 }
                            .buttonStyle(.ffGhost)
                    }
                    Button(step == 2 ? "Enter Functioning Faith" : "Continue") {
                        if step == 2 { finish() } else { step += 1 }
                    }
                    .buttonStyle(.ffPrimary)
                    .frame(maxWidth: .infinity)
                }
                .padding(24)
            }
            .background(Color(.systemGroupedBackground))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Skip") { onComplete() }
                }
            }
            .task { await loadCommunity() }
        }
    }

    private var welcomeStep: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: 74))
                    .foregroundStyle(FFTheme.hearth)
                    .accessibilityHidden(true)
                Text("Welcome to your Christian fitness community")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                Text("Training is easier to sustain when it is connected to purpose and people. Choose what helps; everything here remains under your control.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 14) {
                    onboardingPoint("Move with purpose", icon: "figure.run")
                    onboardingPoint("Encourage real people", icon: "person.2.fill")
                    onboardingPoint("Keep Scripture close", icon: "book.closed.fill")
                    onboardingPoint("Control your privacy", icon: "lock.shield.fill")
                }
                .padding()
                .background(.background, in: RoundedRectangle(cornerRadius: 18))
            }
            .padding(24)
        }
    }

    private var communityStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Find your people").font(.largeTitle.bold())
                Text("One genuine connection makes the feed more useful. These suggestions come from shared communities and mutual connections.")
                    .foregroundStyle(.secondary)

                if isLoading {
                    ProgressView("Finding community...").frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    if !suggestions.isEmpty {
                        Text("People").font(.headline)
                        ForEach(suggestions.prefix(3)) { user in
                            actionRow(
                                title: user.displayName,
                                subtitle: user.reason,
                                completed: followedUserIDs.contains(user.id),
                                actionTitle: "Follow"
                            ) { follow(user) }
                        }
                    }
                    if !groups.isEmpty {
                        Text("Groups").font(.headline).padding(.top, 6)
                        ForEach(groups.prefix(3)) { group in
                            actionRow(
                                title: group.name,
                                subtitle: [group.sport, group.churchName, group.locationName].compactMap { $0 }.joined(separator: " · "),
                                completed: joinedGroupIDs.contains(group.id),
                                actionTitle: "Join"
                            ) { join(group) }
                        }
                    }
                    if suggestions.isEmpty && groups.isEmpty {
                        ContentUnavailableView("Community is growing", systemImage: "person.2", description: Text("You can discover people and groups from Explore at any time."))
                    }
                }
                if let statusMessage {
                    Text(statusMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
    }

    private var notificationStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Choose your encouragement").font(.largeTitle.bold())
                Text("Notifications are optional. Select only what would add value to your day; neither choice is required to use the app.")
                    .foregroundStyle(.secondary)
                notificationChoice(
                    title: "Scripture encouragement",
                    detail: "Occasional verses connected to your chosen rhythm.",
                    icon: "book.closed.fill",
                    isOn: $scriptureNotifications
                )
                notificationChoice(
                    title: "Community replies",
                    detail: "Direct responses and invitations from people you chose to connect with.",
                    icon: "person.2.fill",
                    isOn: $communityNotifications
                )
                Label("You can change these choices in Profile or iOS Settings.", systemImage: "hand.raised.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
            .padding(24)
        }
    }

    @ViewBuilder
    private func onboardingPoint(_ title: String, icon: String) -> some View {
        Label(title, systemImage: icon)
            .font(.headline)
            .foregroundStyle(.primary)
    }

    @ViewBuilder
    private func actionRow(title: String, subtitle: String, completed: Bool, actionTitle: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: completed ? "checkmark.circle.fill" : "person.crop.circle")
                .font(.title2)
                .foregroundStyle(completed ? FFTheme.emerald : FFTheme.meadow)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer()
            Button(completed ? "Added" : actionTitle, action: action)
                .buttonStyle(.ffGhost)
                .disabled(completed)
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder
    private func notificationChoice(title: String, detail: String, icon: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: icon).foregroundStyle(FFTheme.hearth)
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
    }

    private func loadCommunity() async {
        let peopleTask = Task { try? await APIClient.shared.fetchSuggestedUsers() }
        let exploreTask = Task { try? await APIClient.shared.fetchExploreContent() }
        suggestions = (await peopleTask.value) ?? []
        if let content = await exploreTask.value { groups = content.groups }
        isLoading = false
    }

    private func follow(_ user: SuggestedUser) {
        Task {
            do {
                let response = try await APIClient.shared.followUser(id: user.id)
                if response.following { followedUserIDs.insert(user.id) }
            } catch { statusMessage = error.localizedDescription }
        }
    }

    private func join(_ group: ExploreGroup) {
        Task {
            do {
                try await APIClient.shared.setGroupMembership(id: group.id, joining: true)
                joinedGroupIDs.insert(group.id)
            } catch { statusMessage = error.localizedDescription }
        }
    }

    private func finish() {
        Task {
            if scriptureNotifications {
                _ = await NotificationCoordinator.shared.enable(category: .scripture)
            }
            if communityNotifications {
                _ = await NotificationCoordinator.shared.enable(category: .community)
            }
            await MainActor.run { onComplete() }
        }
    }
}

#Preview { SocialOnboardingView {} }
