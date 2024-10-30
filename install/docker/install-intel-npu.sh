if [ "$(uname -m)" != "x86_64" ]
then
    echo "Intel NPU will not be installed on this architecture."
    exit 0
fi

UBUNTU_22_04=$(lsb_release -r | grep "22.04")
UBUNTU_24_04=$(lsb_release -r | grep "24.04")

if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    # proxmox is compatible with ubuntu 22.04, check for  /etc/pve directory
    if [ -d "/etc/pve" ]
    then
        UBUNTU_22_04=true
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
    distro="22.04_amd64"
else
    distro="24.04_amd64"
fi

dpkg --purge --force-remove-reinstreq intel-driver-compiler-npu intel-fw-npu intel-level-zero-npu

# no errors beyond this point
set -e

rm -rf /tmp/npu && mkdir -p /tmp/npu && cd /tmp/npu

# level zero must also be installed
LEVEL_ZERO_VERSION=1.18.3
# https://github.com/oneapi-src/level-zero
curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v"$LEVEL_ZERO_VERSION"/level-zero_"$LEVEL_ZERO_VERSION"+u$distro.deb
curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v"$LEVEL_ZERO_VERSION"/level-zero-devel_"$LEVEL_ZERO_VERSION"+u$distro.deb

# npu driver
# https://github.com/intel/linux-npu-driver
NPU_VERSION=1.8.0
NPU_VERSION_DATE=20240916-10885588273
curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v"$NPU_VERSION"/intel-driver-compiler-npu_$NPU_VERSION."$NPU_VERSION_DATE"_ubuntu$distro.deb
# firmware can only be installed on host. will cause problems inside container.
if [ -n "$INTEL_FW_NPU" ]
then
    curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v"$NPU_VERSION"/intel-fw-npu_$NPU_VERSION."$NPU_VERSION_DATE"_ubuntu$distro.deb
fi
curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v"$NPU_VERSION"/intel-level-zero-npu_$NPU_VERSION."$NPU_VERSION_DATE"_ubuntu$distro.deb

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
