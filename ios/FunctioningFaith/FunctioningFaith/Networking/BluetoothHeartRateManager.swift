import Foundation
import CoreBluetooth

struct WearableDevice: Identifiable {
    let id: UUID
    let name: String
    let rssi: Int
    fileprivate let peripheral: CBPeripheral
}

/// Pairs with standard BLE heart-rate, cadence, power, and indoor-bike sensors.
/// Apple Watch data remains intentionally in HealthKit; vendor-locked watches
/// continue to sync through HealthKit or Strava rather than a guessed pairing.
final class BluetoothHeartRateManager: NSObject, ObservableObject {
    static let shared = BluetoothHeartRateManager()

    @Published private(set) var devices: [WearableDevice] = []
    @Published private(set) var statusText = "Bluetooth is starting…"
    @Published private(set) var heartRate: Int?
    @Published private(set) var cadenceRPM: Int?
    @Published private(set) var cyclingPowerWatts: Int?
    @Published private(set) var speedKmh: Double?
    @Published private(set) var peakPowerWatts = 0
    @Published private(set) var connectedName: String?
    @Published private(set) var isScanning = false

    private var central: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private let heartRateService = CBUUID(string: "180D")
    private let heartRateMeasurement = CBUUID(string: "2A37")
    private let cyclingSpeedCadenceService = CBUUID(string: "1816")
    private let cyclingPowerService = CBUUID(string: "1818")
    private let fitnessMachineService = CBUUID(string: "1826")
    private let cscMeasurement = CBUUID(string: "2A5B")
    private let powerMeasurement = CBUUID(string: "2A63")
    private let indoorBikeData = CBUUID(string: "2AD2")
    private var previousCrank: (revolutions: UInt16, eventTime: UInt16)?

    private var supportedServices: [CBUUID] { [heartRateService, cyclingSpeedCadenceService, cyclingPowerService, fitnessMachineService] }
    var hasLiveSensorData: Bool { heartRate != nil || cadenceRPM != nil || cyclingPowerWatts != nil || speedKmh != nil }

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func scan() {
        guard central.state == .poweredOn else {
            statusText = bluetoothStateDescription(central.state)
            return
        }
        devices.removeAll()
        resetMeasurements()
        isScanning = true
        statusText = "Looking for heart-rate devices…"
        central.scanForPeripherals(withServices: supportedServices, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func connect(_ device: WearableDevice) {
        central.stopScan()
        isScanning = false
        statusText = "Connecting to \(device.name)…"
        connectedPeripheral = device.peripheral
        central.connect(device.peripheral)
    }

    func disconnect() {
        guard let connectedPeripheral else { return }
        central.cancelPeripheralConnection(connectedPeripheral)
    }

    private func resetMeasurements() {
        heartRate = nil; cadenceRPM = nil; cyclingPowerWatts = nil; speedKmh = nil
        peakPowerWatts = 0; previousCrank = nil
    }

    private func refreshStatus() {
        guard let name = connectedName else { return }
        let readings = [heartRate.map { "\($0) BPM" }, cadenceRPM.map { "\($0) rpm" }, cyclingPowerWatts.map { "\($0) W" }, speedKmh.map { String(format: "%.1f km/h", $0) }].compactMap { $0 }
        statusText = readings.isEmpty ? "Connected to \(name). Waiting for sensor data…" : "Connected to \(name) · \(readings.joined(separator: " · "))"
    }

    private func bluetoothStateDescription(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOff: return "Turn on Bluetooth to connect a wearable."
        case .unauthorized: return "Allow Bluetooth in iPhone Settings to connect a wearable."
        case .unsupported: return "Bluetooth heart-rate devices are not supported on this device."
        case .resetting: return "Bluetooth is resetting…"
        case .unknown: return "Bluetooth is starting…"
        case .poweredOn: return "Ready to connect a heart-rate device."
        @unknown default: return "Bluetooth is unavailable."
        }
    }
}

extension BluetoothHeartRateManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        statusText = bluetoothStateDescription(central.state)
        if central.state != .poweredOn {
            isScanning = false
            devices.removeAll(); resetMeasurements()
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        let device = WearableDevice(id: peripheral.identifier, name: peripheral.name ?? "Fitness sensor", rssi: RSSI.intValue, peripheral: peripheral)
        if let index = devices.firstIndex(where: { $0.id == device.id }) { devices[index] = device }
        else { devices.append(device) }
        statusText = devices.isEmpty ? "Looking for heart-rate devices…" : "Choose a device to connect."
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        resetMeasurements()
        connectedName = peripheral.name ?? "Fitness sensor"
        peripheral.delegate = self
        peripheral.discoverServices(supportedServices)
        refreshStatus()
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectedPeripheral = nil
        statusText = "Could not connect. Try selecting the device again."
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        connectedPeripheral = nil
        connectedName = nil
        resetMeasurements()
        statusText = "Wearable disconnected."
    }
}

