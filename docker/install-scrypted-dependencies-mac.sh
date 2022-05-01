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

RUN_IGNORE() {
    echo "Running: $@"
    $@
    if [ $? -ne 0 ]
    then
        echo 'Error during previous command. Ignoring.'
    fi
}

echo "Installing Scrypted dependencies..."
RUN_IGNORE brew update
RUN_IGNORE brew install node@16
# needed by scrypted-ffmpeg
RUN_IGNORE brew install sdl2
# gstreamer plugins
RUN_IGNORE brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
# gst python bindings
RUN_IGNORE brew install gst-python
RUN pip3 install --upgrade pip
RUN pip3 install aiofiles debugpy typing_extensions typing opencv-python

echo "Installing Scrypted Launch Agent..."

RUN mkdir -p ~/Library/LaunchAgents

NODE_16_PATH=$(brew --prefix node@16)
if [ ! -d "$NODE_16_PATH" ]
then
    echo "Unable to determine node@16 path."
    exit 1
fi

NODE_16_BIN_PATH=$NODE_16_PATH/bin
if [ ! -d "$NODE_16_BIN_PATH" ]
then
    echo "Unable to determine node@16 bin path."
    echo "$NODE_16_BIN_PATH does not exist."
    exit 1
fi

export PATH=$NODE_16_BIN_PATH:$PATH

NPX_PATH=$NODE_16_BIN_PATH/npx
if [ ! -f "$NPX_PATH" ]
then
    echo "Unable to find npx."
    exit 1
fi

echo "Installing Scrypted..."
RUN $NPX_PATH -y scrypted install-server

BREW_PREFIX=$(brew --prefix)
if [ -z "$BREW_PREFIX" ]
then
    echo "Unable to determine brew prefix."
    exit 1
fi


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
                <string>$NODE_16_BIN_PATH:$BREW_PREFIX/bin:$BREW_PREFIX/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
            <key>HOME</key>
                <string>/Users/$USER</string>
        </dict>
</dict>
</plist>
EOT

# added 1/30/2022 - delete this block at some point:
# previous script had the wrong domain. clear it.
launchctl unload ~/Library/LaunchAgents/com.scrypted.server.plist || echo ""
rm -f ~/Library/LaunchAgents/com.scrypted.server.plist

# this may fail if its not loaded, do not use RUN
launchctl unload ~/Library/LaunchAgents/app.scrypted.server.plist || echo ""
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
