from aiortc.mediastreams import AudioStreamTrack
from aiortc.codecs import Encoder
import asyncio
from dataclasses import dataclass
import re
import socket
from typing import Callable, Tuple, List


@dataclass
class SampleInfo:
    sample_rate: int
    channels: str


@dataclass
class FFmpegData:
    data: bytes
    sample_info: SampleInfo
    timestamp: int


class FFmpegServer(asyncio.Protocol):
    def __init__(self, data_cb: Callable[[bytes], None]) -> None:
        super().__init__()
        self.data_cb = data_cb

    def data_received(self, data: bytes) -> None:
        self.data_cb(data)


class FFmpegSubprocess(asyncio.SubprocessProtocol):
    SAMPLE_RATE_REGEX = r"([0-9]+) Hz"
    CHANNEL_REGEX = r"Audio:.* (stereo|mono)"

    def __init__(self, sample_info_cb: Callable[[SampleInfo], None]) -> None:
        super().__init__()
        self.sample_info_cb = sample_info_cb

    def pipe_data_received(self, fd: int, data: bytes) -> None:
        decoded = data.decode()
        sample_match = re.search(FFmpegSubprocess.SAMPLE_RATE_REGEX, decoded)
        channel_match = re.search(FFmpegSubprocess.CHANNEL_REGEX, decoded)

        if sample_match is not None and channel_match is not None:
            sample_info = SampleInfo(int(sample_match.group(1)), channel_match.group(1))
            self.sample_info_cb(sample_info)


class FFmpegAudioStreamTrack(AudioStreamTrack):
    ffmpeg_path: str
    ffmpeg_args: list

    data_queue: asyncio.Queue
    sample_info: asyncio.Future
    subprocess: asyncio.SubprocessTransport

    timestamp: int

    def __init__(self, ffmpeg_path: str, ffmpeg_args: list) -> None:
        super().__init__()
        self.ffmpeg_path = ffmpeg_path
        self.ffmpeg_args = ffmpeg_args

        self.data_queue = asyncio.Queue()
        self.sample_info = asyncio.get_event_loop().create_future()
        self.subprocess = None

        self.timestamp = 0

    async def start(self) -> None:
        def sample_info_cb(sample_info: SampleInfo) -> None:
            if not self.sample_info.done():
                self.sample_info.set_result(sample_info)

        self.server = await asyncio.get_event_loop().create_server(
            lambda: FFmpegServer(data_cb=self.data_queue.put_nowait),
            host='localhost', family=socket.AF_INET
        )
        server_port = self.server.sockets[0].getsockname()[1]

        ffmpeg_args = self.ffmpeg_args + [
            '-vn',
            '-acodec', 'libopus',
            '-f', 'opus'
            f'tcp://127.0.0.1:{server_port}'
        ]
        self.subprocess, _ = await asyncio.get_event_loop().subprocess_exec(
            lambda: FFmpegSubprocess(sample_info_cb=sample_info_cb),
            self.ffmpeg_path, *ffmpeg_args
        )

    async def stop(self) -> None:
        self.server.close()
        self.subprocess.close()

    async def recv(self) -> FFmpegData:
        sample_info = await self.sample_info
        data = await self.data_queue.get()

        channel_count = 1 if sample_info.channels == 'mono' else 2
        sample_rate = sample_info.sample_rate

        to_read = sample_rate / 100 * channel_count * 2
        self.timestamp += to_read

        return FFmpegData(data=data[:to_read], sample_info=sample_info, timestamp=self.timestamp)


class FFmpegAudioStreamEncoder(Encoder):
    def __init__(self):
        super().__init__()

    def encode(self, *args) -> None:
        pass

    def pack(self, packet: FFmpegData) -> Tuple[List[bytes], int]:
        return [packet.data], packet.timestamp
