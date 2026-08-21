import SwiftUI

/// A real, human-reviewed application -- not something that completes
/// instantly via API calls. See lib/developer-verification.js's own state
/// machine: a verified .edu email plus an associated, admin-verified
/// church, reviewed by a person before either "verified" flag is set.
struct ChurchVerificationView: View {
    @State private var status: DeveloperVerificationStatus?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && status == nil {
                ProgressView()
            } else if let status {
                List {
                    statusSection(status)
                    actionSection(status)
                }
            }
        }
        .navigationTitle("Church Verification")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Could not load verification status", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func statusSection(_ status: DeveloperVerificationStatus) -> some View {
        Section {
            Text(Self.statusLabel(status.status)).font(.headline)
            Text(Self.statusExplanation(status.status)).font(.caption).foregroundStyle(.secondary)
            if let projectName = status.projectName {
                LabeledContent("Project", value: projectName)
            }
            if let churchName = status.churchName {
                LabeledContent("Church", value: churchName)
            }
            if let note = status.reviewNote, !note.isEmpty {
                Text(note).font(.caption).italic()
            }
        } header: {
            Text("Status")
        }
    }

    @ViewBuilder
    private func actionSection(_ status: DeveloperVerificationStatus) -> some View {
        if status.eligible {
            Section {
                NavigationLink { ChurchAdminLinkingView() } label: {
                    Label("Link YouTube channel & website", systemImage: "link")
                }
            }
        } else if status.status == "not_applied" || status.status == "rejected" {
            Section {
                NavigationLink {
                    ChurchApplyView { Task { await load() } }
                } label: {
                    Text(status.status == "rejected" ? "Re-apply" : "Apply for verification")
                }
            } footer: {
                Text("Requires a .edu email already linked to your account and a real church with a public contact email. A person reviews every application.")
            }
        }
    }

    private static func statusLabel(_ raw: String) -> String {
        switch raw {
        case "not_applied": return "Not applied"
        case "pending_email": return "Waiting on a verified .edu email"
        case "pending_church": return "Waiting on church verification"
        case "pending_review": return "Application under review"
        case "verified": return "Verified"
        case "rejected": return "Application not approved"
        case "suspended": return "Suspended"
        case "revoked": return "Revoked"
        default: return raw.capitalized
        }
    }

    private static func statusExplanation(_ raw: String) -> String {
        switch raw {
        case "not_applied": return "Apply to link your church's real YouTube channel and website."
        case "pending_email": return "Link a .edu email to your account (Google or Microsoft sign-in, from the web app) with that address, then check back."
        case "pending_church": return "Your church still needs to be verified. This can take a little time."
        case "pending_review": return "A person reviews every application by hand -- this isn't instant."
        case "verified": return "You can link your church's real YouTube channel and website."
        case "rejected": return "Your application wasn't approved. You can apply again with updated details."
        case "suspended", "revoked": return "Your verified status was removed after review."
        default: return ""
        }
    }

    private func load() async {
        isLoading = true
        do { status = try await APIClient.shared.fetchDeveloperVerification() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

struct ChurchApplyView: View {
    let onSubmitted: () -> Void
    @EnvironmentObject private var session: NativeSession
    @Environment(\.dismiss) private var dismiss
    @State private var churchName = ""
    @State private var churchAddress = ""
    @State private var churchContactEmail = ""
    @State private var eduEmail = ""
    @State private var projectName = "Functioning Faith"
    @State private var projectPurpose = ""
    @State private var agreedTerms = false
    @State private var agreedAccountability = false
    @State private var agreedContentStandard = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var canSubmit: Bool {
        !churchName.trimmingCharacters(in: .whitespaces).isEmpty
            && !churchAddress.trimmingCharacters(in: .whitespaces).isEmpty
            && !churchContactEmail.trimmingCharacters(in: .whitespaces).isEmpty
            && !eduEmail.trimmingCharacters(in: .whitespaces).isEmpty
            && !projectPurpose.trimmingCharacters(in: .whitespaces).isEmpty
            && agreedTerms && agreedAccountability && agreedContentStandard
            && !isSubmitting
    }

    var body: some View {
        Form {
            Section {
                TextField("name@school.edu", text: $eduEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Your .edu email")
            } footer: {
                Text("Must already be linked to your account with a verified email -- link a Google or Microsoft account using this address from the web app first if you haven't.")
            }
            Section("Your church") {
                TextField("Church name", text: $churchName)
                TextField("Address", text: $churchAddress, axis: .vertical).lineLimit(2...3)
                TextField("Public contact email", text: $churchContactEmail)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Section("Your project") {
                TextField("Project name", text: $projectName)
                TextField("Describe the project and its community purpose", text: $projectPurpose, axis: .vertical)
                    .lineLimit(3...6)
            }
            Section("Agreements") {
                Toggle("I agree to the Functioning Faith developer terms", isOn: $agreedTerms)
                Toggle("I accept accountability for content and conduct associated with my verified status", isOn: $agreedAccountability)
                Toggle("I will follow the community content standards", isOn: $agreedContentStandard)
            }
        }
        .navigationTitle("Apply")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if churchName.isEmpty { churchName = session.profile?.churchName ?? "" }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Submit") { Task { await submit() } }
                    .disabled(!canSubmit)
            }
        }
        .alert("Could not submit", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func submit() async {
        isSubmitting = true
        do {
            let church = try await APIClient.shared.claimChurch(
                name: churchName.trimmingCharacters(in: .whitespaces),
                address: churchAddress.trimmingCharacters(in: .whitespaces),
                contactEmail: churchContactEmail.trimmingCharacters(in: .whitespaces))
            try await APIClient.shared.applyForChurchVerification(
                eduEmail: eduEmail.trimmingCharacters(in: .whitespaces),
                churchID: church.id,
                churchContactEmail: churchContactEmail.trimmingCharacters(in: .whitespaces),
                projectName: projectName.trimmingCharacters(in: .whitespaces),
                projectPurpose: projectPurpose.trimmingCharacters(in: .whitespaces))
            onSubmitted()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}

/// Only reachable once `eligible == true` -- the server enforces the same
/// gate independently (requireVerifiedChurchAdmin) on every call here, so
/// this view is a convenience, not the actual security boundary.
struct ChurchAdminLinkingView: View {
    @EnvironmentObject private var session: NativeSession
    @State private var channelQuery = ""
    @State private var channelResults: [YouTubeChannelResult] = []
    @State private var isSearchingChannels = false
    @State private var websiteURL = ""
    @State private var isSavingWebsite = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("Search for your church's channel", text: $channelQuery)
                Button("Search") { Task { await searchChannels() } }
                    .disabled(channelQuery.trimmingCharacters(in: .whitespaces).isEmpty || isSearchingChannels)
                if isSearchingChannels { ProgressView() }
                ForEach(channelResults) { channel in
                    Button { Task { await link(channel) } } label: { Text(channel.title) }
                }
            } header: {
                Text("YouTube channel")
            }
            Section {
                TextField("https://yourchurch.org", text: $websiteURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Save website") { Task { await saveWebsite() } }
                    .disabled(websiteURL.trimmingCharacters(in: .whitespaces).isEmpty || isSavingWebsite)
            } header: {
                Text("Official website")
            }
        }
        .navigationTitle("Link Your Church")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Could not complete that action", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
        .alert("Done", isPresented: Binding(get: { successMessage != nil }, set: { if !$0 { successMessage = nil } })) {
            Button("OK", role: .cancel) { successMessage = nil }
        } message: { Text(successMessage ?? "") }
    }

    private func searchChannels() async {
        isSearchingChannels = true
        do { channelResults = try await APIClient.shared.searchYouTubeChannels(query: channelQuery) }
        catch { errorMessage = error.localizedDescription }
        isSearchingChannels = false
    }

    private func link(_ channel: YouTubeChannelResult) async {
        guard let osmID = session.profile?.churchOsmID else { return }
        do {
            try await APIClient.shared.linkChurchYouTubeChannel(osmID: osmID, channelID: channel.channelId, channelTitle: channel.title)
            successMessage = "Linked \(channel.title)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveWebsite() async {
        guard let osmID = session.profile?.churchOsmID else { return }
        isSavingWebsite = true
        do {
            try await APIClient.shared.setChurchWebsite(osmID: osmID, websiteURL: websiteURL.trimmingCharacters(in: .whitespaces))
            successMessage = "Website saved."
        } catch {
            errorMessage = error.localizedDescription
        }
        isSavingWebsite = false
    }
}

#Preview { NavigationStack { ChurchVerificationView() }.environmentObject(NativeSession()) }
