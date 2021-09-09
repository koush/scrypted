FROM node:16
RUN apt-get -y update
RUN apt-get -y upgrade
EXPOSE 9443
EXPOSE 10080
COPY . .
WORKDIR /server
RUN apt-get -y update
RUN apt-get -y install libavahi-compat-libdnssd-dev
RUN npm install
CMD npm run serve
