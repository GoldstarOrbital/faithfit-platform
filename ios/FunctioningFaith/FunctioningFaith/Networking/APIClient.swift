import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case requestFailed(Int, String?)
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The server returned an invalid response."
        case .requestFailed(let code, let message): return message ?? "The request failed (\(code))."
        case .notSignedIn: return "Please sign in to continue."
        }
    }
}

/// Cookie-backed client shared by the native screens. The web backend already
/// uses an HttpOnly session cookie, so URLSession keeps the native sign-in and
/// API calls on the same authenticated session without inventing a second token
/// format. Mock mode remains available for previews and offline UI review.
final class APIClient {
    static let shared = APIClient()

#if DEBUG
    var useMock = true
#else
    var useMock = false
#endif

    var baseURL = URL(string: "https://faithfit-demo-production.up.railway.app")!
    private let session = URLSession.shared
    private let decoder: JSONDecoder

    private init() {
        decoder = JSONDecoder()
    }

    func fetchFeed() async throws -> [FeedPost] {
        let page = try await fetchFeedPage()
        return page.posts
    }

    func fetchFeedPage(before: String? = nil) async throws -> FeedPage {
        if useMock { return FeedPage(posts: MockData.feed, nextCursor: nil) }
        // The production feed is a cursor-paginated envelope. Keep the cursor
        // on the client so native scrolling never reloads already-rendered rows.
        var path = "/api/feed?limit=20"
        if let before, let encoded = before.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&before=\(encoded)"
        }
        let response: FeedResponse = try await request(path)
        return FeedPage(posts: response.posts.map(\.model), nextCursor: response.nextCursor)
    }

    func fetchProfile() async throws -> UserProfile {
        (try await fetchSessionState()).profile
    }

    func fetchSessionState() async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let response: MeDTO = try await request("/api/me")
        return NativeSessionState(profile: response.model, accountSetupRequired: response.accountSetupRequired ?? false)
    }

    func fetchAuthProviders() async throws -> [NativeAuthProvider] {
        if useMock { return [NativeAuthProvider(name: "google", label: "Google"), NativeAuthProvider(name: "apple", label: "Apple")] }
        let response: AuthProvidersResponse = try await request("/api/auth/providers")
        return response.providers
    }

    func fetchSuggestedUsers() async throws -> [SuggestedUser] {
        if useMock { return [] }
        let response: [SuggestedUserDTO] = try await request("/api/users/suggested")
        return response.map(\.model)
    }

    func followUser(id: UUID) async throws -> FollowResponse {
        if useMock { return FollowResponse(following: true, followersCount: 1) }
        return try await request("/api/users/\(id.uuidString)/follow", method: "POST", body: EmptyBody())
    }

    func fetchExploreContent() async throws -> ExploreContent {
        if useMock { return MockData.exploreContent }
        async let catalog: ExploreResponse = request("/api/explore")
        async let challenges: [ExploreChallenge] = request("/api/challenges")
        let (base, liveChallenges) = try await (catalog, challenges)
        return ExploreContent(groups: base.groups, quests: base.quests, challenges: liveChallenges)
    }

    func joinChallenge(id: String) async throws {
        if useMock { return }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let _: ActionResponse = try await request("/api/challenges/\(encoded)/join", method: "POST", body: EmptyBody())
    }

    func fetchGroupDetail(id: String) async throws -> NativeGroupDetail {
        if useMock { return MockData.groupDetail }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let response: GroupDetailResponse = try await request("/api/groups/\(encoded)")
        return response.model
    }

    func setGroupMembership(id: String, joining: Bool) async throws {
        if useMock { return }
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let action = joining ? "join" : "leave"
        let _: ActionResponse = try await request("/api/groups/\(encoded)/\(action)", method: "POST", body: EmptyBody())
    }

    /// Organiser-only. Passing an empty string clears the pinned note --
    /// matches the server's own semantics (`text || null`), not a separate
    /// delete endpoint.
    func setGroupAnnouncement(groupID: String, text: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request(
            "/api/groups/\(groupID)/announcement", method: "PUT", body: AnnouncementBody(text: text)
        )
    }

    func fetchGroupMembers(groupID: String) async throws -> [GroupMemberEntry] {
        if useMock { return [] }
        let r: GroupMembersResponse = try await request("/api/groups/\(groupID)/members")
        return r.members
    }

    /// Organiser-only; the server itself refuses to remove the group's
    /// owner or let an admin remove themselves this way (that's "leave"
    /// instead, which triggers ownership handover).
    func removeGroupMember(groupID: String, userID: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/groups/\(groupID)/members/\(userID)", method: "DELETE")
    }

    func sendGroupMessage(groupID: String, content: String) async throws -> GroupMessage {
        if useMock {
            return GroupMessage(id: UUID().uuidString, content: content, createdAt: ISO8601DateFormatter().string(from: .now), authorID: MockData.profile.id.uuidString, author: MockData.profile.displayName)
        }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(encoded)/messages", method: "POST", body: GroupMessageBody(content: content))
    }

    func fetchGroupPulse(groupID: String) async throws -> GroupPulse {
        if useMock { return MockData.groupPulse }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(encoded)/pulse")
    }

    func updateGroupPulse(groupID: String, kind: String, note: String, day: String) async throws -> GroupPulseCheckin {
        if useMock { return MockData.groupPulse.checkins[0] }
        guard let encoded = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request(
            "/api/groups/\(encoded)/pulse",
            method: "POST",
            body: GroupPulseBody(kind: kind, note: note, day: day)
        )
    }

    func encourageGroupPulse(groupID: String, checkinID: String) async throws -> PulseEncouragementResponse {
        if useMock { return PulseEncouragementResponse(encouraged: true, encouragementCount: 2) }
        guard let group = groupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let checkin = checkinID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/groups/\(group)/pulse/\(checkin)/encourage", method: "POST", body: EmptyBody())
    }

    func login(email: String, password: String) async throws -> NativeLoginOutcome {
        if useMock { return .authenticated(NativeSessionState(profile: MockData.profile, accountSetupRequired: false)) }
        let response: AuthResponse = try await request("/api/auth/login", method: "POST", body: Credentials(email: email, password: password))
        if response.mfaRequired == true { return .mfaRequired }
        return .authenticated(try await fetchSessionState())
    }

    func completeMfa(code: String) async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let _: AuthResponse = try await request("/api/auth/mfa/complete", method: "POST", body: MfaBody(code: code))
        return try await fetchSessionState()
    }

    func exchangeNativeOAuth(code: String, handoffVerifier: String) async throws -> NativeSessionState {
        if useMock { return NativeSessionState(profile: MockData.profile, accountSetupRequired: false) }
        let response: NativeOAuthExchangeResponse = try await request(
            "/api/auth/native/exchange",
            method: "POST",
            body: NativeOAuthExchangeBody(code: code, handoffVerifier: handoffVerifier)
        )
        let state = try await fetchSessionState()
        return NativeSessionState(profile: state.profile, accountSetupRequired: response.accountSetupRequired)
    }

    func signInWithApple(identityToken: String, nonce: String, displayName: String?) async throws -> NativeLoginOutcome {
        if useMock { return .authenticated(NativeSessionState(profile: MockData.profile, accountSetupRequired: false)) }
        let response: NativeAppleAuthResponse = try await request(
            "/api/auth/native/apple",
            method: "POST",
            body: NativeAppleAuthBody(identityToken: identityToken, nonce: nonce, displayName: displayName)
        )
        if response.mfaRequired == true { return .mfaRequired }
        let state = try await fetchSessionState()
        return .authenticated(NativeSessionState(
            profile: state.profile,
            accountSetupRequired: response.accountSetupRequired ?? state.accountSetupRequired
        ))
    }

    func register(name: String, email: String, password: String) async throws -> UserProfile {
        if useMock { return MockData.profile }
        let _: AuthResponse = try await request("/api/auth/register", method: "POST", body: Registration(displayName: name, email: email, password: password))
        return try await fetchProfile()
    }

    func logout() async throws {
        guard !useMock else { return }
        let _: AuthResponse = try await request("/api/auth/logout", method: "POST", body: EmptyBody())
    }

    func startWorkout(type: String) async throws -> WorkoutSummary {
        if useMock { return MockData.activeWorkout(type: type) }
        let response: WorkoutStartResponse = try await request("/api/workouts/start", method: "POST", body: WorkoutStart(type: type))
        return WorkoutSummary(id: response.id, type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil)
    }

    func stopWorkout(id: UUID, gpsPoints: [[Double]]) async throws {
        if useMock { return }
        let _: WorkoutStopResponse = try await request("/api/workouts/\(id.uuidString)/stop", method: "POST", body: WorkoutStop(gpsPoints: gpsPoints))
    }

    /// Uploads Apple Health-sourced workouts and daily step totals. The
    /// native client is already on an authenticated session cookie, so this
    /// is a plain POST — no OAuth handshake the way Strava/Google Health need
    /// one, since HealthKit data never leaves the device except through this
    /// call the member's own app makes.
    func syncAppleHealth(_ payload: SyncPayload) async throws -> SyncResult {
        if useMock { return SyncResult(imported: 0, checked: 0, stepDaysSynced: 0) }
        let body = AppleHealthSyncBody(
            workouts: payload.workouts.map { w in
                AppleHealthSyncBody.Workout(
                    externalID: w.externalID, activityType: w.activityType,
                    startTime: ISO8601DateFormatter().string(from: w.startTime),
                    endTime: ISO8601DateFormatter().string(from: w.endTime),
                    durationSec: w.durationSec, calories: w.calories,
                    distanceMeters: w.distanceMeters, avgHeartRate: w.avgHeartRate
                )
            },
            dailySteps: payload.dailySteps.map { AppleHealthSyncBody.DailySteps(date: $0.date, steps: $0.steps) }
        )
        let response: AppleHealthSyncResponse = try await request("/api/connectors/apple-health/sync", method: "POST", body: body)
        return SyncResult(imported: response.imported, checked: response.checked, stepDaysSynced: response.stepDaysSynced)
    }

    func deleteAccount() async throws {
        if useMock { return }
        let _: AuthResponse = try await request("/api/me", method: "DELETE")
    }

    func likePost(id: UUID) async throws -> PostReactionResponse {
        if useMock { return PostReactionResponse(liked: true, likeCount: 1) }
        return try await request("/api/posts/\(id.uuidString)/like", method: "POST", body: EmptyBody())
    }

    func savePost(id: UUID) async throws -> PostSaveResponse {
        if useMock { return PostSaveResponse(saved: true) }
        return try await request("/api/posts/\(id.uuidString)/save", method: "POST", body: EmptyBody())
    }

    func fetchComments(postID: UUID) async throws -> [FeedComment] {
        if useMock { return [] }
        let response: CommentListResponse = try await request("/api/posts/\(postID.uuidString)/comments")
        return response.comments.map(\.model)
    }

    func addComment(postID: UUID, content: String) async throws -> FeedComment {
        if useMock {
            return FeedComment(id: UUID(), content: content, author: MockData.profile.displayName, createdAt: ISO8601DateFormatter().string(from: .now), likeCount: 0, likedByMe: false)
        }
        let response: CommentDTO = try await request("/api/posts/\(postID.uuidString)/comments", method: "POST", body: CommentBody(content: content))
        return response.model
    }

    func likeComment(id: UUID) async throws -> CommentReactionResponse {
        if useMock { return CommentReactionResponse(liked: true, likeCount: 1) }
        return try await request("/api/comments/\(id.uuidString)/like", method: "POST", body: EmptyBody())
    }

    func createPost(content: String, visibility: String, photoData: String?, photoCategory: String?) async throws -> CreatedPostResponse {
        if useMock { return CreatedPostResponse(id: UUID(), visibility: visibility, shareURL: nil) }
        return try await request(
            "/api/posts",
            method: "POST",
            body: CreatePostBody(content: content, visibility: visibility, photoData: photoData, photoCategory: photoCategory)
        )
    }

    func reportPost(id: UUID, reason: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/posts/\(id.uuidString)/report", method: "POST", body: ReportBody(reason: reason))
    }

    func blockUser(id: UUID) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/users/\(id.uuidString)/block", method: "POST", body: EmptyBody())
    }

    func unblockUser(id: UUID) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/users/\(id.uuidString)/block", method: "DELETE")
    }

    // MARK: - Direct messages
    // Raw wire shapes only -- decryption of e2e-kind bodies happens in
    // DMStore, which owns the crypto layer. Keeping APIClient a pure
    // networking client (no E2ECrypto import here) mirrors the web app's own
    // separation between api.js and e2e-crypto.js.

    func fetchDMInbox() async throws -> (threads: [DMThreadDTO], unread: Int) {
        if useMock { return ([], 0) }
        let r: DMInboxResponse = try await request("/api/dms")
        return (r.threads, r.unread)
    }

    func openDMThread(withUserID id: UUID) async throws -> (threadID: String, otherName: String) {
        if useMock { return ("mock-thread", "Preview User") }
        let r: DMOpenResponse = try await request("/api/dms/with/\(id.uuidString)", method: "POST", body: EmptyBody())
        return (r.threadID, r.user.displayName)
    }

    func fetchDMThread(id: String) async throws -> DMThreadDTO {
        if useMock { throw APIError.invalidResponse }
        return try await request("/api/dms/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    /// `plaintextForServerScan` is sent only for non-e2e messages, so the
    /// server's link-safety scan (which cannot and must not see inside real
    /// ciphertext) still runs on ordinary text. For an e2e message, `body` is
    /// already the ciphertext blob and the scan is skipped server-side.
    func sendDM(threadID: String, body: String, isE2E: Bool) async throws -> DMMessageDTO {
        if useMock { throw APIError.invalidResponse }
        let r: DMSendResponse = try await request(
            "/api/dms/\(threadID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? threadID)",
            method: "POST", body: DMSendBody(body: body, e2e: isE2E)
        )
        return r.message
    }

    func publishE2EPublicKey(_ jwk: [String: String]) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/dms/keys", method: "POST", body: E2EKeyBody(publicKey: jwk))
    }

    /// nil when that person hasn't published a key yet (never sent an
    /// encrypted message, or is on an old client version).
    func fetchE2EPublicKey(userID: UUID) async throws -> [String: String]? {
        if useMock { return nil }
        let r: E2EKeyResponse = try await request("/api/dms/keys/\(userID.uuidString)")
        return r.publicKey?.asStringDict
    }

    // MARK: - Stats & personal records

    func fetchStatsSummary() async throws -> StatsSummary {
        if useMock { throw APIError.invalidResponse }
        return try await request("/api/stats/summary")
    }

    func fetchTrends(weeks: Int = 12) async throws -> [TrendPoint] {
        if useMock { return [] }
        return try await request("/api/stats/trends?weeks=\(weeks)")
    }

    func fetchActivityBreakdown() async throws -> [ActivityBreakdownEntry] {
        if useMock { return [] }
        return try await request("/api/stats/activity-breakdown")
    }

    /// Keyed by activity type, matching the server's grouping exactly.
    func fetchPersonalRecords() async throws -> [String: [PersonalRecord]] {
        if useMock { return [:] }
        let r: RecordsResponse = try await request("/api/records")
        return r.records
    }

    // MARK: - Stories / Moments (24h ephemeral)

    func fetchStories() async throws -> [Story] {
        if useMock { return [] }
        let r: StoriesResponse = try await request("/api/stories")
        return r.stories
    }

    /// `photoData` is a full data: URL, matching ImageUpload.dataURL's
    /// output -- same shape POST /posts expects, since both endpoints
    /// validate with the exact same validateDataUrlImage() server-side.
    func postStory(content: String, photoData: String?, photoCategory: String?, visibility: String) async throws {
        let _: PostStoryResponse = try await request(
            "/api/stories", method: "POST",
            body: PostStoryBody(content: content, photoData: photoData, photoCategory: photoCategory, visibility: visibility)
        )
    }

    func markStoryViewed(id: String) async throws {
        let _: ActionResponse = try await request("/api/stories/\(id)/view", method: "POST", body: EmptyBody())
    }

    /// Tapping the same emoji again is how the server models "remove my
    /// reaction" -- there's no separate unreact endpoint, matching the
    /// toggle behavior exactly (see the DELETE branch in the server route).
    func reactToStory(id: String, emoji: String) async throws -> StoryReactionResult {
        try await request("/api/stories/\(id)/reaction", method: "POST", body: StoryReactionBody(emoji: emoji))
    }

    /// A Moment reply is delivered as an ordinary protected DM (with the
    /// story's own safety/block/consent checks), not a public comment --
    /// matches the server's own design note on this route.
    func replyToStory(id: String, body: String) async throws -> String {
        let r: StoryReplyResponse = try await request("/api/stories/\(id)/reply", method: "POST", body: StoryReplyBody(body: body))
        return r.threadID
    }

    func deleteStory(id: String) async throws {
        let _: ActionResponse = try await request("/api/stories/\(id)", method: "DELETE")
    }

    // MARK: - Journeys (progress mechanic; see Models.swift's header comment
    // on why the 3D world itself isn't ported)

    func fetchJourneys() async throws -> [JourneySummary] {
        try await request("/api/journeys")
    }

    func fetchJourneyDetail(key: String) async throws -> JourneyDetail {
        try await request("/api/journeys/\(key)")
    }

    func joinJourney(key: String) async throws {
        let _: ActionResponse = try await request("/api/journeys/\(key)/join", method: "POST", body: EmptyBody())
    }

    func leaveJourney(key: String) async throws {
        let _: ActionResponse = try await request("/api/journeys/\(key)/leave", method: "POST", body: EmptyBody())
    }

    /// `addKm` must be small and positive -- the server rejects anything
    /// over 5km in one call (routes/api.js's own runaway-client guard) --
    /// so a live session must call this with frequent small increments, not
    /// one big jump at the end.
    func postJourneyProgress(key: String, addKm: Double) async throws -> JourneyProgressResult {
        try await request("/api/journeys/\(key)/progress", method: "POST", body: JourneyProgressBody(addKm: addKm))
    }

    // MARK: - Athlete recruiting: discovery only (see Models.swift's header
    // comment on this section for what's deliberately not ported)

    /// Query params match the server's `search({sport, grad_year, q,
    /// school_nces_id, limit})` exactly -- an absent filter is simply
    /// omitted from the query string, not sent as an empty value the
    /// server would otherwise have to specially ignore.
    func searchAthletes(sport: String? = nil, gradYear: Int? = nil, query: String? = nil) async throws -> [AthleteSearchResult] {
        var items: [URLQueryItem] = []
        if let sport, !sport.isEmpty { items.append(URLQueryItem(name: "sport", value: sport)) }
        if let gradYear { items.append(URLQueryItem(name: "grad_year", value: String(gradYear))) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        var components = URLComponents(string: "/api/athletes/search")!
        components.queryItems = items.isEmpty ? nil : items
        let r: AthleteSearchResponse = try await request(components.string ?? "/api/athletes/search")
        return r.athletes
    }

    func fetchAthleteProfile(userID: String) async throws -> AthleteProfile {
        let r: AthleteProfileResponse = try await request("/api/athletes/\(userID)")
        return r.profile
    }

    // MARK: - Hashtags

    func fetchTrendingTags() async throws -> [TrendingTag] {
        if useMock { return [] }
        let r: TrendingTagsResponse = try await request("/api/hashtags/trending")
        return r.tags
    }

    /// Posts for a tag carry only what the server's tag index actually
    /// returns -- no like/comment counts, no verse or workout attachment
    /// (that endpoint doesn't join any of that). Mapped into the same
    /// FeedPost model the home feed uses so FeedPostRow renders it
    /// identically, with those engagement fields at their real (zero/false)
    /// defaults rather than omitted from the UI.
    func fetchPosts(forTag tag: String) async throws -> [FeedPost] {
        if useMock { return [] }
        guard let encoded = tag.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIError.invalidResponse
        }
        let r: HashtagPostsResponse = try await request("/api/hashtags/\(encoded)")
        return r.posts.map(\.model)
    }

    // MARK: - Safety: mute / restrict, trusted circle, follow requests

    func fetchRelationships() async throws -> RelationshipsResponse {
        if useMock { return RelationshipsResponse(muted: [], restricted: [], blocked: []) }
        return try await request("/api/me/relationships")
    }

    /// `control` is "mute" or "restrict" -- matches the server's shared
    /// route `PUT/DELETE /users/:id/:control(mute|restrict)` exactly.
    func setRelationshipControl(userID: String, control: String, on: Bool) async throws {
        if useMock { return }
        let path = "/api/users/\(userID)/\(control)"
        let _: ActionResponse = on
            ? try await request(path, method: "PUT", body: EmptyBody())
            : try await request(path, method: "DELETE")
    }

    func fetchCircle() async throws -> [CircleMember] {
        if useMock { return [] }
        let r: CircleResponse = try await request("/api/circle")
        return r.members
    }

    func fetchCircleCandidates() async throws -> [CircleCandidate] {
        if useMock { return [] }
        let r: CircleCandidatesResponse = try await request("/api/circle/candidates")
        return r.candidates
    }

    func setCircleMembership(userID: String, inCircle: Bool) async throws {
        if useMock { return }
        let path = "/api/circle/\(userID)"
        let _: ActionResponse = inCircle
            ? try await request(path, method: "PUT", body: EmptyBody())
            : try await request(path, method: "DELETE")
    }

    func fetchFollowRequests() async throws -> [FollowRequestUser] {
        if useMock { return [] }
        let r: FollowRequestsResponse = try await request("/api/follow-requests")
        return r.requests
    }

    /// `decision` is "accept" or "decline".
    func decideFollowRequest(requesterID: String, decision: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/follow-requests/\(requesterID)/\(decision)", method: "POST", body: EmptyBody())
    }

    func checkUsernameAvailable(_ name: String) async throws -> UsernameCheckResult {
        guard let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/username-available?name=\(encoded)")
    }

    /// Empty string clears bioVerseRef/tradition (server semantics: `''`
    /// means "unset", matching the web form exactly); job/church have no
    /// such special case and just get stored as-is, empty or not.
    func updateProfile(displayName: String, bioVerseRef: String, job: String, church: String, tradition: String) async throws {
        let _: UpdateProfileResponse = try await request(
            "/api/profile", method: "PUT",
            body: UpdateProfileBody(displayName: displayName, bioVerseRef: bioVerseRef, job: job, church: church, tradition: tradition)
        )
    }

    // MARK: - Notifications

    func fetchNotifications() async throws -> NotificationsResponse {
        if useMock { return NotificationsResponse(notifications: [], unreadCount: 0) }
        return try await request("/api/notifications")
    }

    func markNotificationRead(id: String) async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/notifications/\(id)/read", method: "POST", body: EmptyBody())
    }

    func markAllNotificationsRead() async throws {
        if useMock { return }
        let _: ActionResponse = try await request("/api/notifications/read-all", method: "POST", body: EmptyBody())
    }

    // MARK: - Search

    func search(_ query: String) async throws -> SearchResponse {
        if useMock { return SearchResponse(q: query, groups: [], total: 0) }
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw APIError.invalidResponse
        }
        return try await request("/api/search?q=\(encoded)")
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET") async throws -> T {
        try await request(path, method: method, body: Optional<EmptyBody>.none)
    }

    private func request<T: Decodable, Body: Encodable>(_ path: String, method: String = "GET", body: Body? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios-native-v1", forHTTPHeaderField: "X-Functioning-Faith-Client")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            let details = try? decoder.decode(APIErrorResponse.self, from: data)
            let message = details?.hint ?? details?.error?.replacingOccurrences(of: "_", with: " ").capitalized
            throw APIError.requestFailed(http.statusCode, message)
        }
        return try decoder.decode(T.self, from: data)
    }
}

