import Foundation
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class NotificationCoordinator: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    // The SwiftUI app-delegate adapter creates the live instance. Keeping this
    // reference in sync lets Settings and onboarding use that same delegate.
    private static var active: NotificationCoordinator?
    private static let fallback = NotificationCoordinator()
    static var shared: NotificationCoordinator { active ?? fallback }

    private let tokenKey = "push.apns.device-token"

    private override init() {
        super.init()
        NotificationCoordinator.active = self
        UNUserNotificationCenter.current().delegate = self
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { await registerForRemoteNotificationsIfAllowed() }
        return true
    }

    func enable(category: NotificationCategory) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .denied { return false }

        let granted = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
        if granted == true { await registerForRemoteNotificationsIfAllowed() }
        return granted == true
    }

    func registerForRemoteNotificationsIfAllowed() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    nonisolated func application(_ application: UIApplication,
                                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "push.apns.device-token")
        Task { @MainActor in await self.syncDeviceToken() }
    }

    nonisolated func application(_ application: UIApplication,
                                 didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("APNs registration failed: \(error.localizedDescription)")
        #endif
    }

    func syncDeviceToken() async {
        guard let token = UserDefaults.standard.string(forKey: tokenKey), !token.isEmpty else { return }
        let categories = NotificationCategory.allCases
            .filter { UserDefaults.standard.bool(forKey: "notifications.\($0.rawValue)") }
            .map(\.rawValue)
        try? await APIClient.shared.registerNativePushToken(token, categories: categories)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let destination = response.notification.request.content.userInfo["ff_url"] as? String
        if let destination, let url = URL(string: destination) {
            Task { @MainActor in UIApplication.shared.open(url) }
        }
        completionHandler()
    }

    func openSystemSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #endif
    }

    /// A local, opt-in wellness cue. It is deliberately not a medical alert;
    /// WorkoutView only invokes it while a workout is active and rate-limits it.
    func deliverHeartRateCalmCue(heartRate: Int) async {
        let content = UNMutableNotificationContent()
        content.title = "Take a calm moment"
        content.body = "Your heart rate is \(heartRate) BPM. Ease your pace if you need to, and take a few slow breaths."
        content.sound = .default
        content.userInfo = ["ff_url": "functioningfaith://train"]
        let request = UNNotificationRequest(identifier: "ff-heart-rate-calm-\(UUID().uuidString)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
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
