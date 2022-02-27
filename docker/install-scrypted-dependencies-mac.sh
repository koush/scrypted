#!/usr/bin/env bash

if [ "$USER" == "root" ]
then
    echo "Installation must not be run as 'root'."
    exit 1
fi

RUN() {
    echo "Running: $@"
    $@
    if [ "$?" != "0" ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

echo "Installing Scrypted dependencies..."
RUN brew update
# needed by scrypted-ffmpeg
RUN brew install sdl2
# gstreamer plugins
RUN brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
# gst python bindings
RUN brew install gst-python
RUN pip3 install --upgrade pip
RUN pip3 install aiofiles debugpy typing_extensions typing opencv-python

echo "Installing Scrypted..."
RUN npx -y scrypted install-server

echo "Installing Scrypted Launch Agent..."

RUN mkdir -p ~/Library/LaunchAgents

NPX_PATH=$(which npx)
if [ -z "$NPX_PATH" ]
then
    echo "Unable to determine npx path."
    exit 1
fi

NPX_BIN_PATH=$(dirname $NPX_PATH)
if [ -z "$NPX_BIN_PATH" ]
then
    echo "Unable to determine npx bin path."
    exit 1
fi

BREW_PREFIX=$(brew --prefix)
if [ -z "$BREW_PREFIX" ]
then
    echo "Unable to determine brew prefix."
    exit 1
fi

RUN curl https://raw.githubusercontent.com/koush/scrypted/main/docker/app.scrypted.server.plist --output ~/Library/LaunchAgents/app.scrypted.server.plist

# added 1/30/2022 - delete this block at some point:
# previous script had the wrong domain. clear it.
launchctl unload ~/Library/LaunchAgents/com.scrypted.server.plist
rm -f ~/Library/LaunchAgents/com.scrypted.server.plist

# this may fail if its not loaded, do not use RUN
launchctl unload ~/Library/LaunchAgents/app.scrypted.server.plist
RUN launchctl load ~/Library/LaunchAgents/app.scrypted.server.plist

set +x
echo
echo
echo
echo
echo "Scrypted Service has been installed. You can start, stop, enable, or disable Scrypted with:"
echo "  launchctl unload ~/Library/LaunchAgents/app.scrypted.server.plist"
echo "  launchctl load ~/Library/LaunchAgents/app.scrypted.server.plist"
echo
echo "Scrypted is now running at: https://localhost:10443/"
echo "Note that it is https and that you'll be asked to approve/ignore the website certificate."
echo
echo
