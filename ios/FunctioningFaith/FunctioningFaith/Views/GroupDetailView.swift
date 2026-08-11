import SwiftUI

struct GroupDetailView: View {
    let group: ExploreGroup
    @State private var detail: NativeGroupDetail?
    @State private var isLoading = true
    @State private var isChangingMembership = false
    @State private var messageText = ""
    @State private var isSending = false
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
        do { detail = try await APIClient.shared.fetchGroupDetail(id: group.id) }
        catch { errorMessage = error.localizedDescription }
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
}
