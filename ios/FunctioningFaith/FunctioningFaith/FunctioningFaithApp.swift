import SwiftUI

@main
struct FunctioningFaithApp: App {
    @StateObject private var session = NativeSession()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isAuthenticated {
                    RootTabView()
                } else {
                    NativeAuthView { profile in
                        session.profile = profile
                    }
                }
            }
            .task { await session.restore() }
        }
    }
}