private struct EmptyBody: Encodable {}
private struct APIErrorResponse: Decodable { let error: String?; let hint: String? }
private struct Credentials: Encodable { let email: String; let password: String }
private struct MfaBody: Encodable { let code: String }
private struct NativeOAuthExchangeBody: Encodable {
    let code: String
    let handoffVerifier: String
    enum CodingKeys: String, CodingKey { case code; case handoffVerifier = "handoff_verifier" }
}
private struct NativeAppleAuthBody: Encodable {
    let identityToken: String
    let nonce: String
    let displayName: String?
    enum CodingKeys: String, CodingKey {
        case identityToken = "identity_token"
        case nonce
        case displayName = "display_name"
    }
}
private struct Registration: Encodable { let displayName: String; let email: String; let password: String; enum CodingKeys: String, CodingKey { case displayName = "display_name"; case email, password } }
private struct WorkoutStart: Encodable { let type: String }
private struct GroupPulseBody: Encodable { let kind: String; let note: String; let day: String }
private struct WorkoutStop: Encodable { let gpsPoints: [[Double]]; enum CodingKeys: String, CodingKey { case gpsPoints = "gps_path" } }
private struct AuthResponse: Decodable {
    let ok: Bool?
    let mfaRequired: Bool?
    enum CodingKeys: String, CodingKey { case ok; case mfaRequired = "mfa_required" }
}
private struct AuthProvidersResponse: Decodable { let providers: [NativeAuthProvider] }
private struct NativeOAuthExchangeResponse: Decodable {
    let accountSetupRequired: Bool
    enum CodingKeys: String, CodingKey { case accountSetupRequired = "account_setup_required" }
}
private struct NativeAppleAuthResponse: Decodable {
    let accountSetupRequired: Bool?
    let mfaRequired: Bool?
    enum CodingKeys: String, CodingKey {
        case accountSetupRequired = "account_setup_required"
        case mfaRequired = "mfa_required"
    }
}
private struct WorkoutStartResponse: Decodable { let id: UUID }
private struct WorkoutStopResponse: Decodable { let id: UUID }

