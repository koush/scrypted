# Modified from:
# https://voorloopnul.com/blog/a-python-proxy-in-less-than-100-lines-of-code/
#
# This is a simple port-forward / proxy, written using only the default python
# library. If you want to make a suggestion or fix something you can contact-me
# at voorloop_at_gmail.com
# Distributed over IDC(I Don't Care) license
import socket
import select
import time
import sys

from .logging import getLogger

logger = getLogger(__name__)

# Changing the buffer_size and delay, you can improve the speed and bandwidth.
# But when buffer get to high or delay go too down, you can broke things
buffer_size = 4096
delay = 0.0001

class Forward:
    def __init__(self):
        self.forward = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    def start(self, host, port):
        try:
            self.forward.connect((host, port))
            return self.forward
        except Exception as e:
            logger.error(f"Exception when connecting to upstream: {str(e)}")
            return False

class TheServer:
    def __init__(self, host, port, forward_host, forward_port):
        self.input_list = []
        self.channel = {}
        self.forward_host = forward_host
        self.forward_port = forward_port
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind((host, port))
        self.server.listen(200)
        self.stop = False

    def main_loop(self):
        try:
            self.input_list.append(self.server)
            while not self.stop:
                try:
                    time.sleep(delay)
                    ss = select.select
                    inputready, outputready, exceptready = ss(self.input_list, [], [])
                    for self.s in inputready:
                        if self.s == self.server:
                            self.on_accept()
                            break

                        self.data = self.s.recv(buffer_size)
                        if len(self.data) == 0:
                            self.on_close()
                            break
                        else:
                            self.on_recv()
                except ConnectionResetError as e:
                    logger.warn(f"{type(e)} on {self.s}: {str(e)}")
                    self.on_close()
        except Exception as e:
            logger.error(f"Exception broke out of proxy loop: {type(e)} {str(e)}")
            raise
        finally:
            for _, s in self.channel.items():
                s.close()
            self.server.close()

    def on_accept(self):
        forward = Forward().start(self.forward_host, self.forward_port)
        clientsock, clientaddr = self.server.accept()
        if forward:
            logger.debug(f"{clientaddr} has connected")
            self.input_list.append(clientsock)
            self.input_list.append(forward)
            self.channel[clientsock] = forward
            self.channel[forward] = clientsock
        else:
            logger.error("Can't establish connection with remote server")
            logger.error(f"Closing connection with client {clientaddr}")
            clientsock.close()

    def on_close(self):
        try:
            # remove objects from input_list
            self.input_list.remove(self.s)
            self.input_list.remove(self.channel[self.s])
            out = self.channel[self.s]
            # close the connection with client
            self.channel[out].close()  # equivalent to do self.s.close()
            # close the connection with remote server
            self.channel[self.s].close()
            # delete both objects from channel dict
            del self.channel[out]
            del self.channel[self.s]
            logger.debug(f"{self.s.getpeername()} has disconnected")
        except OSError as e:
            logger.warn(f"Error when closing peer connection {self.s}: {type(e)} {str(e)}")

    def on_recv(self):
        data = self.data
        self.channel[self.s].send(data)