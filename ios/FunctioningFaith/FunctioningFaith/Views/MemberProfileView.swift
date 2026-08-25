import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A purpose-first member profile: identity, community counts, actions, and
/// public encouragement — familiar hierarchy without copying another network.
struct MemberProfileView: View {
    let userID: UUID
    @EnvironmentObject private var dmStore: DMStore
    @State private var profile: MemberProfileResponse?
    @State private var avatarImage: UIImage?
    @State private var conversation: MemberConversationDestination?
    @State private var isFollowingAction = false
    @State private var isOpeningMessage = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let profile {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        identityHeader(profile)
                        actionRow(profile)
                        if let ref = profile.user.bioVerseRef { verseCard(reference: ref, text: profile.user.bioVerseText) }
                        if let label = profile.user.bioLinkLabel, let rawURL = profile.user.bioLinkURL, let url = URL(string: rawURL) {
                            Link(destination: url) { Label(label, systemImage: "link") }.buttonStyle(.ffGhost)
                        }
                        momentsSection(profile.posts)
                    }
                    .padding()
                }
            } else if let errorMessage {
                ContentUnavailableView("Profile unavailable", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(errorMessage))
            } else {
                ProgressView("Loading profile…")
            }
        }
        .background(FFTheme.parchment0.ignoresSafeArea())
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .navigationDestination(item: $conversation) { target in
            DMConversationView(threadID: target.threadID, otherUserID: target.userID, otherName: target.name)
                .environmentObject(dmStore)
        }
        .alert("Profile action unavailable", isPresented: Binding(get: { errorMessage != nil && profile != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "Please try again.") }
    }

    private func identityHeader(_ profile: MemberProfileResponse) -> some View {
        HStack(alignment: .top, spacing: 15) {
            Group {
                if let avatarImage { Image(uiImage: avatarImage).resizable().scaledToFill() }
                else { Image(systemName: "person.fill").font(.title).foregroundStyle(FFTheme.cream) }
            }
            .frame(width: 86, height: 86)
            .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
            .clipShape(Circle())
            .overlay(Circle().stroke(FFTheme.goldBright.opacity(0.7), lineWidth: 3))

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Text(profile.user.displayName).font(FFTheme.display(24, weight: .bold, relativeTo: .title2))
                    if profile.user.verifiedDeveloper { Image(systemName: "checkmark.seal.fill").foregroundStyle(FFTheme.meadow) }
                }
                Text(profile.isFollowing ? "Moving with you" : "Functioning Faith member")
                    .font(.subheadline).foregroundStyle(FFTheme.inkSoft)
                HStack(spacing: 0) {
                    profileStat("Workouts", profile.stats.workouts)
                    profileStat("Followers", profile.stats.followers)
                    profileStat("Following", profile.stats.following)
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }

    private func profileStat(_ label: String, _ value: Int?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value.map(String.init) ?? "Private").font(.subheadline.weight(.bold).monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(FFTheme.inkSoft)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actionRow(_ profile: MemberProfileResponse) -> some View {
        if !profile.isMe {
            HStack(spacing: 10) {
                Button(profile.isFollowing ? "Following" : (profile.followRequested ? "Requested" : "Follow")) { Task { await follow() } }
                    .buttonStyle(.ffPrimary).disabled(isFollowingAction || profile.followRequested)
                Button { Task { await message(profile.user) } } label: {
                    if isOpeningMessage { ProgressView().frame(maxWidth: .infinity) }
                    else { Label("Message", systemImage: "paperplane.fill").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.ffGhost).disabled(isOpeningMessage || profile.isBlocked)
            }
        }
    }

    private func verseCard(reference: String, text: String?) -> some View {
        NavigationLink {
            VerseThreadView(reference: reference)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Label("Faith anchor", systemImage: "book.closed.fill").font(.caption.weight(.bold)).foregroundStyle(FFTheme.scripture)
                Text(reference).font(.headline).foregroundStyle(FFTheme.ink)
                if let text { Text(text).font(.subheadline).italic().foregroundStyle(FFTheme.inkSoft) }
            }
            .padding(15).frame(maxWidth: .infinity, alignment: .leading)
            .background(FFTheme.scripture.opacity(0.1), in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func momentsSection(_ posts: [MemberProfilePost]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Shared encouragement", systemImage: "square.grid.2x2.fill").font(.headline).foregroundStyle(FFTheme.ink)
            if posts.isEmpty {
                Text("No public moments to show yet.").font(.subheadline).foregroundStyle(FFTheme.inkSoft)
                    .frame(maxWidth: .infinity, minHeight: 104)
                    .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(posts) { post in
                        VStack(alignment: .leading, spacing: 7) {
                            if let dataURL = post.photoData, let image = ImageUpload.decode(dataURL) {
                                Image(uiImage: image).resizable().scaledToFill().frame(height: 132).clipped()
                            } else {
                                Image(systemName: post.videoData == nil ? "quote.bubble.fill" : "play.rectangle.fill")
                                    .font(.title2).foregroundStyle(FFTheme.cream)
                                    .frame(maxWidth: .infinity, minHeight: 96)
                                    .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                            }
                            if !post.content.isEmpty { Text(post.content).font(.caption.weight(.medium)).foregroundStyle(FFTheme.ink).lineLimit(3).padding(.horizontal, 10) }
                            if let reference = post.verseReference {
                                NavigationLink {
                                    VerseThreadView(reference: reference)
                                } label: {
                                    Text(reference).font(.caption2.weight(.bold)).foregroundStyle(FFTheme.scripture)
                                }
                                .buttonStyle(.plain)
                                .padding(.horizontal, 10)
                                .padding(.bottom, 10)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                        .clipShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                    }
                }
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await APIClient.shared.fetchMemberProfile(userID: userID)
            profile = loaded
            if loaded.user.hasAvatar, let dataURL = try? await APIClient.shared.fetchAvatarData(userID: userID) { avatarImage = ImageUpload.decode(dataURL) }
        } catch { errorMessage = error.localizedDescription }
    }

    private func follow() async {
        isFollowingAction = true
        defer { isFollowingAction = false }
        do { _ = try await APIClient.shared.followUser(id: userID); await load() }
        catch { errorMessage = error.localizedDescription }
    }

    private func message(_ member: MemberProfile) async {
        isOpeningMessage = true
        defer { isOpeningMessage = false }
        do {
            let opened = try await APIClient.shared.openDMThread(withUserID: member.id)
            await dmStore.loadInbox()
            conversation = MemberConversationDestination(threadID: opened.threadID, userID: member.id, name: opened.otherName)
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct MemberConversationDestination: Identifiable, Hashable {
    let threadID: String
    let userID: UUID
    let name: String
    var id: String { threadID }
}

#Preview {
    NavigationStack { MemberProfileView(userID: UUID()) }.environmentObject(DMStore())
}
