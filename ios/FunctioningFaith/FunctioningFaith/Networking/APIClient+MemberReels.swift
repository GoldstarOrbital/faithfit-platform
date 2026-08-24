import Foundation

// MARK: - Member Reel publishing (web parity)

extension APIClient {
    /// Member Reel: public post with short video. Server enforces media rules
    /// (`lib/media.js`) and pairs verified Scripture before publish.
    func publishReel(caption: String, videoDataURL: String, category: String) async throws -> CreatedPostResponse {
        if useMock { return CreatedPostResponse(id: UUID(), visibility: "public", shareURL: nil) }
        return try await request(
            "/api/posts",
            method: "POST",
            body: ReelPostBody(content: caption, visibility: "public", videoData: videoDataURL, videoCategory: category),
            timeoutInterval: 90
        )
    }
}

private struct ReelPostBody: Encodable {
    let content: String
    let visibility: String
    let videoData: String
    let videoCategory: String
    enum CodingKeys: String, CodingKey {
        case content, visibility
        case videoData = "video_data"
        case videoCategory = "video_category"
    }
}