// MARK: - DM wire types (field names match lib/dms.js's real response shapes exactly)

struct DMThreadDTO: Decodable {
    struct OtherUser: Decodable {
        let id: UUID
        let displayName: String
        let hasAvatar: Bool
        enum CodingKeys: String, CodingKey { case id; case displayName = "display_name"; case hasAvatar = "has_avatar" }
    }
    let threadID: String
    let user: OtherUser
    // Inbox-list fields (present on GET /dms, absent on GET /dms/:id):
    let lastBody: String?
    let lastKind: String?
    let lastFromMe: Bool?
    let lastMessageAt: String?
    let unread: Int?
    // Thread-detail fields (present on GET /dms/:id, absent on GET /dms):
    let blocked: Bool?
    let messages: [DMMessageDTO]?

    enum CodingKeys: String, CodingKey {
        case threadID = "thread_id", user
        case lastBody = "last_body", lastKind = "last_kind", lastFromMe = "last_from_me"
        case lastMessageAt = "last_message_at", unread
        case blocked, messages
    }
}

struct DMMessageDTO: Decodable {
    let id: String
    let body: String
    let kind: String
    let fromMe: Bool
    let createdAt: String
    let read: Bool
    let metadata: [String: JSONValue]?

    enum CodingKeys: String, CodingKey { case id, body, kind; case fromMe = "from_me"; case createdAt = "created_at"; case read, metadata }
}

