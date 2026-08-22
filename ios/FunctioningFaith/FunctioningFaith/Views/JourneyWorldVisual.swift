import SwiftUI

/// A responsive route scene driven by a member's real server-side progress.
struct JourneyWorldVisual: View {
    let world: String
    let progress: Int
    var compact = false

    private var palette: [Color] {
        switch world.lowercased() {
        case let value where value.contains("narnia"):
            return [Color(red: 0.28, green: 0.45, blue: 0.56), Color(red: 0.73, green: 0.84, blue: 0.86), FFTheme.parchment2]
        case let value where value.contains("middle") || value.contains("earth") || value.contains("lotr"):
            return [FFTheme.meadowDeep, FFTheme.forest, FFTheme.gold]
        default:
            return [FFTheme.hearth, FFTheme.goldBright, FFTheme.meadowDeep]
        }
    }

    private var landmark: String {
        switch world.lowercased() {
        case let value where value.contains("narnia"): return "snowflake"
        case let value where value.contains("middle") || value.contains("earth") || value.contains("lotr"): return "mountain.2.fill"
        default: return "sun.horizon.fill"
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(.white.opacity(0.13)).frame(width: size.width * 0.72).offset(x: size.width * 0.29, y: -size.height * 0.30)
                Circle().fill(FFTheme.walnut.opacity(0.14)).frame(width: size.width * 0.92).offset(x: -size.width * 0.33, y: size.height * 0.55)
                JourneyRouteLine()
                    .stroke(FFTheme.parchment2.opacity(0.86), style: StrokeStyle(lineWidth: compact ? 3 : 5, lineCap: .round, dash: [7, 7]))
                    .padding(compact ? 16 : 22)
                Image(systemName: landmark)
                    .font(.system(size: compact ? 24 : 36, weight: .bold))
                    .foregroundStyle(FFTheme.parchment2.opacity(0.9))
                    .position(x: size.width * 0.79, y: size.height * 0.27)
                Image(systemName: "figure.run.circle.fill")
                    .font(.system(size: compact ? 27 : 38, weight: .bold))
                    .foregroundStyle(FFTheme.walnut0)
                    .background(Circle().fill(FFTheme.parchment2).padding(4))
                    .position(markerPosition(in: size))
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

    private func markerPosition(in size: CGSize) -> CGPoint {
        let ratio = min(max(CGFloat(progress) / 100, 0), 1)
        return CGPoint(x: size.width * (0.17 + ratio * 0.65), y: size.height * (0.68 - ratio * 0.34))
    }
}

private struct JourneyRouteLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.08, y: rect.maxY - rect.height * 0.18))
        path.addCurve(to: CGPoint(x: rect.minX + rect.width * 0.92, y: rect.minY + rect.height * 0.20),
                      control1: CGPoint(x: rect.minX + rect.width * 0.35, y: rect.minY + rect.height * 0.52),
                      control2: CGPoint(x: rect.minX + rect.width * 0.60, y: rect.maxY - rect.height * 0.06))
        return path
    }
}
