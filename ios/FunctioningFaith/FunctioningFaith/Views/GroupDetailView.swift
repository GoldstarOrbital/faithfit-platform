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
    @State private var showAnnouncementEditor = false
    @State private var announcementDraft = ""
    @State private var showEventComposer = false

    var body: some View {
        List {
            if let announcement = detail?.announcement, !announcement.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Pinned announcement", systemImage: "pin.fill").font(.caption.weight(.semibold)).foregroundStyle(FFTheme.hearth)
                        Text(announcement)
                        if detail?.isAdmin == true {
                            Button("Edit") { announcementDraft = announcement; showAnnouncementEditor = true }
                                .font(.caption)
                        }
                    }
                    .padding(.vertical, 3)
                }
                .listRowBackground(FFTheme.parchment1)
            } else if detail?.isAdmin == true {
                Section {
                    Button("Pin an announcement") { announcementDraft = ""; showAnnouncementEditor = true }
                }
                .listRowBackground(FFTheme.parchment1)
            }
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
                        if detail.isVerifiedLeader {
                            Label("Verified group leader", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(FFTheme.goldBright)
                                .accessibilityHint("Admin with an independently verified church affiliation")
                        } else {
                            Label("You manage this group", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(FFTheme.gold)
                        }
                        NavigationLink("Manage members") { GroupMembersView(groupID: group.id) }
                    } else {
                        Button(detail.isMember ? "Leave group" : "Join group", role: detail.isMember ? .destructive : nil) {
                            changeMembership(joining: !detail.isMember)
                        }
                        .disabled(isChangingMembership)
                    }
                }
            }
            .listRowBackground(FFTheme.parchment1)

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
                .listRowBackground(FFTheme.parchment1)

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
                .listRowBackground(FFTheme.parchment1)
            }

            if let events = detail?.events, !events.isEmpty {
                Section("Upcoming") {
                    ForEach(events) { event in
                        eventRow(event)
                    }
                    if detail?.isMember == true {
                        Button("New event") { showEventComposer = true }
                    }
                }
                .listRowBackground(FFTheme.parchment1)
            } else if detail?.isMember == true {
                Section("Upcoming") {
                    Button("New event") { showEventComposer = true }
                }
                .listRowBackground(FFTheme.parchment1)
            }
        }
        .ffListChrome()
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
        .sheet(isPresented: $showEventComposer) {
            NavigationStack {
                GroupEventComposerView(groupID: group.id) {
                    showEventComposer = false
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showAnnouncementEditor) {
            NavigationStack {
                Form {
                    Section {
                        TextField("Announcement", text: $announcementDraft, axis: .vertical)
                            .lineLimit(3...8)
                    } footer: {
                        Text("Visible to every member, pinned above the conversation. Clear the text to unpin it.")
                    }
                    .listRowBackground(FFTheme.parchment1)
                }
                .ffListChrome()
                .navigationTitle("Announcement")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAnnouncementEditor = false } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await saveAnnouncement() } } }
                }
            }
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
        if selectedPulseKind == kind {
            Button { selectedPulseKind = kind } label: {
                Label(title, systemImage: icon).font(.caption.weight(.semibold)).frame(maxWidth: .infinity)
            }
            .buttonStyle(.ffPrimary)
            .accessibilityAddTraits(.isSelected)
        } else {
            Button { selectedPulseKind = kind } label: {
                Label(title, systemImage: icon).font(.caption.weight(.semibold)).frame(maxWidth: .infinity)
            }
            .buttonStyle(.ffGhost)
        }
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
                Text(reference).font(.caption.weight(.semibold)).foregroundStyle(FFTheme.scripture)
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

    private func eventRow(_ event: GroupEvent) -> some View {
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
            if detail?.isMember == true {
                HStack(spacing: 10) {
                    rsvpButton(event, status: "going", label: "Going")
                    rsvpButton(event, status: "interested", label: "Interested")
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func rsvpButton(_ event: GroupEvent, status: String, label: String) -> some View {
        if event.myRSVP == status {
            Button(label) {
                Task { await rsvp(event, status: "none") }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.ffPrimary)
            .accessibilityAddTraits(.isSelected)
        } else {
            Button(label) {
                Task { await rsvp(event, status: status) }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.ffGhost)
        }
    }

    private func rsvp(_ event: GroupEvent, status: String) async {
        do {
            try await APIClient.shared.rsvpEvent(eventID: event.id, status: status)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
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

    private func saveAnnouncement() async {
        do {
            try await APIClient.shared.setGroupAnnouncement(groupID: group.id, text: announcementDraft.trimmingCharacters(in: .whitespacesAndNewlines))
            showAnnouncementEditor = false
            await load()
        } catch { errorMessage = error.localizedDescription }
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

private struct GroupEventComposerView: View {
    let groupID: String
    let onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var eventDescription = ""
    @State private var eventTime = Date().addingTimeInterval(86400)
    @State private var locationName = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("Event") {
                TextField("Title", text: $title)
                TextField("Description", text: $eventDescription, axis: .vertical).lineLimit(2...4)
                DatePicker("When", selection: $eventTime, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                TextField("Location (optional)", text: $locationName)
            }
            .listRowBackground(FFTheme.parchment1)
        }
        .ffListChrome()
        .navigationTitle("New Event")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
            }
        }
        .alert("Could not create event", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func save() async {
        isSaving = true
        do {
            try await APIClient.shared.createGroupEvent(
                groupID: groupID, title: title.trimmingCharacters(in: .whitespaces),
                description: eventDescription.trimmingCharacters(in: .whitespaces).isEmpty ? nil : eventDescription,
                activityType: nil, eventTime: eventTime,
                locationName: locationName.trimmingCharacters(in: .whitespaces).isEmpty ? nil : locationName)
            onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

#Preview {
    NavigationStack {
        GroupDetailView(group: MockData.exploreContent.groups[0])
    }
    .environmentObject(NativeSession())
}
