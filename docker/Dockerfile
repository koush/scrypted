ARG BASE="18-bullseye-full"
FROM koush/scrypted-common:${BASE}

WORKDIR /
# cache bust
ADD "https://www.random.org/cgi-bin/randbyte?nbytes=10&format=h" skipcache
ARG SCRYPTED_INSTALL_VERSION="latest"
RUN test -n "$SCRYPTED_INSTALL_VERSION"
RUN npx -y scrypted@latest install-server ${SCRYPTED_INSTALL_VERSION}
WORKDIR /server
CMD npm --prefix /server exec scrypted-serve
