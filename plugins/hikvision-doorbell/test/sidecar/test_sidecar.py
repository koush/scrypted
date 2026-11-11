import ctypes
import importlib.util
import io
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', '..', 'fs', 'hcnetsdk_sidecar.py')

spec = importlib.util.spec_from_file_location('hcnetsdk_sidecar', SCRIPT)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)

CONFIG = {'host': '192.0.2.1', 'port': 8000, 'username': 'admin', 'password': 'not-a-real-secret'}


class PureHelpers(unittest.TestCase):
    def test_alarm_message_maps_17_and_18(self):
        self.assertEqual(sidecar.alarm_message(0x1133, 17), {'type': 'ring'})
        self.assertEqual(sidecar.alarm_message(0x1133, 18), {'type': 'end'})
        self.assertIsNone(sidecar.alarm_message(0x1133, 7))
        self.assertIsNone(sidecar.alarm_message(0x4000, 17))

    def test_intercom_alarm_layout(self):
        # dwSize 4 + NET_DVR_TIME_EX 8 + byDevNumber 32
        self.assertEqual(sidecar.VideoIntercomAlarm.byAlarmType.offset, 44)

    def test_read_config_rejects_missing_keys(self):
        missing = dict(CONFIG)
        del missing['password']
        self.assertIsNone(sidecar.read_config(io.StringIO(json.dumps(missing) + '\n')))
        self.assertEqual(sidecar.read_config(io.StringIO(json.dumps(CONFIG) + '\n'))['diagnostics'], False)

    def test_long_is_32_bit(self):
        # HCNetSDK's LONG is a C int on Linux; a 64-bit read of a returned -1 gives 4294967295.
        self.assertIs(sidecar.LONG, ctypes.c_int32)
        self.assertIs(sidecar.MSG_CALLBACK._argtypes_[0], ctypes.c_int32)

    def test_sdk_version_reads_one_byte_per_part(self):
        self.assertEqual(sidecar.sdk_version(0x06010930), '6.1.9.48')

    def test_exception_codes_map(self):
        self.assertEqual(sidecar.EXCEPTION_MESSAGES, {0x8006: 'disconnected', 0x8016: 'reconnected'})

    def test_raw_message_shape(self):
        self.assertEqual(sidecar.raw_message('alarm', 0x1133, {'byAlarmType': 17}),
                         {'type': 'raw', 'source': 'alarm', 'command': 4403, 'data': {'byAlarmType': 17}})


class Process(unittest.TestCase):
    def run_sidecar(self, stdin_text):
        return subprocess.run([sys.executable, SCRIPT, '/nonexistent'], input=stdin_text,
                              capture_output=True, text=True, timeout=20)

    def test_exits_on_stdin_eof(self):
        result = self.run_sidecar('')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_init_error_reported(self):
        result = self.run_sidecar(json.dumps(CONFIG) + '\n')
        self.assertEqual(result.returncode, 2)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]['type'], 'error')
        self.assertEqual(lines[0]['stage'], 'init')
        self.assertNotIn(CONFIG['password'], result.stdout + result.stderr)


class FakeSdk:
    def __init__(self):
        self.calls = []

    def NET_DVR_StartRemoteConfig(self, user_id, command, cond, size, callback, user):
        self.calls.append(command)
        return 7

    def NET_DVR_GetLastError(self):
        return 0


class CallChannel(unittest.TestCase):
    def test_not_opened_without_diagnostics(self):
        sdk = FakeSdk()
        self.assertIsNone(sidecar.open_call_channel(sdk, 0, False, None))
        self.assertEqual(sdk.calls, [])

    def test_opened_with_diagnostics(self):
        sdk = FakeSdk()
        self.assertEqual(sidecar.open_call_channel(sdk, 0, True, None), 7)
        self.assertEqual(sdk.calls, [sidecar.NET_DVR_VIDEO_CALL_SIGNAL_PROCESS])


if __name__ == '__main__':
    unittest.main()
