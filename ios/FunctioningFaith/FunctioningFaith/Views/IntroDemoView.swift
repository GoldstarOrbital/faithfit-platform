import SwiftUI

/// A skippable, animated first-run product demo shown exactly once per
/// account, after a successful sign-up or login and after any required
/// account setup -- never on the auth screen itself. Seven swipeable pages
/// walk a new member through the app's full scope (fitness, community,
/// education, media, news), GPS-corrected workouts, Scripture in Motion,
/// community/Reels, and wearable-driven insight before handing off to
/// `RootTabView` -- new accounts see `SocialOnboardingView` directly after
/// this, chained in `FunctioningFaithApp`'s own conditional branching, not
/// `RootTabView` itself.
struct IntroDemoView: View {
    let onFinish: () -> Void

    @State private var page = 0
    private let lastPage = 6

    var body: some View {
        VStack(spacing: 0) {
            topBar
            TabView(selection: $page.animation(.easeInOut(duration: 0.4))) {
                IntroWelcomeSlide().tag(0)
                IntroPillarsSlide().tag(1)
                IntroFeatureSlide(
                    eyebrow: "Movement",
                    headline: "Every mile,\nfaithfully tracked",
                    subcopy: "GPS-corrected distance, elevation, and pace — calibrated after every run, ride, or walk, so your record is true.",
                    chips: ["Distance", "Elevation", "Pace"]
                ) { IntroWorkoutShot() }.tag(2)
                IntroFeatureSlide(
                    eyebrow: "Scripture in Motion",
                    headline: "Scripture that\nmoves with you",
                    subcopy: "A fresh verse greets you every time — chosen from your training rhythm, ready before you begin."
                ) { IntroScriptureShot() }.tag(3)
                IntroFeatureSlide(
                    eyebrow: "Community",
                    headline: "Grow with others —\nalone or with your church",
                    subcopy: "Follow friends, join a church group, and share encouragement through Reels built for the walk of faith."
                ) { IntroCommunityShot() }.tag(4)
                IntroFeatureSlide(
                    eyebrow: "Wearables",
                    headline: "Insight drawn from\nbody and spirit",
                    subcopy: "Apple Health syncs your heart rate live during workouts, and AI-personalized encouragement reflects your recovery and consistency."
                ) { IntroWearableShot() }.tag(5)
                IntroFinalSlide(onFinish: onFinish).tag(6)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            if page < lastPage {
                footer
            }
        }
        .background(
            LinearGradient(colors: [FFTheme.parchment0, FFTheme.parchment1, FFTheme.parchment2], startPoint: .top, endPoint: .bottom)
                .overlay(
                    RadialGradient(colors: [FFTheme.goldBright.opacity(0.28), .clear], center: UnitPoint(x: 0.5, y: -0.05), startRadius: 10, endRadius: 260)
                )
                .ignoresSafeArea()
        )
    }

    private var topBar: some View {
        HStack {
            Image("BrandMarkTransparent")
                .resizable().scaledToFit()
                .frame(width: 26, height: 26)
            Spacer()
            if page < lastPage {
                Button("Skip") { withAnimation(.easeInOut) { page = lastPage } }
                    .font(FFTheme.serifMedium(15))
                    .foregroundStyle(FFTheme.inkSoft)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 52)
    }

    private var footer: some View {
        HStack {
            if page > 0 {
                Button { withAnimation(.easeInOut) { page -= 1 } } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(FFTheme.inkSoft)
                        .frame(width: 44, height: 44)
                        .background(FFTheme.parchment1, in: Circle())
                        .overlay(Circle().stroke(FFTheme.hairline, lineWidth: 1))
                }
            } else {
                Color.clear.frame(width: 44, height: 44)
            }

            Spacer()

            HStack(spacing: 7) {
                ForEach(0...lastPage, id: \.self) { i in
                    Capsule()
                        .fill(i == page ? FFTheme.meadow : FFTheme.ink.opacity(0.22))
                        .frame(width: i == page ? 20 : 7, height: 7)
                        .animation(.easeInOut(duration: 0.25), value: page)
                }
            }

            Spacer()

            Button { withAnimation(.easeInOut) { page = min(lastPage, page + 1) } } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(FFTheme.cream)
                    .frame(width: 56, height: 56)
                    .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadow], startPoint: .top, endPoint: .bottom), in: Circle())
                    .shadow(color: FFTheme.meadowDeep.opacity(0.4), radius: 10, y: 5)
            }
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 30)
        .padding(.top, 18)
    }
}

// MARK: - Slides

