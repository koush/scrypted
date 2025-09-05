if [ "$(uname -m)" != "x86_64" ]
then
    echo "Intel NPU will not be installed on this architecture."
    exit 0
fi

UBUNTU_22_04=$(lsb_release -r | grep "22.04")
UBUNTU_24_04=$(lsb_release -r | grep "24.04")

if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    # proxmox is compatible with intel's ubuntu builds, check for /etc/pve directory
    # then determine debian version
    version=$(cat /etc/debian_version 2>/dev/null)

    # Determine if it's Debian 12 or 13
    if [[ "$version" == 12* ]]; then
        UBUNTU_22_04=true
    elif [[ "$version" == 13* ]]; then
        UBUNTU_24_04=true
    fi

fi

# needs either ubuntu 22.0.4 or 24.04
if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    echo "Intel NPU will not be installed. Ubuntu version could not be detected when checking lsb-release and /etc/os-release."
    exit 0
fi

if [ -n "$UBUNTU_22_04" ]
then
    ubuntu_distro=ubuntu2204
    distro="22.04_amd64"
else
    ubuntu_distro=ubuntu2404
    distro="24.04_amd64"
fi

dpkg --purge --force-remove-reinstreq intel-driver-compiler-npu intel-fw-npu intel-level-zero-npu

# no errors beyond this point
set -e

rm -rf /tmp/npu && mkdir -p /tmp/npu && cd /tmp/npu

# level zero must also be installed
LEVEL_ZERO_VERSION=1.24.2
# https://github.com/oneapi-src/level-zero
curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v"$LEVEL_ZERO_VERSION"/level-zero_"$LEVEL_ZERO_VERSION"+u$distro.deb
curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v"$LEVEL_ZERO_VERSION"/level-zero-devel_"$LEVEL_ZERO_VERSION"+u$distro.deb

# npu driver
# https://github.com/intel/linux-npu-driver
NPU_VERSION=1.23.0
NPU_VERSION_DATE=20250827-17270089246
NPU_TAR_FILENAME=linux-npu-driver-v"$NPU_VERSION"."$NPU_VERSION_DATE"-$ubuntu_distro.tar.gz
curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v"$NPU_VERSION"/"$NPU_TAR_FILENAME"
tar xzvf "$NPU_TAR_FILENAME"

# firmware can only be installed on host. will cause problems inside container.
if [ ! -z "$INTEL_FW_NPU" ]
then
    rm *fw-npu*
fi

apt -y update
apt -y install libtbb12
dpkg -i *.deb

cd /tmp && rm -rf /tmp/npu

apt-get -y dist-upgrade

if [ -n "$INTEL_FW_NPU" ]
then
    echo
    echo "###############################################################################"
    echo "Intel NPU firmware was installed. Reboot the host to complete the installation."
    echo "###############################################################################"
fi