/// Minimal decode-anything box for `metadata`, whose shape varies by message
/// kind (a verse share carries {reference,text,share_url}; other kinds carry
/// other fields). Only `reference` is actually read today.
enum JSONValue: Decodable {
    case string(String), number(Double), bool(Bool), null, object([String: JSONValue]), array([JSONValue])
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .null }
    }
    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
}

private struct DMInboxResponse: Decodable { let threads: [DMThreadDTO]; let unread: Int }
private struct DMOpenResponse: Decodable {
    let threadID: String
    struct U: Decodable { let id: UUID; let displayName: String; enum CodingKeys: String, CodingKey { case id; case displayName = "display_name" } }
    let user: U
    enum CodingKeys: String, CodingKey { case threadID = "thread_id", user }
}
private struct DMSendBody: Encodable { let body: String; let e2e: Bool }
private struct DMSendResponse: Decodable { let message: DMMessageDTO }
private struct E2EKeyBody: Encodable { let publicKey: [String: String]; enum CodingKeys: String, CodingKey { case publicKey = "public_key" } }

/// A real JWK published by the web client carries `ext`/`key_ops` fields
/// alongside kty/crv/x/y (WebCrypto's `exportKey('jwk', ...)` always includes
/// them). Only kty/crv/x/y are ever read here, but the struct must still be
/// ABLE to decode a payload containing the extra fields -- Decodable ignores
/// keys it has no property for, so listing only the four needed fields is
/// exactly what makes that work. A `[String: String]` dictionary would not:
/// `ext` decodes as a JSON boolean and `key_ops` as an array, so decoding the
/// whole object as all-String values would throw, and every key published
/// from the website would silently fail to decode on this client.
private struct JWKDTO: Decodable {
    let kty: String, crv: String, x: String, y: String
    var asStringDict: [String: String] { ["kty": kty, "crv": crv, "x": x, "y": y] }
}
private struct E2EKeyResponse: Decodable {
    let publicKey: JWKDTO?
    enum CodingKeys: String, CodingKey { case publicKey = "public_key" }
}

