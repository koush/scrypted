echo ######################################
echo "npm ciing in popular plugins..."
echo ######################################

cd $(dirname $0)

git submodule init
git submodule update

for base in sdk common server
do
    echo $base
    pushd $base
    npm ci
    popd
done

pushd external/HAP-NodeJS
npm ci
npm run build
popd

pushd external/werift
npm install
popd

for plugin in ffmpeg-camera rtsp amcrest onvif hikvision unifi-protect homekit
do
    echo $plugin
    pushd plugins/$plugin
    npm ci
    popd
done