private struct IntroWelcomeSlide: View {
    @State private var breathe = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 28)
            Image("BrandMarkTransparent")
                .resizable().scaledToFit()
                .frame(width: 112, height: 112)
                .shadow(color: FFTheme.walnut.opacity(0.28), radius: 14, y: 8)
                .scaleEffect(breathe ? 1.045 : 1.0)
                .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: breathe)
                .onAppear { breathe = true }
            Text("FUNCTIONING FAITH")
                .font(FFTheme.eyebrow(12))
                .foregroundStyle(FFTheme.hearth)
                .padding(.top, 18)
            Text("Faith in motion.")
                .font(FFTheme.display(34, weight: .bold, relativeTo: .largeTitle))
                .foregroundStyle(FFTheme.ink)
                .padding(.top, 10)
            Text("Track real workouts with GPS, pair movement with Scripture, and grow with others — alone or with your church.")
                .font(FFTheme.serif(16))
                .foregroundStyle(FFTheme.inkSoft)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .padding(.top, 12)
            Spacer(minLength: 40)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
    }
}

private struct IntroPillarsSlide: View {
    private let pillars: [(label: String, icon: String, wide: Bool)] = [
        ("Fitness", "figure.run", false),
        ("Community", "person.2.fill", false),
        ("Education", "books.vertical.fill", false),
        ("Media", "play.rectangle.fill", false),
        ("News", "newspaper.fill", true),
    ]
    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            Text("ONE APP, EVERYTHING")
                .font(FFTheme.eyebrow(12))
                .foregroundStyle(FFTheme.hearth)
            Text("More than\nsocial media.")
                .font(FFTheme.display(27, weight: .bold, relativeTo: .title))
                .foregroundStyle(FFTheme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 12)
            Text("Fitness, community, Scripture, media, and news for the whole Christian life — not scattered across five apps.")
                .font(FFTheme.serif(16))
                .foregroundStyle(FFTheme.inkSoft)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .padding(.top, 10)

            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(Array(pillars.enumerated()), id: \.element.label) { index, pillar in
                    PillarBadge(label: pillar.label, icon: pillar.icon, delay: Double(index) * 0.07)
                        .gridCellColumns(pillar.wide ? 2 : 1)
                }
            }
            .frame(maxWidth: 300)
            .padding(.top, 22)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
    }
}

private struct PillarBadge: View {
    let label: String
    let icon: String
    let delay: Double
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(FFTheme.scripture)
                .frame(width: 52, height: 52)
                .background(FFTheme.meadow.opacity(0.1), in: Circle())
                .overlay(Circle().stroke(FFTheme.meadow.opacity(0.28), lineWidth: 1.4))
            Text(label.uppercased())
                .font(FFTheme.eyebrow(12))
                .foregroundStyle(FFTheme.ink)
        }
        .scaleEffect(appeared ? 1 : 0.6)
        .opacity(appeared ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.65).delay(delay)) {
                appeared = true
            }
        }
    }
}

private struct IntroFeatureSlide<Shot: View>: View {
    let eyebrow: String
    let headline: String
    let subcopy: String
    var chips: [String] = []
    @ViewBuilder let shot: Shot

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 8)
            Text(eyebrow.uppercased())
                .font(FFTheme.eyebrow(12))
                .foregroundStyle(FFTheme.scripture)
            shot
                .padding(.top, 16)
            Text(headline)
                .font(FFTheme.display(27, weight: .bold, relativeTo: .title))
                .foregroundStyle(FFTheme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 20)
            Text(subcopy)
                .font(FFTheme.serif(16))
                .foregroundStyle(FFTheme.inkSoft)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .padding(.top, 10)
            if !chips.isEmpty {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.self) { chip in
                        Text(chip.uppercased())
                            .font(FFTheme.eyebrow(11))
                            .foregroundStyle(FFTheme.scripture)
                            .padding(.horizontal, 13).padding(.vertical, 7)
                            .background(FFTheme.meadow.opacity(0.08), in: Capsule())
                            .overlay(Capsule().stroke(FFTheme.meadow.opacity(0.35), lineWidth: 1.2))
                    }
                }
                .padding(.top, 16)
            }
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
    }
}

