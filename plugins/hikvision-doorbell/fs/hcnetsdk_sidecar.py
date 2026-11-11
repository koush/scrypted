#!/usr/bin/env python3
"""HCNetSDK sidecar for the Scrypted Hikvision doorbell plugin.

Holds the SDK login and alarm channel to one door station and reports call
start/end as JSON lines, so the plugin does not have to poll for them. Runs as
a child process: the SDK ships its own OpenSSL and native code, and a crash here
only takes down this process.

Usage:  python3 hcnetsdk_sidecar.py <libDir>
stdin:  one JSON line {"host", "port", "username", "password", "diagnostics"};
        stdin stays open while the plugin wants events, EOF shuts down.
stdout: one JSON object per line:
        {"type":"ready","sdkVersion":"..."}   logged in and armed
        {"type":"ring"} / {"type":"end"}     call started / stopped (alarm types 17 / 18)
        {"type":"error","stage":"init|login|arm","code":N,"message":"..."}
        {"type":"disconnected"} / {"type":"reconnected"}
        {"type":"raw",...}                    every SDK callback, only with "diagnostics"

Written from Hikvision's Device Network SDK (Video Intercom) developer guide.
The SDK itself is not part of the plugin; the user supplies it.
"""
import ctypes
import json
import os
import sys
import threading

COMM_ALARM_VIDEO_INTERCOM = 0x1133
COMM_UPLOAD_VIDEO_INTERCOM_EVENT = 0x1132
COMM_ISAPI_ALARM = 0x6009
NET_DVR_VIDEO_CALL_SIGNAL_PROCESS = 16032
ALARM_TYPE_CALL_STARTED = 17
ALARM_TYPE_CALL_STOPPED = 18

# Exception callback codes reported as disconnected / reconnected
# (HCNetSDK.h: EXCEPTION_ALARMRECONNECT, ALARM_RECONNECTSUCCESS).
EXCEPTION_MESSAGES = {0x8006: 'disconnected', 0x8016: 'reconnected'}

REQUIRED_KEYS = ('host', 'port', 'username', 'password')

# HCNetSDK's LONG is a C int on Linux, not a C long.
LONG = ctypes.c_int32


class NetDvrTimeEx(ctypes.Structure):
    _fields_ = [('wYear', ctypes.c_uint16), ('byMonth', ctypes.c_uint8), ('byDay', ctypes.c_uint8),
                ('byHour', ctypes.c_uint8), ('byMinute', ctypes.c_uint8), ('bySecond', ctypes.c_uint8),
                ('byRes', ctypes.c_uint8)]


class VideoIntercomAlarm(ctypes.Structure):
    """Leading part of NET_DVR_VIDEO_INTERCOM_ALARM (also the layout of NET_DVR_VIDEO_INTERCOM_EVENT
    up to its byEventType). Only the fields read here are declared."""
    _fields_ = [('dwSize', ctypes.c_uint32), ('struTime', NetDvrTimeEx),
                ('byDevNumber', ctypes.c_uint8 * 32), ('byAlarmType', ctypes.c_uint8)]


class AlarmIsapiInfo(ctypes.Structure):
    _fields_ = [('pAlarmData', ctypes.c_void_p), ('dwAlarmDataLen', ctypes.c_uint32),
                ('byDataType', ctypes.c_uint8), ('byPicturesNumber', ctypes.c_uint8)]


class SetupAlarmParamV50(ctypes.Structure):
    _fields_ = [('dwSize', ctypes.c_uint32), ('byLevel', ctypes.c_uint8), ('byAlarmInfoType', ctypes.c_uint8),
                ('byRetAlarmTypeV40', ctypes.c_uint8), ('byRetDevInfoVersion', ctypes.c_uint8),
                ('byRetVQDAlarmType', ctypes.c_uint8), ('byFaceAlarmDetection', ctypes.c_uint8),
                ('bySupport', ctypes.c_uint8), ('byBrokenNetHttp', ctypes.c_uint8), ('wTaskNo', ctypes.c_uint16),
                ('byDeployType', ctypes.c_uint8), ('byRes1', ctypes.c_uint8 * 3), ('byAlarmTypeURL', ctypes.c_uint8),
                ('byCustomCtrl', ctypes.c_uint8), ('byRes4', ctypes.c_uint8 * 128)]


class VideoCallCond(ctypes.Structure):
    _fields_ = [('dwSize', ctypes.c_uint32), ('byRes', ctypes.c_uint8 * 128)]


