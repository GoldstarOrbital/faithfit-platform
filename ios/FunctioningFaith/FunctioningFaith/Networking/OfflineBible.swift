import Foundation

/// The whole Bible on the device, so Scripture reads with no connection at all.
///
/// HTTP caching alone only ever covers chapters a member already opened while
/// online -- open John 3 on wifi and it reads on a plane, but Romans 8, never
/// opened, does not. Scripture is the one thing in this app that should never
/// be unavailable, so the server offers the whole ingested Bible as a single
/// compact payload (GET /api/bible/offline, ~1.2MB over the wire) and this
/// keeps it.
///
/// The network still comes first everywhere it can: this is a fallback for
/// when a passage request fails, not a replacement for it. That way a
/// correction to the text still reaches members, and a stale local copy can
/// never quietly shadow the live one.
actor OfflineBible {
    static let shared = OfflineBible()

    /// `books[book][chapter]` is the chapter's verses in order, verse N at
    /// index N-1 -- the same shape the server sends, which is what keeps the
    /// payload near a megabyte rather than five.
    private struct Payload: Codable {
        let verses: Int
        let translations: [String: String]
        let books: [String: [String: [String]]]
    }

    private var loaded: Payload?
    private var downloading: Task<Void, Never>?

    private static var file: URL? {
        try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                     appropriateFor: nil, create: true)
            .appendingPathComponent("offline-bible.json")
    }

    /// Public-domain Scripture, identical for every member and containing
    /// nothing about anyone, so unlike the feed cache this deliberately
    /// survives sign-out. There is nothing here to leak, and re-downloading a
    /// megabyte per sign-in would be waste, not privacy.
    private func payload() -> Payload? {
        if let loaded { return loaded }
        guard let file = Self.file,
              let data = try? Data(contentsOf: file),
              let decoded = try? JSONDecoder().decode(Payload.self, from: data)
        else { return nil }
        loaded = decoded
        return decoded
    }

    /// Reads a chapter from the local copy. Returns nil when it has not been
    /// downloaded yet, or does not contain that chapter, so every caller falls
    /// straight back to its existing behaviour.
    func passage(book: String, chapter: Int) -> BiblePassage? {
        guard let payload = payload(),
              let texts = payload.books[book]?[String(chapter)],
              !texts.isEmpty
        else { return nil }
        let translation = payload.translations[book] ?? "WEB"
        // Verse numbering has real gaps -- WEB omits Acts 8:37 and a few
        // others -- and those arrive as empty strings so the array can stay
        // indexed by verse number. Skip them, exactly as the per-chapter
        // endpoint omits the row entirely, rather than rendering a blank verse.
        let verses = texts.enumerated().compactMap { index, text -> BibleVerse? in
            guard !text.isEmpty else { return nil }
            return BibleVerse(book: book, chapter: chapter, verse: index + 1, text: text, translation: translation)
        }
        guard !verses.isEmpty else { return nil }
        return BiblePassage(book: book, chapter: chapter, translation: translation, verses: verses)
    }

    var isDownloaded: Bool { payload() != nil }

    /// Fetches once and keeps it. Safe to call on every launch: it returns
    /// immediately when the Bible is already on disk, and coalesces concurrent
    /// callers onto one download rather than starting several.
    func downloadIfNeeded() async {
        if payload() != nil { return }
        if let downloading { return await downloading.value }
        let task = Task { await self.download() }
        downloading = task
        await task.value
        downloading = nil
    }

    private func download() async {
        // Same relative-to-base form APIClient uses, so a configured host
        // override applies here too rather than only to everything else.
        guard let url = URL(string: "/api/bible/offline", relativeTo: AppConfig.apiBaseURL),
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(Payload.self, from: data),
              decoded.verses > 0
        else { return }
        loaded = decoded
        guard let file = Self.file else { return }
        // Application Support, not Caches: a Bible the member is relying on
        // offline should not be evicted under storage pressure precisely when
        // they have no connection to re-fetch it.
        try? data.write(to: file, options: .atomic)
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        var mutable = file
        try? mutable.setResourceValues(resource)
    }
}
