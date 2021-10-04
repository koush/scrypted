FROM koush/opencv4nodejs
RUN apt-get -y update
RUN apt-get -y upgrade
RUN apt-get -y install libavahi-compat-libdnssd-dev

WORKDIR /
COPY . .

WORKDIR /server
ENV OPENCV4NODEJS_DISABLE_AUTOBUILD=true
RUN npm install

WORKDIR /opencv4nodejs-install/opencv4nodejs
RUN npm link
WORKDIR /server
RUN npm link @koush/opencv4nodejs

RUN npm run build

ENV COMMIT_SHA=$GITHUB_SHA
CMD npm run serve-no-build