class VideoCallParam(ctypes.Structure):
    _fields_ = [('dwSize', ctypes.c_uint32), ('dwCmdType', ctypes.c_uint32), ('wPeriod', ctypes.c_uint16),
                ('wBuildingNumber', ctypes.c_uint16), ('wUnitNumber', ctypes.c_uint16),
                ('wFloorNumber', ctypes.c_int16), ('wRoomNumber', ctypes.c_uint16)]


MSG_CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, LONG, ctypes.c_void_p, ctypes.c_void_p,
                                ctypes.c_uint32, ctypes.c_void_p)
EXCEPTION_CALLBACK = ctypes.CFUNCTYPE(None, ctypes.c_uint32, LONG, LONG, ctypes.c_void_p)
REMOTE_CONFIG_CALLBACK = ctypes.CFUNCTYPE(None, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p)

_out_lock = threading.Lock()


def emit(message):
    line = json.dumps(message, separators=(',', ':'))
    with _out_lock:
        sys.stdout.write(line + '\n')
        sys.stdout.flush()


def alarm_message(command, alarm_type):
    if command != COMM_ALARM_VIDEO_INTERCOM:
        return None
    if alarm_type == ALARM_TYPE_CALL_STARTED:
        return {'type': 'ring'}
    if alarm_type == ALARM_TYPE_CALL_STOPPED:
        return {'type': 'end'}
    return None


def raw_message(source, command, data):
    return {'type': 'raw', 'source': source, 'command': command, 'data': data}


def sdk_version(build):
    """Format NET_DVR_GetSDKBuildVersion: one byte each for major, minor, revision, build."""
    return '%d.%d.%d.%d' % (build >> 24, (build >> 16) & 0xff, (build >> 8) & 0xff, build & 0xff)


def read_config(stream):
    line = stream.readline()
    if not line:
        return None
    try:
        config = json.loads(line)
    except ValueError:
        return None
    if not isinstance(config, dict) or any(key not in config for key in REQUIRED_KEYS):
        return None
    config['diagnostics'] = bool(config.get('diagnostics', False))
    return config


def describe_alarm(command, info, length):
    """Decode the fields worth logging from one alarm callback buffer."""
    if not info:
        return {'len': length}
    if command in (COMM_ALARM_VIDEO_INTERCOM, COMM_UPLOAD_VIDEO_INTERCOM_EVENT) and length >= 45:
        alarm = VideoIntercomAlarm.from_address(info)
        key = 'byAlarmType' if command == COMM_ALARM_VIDEO_INTERCOM else 'byEventType'
        return {key: alarm.byAlarmType, 'devNumber': bytes(alarm.byDevNumber).split(b'\0')[0].decode(errors='replace')}
    if command == COMM_ISAPI_ALARM:
        isapi = AlarmIsapiInfo.from_address(info)
        text = ctypes.string_at(isapi.pAlarmData, isapi.dwAlarmDataLen).decode(errors='replace') if isapi.pAlarmData else ''
        return {'dataType': isapi.byDataType, 'pictures': isapi.byPicturesNumber, 'text': text[:2000]}
    return {'len': length, 'head': ctypes.string_at(info, min(length, 64)).hex()}


def open_call_channel(sdk, user_id, diagnostics, callback):
    """Passive call-signal channel, for diagnostics only: nothing is sent, whatever the
    station reports on it is logged. Returns the handle, or None when not opened."""
    if not diagnostics:
        return None
    cond = VideoCallCond()
    cond.dwSize = ctypes.sizeof(cond)
    handle = sdk.NET_DVR_StartRemoteConfig(user_id, NET_DVR_VIDEO_CALL_SIGNAL_PROCESS, ctypes.byref(cond),
                                           ctypes.sizeof(cond), callback, None)
    emit(raw_message('call', NET_DVR_VIDEO_CALL_SIGNAL_PROCESS,
                     {'opened': handle >= 0, 'error': None if handle >= 0 else sdk.NET_DVR_GetLastError()}))
    return handle


