FROM node:16
RUN apt-get -y update
RUN apt-get -y upgrade
RUN apt-get -y install libavahi-compat-libdnssd-dev build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

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
