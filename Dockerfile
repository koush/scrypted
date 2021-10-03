FROM node:16
RUN apt-get -y update
RUN apt-get -y upgrade
RUN apt-get -y install libavahi-compat-libdnssd-dev libopencv-dev

COPY . .
WORKDIR /server
ENV OPENCV4NODEJS_DISABLE_AUTOBUILD=true
RUN npm install
RUN npm run build
CMD npm run serve-no-build
