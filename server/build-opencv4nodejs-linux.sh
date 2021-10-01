export OPENCV4NODEJS_DEFINES="remove_cv_t=remove_cv"
export OPENCV4NODEJS_INCLUDES=/usr/local/Cellar/opencv@3/3.4.15/include/
export OPENCV4NODEJS_BIN=/usr/local/Cellar/opencv@3/3.4.15/bin/
export OPENCV4NODEJS_LIBRARIES="libopencv_core.a
libopencv_videoio.a
libopencv_objdetect.a"
cd node_modules/@koush/opencv4nodejs
npm run build
