# Mocks are adapted from https://github.com/aiortc/aiortc/blob/99cc917f30ead703880b259a8814dc63093d9998/docs/conf.py
import sys


# Mock out binding
class MockLib:
    ssrc_undefined = 0
    ssrc_specific = 1
    ssrc_any_inbound = 2
    ssrc_any_outbound = 3

    def srtp_init(self):
        pass


class MockBinding:
    ffi = None
    lib = MockLib()


class MockAvLogging:
    restore_default_callback = lambda x: None


class MockAv:
    logging = MockAvLogging()
    AudioFrame = None
    VideoFrame = None


class MockAvFrame:
    Frame = None


class MockAvPacket:
    Packet = None


class MockH264:
    H264Decoder = None
    H264Encoder = None
    h264_depayload = None


class MockOpus:
    OpusDecoder = None
    OpusEncoder = None


class MockVpx:
    Vp8Decoder = None
    Vp8Encoder = None
    vp8_depayload = None


sys.modules.update({'av': MockAv()})
sys.modules.update({'av.frame': MockAvFrame()})
sys.modules.update({'av.packet': MockAvPacket()})
sys.modules.update({'av.logging': MockAvLogging()})
sys.modules.update({'pylibsrtp._binding': MockBinding()})
sys.modules.update({'aiortc.codecs.h264': MockH264()})
sys.modules.update({'aiortc.codecs.opus': MockOpus()})
sys.modules.update({'aiortc.codecs.vpx': MockVpx()})