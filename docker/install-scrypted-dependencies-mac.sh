#!/usr/bin/env bash

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
# needed by scrypted-ffmpeg
RUN_IGNORE brew install sdl2
# gstreamer plugins
RUN_IGNORE brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
# gst python bindings
RUN_IGNORE brew install gst-python
# python image library
RUN_IGNORE brew install pillow

RUN_IGNORE brew install python@3.9
PYTHON_PATH=$(brew --prefix python@3.9)
PYTHON_BIN_PATH=
if [ ! -d "$PYTHON_PATH" ]
then
    PYTHON_BIN_PATH=$PYTHON_PATH/bin
    export PATH=$PYTHON_BIN_PATH:$PATH
fi

RUN python3.9 -m pip install --upgrade pip
RUN python3.9 -m pip install aiofiles debugpy typing_extensions typing opencv-python

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
            <key>PATH</key>
                <string>$NODE_BIN_PATH:$PYTHON_BIN_PATH:$BREW_PREFIX/bin:$BREW_PREFIX/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
            <key>HOME</key>
                <string>/Users/$USER</string>
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
