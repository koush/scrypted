ARG BASE="20-jammy-full"
FROM ghcr.io/koush/scrypted-common:${BASE}

WORKDIR /
# cache bust
ADD "https://www.random.org/cgi-bin/randbyte?nbytes=10&format=h" skipcache
ARG SCRYPTED_INSTALL_VERSION="latest"
RUN test -n "$SCRYPTED_INSTALL_VERSION"
RUN npx -y scrypted@latest install-server ${SCRYPTED_INSTALL_VERSION}
WORKDIR /server

# this prevents node from preferring ipv6 addresses locally on
# networks with busted ipv6 setups.
# https://github.com/nodejs/node/issues/41145#issuecomment-992948130
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# changing this forces pip and npm to perform reinstalls.
# if this base image changes, this version must be updated.
ENV SCRYPTED_BASE_VERSION="20240321"

CMD ["/bin/sh", "-c", "ulimit -c 0; exec npm --prefix /server exec scrypted-serve"]
