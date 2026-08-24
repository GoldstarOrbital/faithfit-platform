import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Shared by every screen that uploads a photo as a data: URL (posts,
/// moments/stories) -- one compression policy, one 1MB ceiling matching
/// the server's own MAX_IMAGE_BYTES (see validateDataUrlImage in
/// routes/api.js), so a photo that passes here is guaranteed to pass there.
enum ImageUpload {
    enum UploadError: LocalizedError {
        case invalidImage, sourceTooLarge, imageTooLarge
        var errorDescription: String? {
            switch self {
            case .invalidImage: return "That image could not be opened."
            case .sourceTooLarge: return "Choose an image smaller than 30 MB."
            case .imageTooLarge: return "That image could not be compressed below the 1 MB upload limit."
            }
        }
    }

    #if canImport(UIKit)
    static func compress(_ data: Data) -> Data? {
        guard let original = UIImage(data: data) else { return nil }
        for maxDimension in [CGFloat(1440), 1080, 820] {
            let longest = max(original.size.width, original.size.height)
            let scale = min(1, maxDimension / max(longest, 1))
            let target = CGSize(width: max(1, original.size.width * scale), height: max(1, original.size.height * scale))
            let image = UIGraphicsImageRenderer(size: target).image { _ in
                original.draw(in: CGRect(origin: .zero, size: target))
            }
            for quality in stride(from: CGFloat(0.82), through: 0.24, by: -0.08) {
                if let output = image.jpegData(compressionQuality: quality), output.count <= 960 * 1024 {
                    return output
                }
            }
        }
        return nil
    }
    #endif

    static func dataURL(from data: Data) -> String {
        "data:image/jpeg;base64," + data.base64EncodedString()
    }

    /// Loads, size-checks, and compresses a PhotosPicker source in one call.
    static func prepare(_ source: Data) throws -> Data {
        guard source.count <= 30 * 1024 * 1024 else { throw UploadError.sourceTooLarge }
        #if canImport(UIKit)
        guard let prepared = compress(source) else { throw UploadError.imageTooLarge }
        return prepared
        #else
        throw UploadError.invalidImage
        #endif
    }

    #if canImport(UIKit)
    /// Shared decode cache for every screen rendering a stored data: URL
    /// image (feed posts, story moments) -- avoids re-decoding base64 on
    /// every scroll/redraw of the same image.
    private static let decodeCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 40
        cache.totalCostLimit = 32 * 1024 * 1024
        return cache
    }()

    static func decode(_ dataURL: String) -> UIImage? {
        let key = dataURL as NSString
        if let cached = decodeCache.object(forKey: key) { return cached }
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = UIImage(data: data)
        else { return nil }
        decodeCache.setObject(image, forKey: key, cost: data.count)
        return image
    }
    #endif
}
