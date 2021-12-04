FROM koush/opencv4nodejs

# edge TPU
RUN echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | tee /etc/apt/sources.list.d/coral-edgetpu.list
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add -

RUN apt-get -y update
RUN apt-get -y upgrade

RUN apt-get -y install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav

RUN apt-get -y install \
    build-essential \
    gcc \
    gir1.2-gtk-3.0 \
    libavahi-compat-libdnssd-dev \
    libcairo2-dev \
    libedgetpu1-std \
    libgirepository1.0-dev \
    libglib2.0-dev \
    libjpeg-dev \
    libgif-dev \
    libopenjp2-7 \
    libpango1.0-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    python3-dev \
    python3-matplotlib \
    python3-numpy \
    python3-pip \
    python3-gi \
    python3-gst-1.0

RUN python3 -m pip install aiofiles debugpy

WORKDIR /
COPY . .

# grab raspbian (omx) ffmpeg, since we don't know at build time whether this is
# a raspbian system.
RUN mkdir -p /raspbian && cd /raspbian \
    && curl -O -L https://github.com/homebridge/ffmpeg-for-homebridge/releases/latest/download/ffmpeg-raspbian-armv6l.tar.gz \
    && tar xzvfm ffmpeg-raspbian-armv6l.tar.gz \
    && rm ffmpeg-raspbian-armv6l.tar.gz
ENV SCRYPTED_RASPBIAN_FFMPEG_PATH="/raspbian/usr/local/bin/ffmpeg"

WORKDIR /server
RUN npm install
RUN npm run build

ENV SCRYPTED_DOCKER_SERVE="true"
ENV SCRYPTED_CAN_RESTART="true"
CMD npm run serve-no-build