extension BluetoothHeartRateManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let services = peripheral.services else { statusText = "Could not read wearable services."; return }
        for service in services {
            switch service.uuid {
            case heartRateService: peripheral.discoverCharacteristics([heartRateMeasurement], for: service)
            case cyclingSpeedCadenceService: peripheral.discoverCharacteristics([cscMeasurement], for: service)
            case cyclingPowerService: peripheral.discoverCharacteristics([powerMeasurement], for: service)
            case fitnessMachineService: peripheral.discoverCharacteristics([indoorBikeData], for: service)
            default: break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, let characteristics = service.characteristics else { statusText = "Could not read heart-rate data."; return }
        characteristics.forEach { peripheral.setNotifyValue(true, for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let value = characteristic.value else { return }
        let bytes = [UInt8](value)
        switch characteristic.uuid {
        case heartRateMeasurement: parseHeartRate(bytes)
        case cscMeasurement: parseCyclingSpeedCadence(bytes)
        case powerMeasurement: parseCyclingPower(bytes)
        case indoorBikeData: parseIndoorBikeData(bytes)
        default: return
        }
        refreshStatus()
    }

    private func parseHeartRate(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        let values = [UInt8](bytes)
        let isUInt16 = values[0] & 0x01 != 0
        guard (isUInt16 && values.count >= 3) || (!isUInt16 && values.count >= 2) else { return }
        heartRate = isUInt16 ? Int(values[1]) | (Int(values[2]) << 8) : Int(values[1])
    }

    private func parseCyclingSpeedCadence(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        let flags = bytes[0]; var index = 1
        if flags & 0x01 != 0 { guard bytes.count >= index + 6 else { return }; index += 6 }
        guard flags & 0x02 != 0, bytes.count >= index + 4 else { return }
        let revolutions = UInt16(bytes[index]) | UInt16(bytes[index + 1]) << 8
        let eventTime = UInt16(bytes[index + 2]) | UInt16(bytes[index + 3]) << 8
        defer { previousCrank = (revolutions, eventTime) }
        guard let previousCrank else { return }
        let revolutionDelta = Double(revolutions &- previousCrank.revolutions)
        let timeDelta = Double(eventTime &- previousCrank.eventTime) / 1024
        let rpm = revolutionDelta / timeDelta * 60
        if timeDelta > 0, timeDelta < 10, rpm.isFinite, rpm >= 0, rpm <= 260 { cadenceRPM = Int(rpm.rounded()) }
    }

    private func parseCyclingPower(_ bytes: [UInt8]) {
        guard bytes.count >= 4 else { return }
        let power = Int(Int16(bitPattern: UInt16(bytes[2]) | UInt16(bytes[3]) << 8))
        guard power >= 0, power <= 3_000 else { return }
        cyclingPowerWatts = power; peakPowerWatts = max(peakPowerWatts, power)
    }

    private func parseIndoorBikeData(_ bytes: [UInt8]) {
        guard bytes.count >= 4 else { return }
        let flags = UInt16(bytes[0]) | UInt16(bytes[1]) << 8
        var index = 2
        if flags & 0x0001 == 0 { guard bytes.count >= index + 2 else { return }; speedKmh = Double(UInt16(bytes[index]) | UInt16(bytes[index + 1]) << 8) / 100; index += 2 }
        if flags & 0x0004 != 0, bytes.count >= index + 2 { cadenceRPM = Int((Double(UInt16(bytes[index]) | UInt16(bytes[index + 1]) << 8) / 2).rounded()) }
    }
}
