ARG BASE="18-bullseye-full"
ARG SCRYPTED_INSTALL_VERSION=latest
FROM koush/scrypted-common:${BASE}

WORKDIR /
# cache bust
# ADD "https://www.random.org/cgi-bin/randbyte?nbytes=10&format=h" skipcache
RUN npx -y scrypted install-server $SCRYPTED_INSTALL_VERSION
WORKDIR /server
CMD npm --prefix /server exec scrypted-serve
