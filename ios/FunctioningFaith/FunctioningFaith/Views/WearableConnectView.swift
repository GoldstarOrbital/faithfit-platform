import SwiftUI

/// Explicit opt-in pairing screen for standard BLE heart-rate devices. Apple
/// Watch and other Health-enabled apps continue to sync through HealthKit.
struct WearableConnectView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var bluetooth = BluetoothHeartRateManager.shared

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Connect a Bluetooth heart-rate strap, sensor, or wearable that supports the standard Heart Rate Service. Apple Watch workouts sync through Apple Health.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section("Status") {
                    Label(bluetooth.statusText, systemImage: bluetooth.connectedName == nil ? "dot.radiowaves.left.and.right" : "heart.fill")
                        .foregroundStyle(bluetooth.connectedName == nil ? .primary : FFTheme.meadow)
                    if let bpm = bluetooth.heartRate { LabeledContent("Live heart rate", value: "\(bpm) BPM") }
                    if bluetooth.connectedName != nil {
                        Button("Disconnect", role: .destructive) { bluetooth.disconnect() }
                    }
                }

                Section("Nearby devices") {
                    if bluetooth.devices.isEmpty {
                        ContentUnavailableView("No devices found", systemImage: "antenna.radiowaves.left.and.right", description: Text("Put your wearable in pairing mode, then scan again."))
                    } else {
                        ForEach(bluetooth.devices) { device in
                            Button { bluetooth.connect(device) } label: {
                                HStack {
                                    Label(device.name, systemImage: "heart.circle")
                                    Spacer()
                                    Text("\(device.rssi) dBm").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Connect wearable")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(bluetooth.isScanning ? "Scanning…" : "Scan") { bluetooth.scan() }
                        .disabled(bluetooth.isScanning)
                }
            }
            .task { bluetooth.scan() }
        }
    }
}

#Preview { WearableConnectView() }
