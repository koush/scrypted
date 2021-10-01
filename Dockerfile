FROM node:16
RUN apt-get -y update
RUN apt-get -y upgrade
COPY . .
WORKDIR /server
RUN apt-get -y update
RUN apt-get -y install libavahi-compat-libdnssd-dev libopencv-dev
RUN npm install
RUN ./build-opencv4nodejs-linux.sh
RUN npm run build
CMD npm run serve-no-build
