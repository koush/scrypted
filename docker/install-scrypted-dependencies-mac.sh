#!/usr/bin/env bash

if [ "$USER" == "root" ]
then
    echo "Installation must not be run as 'root'."
    exit 1
fi

set -x

RUN() {
    $@
    if [ "$?" != "0" ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

echo "Installing Scrypted dependencies..."
RUN brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
RUN brew install gst-python
RUN pip3 install --upgrade pip
RUN pip3 install aiofiles debugpy typing_extensions typing 

echo "Installing Scrypted..."
RUN npx -y scrypted install-server

set +x
echo
echo
echo
echo
echo "Launch Scrypted with the following:"
echo "  npx -y scrypted serve"
echo
echo "Follow these instructions to create a service that runs on boot:"
echo "  https://github.com/koush/scrypted/wiki/Local-Installation#mac"
echo
echo