private struct RecordsResponse: Decodable { let records: [String: [PersonalRecord]] }
private struct StoriesResponse: Decodable { let stories: [Story] }
private struct PostStoryBody: Encodable { let content: String; let photoData: String?; let photoCategory: String?; let visibility: String
    enum CodingKeys: String, CodingKey { case content; case photoData = "photo_data"; case photoCategory = "photo_category"; case visibility }
}
private struct PostStoryResponse: Decodable { let id: String }
private struct StoryReactionBody: Encodable { let emoji: String }
private struct StoryReplyBody: Encodable { let body: String }
private struct StoryReplyResponse: Decodable { let threadID: String; enum CodingKeys: String, CodingKey { case threadID = "thread_id" } }
private struct TrendingTagsResponse: Decodable { let tags: [TrendingTag] }
private struct JourneyProgressBody: Encodable { let addKm: Double; enum CodingKeys: String, CodingKey { case addKm = "add_km" } }
private struct AthleteSearchResponse: Decodable { let athletes: [AthleteSearchResult] }
private struct AthleteProfileResponse: Decodable { let profile: AthleteProfile }
private struct HashtagPostsResponse: Decodable { let tag: String; let posts: [HashtagPostDTO] }
private struct HashtagPostDTO: Decodable {
    let id: UUID
    let content: String?
    let createdAt: String
    let visibility: String?
    let photoData: String?
    let photoCategory: String?
    let authorID: UUID?
    let author: String

