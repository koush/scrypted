HAS_OPENCV_3=$(pkg-config --modversion opencv)
if [ ! -z "$HAS_OPENCV_3" ]
then
    OPENCV_VERSION=opencv
else
    OPENCV_VERSION=opencv4
fi
echo $OPENCV_VERSION
export CFLAGS=$(pkg-config --cflags $OPENCV_VERSION)
export CXXFLAGS=$(pkg-config --cflags $OPENCV_VERSION)
export LDFLAGS="-Wl,--no-as-needed $(pkg-config --libs $OPENCV_VERSION)"
echo $LDFLAGS
cd node_modules/@koush/opencv4nodejs
npm run build
