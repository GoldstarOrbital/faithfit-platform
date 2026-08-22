import Foundation
import CoreBluetooth

struct WearableDevice: Identifiable {
    let id: UUID
    let name: String
    let rssi: Int
    fileprivate let peripheral: CBPeripheral
}

/// Pairs with standard Bluetooth LE Heart Rate Service devices (service 180D).
/// Apple Watch data remains intentionally in HealthKit; this is for sensors and
/// wearables that expose the public BLE heart-rate profile, never a claim that
/// every vendor's closed ecosystem can be directly paired by a third-party app.
final class BluetoothHeartRateManager: NSObject, ObservableObject {
    static let shared = BluetoothHeartRateManager()

    @Published private(set) var devices: [WearableDevice] = []
    @Published private(set) var statusText = "Bluetooth is starting…"
    @Published private(set) var heartRate: Int?
    @Published private(set) var connectedName: String?
    @Published private(set) var isScanning = false

    private var central: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private let heartRateService = CBUUID(string: "180D")
    private let heartRateMeasurement = CBUUID(string: "2A37")

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
        heartRate = nil
        isScanning = true
        statusText = "Looking for heart-rate devices…"
        central.scanForPeripherals(withServices: [heartRateService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
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
            devices.removeAll()
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        let device = WearableDevice(id: peripheral.identifier, name: peripheral.name ?? "Heart-rate sensor", rssi: RSSI.intValue, peripheral: peripheral)
        if let index = devices.firstIndex(where: { $0.id == device.id }) { devices[index] = device }
        else { devices.append(device) }
        statusText = devices.isEmpty ? "Looking for heart-rate devices…" : "Choose a device to connect."
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        connectedName = peripheral.name ?? "Heart-rate sensor"
        statusText = "Connected to \(connectedName!)."
        peripheral.delegate = self
        peripheral.discoverServices([heartRateService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        connectedPeripheral = nil
        statusText = "Could not connect. Try selecting the device again."
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        connectedPeripheral = nil
        connectedName = nil
        heartRate = nil
        statusText = "Wearable disconnected."
    }
}

extension BluetoothHeartRateManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let services = peripheral.services else { statusText = "Could not read wearable services."; return }
        for service in services where service.uuid == heartRateService {
            peripheral.discoverCharacteristics([heartRateMeasurement], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, let characteristics = service.characteristics else { statusText = "Could not read heart-rate data."; return }
        for characteristic in characteristics where characteristic.uuid == heartRateMeasurement {
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.uuid == heartRateMeasurement, let bytes = characteristic.value, !bytes.isEmpty else { return }
        let values = [UInt8](bytes)
        let isUInt16 = values[0] & 0x01 != 0
        guard (isUInt16 && values.count >= 3) || (!isUInt16 && values.count >= 2) else { return }
        heartRate = isUInt16 ? Int(values[1]) | (Int(values[2]) << 8) : Int(values[1])
        statusText = "Connected to \(connectedName ?? "wearable") · \(heartRate ?? 0) BPM"
    }
}
