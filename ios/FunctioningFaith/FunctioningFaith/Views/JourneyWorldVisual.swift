import SwiftUI
import UIKit

/// Shared look for a journey's virtual world -- palette and landmark glyph
/// keyed off the world name, used by both the compact list preview and the
/// full interactive map so they always read as the same place.
enum JourneyWorldStyle {
    static func palette(for world: String) -> [Color] {
        switch world.lowercased() {
        case let value where value.contains("narnia"):
            return [Color(red: 0.28, green: 0.45, blue: 0.56), Color(red: 0.73, green: 0.84, blue: 0.86), FFTheme.parchment2]
        case let value where value.contains("middle") || value.contains("earth") || value.contains("lotr"):
            return [FFTheme.meadowDeep, FFTheme.forest, FFTheme.gold]
        default:
            return [FFTheme.hearth, FFTheme.goldBright, FFTheme.meadowDeep]
        }
    }

    static func landmark(for world: String) -> String {
        switch world.lowercased() {
        case let value where value.contains("narnia"): return "snowflake"
        case let value where value.contains("middle") || value.contains("earth") || value.contains("lotr"): return "mountain.2.fill"
        default: return "sun.horizon.fill"
        }
    }
}

/// The route's curve, defined once so the line drawn on screen and the
/// pins/marker placed "on" it always land at exactly the same points --
/// the difference between a map that looks interactive and one that
/// actually is.
enum RouteGeometry {
    private static func controlPoints(in rect: CGRect) -> (CGPoint, CGPoint, CGPoint, CGPoint) {
        let p0 = CGPoint(x: rect.minX + rect.width * 0.06, y: rect.maxY - rect.height * 0.12)
        let p1 = CGPoint(x: rect.minX + rect.width * 0.32, y: rect.minY + rect.height * 0.55)
        let p2 = CGPoint(x: rect.minX + rect.width * 0.62, y: rect.maxY - rect.height * 0.02)
        let p3 = CGPoint(x: rect.minX + rect.width * 0.95, y: rect.minY + rect.height * 0.22)
        return (p0, p1, p2, p3)
    }

    static func path(in rect: CGRect) -> Path {
        let (p0, p1, p2, p3) = controlPoints(in: rect)
        var path = Path()
        path.move(to: p0)
        path.addCurve(to: p3, control1: p1, control2: p2)
        return path
    }

    /// A point on the cubic bezier at parameter `t` (0...1) -- the standard
    /// De Casteljau formula, evaluated directly rather than walked.
    static func point(at t: CGFloat, in rect: CGRect) -> CGPoint {
        let (p0, p1, p2, p3) = controlPoints(in: rect)
        let clamped = min(max(t, 0), 1)
        let mt = 1 - clamped
        let x = mt*mt*mt*p0.x + 3*mt*mt*clamped*p1.x + 3*mt*clamped*clamped*p2.x + clamped*clamped*clamped*p3.x
        let y = mt*mt*mt*p0.y + 3*mt*mt*clamped*p1.y + 3*mt*clamped*clamped*p2.y + clamped*clamped*clamped*p3.y
        return CGPoint(x: x, y: y)
    }
}

/// A responsive route scene driven by a member's real server-side progress.
/// Used as a compact, non-interactive preview (journey list cards); the full
/// journey screen uses `JourneyInteractiveMap` instead, which plots real
/// waypoints on this same curve and makes them tappable.
struct JourneyWorldVisual: View {
    let world: String
    let progress: Int
    var compact = false

    var body: some View {
        GeometryReader { geometry in
            let inset: CGFloat = compact ? 16 : 22
            let rect = CGRect(origin: .zero, size: geometry.size).insetBy(dx: inset, dy: inset)
            let palette = JourneyWorldStyle.palette(for: world)
            ZStack {
                LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(.white.opacity(0.13)).frame(width: geometry.size.width * 0.72).offset(x: geometry.size.width * 0.29, y: -geometry.size.height * 0.30)
                Circle().fill(FFTheme.walnut.opacity(0.14)).frame(width: geometry.size.width * 0.92).offset(x: -geometry.size.width * 0.33, y: geometry.size.height * 0.55)
                RouteGeometry.path(in: rect)
                    .stroke(FFTheme.parchment2.opacity(0.86), style: StrokeStyle(lineWidth: compact ? 3 : 5, lineCap: .round, dash: [7, 7]))
                Image(systemName: JourneyWorldStyle.landmark(for: world))
                    .font(.system(size: compact ? 24 : 36, weight: .bold))
                    .foregroundStyle(FFTheme.parchment2.opacity(0.9))
                    .position(x: geometry.size.width * 0.79, y: geometry.size.height * 0.27)
                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: compact ? 27 : 38, weight: .bold))
                    .foregroundStyle(FFTheme.walnut0)
                    .background(Circle().fill(FFTheme.parchment2).padding(4))
                    .position(RouteGeometry.point(at: CGFloat(progress) / 100, in: rect))
                    .accessibilityLabel("Your route position: \(progress)%")
                VStack {
                    HStack {
                        Text(world.uppercased()).font(FFTheme.eyebrow(compact ? 9 : 11)).tracking(1.1).foregroundStyle(FFTheme.parchment2)
                        Spacer()
                        Text("\(progress)%").font(.caption.weight(.bold)).foregroundStyle(FFTheme.parchment2)
                            .padding(.horizontal, 8).padding(.vertical, 4).background(.black.opacity(0.2), in: Capsule())
                    }
                    Spacer()
                }
                .padding(compact ? 12 : 16)
            }
            .clipShape(RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous))
        }
        .aspectRatio(compact ? 2.1 : 1.72, contentMode: .fit)
        .accessibilityElement(children: .combine)
    }
}

