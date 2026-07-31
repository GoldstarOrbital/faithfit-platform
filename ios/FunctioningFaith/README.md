# Functioning Faith iOS skeleton

SwiftUI app skeleton: NavigationStack root + TabView (Home Feed, Workouts, Explore, Profile),
wired to a mock API client so it runs standalone in the simulator without a live backend.

## Structure
- `Functioning Faith/App` - entry point
- `Functioning Faith/Views` - SwiftUI screens
- `Functioning Faith/Models` - Codable DTOs matching backend schema
- `Functioning Faith/Networking` - APIClient (mock + real modes)
- `Functioning Faith/Tests` - unit/UI test stubs

## Running
Open in Xcode (add these files to a new SwiftUI App project targeting iOS 17+), select a
simulator, and run. `APIClient.useMock = true` by default.

## Accessibility
- Dynamic Type supported via `.font(.body)` / relative text styles throughout.
- All interactive elements have `.accessibilityLabel` and meet the 44x44pt minimum tap target.
- Contrast targets WCAG AA (verify with Xcode's Accessibility Inspector before ship).
