echo ######################################
echo "npm installing in popular plugins..."
echo ######################################

cd $(dirname $0)
for base in sdk common
do
    echo $base
    pushd $base
    npm install
    popd
done

for plugin in ffmpeg-camera rtsp amcrest onvif hikvision unifi-protect
do
    echo $plugin
    pushd plugins/$plugin
    npm install
    popd
done
