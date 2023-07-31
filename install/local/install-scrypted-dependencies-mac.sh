#!/usr/bin/env bash

# Node 17 changes the dns resolution order to return the record order.
# This causes issues with clients that are on "IPv6" networks that are
# actually busted and fail to connect to npm's IPv6 address.
# The workaround is to favor IPv4.
export NODE_OPTIONS=--dns-result-order=ipv4first

if [ "$USER" == "root" ]
then
    echo "Installation must not be run as 'root'."
    exit 1
fi

RUN() {
    echo "Running: $@"
    $@
    if [ $? -ne 0 ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

# brew install likes to return non zero on success.
RUN_IGNORE() {
    echo "Running: $@"
    $@
    if [ $? -ne 0 ]
    then
        echo 'Error during previous command. Ignoring.'
    fi
}

echo "Stopping previous Scrypted Service if it is running..."
# this may fail if its not loaded, do not use RUN
launchctl unload ~/Library/LaunchAgents/app.scrypted.server.plist || echo ""

echo "Installing Scrypted dependencies..."
RUN_IGNORE xcode-select --install
RUN brew update
RUN_IGNORE brew install node@18
# snapshot plugin and others
RUN brew install libvips
# dlib
RUN brew install cmake

### HACK WORKAROUND
### https://github.com/koush/scrypted/issues/544

brew unpin gstreamer
brew unpin gst-plugins-base
brew unpin gst-plugins-good
brew unpin gst-plugins-bad
brew unpin gst-plugins-ugly
brew unpin gst-libav
brew unpin gst-python

### END HACK WORKAROUND

# seems to be necessary for python-codecs' pycairo dependency or something?
RUN_IGNORE gobject-introspection libffi pkg-config

# gstreamer plugins
RUN_IGNORE brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav
# gst python bindings
RUN_IGNORE brew install gst-python

ARCH=$(arch)
if [ "$ARCH" = "arm64" ]
then
    PYTHON_VERSION=3.10
else
    PYTHON_VERSION=3.9
fi

RUN_IGNORE brew install python@$PYTHON_VERSION
PYTHON_PATH=$(brew --prefix python@$PYTHON_VERSION)
PYTHON_BIN_PATH=
SCRYPTED_PYTHON_PATH=
if [ -d "$PYTHON_PATH" ]
then
    PYTHON_BIN_PATH=$PYTHON_PATH/bin
    export PATH=$PYTHON_BIN_PATH:$PATH
    export SCRYPTED_PYTHON_PATH=python$PYTHON_VERSION
fi

RUN python$PYTHON_VERSION -m pip install --upgrade pip
if [ "$PYTHON_VERSION" != "3.10" ]
then
    RUN python$PYTHON_VERSION -m pip install typing
fi
RUN python$PYTHON_VERSION -m pip install debugpy typing_extensions opencv-python psutil

echo "Installing Scrypted Launch Agent..."

RUN mkdir -p ~/Library/LaunchAgents

NODE_PATH=$(brew --prefix node@18)
if [ ! -d "$NODE_PATH" ]
then
    echo "Unable to determine node@18 path."
    exit 1
fi

NODE_BIN_PATH=$NODE_PATH/bin
if [ ! -d "$NODE_BIN_PATH" ]
then
    echo "Unable to determine node@18 bin path."
    echo "$NODE_BIN_PATH does not exist."
    exit 1
fi

BREW_PREFIX=$(brew --prefix)
if [ -z "$BREW_PREFIX" ]
then
    echo "Unable to determine brew prefix."
    exit 1
fi

BREW_BIN_PATH=$BREW_PREFIX/bin
if [ ! -d "$BREW_BIN_PATH" ]
then
    echo "Unable to determine brew bin path."
    echo "$BREW_BIN_PATH does not exist."
    exit 1
fi

export PATH=$NODE_BIN_PATH:$BREW_BIN_PATH:$PATH

NPX_PATH=$(which npx)
if [ ! -f "$NPX_PATH" ]
then
    echo "Unable to find npx."
    exit 1
fi

echo "Installing Scrypted..."
RUN $NPX_PATH -y scrypted@latest install-server

cat > ~/Library/LaunchAgents/app.scrypted.server.plist <<EOT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>RunAtLoad</key>
        <true/>
    <key>KeepAlive</key>
        <true/>
    <key>Label</key>
        <string>app.scrypted.server</string>
    <key>ProgramArguments</key>
        <array>
             <string>$NPX_PATH</string>
             <string>-y</string>
             <string>scrypted</string>
             <string>serve</string>
        </array>
    <key>WorkingDirectory</key>
         <string>/Users/$USER/.scrypted</string>
    <key>StandardOutPath</key>
        <string>/dev/null</string>
    <key>StandardErrorPath</key>
        <string>/dev/null</string>
    <key>UserName</key>
        <string>$USER</string>
    <key>EnvironmentVariables</key>
        <dict>
            <key>NODE_OPTIONS</key>
                <string>$NODE_OPTIONS</string>
            <key>PATH</key>
                <string>$NODE_BIN_PATH:$PYTHON_BIN_PATH:$BREW_PREFIX/bin:$BREW_PREFIX/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
            <key>HOME</key>
                <string>/Users/$USER</string>
            <key>SCRYPTED_PYTHON_PATH</key>
                <string>$SCRYPTED_PYTHON_PATH</string>
        </dict>
</dict>
</plist>
EOT

RUN launchctl load ~/Library/LaunchAgents/app.scrypted.server.plist

set +x
echo
echo
echo
echo
echo "Scrypted Service has been installed. You can start, stop, enable, or disable Scrypted with:"
echo "  launchctl load ~/Library/LaunchAgents/app.scrypted.server.plist"
echo "  launchctl unload ~/Library/LaunchAgents/app.scrypted.server.plist"
echo "  launchctl enable ~/Library/LaunchAgents/app.scrypted.server.plist"
echo "  launchctl disable ~/Library/LaunchAgents/app.scrypted.server.plist"
echo
echo "Scrypted is now running at: https://localhost:10443/"
echo "Note that it is https and that you'll be asked to approve/ignore the website certificate."
echo
echo