    enum CodingKeys: String, CodingKey {
        case id, content, visibility
        case createdAt = "created_at", photoData = "photo_data", photoCategory = "photo_category"
        case authorID = "author_id", author
    }

    var model: FeedPost {
        FeedPost(id: id, authorID: authorID, authorName: author, content: content ?? "", workout: nil, verse: nil,
                  createdAt: DateParser.parse(createdAt) ?? .now, photoData: photoData, photoCategory: photoCategory,
                  visibility: visibility ?? "public")
    }
}
private struct AnnouncementBody: Encodable { let text: String }
private struct GroupMembersResponse: Decodable { let members: [GroupMemberEntry]; let isAdmin: Bool?
    enum CodingKeys: String, CodingKey { case members; case isAdmin = "is_admin" }
}
private struct CircleResponse: Decodable { let members: [CircleMember]; let max: Int }
private struct CircleCandidatesResponse: Decodable { let candidates: [CircleCandidate] }
private struct FollowRequestsResponse: Decodable { let requests: [FollowRequestUser] }

struct UsernameCheckResult: Decodable {
    let available: Bool
    let error: String?
    let message: String?
    let suggestion: String?
}

private struct UpdateProfileBody: Encodable {
    let displayName: String, bioVerseRef: String, job: String, church: String, tradition: String
    enum CodingKeys: String, CodingKey {
        case displayName = "display_name", bioVerseRef = "bio_verse_ref", job, church, tradition
    }
}
private struct UpdateProfileResponse: Decodable { let ok: Bool }

private struct AppleHealthSyncBody: Encodable {
    struct Workout: Encodable {
        let externalID: String
        let activityType: String
        let startTime: String
        let endTime: String
        let durationSec: Int
        let calories: Int?
        let distanceMeters: Double?
        let avgHeartRate: Int?
        enum CodingKeys: String, CodingKey {
            case externalID = "external_id", activityType = "activity_type"
            case startTime = "start_time", endTime = "end_time"
            case durationSec = "duration_sec", calories
            case distanceMeters = "distance_meters", avgHeartRate = "avg_heart_rate"
        }
    }
    struct DailySteps: Encodable { let date: String; let steps: Int }
    let workouts: [Workout]
    let dailySteps: [DailySteps]
    enum CodingKeys: String, CodingKey { case workouts; case dailySteps = "daily_steps" }
}

