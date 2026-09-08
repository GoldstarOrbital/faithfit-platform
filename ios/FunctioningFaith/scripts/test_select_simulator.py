import unittest
from select_simulator import select_device


class SelectionTests(unittest.TestCase):
    def test_installed_runtime_replaces_removed_pin(self):
        self.assertEqual(select_device({'devices': {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
                {'name': 'iPhone 17 Pro', 'udid': 'current', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-26-4-1': [
                {'name': 'iPhone 17 Pro', 'udid': 'removed', 'isAvailable': False}]
        }}), 'current')

    def test_numeric_version_order_and_non_phone_exclusion(self):
        self.assertEqual(select_device({'devices': {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-9': [
                {'name': 'iPhone 17', 'udid': 'older', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.iOS-26-10': [
                {'name': 'iPhone 17', 'udid': 'newer', 'isAvailable': True},
                {'name': 'iPad Pro', 'udid': 'tablet', 'isAvailable': True}],
            'com.apple.CoreSimulator.SimRuntime.tvOS-99': [
                {'name': 'iPhone fake', 'udid': 'wrong-platform', 'isAvailable': True}]
        }}), 'newer')

    def test_no_device_fails_actionably(self):
        with self.assertRaisesRegex(ValueError, 'No available iPhone'):
            select_device({'devices': {}})


if __name__ == '__main__':
    unittest.main()