private struct IntroFinalSlide: View {
    let onFinish: () -> Void
    @State private var breathe = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 30)
            Image("BrandMarkTransparent")
                .resizable().scaledToFit()
                .frame(width: 88, height: 88)
                .shadow(color: FFTheme.walnut.opacity(0.26), radius: 10, y: 6)
                .scaleEffect(breathe ? 1.045 : 1.0)
                .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: breathe)
                .onAppear { breathe = true }
            Text("Ready to begin?")
                .font(FFTheme.display(27, weight: .bold, relativeTo: .title))
                .foregroundStyle(FFTheme.ink)
                .padding(.top, 20)
            Text("Your first workout — and your first verse — are waiting.")
                .font(FFTheme.serif(16))
                .foregroundStyle(FFTheme.inkSoft)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .padding(.top, 10)
            Button("Get Started") { onFinish() }
                .buttonStyle(.ffPrimary)
                .frame(maxWidth: 300)
                .padding(.top, 26)
            Text("You can revisit this anytime from Settings.")
                .font(FFTheme.caption())
                .foregroundStyle(FFTheme.muted)
                .padding(.top, 14)
            Spacer(minLength: 40)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
    }
}

// MARK: - "App shot" mockups — recreated miniatures of real screens, not
// live data, so the demo works before the member has any workouts or posts.

private struct AppShotCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(FFTheme.display(12, weight: .semibold, relativeTo: .caption))
                .foregroundStyle(FFTheme.cream)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(FFTheme.walnut)
            content
                .padding(13)
        }
        .frame(width: 232)
        .background(FFTheme.parchment2)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(FFTheme.walnutEdge, lineWidth: 1))
        .shadow(color: FFTheme.walnut.opacity(0.24), radius: 16, y: 10)
    }
}

private struct IntroWorkoutShot: View {
    var body: some View {
        AppShotCard(title: "Activity Analysis") {
            VStack(spacing: 8) {
                RouteSparkline()
                    .frame(height: 44)
                metricRow("Distance", "5.42 km")
                metricRow("Elevation gain", "68 m")
                metricRow("Pace", "5:42 /km")
            }
        }
    }

    private func metricRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(FFTheme.serif(13)).foregroundStyle(FFTheme.inkSoft)
            Spacer()
            Text(value).font(.system(size: 13, weight: .semibold)).monospacedDigit().foregroundStyle(FFTheme.ink)
        }
        .padding(.vertical, 4)
        .overlay(Rectangle().fill(FFTheme.hairline).frame(height: 1), alignment: .bottom)
    }
}

private struct RouteSparkline: View {
    @State private var drawn: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            Path { path in
                let w = geo.size.width, h = geo.size.height
                path.move(to: CGPoint(x: 0, y: h * 0.82))
                path.addCurve(to: CGPoint(x: w * 0.58, y: h * 0.42),
                               control1: CGPoint(x: w * 0.28, y: h * 0.82),
                               control2: CGPoint(x: w * 0.36, y: h * 0.14))
                path.addCurve(to: CGPoint(x: w, y: h * 0.22),
                               control1: CGPoint(x: w * 0.82, y: h * 0.6),
                               control2: CGPoint(x: w * 0.92, y: h * 0.05))
            }
            .trim(from: 0, to: drawn)
            .stroke(FFTheme.meadow, style: StrokeStyle(lineWidth: 3, lineCap: .round))
            .onAppear {
                drawn = 0
                withAnimation(.easeOut(duration: 1.1)) { drawn = 1 }
            }
        }
    }
}

/// A soft, looping glow behind "TODAY" -- a quiet cue that this card is
/// alive and re-picks itself, not a static screenshot of one fixed verse.
private struct PulsingBadge: View {
    let text: String
    @State private var glowing = false

    var body: some View {
        Text(text)
            .font(FFTheme.eyebrow(8))
            .foregroundStyle(FFTheme.cream)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(FFTheme.meadow, in: Capsule())
            .shadow(color: FFTheme.meadow.opacity(glowing ? 0.7 : 0), radius: glowing ? 6 : 0)
            .animation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true), value: glowing)
            .onAppear { glowing = true }
    }
}

private struct IntroScriptureShot: View {
    var body: some View {
        AppShotCard(title: "Home") {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "book.closed.fill").font(.caption2).foregroundStyle(FFTheme.scripture)
                    Text("SCRIPTURE IN MOTION").font(FFTheme.eyebrow(10)).foregroundStyle(FFTheme.scripture)
                    Spacer()
                    PulsingBadge(text: "TODAY")
                }
                Text("Philippians 4:13").font(.system(size: 15, weight: .bold)).foregroundStyle(FFTheme.ink)
                Text("\"I can do all things through him who strengthens me.\"")
                    .font(FFTheme.serifItalic(12.5)).foregroundStyle(FFTheme.inkSoft)
                HStack(spacing: 8) {
                    Text("Begin the mission").font(.system(size: 11, weight: .semibold)).foregroundStyle(FFTheme.cream)
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadow], startPoint: .top, endPoint: .bottom), in: Capsule())
                    Text("Read").font(.system(size: 11, weight: .semibold)).foregroundStyle(FFTheme.inkSoft)
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .overlay(Capsule().stroke(FFTheme.hairline, lineWidth: 1.2))
                }
                .padding(.top, 4)
            }
            .padding(12)
            .background(FFTheme.parchment1, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(FFTheme.hairline, lineWidth: 1)
            )
            .overlay(alignment: .leading) {
                Rectangle().fill(FFTheme.goldBright).frame(width: 4)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .padding(.vertical, 2)
            }
        }
    }
}

