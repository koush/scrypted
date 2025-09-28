if [ "$(uname -m)" != "x86_64" ]
then
    echo "AMD graphics will not be installed on this architecture."
    exit 0
fi

UBUNTU_22_04=$(lsb_release -r | grep "22.04")
UBUNTU_24_04=$(lsb_release -r | grep "24.04")

# needs either ubuntu 22.0.4 or 24.04
if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    echo "AMD graphics package can not be installed. Ubuntu version could not be detected when checking lsb-release and /etc/os-release."
    exit 1
fi

if [ -n "$UBUNTU_22_04" ]
then
    distro="jammy"
else
    distro="noble"
fi

apt -y update
apt -y install rsync gpg
# the deb no longer seems to install a key?
gpg --keyserver keyserver.ubuntu.com --recv-keys 9386B48A1A693C5C
gpg --export --armor 9386B48A1A693C5C | tee /etc/apt/trusted.gpg.d/amdgpu.asc

# https://amdgpu-install.readthedocs.io/en/latest/install-prereq.html#installing-the-installer-package

# AMD keeps breaking these links. Use hard links.

# FILENAME=$(curl -s -L https://repo.radeon.com/amdgpu-install/latest/ubuntu/$distro/ | grep -o 'amdgpu-install_[^ ]*' | cut -d'"' -f1)
# if [ -z "$FILENAME" ]
# then
#     echo "AMD graphics package can not be installed. Could not find the package name."
#     exit 1
# fi

set -e
mkdir -p /tmp/amd
cd /tmp/amd
# curl -O -L https://repo.radeon.com/amdgpu-install/latest/ubuntu/$distro/$FILENAME

FILENAME=amdgpu-install_7.0.1.70001-1_all.deb
curl -O -L https://repo.radeon.com/amdgpu-install/7.0.1/ubuntu/$distro/$FILENAME

dpkg -i $FILENAME
apt -y update

amdgpu-install --usecase=opencl --no-dkms -y --accept-eula
cd /tmp
rm -rf /tmp/amd

