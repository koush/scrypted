echo 'if (!process.version.startsWith("v18")) throw new Error("Node 18 is required. Install Node Version Manager (nvm) for versioned node installations. See https://github.com/koush/scrypted/pull/498#issuecomment-1373854020")' | node
if [ "$?" != 0 ]
then
    exit
fi

echo ######################################
echo "Setting up popular plugins."
echo "Additional will need npm install manually."
echo ######################################

cd $(dirname $0)

git submodule init
git submodule update

for directory in sdk common server
do
    echo "$directory > npm ci"
    pushd $directory
    npm ci
    popd
done

pushd sdk
echo "sdk > npm run build"
npm run build
popd

pushd external/HAP-NodeJS
echo "external/HAP-NodeJS > npm ci"
npm ci
echo "external/HAP-NodeJS > npm run build"
npm run build
popd

pushd external/werift
echo "external/werift > npm install"
npm install
popd

for directory in ffmpeg-camera rtsp amcrest onvif hikvision unifi-protect webrtc homekit
do
    echo "$directory > npm ci"
    pushd plugins/$directory
    npm ci
    popd
done
