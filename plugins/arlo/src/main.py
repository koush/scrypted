import os 
import psutil
import subprocess
import sys

dir_path = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "unzipped")
package_path = os.path.join(dir_path, "arlo")

# install local package since scrypted doesn't know where it is
print(f"Installing local arlo package from {package_path}")
subprocess.check_call([sys.executable, "-m", "pip", "install", package_path])

# chmod live555ProxyServer
subprocess.check_call(['chmod', '+x', os.path.join(dir_path, "live555ProxyServer")])

# stop any running live555ProxyServers
for proc in psutil.process_iter():
    if proc.name() == "live555ProxyServer":
        proc.kill()

from arlo_plugin import ArloProvider 

def create_scrypted_plugin():
    return ArloProvider()