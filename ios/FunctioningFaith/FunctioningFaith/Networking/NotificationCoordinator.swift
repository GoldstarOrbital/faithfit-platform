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
        // Silent: only re-registers when authorization was already granted in
        // an earlier session, so this never shows the system permission
        // prompt. The prompt itself (requestPermissionIfAnyCategoryAtDefault)
        // waits until a member is signed in -- see RootTabView's .task.
        Task { await registerForRemoteNotificationsIfAllowed() }
        return true
    }

    /// Core notification toggles default to on (Profile still lets a member
    /// turn any of them off individually); editorial alerts default off. For
    /// an install that never touched one of the enabled-by-default toggles,
    /// nothing else in the app ever
    /// triggers the actual system permission prompt, since that normally only
    /// fires from a Settings toggle's own onChange going from off to on. This
    /// runs that same request once a member is actually signed in and inside
    /// the app shell (see RootTabView's .task) -- NEVER from app launch
    /// directly, which would show the system prompt over the loading/auth
    /// screen before the person has even signed in.
    func requestPermissionIfAnyCategoryAtDefault() async {
        let defaults = UserDefaults.standard
        let hasUntouchedEnabledCategory = NotificationCategory.allCases.contains { category in
            let key = "notifications.\(category.rawValue)"
            return defaults.object(forKey: key) == nil && category.defaultEnabled
        }
        guard hasUntouchedEnabledCategory else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
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
            .filter { isNotificationCategoryEnabled($0) }
            .flatMap(\.serverCategories)
        try? await APIClient.shared.registerNativePushToken(token, categories: categories)
    }

    /// UserDefaults.bool(forKey:) returns false for a key that was never
    /// written, regardless of the @AppStorage default declared at the call
    /// site -- since every notification toggle now defaults to on, reading
    /// raw UserDefaults here would silently register zero core categories for
    /// anyone who never opened Profile and touched a toggle. Each category's
    /// declared default keeps the new editorial choices genuinely opt-in.
    private func isNotificationCategoryEnabled(_ category: NotificationCategory) -> Bool {
        let defaults = UserDefaults.standard
        let key = "notifications.\(category.rawValue)"
        guard defaults.object(forKey: key) != nil else { return category.defaultEnabled }
        return defaults.bool(forKey: key)
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
    /// Carries whatever verse this workout session already has, so an elevated
    /// heart rate brings scripture along with the pace reminder instead of a
    /// bare physiological alert.
    func deliverHeartRateCalmCue(heartRate: Int, verse: VerseSnippet?) async {
        let content = UNMutableNotificationContent()
        content.title = "Take a calm moment"
        content.body = "Your heart rate is \(heartRate) BPM. Ease your pace if you need to, and take a few slow breaths."
        if let verse {
            content.body += " \(verse.reference) — \(verse.snippet)"
        }
        content.sound = .default
        // "workouts", not "train" -- DeepLinkRouter's parser has no "train"
        // case at all, so this silently went nowhere on tap.
        content.userInfo = ["ff_url": "functioningfaith://workouts"]
        let request = UNNotificationRequest(identifier: "ff-heart-rate-calm-\(UUID().uuidString)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

enum NotificationCategory: String, CaseIterable, Identifiable {
    case scripture
    case community
    case reminders
    case podcasts
    case news

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scripture: return "Scripture encouragement"
        case .community: return "Community replies"
        case .reminders: return "Workout reminders"
        case .podcasts: return "New podcast episodes"
        case .news: return "Christian news"
        }
    }

    var explanation: String {
        switch self {
        case .scripture: return "Receive a timely verse around the workouts you choose to record."
        case .community: return "Know when someone replies, cheers, or invites you."
        case .reminders: return "Get reminders you create for your own rhythm."
        case .podcasts: return "Hear when a new episode is available from a podcast in Explore."
        case .news: return "Receive a timely headline from the Christian news feed."
        }
    }

    /// Existing encouragement categories retain their established defaults.
    /// Editorial content is a separate interruption and stays off until the
    /// member explicitly asks for it in Profile.
    var defaultEnabled: Bool {
        switch self {
        case .scripture, .community, .reminders: return true
        case .podcasts, .news: return false
        }
    }

    /// The server's own push categories (webapp/lib/push.js CATEGORIES) this
    /// toggle actually controls. These names don't match the enum's raw
    /// values 1:1 -- registering the raw case name here previously sent a
    /// category the server didn't recognize, which its own filtering silently
    /// dropped, so "scripture" and "community" never reached anyone despite
    /// looking enabled in Settings.
    var serverCategories: [String] {
        switch self {
        case .scripture: return ["daily_verse"]
        case .community: return ["verse_reply", "social"]
        case .reminders: return ["reminders"]
        case .podcasts: return ["podcasts"]
        case .news: return ["news"]
        }
    }
}
