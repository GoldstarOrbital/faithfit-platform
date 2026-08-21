import SwiftUI

struct NativeAccountSetupView: View {
    let onComplete: () -> Void
    let onSignOut: () -> Void

    @State private var dateOfBirth = Calendar.current.date(byAdding: .year, value: -18, to: .now) ?? .now
    @State private var acceptedTerms = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Confirm your age and review the current community rules before posting, messaging, or joining groups.")
                        .foregroundStyle(.secondary)
                    DatePicker("Date of birth", selection: $dateOfBirth, in: ...Date(), displayedComponents: .date)
                    Toggle("I am at least 13 and accept the Terms and Privacy Policy", isOn: $acceptedTerms)
                    HStack(spacing: 16) {
                        Link("Terms", destination: URL(string: "https://faithfit-demo-production.up.railway.app/terms.html")!)
                        Link("Privacy", destination: URL(string: "https://faithfit-demo-production.up.railway.app/privacy.html")!)
                    }
                    .font(.footnote)
                } header: {
                    Text("Account safety")
                }
                .listRowBackground(FFTheme.parchment1)

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(FFTheme.seal) }
                        .listRowBackground(FFTheme.parchment1)
                }

                Section {
                    Button {
                        completeSetup()
                    } label: {
                        if isSubmitting { ProgressView().frame(maxWidth: .infinity) }
                        else { Text("Continue").frame(maxWidth: .infinity) }
                    }
                    .disabled(!acceptedTerms || !isEligibleAge || isSubmitting)
                    Button("Sign out", role: .destructive, action: onSignOut)
                }
                .listRowBackground(FFTheme.parchment1)
            }
            .ffListChrome()
            .navigationTitle("One quick step")
        }
    }

    private var isEligibleAge: Bool {
        (Calendar(identifier: .gregorian).dateComponents([.year], from: dateOfBirth, to: .now).year ?? 0) >= 13
    }

    private func completeSetup() {
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                try await APIClient.shared.completeNativeAccountSetup(dateOfBirth: dateOfBirth, acceptedTerms: acceptedTerms)
                isSubmitting = false
                onComplete()
            } catch {
                isSubmitting = false
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview { NativeAccountSetupView(onComplete: {}, onSignOut: {}) }
