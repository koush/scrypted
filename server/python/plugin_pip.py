import os
import subprocess
import sys
from typing import Any
import shutil


def get_requirements_files(requirements: str):
    want_requirements = requirements + ".txt"
    installed_requirementstxt = requirements + ".installed.txt"
    return want_requirements, installed_requirementstxt


def need_requirements(requirements_basename: str, requirements_str: str):
    _, installed_requirementstxt = get_requirements_files(requirements_basename)
    if not os.path.exists(installed_requirementstxt):
        return True
    try:
        f = open(installed_requirementstxt, "rb")
        installed_requirements = f.read().decode("utf8")
        return requirements_str != installed_requirements
    except:
        return True


def remove_pip_dirs(plugin_volume: str):
    try:
        for de in os.listdir(plugin_volume):
            if (
                de.startswith("linux")
                or de.startswith("darwin")
                or de.startswith("win32")
                or de.startswith("python")
                or de.startswith("node")
            ):
                filePath = os.path.join(plugin_volume, de)
                print("Removing old dependencies: %s" % filePath)
                try:
                    shutil.rmtree(filePath)
                except:
                    pass
    except:
        pass


def install_with_pip(
    python_prefix: str,
    packageJson: Any,
    requirements_str: str,
    requirements_basename: str,
    ignore_error: bool = False,
    site_packages: str = None,
):
    requirementstxt, installed_requirementstxt = get_requirements_files(
        requirements_basename
    )

    os.makedirs(python_prefix, exist_ok=True)

    print(f"{os.path.basename(requirementstxt)} (outdated)")
    print(requirements_str)

    f = open(requirementstxt, "wb")
    f.write(requirements_str.encode())
    f.close()

    try:
        pythonVersion = packageJson["scrypted"]["pythonVersion"]
    except:
        pythonVersion = None

    pipArgs = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "-r",
        requirementstxt,
        "--target",
        python_prefix,
    ]
    if pythonVersion:
        print("Specific Python version requested. Forcing reinstall.")
        # prevent uninstalling system packages.
        pipArgs.append("--ignore-installed")
        # force reinstall even if it exists in system packages.
        pipArgs.append("--force-reinstall")

    env = None
    if site_packages:
        env = dict(os.environ)
        PYTHONPATH = env["PYTHONPATH"] or ""
        PYTHONPATH += ":" + site_packages
        env["PYTHONPATH"] = PYTHONPATH
        print("PYTHONPATH", env["PYTHONPATH"])
    p = subprocess.Popen(
        pipArgs, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env
    )

    while True:
        line = p.stdout.readline()
        if not line:
            break
        line = line.decode("utf8").rstrip("\r\n")
        print(line)
    result = p.wait()
    print("pip install result %s" % result)
    if result:
        if not ignore_error:
            raise Exception("non-zero result from pip %s" % result)
        else:
            print("ignoring non-zero result from pip %s" % result)
    else:
        f = open(installed_requirementstxt, "wb")
        f.write(requirements_str.encode())
        f.close()
