import SwiftUI

struct GroupDetailView: View {
    let group: ExploreGroup
    @EnvironmentObject private var session: NativeSession
    @State private var detail: NativeGroupDetail?
    @State private var pulse: GroupPulse?
    @State private var isLoading = true
    @State private var isChangingMembership = false
    @State private var messageText = ""
    @State private var isSending = false
    @State private var selectedPulseKind: String?
    @State private var pulseNote = ""
    @State private var isSubmittingPulse = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(detail?.group.description ?? group.description ?? "A Functioning Faith community.")
                        .font(.body)
                    HStack(spacing: 14) {
                        if let sport = detail?.group.sport ?? group.sport {
                            Label(sport, systemImage: "figure.run")
                        }
                        if let location = detail?.group.locationName ?? group.locationName {
                            Label(location, systemImage: "mappin.and.ellipse")
                        }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                    Label("\(detail?.memberCount ?? group.memberCount) members", systemImage: "person.2.fill")
                        .font(.caption.weight(.semibold))
                }
                .padding(.vertical, 5)

                if let detail {
                    if detail.isAdmin {
                        Label("You manage this group", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.indigo)
                    } else {
                        Button(detail.isMember ? "Leave group" : "Join group", role: detail.isMember ? .destructive : nil) {
                            changeMembership(joining: !detail.isMember)
                        }
                        .disabled(isChangingMembership)
                    }
                }
            }

            if let detail, detail.isMember {
                Section {
                    Text("Share where you are today. There are no rankings or missed-day penalties—just a simple way to show up for one another.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        pulseKindButton("moved", title: "Moved", icon: "figure.run")
                        pulseKindButton("prayed", title: "Prayed", icon: "hands.sparkles.fill")
                        pulseKindButton("rested", title: "Recovered", icon: "leaf.fill")
                    }
                    TextField("Optional support note", text: $pulseNote, axis: .vertical)
                        .lineLimit(1...3)
                    Button(pulse?.mine == nil ? "Share today’s check-in" : "Update today’s check-in") {
                        submitPulse()
                    }
                    .disabled(selectedPulseKind == nil || isSubmittingPulse)

                    if let checkins = pulse?.checkins, checkins.isEmpty {
                        Text("No check-ins yet. Be the first to share today’s rhythm.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach((pulse?.checkins ?? []).prefix(18)) { checkin in
                            pulseRow(checkin)
                        }
                    }
                } header: {
                    HStack {
                        Text("Group Pulse")
                        Spacer()
                        if let count = pulse?.todayCount { Text("\(count) today").font(.caption).foregroundStyle(.secondary) }
                    }
                }

                Section("Conversation") {
                    if detail.messages.isEmpty {
                        Text("Start the conversation with encouragement or a meetup note.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(detail.messages.suffix(20)) { message in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(message.author).font(.caption.weight(.semibold))
                                Text(message.content)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                    HStack {
                        TextField("Message the group", text: $messageText, axis: .vertical)
                            .lineLimit(1...4)
                        Button {
                            sendMessage()
                        } label: {
                            if isSending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                        }
                        .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                        .accessibilityLabel("Send group message")
                    }
                }
            }

            if let events = detail?.events, !events.isEmpty {
                Section("Upcoming") {
                    ForEach(events) { event in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(event.title).font(.headline)
                            if let description = event.description {
                                Text(description).font(.caption).foregroundStyle(.secondary)
                            }
                            HStack {
                                if let activity = event.activityType { Label(activity, systemImage: "figure.run") }
                                if let location = event.locationName { Label(location, systemImage: "mappin") }
                            }
                            .font(.caption2).foregroundStyle(.secondary)
                            Text("\(event.goingCount) going · \(event.interestedCount) interested")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if isLoading { ProgressView() } }
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not complete that action", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await APIClient.shared.fetchGroupDetail(id: group.id)
            if detail?.isMember == true {
                pulse = try await APIClient.shared.fetchGroupPulse(groupID: group.id)
                selectedPulseKind = pulse?.mine?.kind
                pulseNote = pulse?.mine?.note ?? ""
            } else {
                pulse = nil
            }
        }
        catch { errorMessage = error.localizedDescription }
    }

    @ViewBuilder
    private func pulseKindButton(_ kind: String, title: String, icon: String) -> some View {
        Button {
            selectedPulseKind = kind
        } label: {
            Label(title, systemImage: icon).font(.caption.weight(.semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(selectedPulseKind == kind ? .orange : .secondary)
        .accessibilityAddTraits(selectedPulseKind == kind ? .isSelected : [])
    }

    @ViewBuilder
    private func pulseRow(_ checkin: GroupPulseCheckin) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("\(pulseIcon(checkin.kind)) \(checkin.author)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(checkin.day == pulse?.day ? "Today" : checkin.day).font(.caption2).foregroundStyle(.secondary)
            }
            Text([pulseTitle(checkin.kind), checkin.note].compactMap { $0 }.joined(separator: " · "))
            if let reference = checkin.verseReference {
                Text(reference).font(.caption.weight(.semibold)).foregroundStyle(.indigo)
                if let verse = checkin.verseText { Text(verse).font(.caption).italic().foregroundStyle(.secondary) }
            }
            if checkin.userID != session.profile?.id.uuidString {
                Button(checkin.encouragedByMe ? "Encouraged ✓ · \(checkin.encouragementCount)" : "Encourage · \(checkin.encouragementCount)") {
                    encourage(checkin)
                }
                .buttonStyle(.borderless)
                .font(.caption.weight(.semibold))
                .disabled(checkin.encouragedByMe)
            } else {
                Text("\(checkin.encouragementCount) encouragement\(checkin.encouragementCount == 1 ? "" : "s")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 5)
    }

    private func submitPulse() {
        guard let kind = selectedPulseKind else { return }
        isSubmittingPulse = true
        Task {
            do {
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_CA"); formatter.dateFormat = "yyyy-MM-dd"
                _ = try await APIClient.shared.updateGroupPulse(groupID: group.id, kind: kind, note: pulseNote, day: formatter.string(from: .now))
                pulse = try await APIClient.shared.fetchGroupPulse(groupID: group.id)
            } catch { errorMessage = error.localizedDescription }
            isSubmittingPulse = false
        }
    }

    private func encourage(_ checkin: GroupPulseCheckin) {
        Task {
            do {
                let response = try await APIClient.shared.encourageGroupPulse(groupID: group.id, checkinID: checkin.id)
                guard let index = pulse?.checkins.firstIndex(where: { $0.id == checkin.id }) else { return }
                pulse?.checkins[index].encouragedByMe = response.encouraged
                pulse?.checkins[index].encouragementCount = response.encouragementCount
            } catch { errorMessage = error.localizedDescription }
        }
    }

    private func pulseTitle(_ kind: String) -> String? {
        ["moved": "Moved", "prayed": "Prayed", "rested": "Recovered"][kind]
    }

    private func pulseIcon(_ kind: String) -> String {
        ["moved": "🏃", "prayed": "🙏", "rested": "🌿"][kind] ?? "•"
    }

    private func changeMembership(joining: Bool) {
        isChangingMembership = true
        Task {
            do {
                try await APIClient.shared.setGroupMembership(id: group.id, joining: joining)
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
            isChangingMembership = false
        }
    }

    private func sendMessage() {
        let content = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        isSending = true
        Task {
            do {
                let message = try await APIClient.shared.sendGroupMessage(groupID: group.id, content: content)
                detail?.messages.append(message)
                messageText = ""
            } catch {
                errorMessage = error.localizedDescription
            }
            isSending = false
        }
    }
}

#Preview {
    NavigationStack {
        GroupDetailView(group: MockData.exploreContent.groups[0])
    }
    .environmentObject(NativeSession())
}
