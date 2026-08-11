import Foundation
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class NotificationCoordinator {
    static let shared = NotificationCoordinator()

    private init() { }

    func enable(category: NotificationCategory) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .denied { return false }

        let granted = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
        return granted == true
    }

    func openSystemSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #endif
    }
}

enum NotificationCategory: String, CaseIterable, Identifiable {
    case scripture
    case community
    case reminders

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scripture: return "Scripture encouragement"
        case .community: return "Community replies"
        case .reminders: return "Workout reminders"
        }
    }

    var explanation: String {
        switch self {
        case .scripture: return "Receive a timely verse around the workouts you choose to record."
        case .community: return "Know when someone replies, cheers, or invites you."
        case .reminders: return "Get reminders you create for your own rhythm."
        }
    }
}