private struct AppleHealthSyncResponse: Decodable {
    let imported: Int
    let checked: Int
    let stepDaysSynced: Int
    enum CodingKeys: String, CodingKey { case imported, checked; case stepDaysSynced = "step_days_synced" }
}

struct PulseEncouragementResponse: Decodable {
    let encouraged: Bool
    let encouragementCount: Int
    enum CodingKeys: String, CodingKey { case encouraged; case encouragementCount = "encouragement_count" }
}

struct PostReactionResponse: Decodable {
    let liked: Bool
    let likeCount: Int

    enum CodingKeys: String, CodingKey {
        case liked
        case likeCount = "like_count"
    }
}

struct PostSaveResponse: Decodable {
    let saved: Bool
}

struct FollowResponse: Decodable {
    let following: Bool
    let followersCount: Int

    enum CodingKeys: String, CodingKey {
        case following
        case followersCount = "followers_count"
    }
}

struct CommentReactionResponse: Decodable {
    let liked: Bool
    let likeCount: Int

    enum CodingKeys: String, CodingKey {
        case liked
        case likeCount = "like_count"
    }
}

struct CreatedPostResponse: Decodable {
    let id: UUID
    let visibility: String
    let shareURL: String?

    enum CodingKeys: String, CodingKey {
        case id, visibility
        case shareURL = "share_url"
    }
}

private struct ActionResponse: Decodable {
    let ok: Bool
}

private struct ReportBody: Encodable {
    let reason: String
}

private struct GroupMessageBody: Encodable {
    let content: String
}

private struct CommentBody: Encodable {
    let content: String
}

private struct CreatePostBody: Encodable {
    let content: String
    let visibility: String
    let photoData: String?
    let photoCategory: String?

    enum CodingKeys: String, CodingKey {
        case content, visibility
        case photoData = "photo_data"
        case photoCategory = "photo_category"
    }
}

private struct FeedResponse: Decodable {
    let posts: [FeedDTO]
    let nextCursor: String?
    enum CodingKeys: String, CodingKey { case posts; case nextCursor = "next_cursor" }
}

private struct CommentListResponse: Decodable {
    let comments: [CommentDTO]
}

private struct CommentDTO: Decodable {
    let id: UUID
    let content: String
    let author: String
    let createdAt: String
    let likeCount: Int?
    let likedByMe: Bool?

    enum CodingKeys: String, CodingKey {
        case id, content, author
        case createdAt = "created_at"
        case likeCount = "like_count"
        case likedByMe = "liked_by_me"
    }

    var model: FeedComment {
        FeedComment(id: id, content: content, author: author, createdAt: createdAt, likeCount: likeCount ?? 0, likedByMe: likedByMe ?? false)
    }
}

private struct ExploreResponse: Decodable {
    let groups: [ExploreGroup]
    let quests: [ExploreQuest]
}

private struct GroupDetailResponse: Decodable {
    let group: GroupCoreDTO
    let memberCount: Int
    let isMember: Bool
    let isAdmin: Bool
    let messages: [GroupMessage]
    let events: [GroupEvent]

    enum CodingKeys: String, CodingKey {
        case group, messages, events
        case memberCount = "member_count"
        case isMember = "is_member"
        case isAdmin = "is_admin"
    }

    var model: NativeGroupDetail {
        NativeGroupDetail(
            group: group.model(memberCount: memberCount),
            memberCount: memberCount,
            isMember: isMember,
            isAdmin: isAdmin,
            messages: messages,
            events: events,
            announcement: group.announcement,
            announcementAt: group.announcementAt
        )
    }
}

private struct GroupCoreDTO: Decodable {
    let id: String
    let name: String
    let description: String?
    let username: String?
    let churchName: String?
    let locationName: String?
    let sport: String?
    let announcement: String?
    let announcementAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, username, sport, announcement
        case churchName = "church_name"
        case locationName = "location_name"
        case announcementAt = "announcement_at"
    }

    func model(memberCount: Int) -> ExploreGroup {
        ExploreGroup(id: id, name: name, description: description, username: username, churchName: churchName, locationName: locationName, sport: sport, memberCount: memberCount)
    }
}

struct FeedPage {
    let posts: [FeedPost]
    let nextCursor: String?
}

private struct FeedDTO: Decodable {
    let id: UUID; let authorID: UUID?; let content: String?; let author: String; let createdAt: String
    let workoutID: UUID?; let workoutType: String?; let startTime: String?; let endTime: String?
    let calories: Int?; let avgHR: Int?; let verseReference: String?; let verseText: String?; let youVersionID: String?
    let likeCount: Int?; let likedByMe: Bool?; let savedByMe: Bool?; let commentCount: Int?
    let photoData: String?; let photoCategory: String?; let visibility: String?

    enum CodingKeys: String, CodingKey { case id; case authorID = "author_id"; case content, author, visibility; case createdAt = "created_at"; case workoutID = "workout_id"; case workoutType = "workout_type"; case startTime = "start_time"; case endTime = "end_time"; case calories; case avgHR = "avg_hr"; case verseReference = "verse_reference"; case verseText = "verse_text"; case youVersionID = "youversion_id"; case likeCount = "like_count"; case likedByMe = "liked_by_me"; case savedByMe = "saved_by_me"; case commentCount = "comment_count"; case photoData = "photo_data"; case photoCategory = "photo_category" }
    var model: FeedPost {
        let workout = workoutType.map { WorkoutSummary(id: workoutID ?? UUID(), type: $0, startTime: DateParser.parse(startTime) ?? .now, endTime: DateParser.parse(endTime), calories: calories, avgHR: avgHR) }
        let verse = verseReference.map { VerseSnippet(id: youVersionID ?? $0, reference: $0, snippet: verseText ?? "", deepLink: "https://www.bible.com/bible?query=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)") }
        return FeedPost(id: id, authorID: authorID, authorName: author, content: content ?? "", workout: workout, verse: verse, createdAt: DateParser.parse(createdAt) ?? .now, photoData: photoData, photoCategory: photoCategory, visibility: visibility ?? "private", likeCount: likeCount ?? 0, likedByMe: likedByMe ?? false, savedByMe: savedByMe ?? false, commentCount: commentCount ?? 0)
    }
}