/// The Zwift-style piece: every waypoint plotted as a tappable pin along the
/// real route curve, the member's own progress marker moving along the same
/// line, and a light haptic on every tap -- locked waypoints refuse with a
/// distinct "no" buzz instead of silently doing nothing. Tapping an unlocked
/// pin hands the waypoint to `onSelect` (the caller presents its narrative
/// and scripture, typically as a sheet).
struct JourneyInteractiveMap: View {
    let world: String
    let progress: Int
    let waypoints: [JourneyWaypoint]
    let totalKm: Double
    let onSelect: (JourneyWaypoint) -> Void

    var body: some View {
        GeometryReader { geometry in
            let inset: CGFloat = 26
            let rect = CGRect(origin: .zero, size: geometry.size).insetBy(dx: inset, dy: inset)
            let palette = JourneyWorldStyle.palette(for: world)
            ZStack {
                LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(.white.opacity(0.13)).frame(width: geometry.size.width * 0.72).offset(x: geometry.size.width * 0.29, y: -geometry.size.height * 0.30)
                Circle().fill(FFTheme.walnut.opacity(0.14)).frame(width: geometry.size.width * 0.92).offset(x: -geometry.size.width * 0.33, y: geometry.size.height * 0.55)
                RouteGeometry.path(in: rect)
                    .stroke(FFTheme.parchment2.opacity(0.86), style: StrokeStyle(lineWidth: 5, lineCap: .round, dash: [7, 7]))
                Image(systemName: JourneyWorldStyle.landmark(for: world))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(FFTheme.parchment2.opacity(0.9))
                    .position(x: geometry.size.width * 0.79, y: geometry.size.height * 0.27)

                ForEach(waypoints) { waypoint in
                    let t = totalKm > 0 ? CGFloat(waypoint.kmMark / totalKm) : 0
                    WaypointPin(waypoint: waypoint) { onSelect(waypoint) }
                        .position(RouteGeometry.point(at: t, in: rect))
                }

                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(FFTheme.walnut0)
                    .background(Circle().fill(FFTheme.parchment2).padding(4))
                    .position(RouteGeometry.point(at: CGFloat(progress) / 100, in: rect))
                    .accessibilityLabel("Your route position: \(progress)%")
                    .animation(.spring(response: 0.6, dampingFraction: 0.8), value: progress)

                VStack {
                    HStack {
                        Text(world.uppercased()).font(FFTheme.eyebrow(11)).tracking(1.1).foregroundStyle(FFTheme.parchment2)
                        Spacer()
                        Text("\(progress)%").font(.caption.weight(.bold)).foregroundStyle(FFTheme.parchment2)
                            .padding(.horizontal, 8).padding(.vertical, 4).background(.black.opacity(0.2), in: Capsule())
                    }
                    Spacer()
                    Text("Tap a marker to read that stop")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(FFTheme.parchment2.opacity(0.85))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.black.opacity(0.16), in: Capsule())
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                .padding(16)
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .aspectRatio(1.5, contentMode: .fit)
    }
}

private struct WaypointPin: View {
    let waypoint: JourneyWaypoint
    let action: () -> Void
    @State private var justTapped = false

    var body: some View {
        Button {
            if waypoint.unlocked {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                withAnimation(.spring(response: 0.35, dampingFraction: 0.5)) { justTapped = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { justTapped = false }
                action()
            } else {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            }
        } label: {
            Image(systemName: waypoint.unlocked ? "mappin.circle.fill" : "lock.circle.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(waypoint.unlocked ? FFTheme.hearth : FFTheme.parchment2.opacity(0.55))
                .background(Circle().fill(FFTheme.walnut0).frame(width: 26, height: 26))
                .scaleEffect(justTapped ? 1.35 : 1.0)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(waypoint.unlocked ? waypoint.title : "Locked waypoint")
    }
}
