import os 
import psutil
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

dir_path = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "unzipped")
package_path = os.path.join(dir_path, "arlo")

# install local package since scrypted doesn't know where it is
print(f"Installing local arlo package from {package_path}")
subprocess.check_call([sys.executable, "-m", "pip", "install", package_path])

if shutil.which("live555ProxyServer") is None:
    # build live555ProxyServer
    with tempfile.TemporaryDirectory() as tempdir:
        targz = os.path.join(tempdir, "live555-latest.tar.gz")
        uncompressed = os.path.join(tempdir, "out")
        livedir = os.path.join(uncompressed, "live")

        print("Downloading live555 sources")
        urllib.request.urlretrieve("http://www.live555.com/liveMedia/public/live555-latest.tar.gz", targz)

        print("Unpacking live555")
        tf = tarfile.open(targz)
        tf.extractall(uncompressed)
        tf.close()

        print("Generating live555 makefiles")
        subprocess.check_call("./genMakefiles linux-64bit", cwd=livedir, shell=True)

        print("Building live555")
        subprocess.check_call("make", cwd=livedir, shell=True)
        subprocess.check_call("make install", cwd=livedir, shell=True)

# stop any running live555ProxyServers
for proc in psutil.process_iter():
    if proc.name() == "live555ProxyServer":
        proc.kill()

from arlo_plugin import ArloProvider 

def create_scrypted_plugin():
    return ArloProvider()