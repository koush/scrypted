import multiprocessing
import subprocess
import time
import threading

HEARTBEAT_INTERVAL = 5


def multiprocess_main(child_conn, exe, args):
    print("Child process starting")
    sp = subprocess.Popen([exe, *args])

    while True:
        has_data = child_conn.poll(HEARTBEAT_INTERVAL * 3)
        if not has_data:
            break
        keep_alive = child_conn.recv()
        if not keep_alive:
            break

    sp.terminate()
    sp.wait()
    print("Child process exiting")


class HeartbeatChildProcess:
    """Class to manage running a child process that gets cleaned up if the parent exits.
    
    When spawining subprocesses in Python, if the parent is forcibly killed (as is the case
    when Scrypted restarts plugins), subprocesses get orphaned. This approach uses parent-child
    heartbeats for the child to ensure that the parent process is still alive, and to cleanly
    exit the child if the parent has terminated.
    """

    def __init__(self, exe, *args):
        self.exe = exe
        self.args = args

        self.parent_conn, self.child_conn = multiprocessing.Pipe()
        self.process = multiprocessing.Process(target=multiprocess_main, args=(self.child_conn, exe, args))
        self.process.daemon = True
        self._stop = False

        self.thread = threading.Thread(target=self.heartbeat)

    def start(self):
        self.process.start()
        self.thread.start()

    def stop(self):
        self._stop = True
        self.parent_conn.send(False)

    def heartbeat(self):
        while not self._stop:
            time.sleep(HEARTBEAT_INTERVAL)
            self.parent_conn.send(True)
