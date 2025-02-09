if [ "$(uname -m)" != "x86_64" ]
then
    echo "Intel graphics will not be installed on this architecture."
    exit 0
fi

# no errors beyond this point
set -e

# the intel provided script is disabled since it does not work with the 6.8 kernel in Ubuntu 24.04 or Proxmox 8.2.
# manual installation of the Intel graphics stuff is required.

# echo "Installing Intel graphics packages."
# apt-get update && apt-get install -y gpg-agent &&
# rm -f /usr/share/keyrings/intel-graphics.gpg &&
# curl -L https://repositories.intel.com/graphics/intel-graphics.key | gpg --dearmor --yes --output /usr/share/keyrings/intel-graphics.gpg &&
# echo 'deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/graphics/ubuntu jammy arc' | tee  /etc/apt/sources.list.d/intel.gpu.jammy.list &&
# apt-get -y update &&
# apt-get -y install intel-opencl-icd &&
# apt-get -y dist-upgrade;

# need intel-media-va-driver-non-free, but all the other intel packages are installed from Intel github.
echo "Installing Intel graphics packages."
apt-get update && apt-get install -y gpg-agent &&
rm -f /usr/share/keyrings/intel-graphics.gpg &&
curl -L https://repositories.intel.com/graphics/intel-graphics.key | gpg --dearmor --yes --output /usr/share/keyrings/intel-graphics.gpg &&
echo 'deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/graphics/ubuntu jammy arc' | tee  /etc/apt/sources.list.d/intel.gpu.jammy.list &&
apt-get -y update &&
apt-get -y install intel-media-va-driver-non-free &&
apt-get -y dist-upgrade;

rm -rf /tmp/gpu && mkdir -p /tmp/gpu && cd /tmp/gpu

apt-get install -y ocl-icd-libopencl1

# very stupid legacy + current install process conflict.
# install 24.35.30872.22 for legacy support. Then install latest.
# https://github.com/intel/compute-runtime/issues/770#issuecomment-2515166915

# https://github.com/intel/compute-runtime/releases/tag/24.35.30872.22
curl -O -L https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17537.20/intel-igc-core_1.0.17537.20_amd64.deb
curl -O -L https://github.com/intel/intel-graphics-compiler/releases/download/igc-1.0.17537.20/intel-igc-opencl_1.0.17537.20_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-level-zero-gpu-dbgsym_1.3.30872.22_amd64.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-level-zero-gpu-legacy1-dbgsym_1.3.30872.22_amd64.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-level-zero-gpu-legacy1_1.3.30872.22_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-level-zero-gpu_1.3.30872.22_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-opencl-icd-dbgsym_24.35.30872.22_amd64.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-opencl-icd-legacy1-dbgsym_24.35.30872.22_amd64.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-opencl-icd-legacy1_24.35.30872.22_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/intel-opencl-icd_24.35.30872.22_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/24.35.30872.22/libigdgmm12_22.5.0_amd64.deb

dpkg -i *.deb
rm -f *.deb

# https://github.com/intel/compute-runtime/releases/tag/24.45.31740.9
# note that at time of commit, IGC supports ubuntu 24.04 only possibly due to their builder being on 24.04.
IGC_BASE_VERSION=2.5.6
IGC_VERSION=2_$IGC_BASE_VERSION+18417_amd64
COMPUTE_VERSION=24.52.32224.5
ZERO_GPU_VERSION=1.6.32224.5_amd64
LIBIGDGMM_VERSION=22.5.5_amd64
curl -O -L https://github.com/intel/intel-graphics-compiler/releases/download/v$IGC_BASE_VERSION/intel-igc-core-$IGC_VERSION.deb
curl -O -L https://github.com/intel/intel-graphics-compiler/releases/download/v$IGC_BASE_VERSION/intel-igc-opencl-$IGC_VERSION.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/$COMPUTE_VERSION/intel-level-zero-gpu-dbgsym_$ZERO_GPU_VERSION.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/$COMPUTE_VERSION/intel-level-zero-gpu_$ZERO_GPU_VERSION.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/$COMPUTE_VERSION/intel-opencl-icd-dbgsym_"$COMPUTE_VERSION"_amd64.ddeb
curl -O -L https://github.com/intel/compute-runtime/releases/download/$COMPUTE_VERSION/intel-opencl-icd_"$COMPUTE_VERSION"_amd64.deb
curl -O -L https://github.com/intel/compute-runtime/releases/download/$COMPUTE_VERSION/libigdgmm12_$LIBIGDGMM_VERSION.deb

set +e
dpkg -i *.deb
set -e
# the legacy + latest process says this may be necessary but it does not seem to be in a clean environment.
apt-get install --fix-broken


cd /tmp && rm -rf /tmp/gpu

apt-get -y dist-upgrade
