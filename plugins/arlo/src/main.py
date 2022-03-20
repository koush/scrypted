import os 
import subprocess
import sys

dir_path = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "unzipped")
package_path = os.path.join(dir_path, "arlo")

# install local package since scrypted doesn't know where it is
print(f"Installing local arlo package from {package_path}")
subprocess.check_call([sys.executable, "-m", "pip", "install", os.path.join(dir_path, "arlo")])

from arlo_plugin import ArloProvider 

def create_scrypted_plugin():
    return ArloProvider()