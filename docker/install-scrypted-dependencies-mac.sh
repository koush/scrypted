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
# needed by scrypted-ffmpeg
RUN_IGNORE brew install sdl2
# gstreamer plugins
RUN_IGNORE brew install gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-plugins-ugly
# gst python bindings
RUN_IGNORE brew install gst-python
# python image library
RUN_IGNORE brew install pillow

### HACK WORKAROUND
### https://github.com/koush/scrypted/issues/544

brew unpin gstreamer
brew unpin gst-python
brew unpin gst-plugins-ugly
brew unpin gst-plugins-good
brew unpin gst-plugins-base
brew unpin gst-plugins-bad

brew unlink gstreamer
brew unlink gst-python
brew unlink gst-plugins-ugly
brew unlink gst-plugins-good
brew unlink gst-plugins-base
brew unlink gst-plugins-bad

curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gstreamer.rb && brew install ./gstreamer.rb
curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gst-python.rb && brew install ./gst-python.rb
curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gst-plugins-ugly.rb && brew install ./gst-plugins-ugly.rb
curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gst-plugins-good.rb && brew install ./gst-plugins-good.rb
curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gst-plugins-base.rb && brew install ./gst-plugins-base.rb
curl -O https://raw.githubusercontent.com/Homebrew/homebrew-core/49a8667f0c1a6579fe887bc0fa1c0ce682eb01c8/Formula/gst-plugins-bad.rb && brew install ./gst-plugins-bad.rb

brew pin gstreamer
brew pin gst-python
brew pin gst-plugins-ugly
brew pin gst-plugins-good
brew pin gst-plugins-base
brew pin gst-plugins-bad

### END HACK WORKAROUND

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
RUN python$PYTHON_VERSION -m pip install aiofiles debugpy typing_extensions typing opencv-python psutil

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