def main():
    if len(sys.argv) != 2:
        sys.stderr.write('usage: hcnetsdk_sidecar.py <libDir>\n')
        return 2
    lib_dir = sys.argv[1]
    config = read_config(sys.stdin)
    if config is None:
        return 0
    diagnostics = config['diagnostics']

    try:
        sdk = ctypes.CDLL(os.path.join(lib_dir, 'libhcnetsdk.so'))
    except OSError as error:
        emit({'type': 'error', 'stage': 'init', 'code': -1, 'message': str(error)})
        return 2
    if os.path.isdir(lib_dir):
        os.chdir(lib_dir)  # the SDK looks for HCNetSDKCom/ next to the process cwd as well

    sdk.NET_DVR_Login_V30.restype = LONG
    sdk.NET_DVR_SetupAlarmChan_V50.restype = LONG
    sdk.NET_DVR_StartRemoteConfig.restype = LONG
    sdk.NET_DVR_GetLastError.restype = ctypes.c_uint32
    sdk.NET_DVR_GetSDKBuildVersion.restype = ctypes.c_uint32

    if not sdk.NET_DVR_Init():
        emit({'type': 'error', 'stage': 'init', 'code': sdk.NET_DVR_GetLastError(), 'message': 'NET_DVR_Init failed'})
        return 2
    sdk.NET_DVR_SetReconnect(5000, 1)

    def on_alarm(command, alarmer, info, length, user):
        try:
            data = describe_alarm(command, info, length)
            message = alarm_message(command, data.get('byAlarmType')) if command == COMM_ALARM_VIDEO_INTERCOM else None
            if diagnostics:
                emit(raw_message('alarm', command, data))
            if message:
                emit(message)
        except Exception as error:  # never let an exception unwind into the SDK thread
            emit(raw_message('alarm', command, {'decodeError': str(error)}))
        return 1

    def on_exception(code, user_id, handle, user):
        if diagnostics:
            emit(raw_message('exception', code, {'userId': user_id, 'handle': handle}))
        mapped = EXCEPTION_MESSAGES.get(code)
        if mapped:
            emit({'type': mapped})

    def on_call_signal(data_type, buffer, length, user):
        if not diagnostics:
            return
        data = {'dwType': data_type, 'len': length}
        if buffer and data_type == 0 and length >= 4:
            data['status'] = ctypes.c_uint32.from_address(buffer).value
        elif buffer and data_type == 2 and length >= ctypes.sizeof(VideoCallParam):
            param = VideoCallParam.from_address(buffer)
            data.update({'dwCmdType': param.dwCmdType, 'building': param.wBuildingNumber, 'unit': param.wUnitNumber,
                         'floor': param.wFloorNumber, 'room': param.wRoomNumber})
        emit(raw_message('call', NET_DVR_VIDEO_CALL_SIGNAL_PROCESS, data))

    # keep references so ctypes does not free the callbacks
    callbacks = (MSG_CALLBACK(on_alarm), EXCEPTION_CALLBACK(on_exception), REMOTE_CONFIG_CALLBACK(on_call_signal))
    sdk.NET_DVR_SetExceptionCallBack_V30(0, None, callbacks[1], None)
    sdk.NET_DVR_SetDVRMessageCallBack_V50(0, callbacks[0], None)

    device_info = (ctypes.c_uint8 * 512)()
    user_id = sdk.NET_DVR_Login_V30(str(config['host']).encode(), int(config['port']),
                                    str(config['username']).encode(), str(config['password']).encode(),
                                    ctypes.byref(device_info))
    if user_id < 0:
        emit({'type': 'error', 'stage': 'login', 'code': sdk.NET_DVR_GetLastError(), 'message': 'NET_DVR_Login_V30 failed'})
        sdk.NET_DVR_Cleanup()
        return 2

    param = SetupAlarmParamV50()
    param.dwSize = ctypes.sizeof(param)
    param.byLevel = 1
    param.byAlarmInfoType = 1
    param.byDeployType = 1
    param.bySupport &= ~0x02  # bit 1: alarm confirmation mechanism, keep it off
    alarm_handle = sdk.NET_DVR_SetupAlarmChan_V50(user_id, ctypes.byref(param), None, 0)
    if alarm_handle < 0:
        emit({'type': 'error', 'stage': 'arm', 'code': sdk.NET_DVR_GetLastError(), 'message': 'NET_DVR_SetupAlarmChan_V50 failed'})
        sdk.NET_DVR_Logout_V30(user_id)
        sdk.NET_DVR_Cleanup()
        return 2

    call_handle = open_call_channel(sdk, user_id, diagnostics, callbacks[2])

    emit({'type': 'ready', 'sdkVersion': sdk_version(sdk.NET_DVR_GetSDKBuildVersion())})

    sys.stdin.read()  # block until the plugin closes stdin

    if call_handle is not None and call_handle >= 0:
        sdk.NET_DVR_StopRemoteConfig(call_handle)
    sdk.NET_DVR_CloseAlarmChan_V30(alarm_handle)
    sdk.NET_DVR_Logout_V30(user_id)
    sdk.NET_DVR_Cleanup()
    return 0


if __name__ == '__main__':
    sys.exit(main())
