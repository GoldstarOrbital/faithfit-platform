"""Select an installed, available iPhone rather than pinning a stale runtime."""
import json
import re
import subprocess
import sys


def select_device(payload):
    candidates = []
    for runtime, devices in payload.get('devices', {}).items():
        match = re.fullmatch(r'com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+(?:-\d+)*)', runtime)
        if not match:
            continue
        version = tuple(int(part) for part in match.group(1).split('-'))
        for device in devices:
            if device.get('isAvailable') and device.get('name', '').startswith('iPhone ') and device.get('udid'):
                candidates.append((version, device['name'], device['udid']))
    if not candidates:
        raise ValueError('No available iPhone simulator. Install an iOS runtime in the selected Xcode image.')
    return max(candidates)[2]


if __name__ == '__main__':
    result = subprocess.run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'],
                            check=True, capture_output=True, text=True)
    try:
        print(select_device(json.loads(result.stdout)))
    except ValueError as error:
        sys.exit(str(error))
