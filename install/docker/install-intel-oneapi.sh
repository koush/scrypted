if [ "$(uname -m)" = "x86_64" ]
then
    apt -y update
    apt -y install gpg

    # download the key to system keyring
    curl -1sLf https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | gpg --dearmor --yes --output /usr/share/keyrings/oneapi-archive-keyring.gpg

    # add signed entry to apt sources and configure the APT client to use Intel repository:
    echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | tee /etc/apt/sources.list.d/oneAPI.list

    apt -y update
    apt -y install intel-oneapi-mkl-sycl-blas intel-oneapi-runtime-dnnl intel-oneapi-runtime-compilers
else
    echo "NVIDIA graphics will not be installed on this architecture."
fi

exit 0
