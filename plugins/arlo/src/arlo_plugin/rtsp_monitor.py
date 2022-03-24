from urllib.parse import urlparse
import socket
import threading
import traceback

from .logging import getLogger
from .tcp_proxy import TheServer

logger = getLogger(__name__)

class RtspArloMonitor(TheServer):
    def __init__(self, rtspUrl):
        parsed = urlparse(rtspUrl)
        self.hostip = socket.gethostbyname(socket.gethostname())
        super().__init__(self.hostip, 0, parsed.hostname, parsed.port)

        self.rtspUrl = rtspUrl
        self.listen_port = self.server.getsockname()[1]

        self.num_clients = 0
        self.client_lock = threading.Lock()

    @property
    def proxy_url(self):
        parsed = urlparse(self.rtspUrl)
        modified = parsed._replace(netloc=f"{self.hostip}:{self.listen_port}")
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

    def run_threaded(self, on_proxy_exit):
        def thread_main(self):
            try:
                logger.debug(f"Starting RTSP monitor: {self.rtspUrl} proxied at {self.proxy_url}")
                self.main_loop()
            finally:
                logger.info(f"RTSP monitor exiting")
                on_proxy_exit()

        thread = threading.Thread(name="RTSPArloMonitor", target=thread_main, args=(self,))
        thread.setDaemon(True)
        thread.start()



    