private struct MeDTO: Decodable {
    let user: UserDTO; let xp: XPDTO?; let badges: [BadgeDTO]; let accountSetupRequired: Bool?
    enum CodingKeys: String, CodingKey { case user, xp, badges; case accountSetupRequired = "account_setup_required" }
    var model: UserProfile {
        UserProfile(id: user.id, displayName: user.displayName, bio: user.bioVerseRef, xp: xp?.xp ?? 0, level: xp?.level ?? 1,
                    badges: badges.map { Badge(id: $0.id, name: $0.name, iconURL: $0.icon) },
                    job: user.job, church: user.church, tradition: user.tradition)
    }
}
private struct UserDTO: Decodable {
    let id: UUID; let displayName: String; let bioVerseRef: String?
    let job: String?; let church: String?; let tradition: String?
    enum CodingKeys: String, CodingKey {
        case id; case displayName = "display_name"; case bioVerseRef = "bio_verse_ref"
        case job, church, tradition
    }
}
private struct XPDTO: Decodable { let xp: Int; let level: Int }
private struct BadgeDTO: Decodable { let id: String; let name: String; let icon: String }
private struct SuggestedUserDTO: Decodable {
    let id: UUID
    let displayName: String
    let bioVerseRef: String?
    let followersCount: Int
    let reason: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case bioVerseRef = "bio_verse_ref"
        case followersCount = "followers_count"
        case reason
    }

    var model: SuggestedUser {
        SuggestedUser(id: id, displayName: displayName, bio: bioVerseRef, followersCount: followersCount, reason: reason)
    }
}

private enum DateParser {
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        if let date = ISO8601DateFormatter().date(from: value) { return date }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.date(from: value)
    }
}

enum MockData {
    static let feed: [FeedPost] = [
        FeedPost(id: UUID(), authorName: "Sam T.", content: "Morning 5K done!", workout: WorkoutSummary(id: UUID(), type: "Run", startTime: .now.addingTimeInterval(-3600), endTime: .now, calories: 420, avgHR: 152), verse: VerseSnippet(id: "isa.40.31", reference: "Isaiah 40:31", snippet: "Those who hope in the Lord will renew their strength...", deepLink: "youversion://bible/verse/isa.40.31"), createdAt: .now.addingTimeInterval(-3000)),
        FeedPost(id: UUID(), authorName: "Priya K.", content: "Rest day reflection.", workout: nil, verse: VerseSnippet(id: "psa.46.1", reference: "Psalm 46:1", snippet: "God is our refuge and strength...", deepLink: "youversion://bible/verse/psa.46.1"), createdAt: .now.addingTimeInterval(-7200)),
    ]
    static let profile = UserProfile(id: UUID(), displayName: "Alex G.", bio: "Training body and spirit.", xp: 320, level: 3, badges: [Badge(id: "b-first-workout", name: "First Steps", iconURL: "star.fill")])
    static let exploreContent = ExploreContent(
        groups: [ExploreGroup(id: "group-preview", name: "Sunrise 5K Fellowship", description: "Early runs and spiritual reflection.", username: "sunrise-5k", churchName: nil, locationName: nil, sport: "Running", memberCount: 12)],
        quests: [ExploreQuest(id: "quest-preview", name: "Faithful Five", description: "Complete five workouts this week.", theme: "perseverance", target: 5)],
        challenges: [ExploreChallenge(id: "challenge-preview", name: "First Steps", description: "Complete three workouts.", flavor: "Do not despise small beginnings.", scriptureReference: "Zechariah 4:10", metric: "workouts", target: 3, theme: "beginning", progress: 1, participants: 24, joined: true, percent: 33, completed: false)]
    )
    static let groupDetail = NativeGroupDetail(
        group: exploreContent.groups[0],
        memberCount: exploreContent.groups[0].memberCount,
        isMember: true,
        isAdmin: false,
        messages: [GroupMessage(id: "message-preview", content: "See everyone at sunrise!", createdAt: "2026-08-11 06:00:00", authorID: "preview-author", author: "Sam T.")],
        events: [GroupEvent(id: "event-preview", title: "Saturday 5K", description: "Easy community run.", activityType: "Run", eventTime: "2026-08-15 07:00:00", locationName: "River Trail", goingCount: 8, interestedCount: 3, myRSVP: "going")]
    )
    static let groupPulse = GroupPulse(
        day: "2026-08-11",
        todayCount: 2,
        mine: nil,
        checkins: [GroupPulseCheckin(id: "pulse-preview", groupID: "group-preview", userID: "preview-author", day: "2026-08-11", kind: "moved", note: "Easy miles before work.", author: "Sam T.", verseReference: "Isaiah 40:31", verseText: "Those who wait for Yahweh will renew their strength.", encouragementCount: 1, encouragedByMe: false)]
    )
    static func activeWorkout(type: String) -> WorkoutSummary { WorkoutSummary(id: UUID(), type: type, startTime: .now, endTime: nil, calories: nil, avgHR: nil) }
}
