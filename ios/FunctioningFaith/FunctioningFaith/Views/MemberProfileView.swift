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
    @State private var expandedPost: MemberProfilePost?
    @State private var mutuals: MutualFollowersResponse?
    @State private var isSafetyActionWorking = false
    @State private var showBlockConfirm = false

    var body: some View {
        Group {
            if let profile {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        identityHeader(profile)
                        if let mutuals { mutualsRow(mutuals) }
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
        .sheet(item: $expandedPost) { post in
            PostMediaDetailView(post: post)
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
                    profileStat("Posts", profile.stats.posts)
                    profileStat("Workouts", profile.stats.workouts)
                    profileStat("Followers", profile.stats.followers, kind: "followers")
                    profileStat("Following", profile.stats.following, kind: "following")
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: FFTheme.Radius.lg, style: .continuous))
    }

    /// `kind`, when given, makes a non-nil count tappable through to the real
    /// followers/following list (SocialListView) -- previously these were
    /// plain numbers with nowhere to go. A nil value means the member hides
    /// this count, shown as a lock rather than the word "Private" reading
    /// like a stat literally named that.
    @ViewBuilder
    private func profileStat(_ label: String, _ value: Int?, kind: String? = nil) -> some View {
        if let kind, value != nil {
            NavigationLink {
                SocialListView(userID: userID, kind: kind, title: label)
            } label: { statContent(label, value) }
            .buttonStyle(.plain)
        } else {
            statContent(label, value)
        }
    }

    private func statContent(_ label: String, _ value: Int?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let value {
                Text(String(value)).font(.subheadline.weight(.bold).monospacedDigit())
            } else {
                Label("Private", systemImage: "lock.fill")
                    .font(.caption.weight(.semibold)).foregroundStyle(FFTheme.muted)
            }
            Text(label).font(.caption2).foregroundStyle(FFTheme.inkSoft)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Followed by X, Y and N others" -- the standard mutual-connections
    /// line on any social profile, absent from this app until now.
    private func mutualsRow(_ mutuals: MutualFollowersResponse) -> some View {
        Group {
            if mutuals.total > 0 {
                HStack(spacing: 8) {
                    HStack(spacing: -8) {
                        ForEach(mutuals.members.prefix(3)) { member in
                            MemberAvatarView(userID: member.id, hasAvatar: member.hasAvatar, size: 22)
                                .overlay(Circle().stroke(FFTheme.parchment0, lineWidth: 2))
                        }
                    }
                    Text(mutualsText(mutuals)).font(.caption).foregroundStyle(FFTheme.inkSoft)
                }
            }
        }
    }

    private func mutualsText(_ mutuals: MutualFollowersResponse) -> String {
        let names = mutuals.members.prefix(2).map(\.displayName)
        let extra = mutuals.total - names.count
        if names.isEmpty { return "Followed by \(mutuals.total) people you follow" }
        let joined = names.joined(separator: ", ")
        return extra > 0 ? "Followed by \(joined) and \(extra) more you follow" : "Followed by \(joined)"
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
                safetyMenu(profile)
            }
        }
    }

    // The server has sent is_muted/is_restricted (and enforced both --
    // muting filters the feed, restricting blocks DM open/send) since it
    // shipped the equivalent web UI (webapp/public/app.js's profile-mute/
    // profile-restrict handlers); this was the only client with no way to
    // actually turn either one on, only to undo one that was somehow already
    // set (SafetyView). Block was in the same position -- reachable from a
    // post's overflow menu or a DM conversation's toolbar, but not from the
    // profile itself, unlike web's three-button row.
    private func safetyMenu(_ profile: MemberProfileResponse) -> some View {
        Menu {
            Button(profile.isMuted ? "Unmute" : "Mute") { Task { await setSafety(control: "mute", on: !profile.isMuted) } }
            Button(profile.isRestricted ? "Un-restrict" : "Restrict") { Task { await setSafety(control: "restrict", on: !profile.isRestricted) } }
            if profile.isBlocked {
                Button("Unblock") { Task { await toggleBlock(blocking: false) } }
            } else {
                Button("Block", role: .destructive) { showBlockConfirm = true }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3)
                .frame(width: 44, height: 44)
        }
        .disabled(isSafetyActionWorking)
        .confirmationDialog(
            "Block \(profile.user.displayName)?",
            isPresented: $showBlockConfirm, titleVisibility: .visible
        ) {
            Button("Block", role: .destructive) { Task { await toggleBlock(blocking: true) } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Neither of you will be able to message the other, and their posts and workouts will no longer appear to you.")
        }
    }

    private func setSafety(control: String, on: Bool) async {
        isSafetyActionWorking = true
        defer { isSafetyActionWorking = false }
        do {
            // .uuidString is uppercase on Apple platforms; the server's ids
            // are lowercase and this lookup is a case-sensitive SQLite `=`
            // (see fetchMemberProfile's identical .lowercased() a few lines
            // up, and stopWorkout's comment on the same issue) -- passing it
            // unlowered here would 404 on every single call.
            try await APIClient.shared.setRelationshipControl(userID: userID.uuidString.lowercased(), control: control, on: on)
            NotificationCenter.default.post(name: .relationshipControlsChanged, object: nil)
            await load()
        } catch { errorMessage = error.localizedDescription }
    }

    private func toggleBlock(blocking: Bool) async {
        isSafetyActionWorking = true
        defer { isSafetyActionWorking = false }
        do {
            if blocking { try await APIClient.shared.blockUser(id: userID) }
            else { try await APIClient.shared.unblockUser(id: userID) }
            NotificationCenter.default.post(name: .relationshipControlsChanged, object: nil)
            await load()
        } catch { errorMessage = error.localizedDescription }
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
                            // Photos and videos both open the full post --
                            // a photo enlarged, a video actually playing,
                            // instead of a tile that does nothing when tapped
                            // (video previously had no way to play at all
                            // from this grid, just a static icon).
                            Group {
                                if let dataURL = post.photoData, let image = ImageUpload.decode(dataURL) {
                                    Button { expandedPost = post } label: {
                                        Image(uiImage: image).resizable().scaledToFill().frame(height: 132).clipped()
                                    }
                                    .buttonStyle(.plain)
                                } else if post.videoData != nil {
                                    Button { expandedPost = post } label: {
                                        ZStack {
                                            LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
                                            Image(systemName: "play.rectangle.fill").font(.title2).foregroundStyle(FFTheme.cream)
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 96)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    Image(systemName: "quote.bubble.fill")
                                        .font(.title2).foregroundStyle(FFTheme.cream)
                                        .frame(maxWidth: .infinity, minHeight: 96)
                                        .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                                }
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
            if !loaded.isMe { mutuals = try? await APIClient.shared.fetchMutualFollowers(userID: userID) }
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

/// A grid tile's full view -- the enlarged photo, or the video actually
/// playing (FeedVideoView, shared with the home feed's own post media).
private struct PostMediaDetailView: View {
    let post: MemberProfilePost
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    #if canImport(UIKit)
                    if let dataURL = post.photoData, let image = ImageUpload.decode(dataURL) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: FFTheme.Radius.md, style: .continuous))
                    }
                    #endif
                    if let dataURL = post.videoData {
                        FeedVideoView(dataURL: dataURL)
                    }
                    if !post.content.isEmpty {
                        Text(post.content).font(.body).foregroundStyle(FFTheme.ink)
                    }
                    if let reference = post.verseReference {
                        NavigationLink { VerseThreadView(reference: reference) } label: {
                            Label(reference, systemImage: "book.closed.fill")
                                .font(.caption.weight(.bold)).foregroundStyle(FFTheme.scripture)
                        }
                    }
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}

#Preview {
    NavigationStack { MemberProfileView(userID: UUID()) }.environmentObject(DMStore())
}
