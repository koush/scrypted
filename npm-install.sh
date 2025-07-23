#!/bin/bash
echo ######################################
echo "Setting up popular plugins."
echo "Additional will need npm install manually."
echo ######################################

cd $(dirname $0)

git submodule init
git submodule update

for directory in sdk server common packages/client packages/auth-fetch
do
    echo "$directory > npm install"
    pushd $directory
    npm install
    popd
done

pushd sdk
echo "sdk > npm run build"
npm run build
popd

pushd external/werift
echo "external/werift > npm install"
npm install
popd

for directory in rtsp ffmpeg-camera onvif prebuffer-mixin snapshot core webrtc homekit doorbird
do
    echo "$directory > npm install"
    pushd plugins/$directory
    npm install
    popd
done