private struct IntroCommunityShot: View {
    var body: some View {
        VStack(spacing: 12) {
            AppShotCard(title: "Reels") {
                VStack(alignment: .leading, spacing: 9) {
                    ZStack(alignment: .topLeading) {
                        LinearGradient(colors: [FFTheme.meadow2, FFTheme.meadowDeep], startPoint: .topLeading, endPoint: .bottomTrailing)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        Text("TRAIL RUN")
                            .font(FFTheme.eyebrow(8.5)).foregroundStyle(FFTheme.cream)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(FFTheme.walnut.opacity(0.5), in: Capsule())
                            .padding(8)
                        LikeHeart()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(10)
                    }
                    .frame(height: 84)

                    HStack(spacing: 4) {
                        Image(systemName: "book.closed.fill").font(.system(size: 10)).foregroundStyle(FFTheme.scripture)
                        Text("Isaiah 40:31 →").font(.system(size: 11.5, weight: .bold)).foregroundStyle(FFTheme.scripture)
                    }

                    HStack(spacing: 6) {
                        reelChip("heart")
                        reelChip("bookmark.fill")
                        reelChip("arrowshape.turn.up.right.fill")
                    }
                }
            }
            HStack(spacing: -8) {
                ForEach(0..<4, id: \.self) { _ in
                    Circle()
                        .fill(LinearGradient(colors: [FFTheme.meadow2, FFTheme.forest], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 30, height: 30)
                        .overlay(Circle().stroke(FFTheme.parchment2, lineWidth: 2))
                }
            }
        }
    }

    private func reelChip(_ systemImage: String) -> some View {
        Image(systemName: systemImage)
            .font(.system(size: 12))
            .foregroundStyle(FFTheme.inkSoft)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .overlay(Capsule().stroke(FFTheme.ink.opacity(0.2), lineWidth: 1.2))
    }
}

/// A heartbeat, not a static glyph: the heart itself thumps on a steady
/// cadence while a ring expands and fades outward from it, echoing a live
/// pulse reading -- the single detail most worth animating in the whole
/// demo, since "your heart rate, live" is the actual product claim here.
private struct HeartbeatBadge: View {
    @State private var beat = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(FFTheme.seal.opacity(0.55), lineWidth: 2)
                .scaleEffect(beat ? 1.65 : 1.0)
                .opacity(beat ? 0 : 0.75)
                .animation(.easeOut(duration: 1.15).repeatForever(autoreverses: false), value: beat)
            Circle().stroke(FFTheme.seal, lineWidth: 2)
            Image(systemName: "heart.fill")
                .font(.system(size: 18))
                .foregroundStyle(FFTheme.seal)
                .scaleEffect(beat ? 1.22 : 1.0)
                .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: beat)
        }
        .frame(width: 44, height: 44)
        .onAppear { beat = true }
    }
}

private struct LikeHeart: View {
    @State private var liked = false

    var body: some View {
        Image(systemName: "heart.fill")
            .font(.caption)
            .foregroundStyle(FFTheme.cream)
            .scaleEffect(liked ? 1.3 : 1.0)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(0.4), value: liked)
            .onAppear { liked = true }
    }
}

private struct IntroWearableShot: View {
    var body: some View {
        AppShotCard(title: "Train") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    HeartbeatBadge()
                    VStack(alignment: .leading, spacing: 1) {
                        Text("142 bpm").font(.system(size: 18, weight: .bold)).monospacedDigit().foregroundStyle(FFTheme.ink)
                        Text("Live from Apple Watch").font(.system(size: 10.5)).foregroundStyle(FFTheme.inkSoft)
                    }
                }
                .padding(11)
                .background(FFTheme.seal.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(FFTheme.seal.opacity(0.22), lineWidth: 1))

                Text("Your recovery looks strong this week — steady pace, and a verse to match your consistency.")
                    .font(.system(size: 12))
                    .foregroundStyle(FFTheme.inkSoft)
                    .padding(10)
                    .background(FFTheme.meadow.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(alignment: .leading) {
                        Rectangle().fill(FFTheme.meadow).frame(width: 3)
                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                    }
            }
        }
    }
}

#Preview {
    IntroDemoView(onFinish: {})
}
