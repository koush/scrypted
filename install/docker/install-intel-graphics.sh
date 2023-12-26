if [ "$(uname -m)" = "x86_64" ]
then
    apt-get update && apt-get install -y gpg-agent &&
    rm -f /usr/share/keyrings/intel-graphics.gpg &&
    curl -L https://repositories.intel.com/graphics/intel-graphics.key | gpg --dearmor --yes --output /usr/share/keyrings/intel-graphics.gpg &&
    echo 'deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/graphics/ubuntu jammy arc' | tee  /etc/apt/sources.list.d/intel.gpu.jammy.list &&
    apt-get -y update &&
    apt-get -y install intel-opencl-icd intel-media-va-driver-non-free &&
    apt-get -y dist-upgrade;
    exit $?
else
    echo "Intel graphics will not be installed on this architecture."
fi

exit 0
