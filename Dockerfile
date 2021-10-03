FROM koush/opencv4nodejs
RUN apt-get -y update
RUN apt-get -y upgrade

WORKDIR /
COPY . .

WORKDIR /server
RUN apt-get -y update
RUN apt-get -y install libavahi-compat-libdnssd-dev
RUN npm install

WORKDIR /opencv4nodejs-install/opencv4nodejs
RUN npm link
WORKDIR /server
RUN npm link @koush/opencv4nodejs

RUN npm run build
CMD npm run serve-no-build
