echo ######################################
echo "npm installing in popular plugins..."
echo ######################################

cd $(dirname $0)

git submodule init
git submodule update

for base in sdk common
do
    echo $base
    pushd $base
    npm install
    popd
done

pushd external/HAP-NodeJS
npm install
npm run build
popd

for plugin in ffmpeg-camera rtsp amcrest onvif hikvision unifi-protect homekit
do
    echo $plugin
    pushd plugins/$plugin
    npm install
    popd
done
