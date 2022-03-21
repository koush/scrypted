from urllib.parse import urlparse
import threading
import traceback

from .logging import getLogger
from .tcp_proxy import TheServer

logger = getLogger(__name__)

class RtspArloProxy(TheServer):
    def __init__(self, rtspUrl, provider, arlo_device):
        parsed = urlparse(rtspUrl)
        super().__init__("localhost", 0, parsed.hostname, parsed.port)

        self.provider = provider
        self.arlo_device = arlo_device
        self.rtspUrl = rtspUrl
        self.listen_port = self.server.getsockname()[1]

        self.num_clients = 0
        self.client_lock = threading.Lock()

    @property
    def proxy_url(self):
        parsed = urlparse(self.rtspUrl)
        modified = parsed._replace(netloc=f"localhost:{self.listen_port}")
        return modified.geturl()

    def on_accept(self):
        with self.client_lock:
            super().on_accept()
            self.num_clients += 1

    def on_close(self):
        with self.client_lock:
            super().on_close()
            self.num_clients -= 1
            if self.num_clients == 0:
                self.stop = True
                with self.provider.arlo as arlo:
                    arlo.StopStream(self.arlo_device, self.arlo_device)

    def run_threaded(self, on_proxy_exit):
        def thread_main(self):
            try:
                logger.info(f"Starting RTSP proxy at {self.proxy_url}")
                self.main_loop()
            finally:
                logger.info(f"RTSP proxy exiting")
                on_proxy_exit()

        thread = threading.Thread(name="RTSPArloProxy", target=thread_main, args=(self,))
        thread.setDaemon(True)
        thread.start()



    