if [ "$(uname -m)" != "x86_64" ]
then
    echo "Intel NPU will not be installed on this architecture."
    exit 0
fi

UBUNTU_22_04=$(lsb_release -r | grep "22.04")
UBUNTU_24_04=$(lsb_release -r | grep "24.04")

# check bookworm and bullseye if UBUNTU vars are not set.
# this will cover proxmox.
if [ -z "$UBUNTU_22_04" ]
then
    UBUNTU_22_04=$(cat /etc/os-release | grep bullseye)
fi

if [ -z "$UBUNTU_24_04" ]
then
    UBUNTU_24_04=$(cat /etc/os-release | grep bookworm)
fi

# needs either ubuntu 22.0.4 or 24.04
if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    echo "Intel NPU will not be installed. Ubuntu version could not be detected when checking lsb-release and /etc/os-release."
    exit 0
fi

dpkg --purge --force-remove-reinstreq intel-driver-compiler-npu intel-fw-npu intel-level-zero-npu

# no errors beyond this point
set -e

rm -rf /tmp/npu && mkdir -p /tmp/npu && cd /tmp/npu

# different npu downloads for ubuntu versions
if [ -n "$UBUNTU_22_04" ]
then
    curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-driver-compiler-npu_1.5.1.20240708-9842236399_ubuntu22.04_amd64.deb
    # firmware can only be installed on host. will cause problems inside container.
    if [ -n "$INTEL_FW_NPU" ]
    then
        curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-fw-npu_1.5.1.20240708-9842236399_ubuntu22.04_amd64.deb
    fi
    curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-level-zero-npu_1.5.1.20240708-9842236399_ubuntu22.04_amd64.deb    
else
    curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-driver-compiler-npu_1.5.1.20240708-9842236399_ubuntu24.04_amd64.deb
    if [ -n "$INTEL_FW_NPU" ]
    then
        curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-fw-npu_1.5.1.20240708-9842236399_ubuntu24.04_amd64.deb
    fi
    curl -O -L https://github.com/intel/linux-npu-driver/releases/download/v1.5.1/intel-level-zero-npu_1.5.1.20240708-9842236399_ubuntu24.04_amd64.deb
fi

curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v1.17.6/level-zero_1.17.6+u22.04_amd64.deb
curl -O -L https://github.com/oneapi-src/level-zero/releases/download/v1.17.6/level-zero-devel_1.17.6+u22.04_amd64.deb

apt -y update
apt -y install libtbb12
dpkg -i *.deb

cd /tmp && rm -rf /tmp/npu

apt-get -y dist-upgrade

if [ -n "$INTEL_FW_NPU" ]
then
    echo "Intel NPU firmware was installed. Reboot the host to complete the installation."
fi
