ARG BASHIO_VERSION=0.14.3
ARG TEMPIO_VERSION=2021.09.0
FROM koush/scrypted:beta

# Install Nginx and a set of Home Assistant add-on tools
RUN \
    case "$(uname -m)" in \
    x86_64) BUILD_ARCH='amd64';; \
    armv7l) BUILD_ARCH='armhf';; \
    aarch64) BUILD_ARCH='aarch64';; \
    \
    *) echo "Your system architecture isn't supported."; exit 1 ;; \
    esac \
    set -x \
    && apt-get update && apt-get install -y --no-install-recommends \
        bash \
        jq \
        tzdata \
        curl \
        ca-certificates \
        nginx-extras\
        libnginx-mod-http-lua\
    && mkdir -p /usr/share/man/man1 \
    \
    && mkdir -p /etc/fix-attrs.d \
    && mkdir -p /etc/services.d \
    \
    && curl -L -f -s -o /usr/bin/tempio \
        "https://github.com/home-assistant/tempio/releases/download/${TEMPIO_VERSION}/tempio_${BUILD_ARCH}" \
    && chmod a+x /usr/bin/tempio \
    \
    && mkdir -p /usr/src/bashio \
    && curl -L -f -s "https://github.com/hassio-addons/bashio/archive/v${BASHIO_VERSION}.tar.gz" \
        | tar -xzf - --strip 1 -C /usr/src/bashio \
    && mv /usr/src/bashio/lib /usr/lib/bashio \
    && ln -s /usr/lib/bashio/bashio /usr/bin/bashio \
    \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/src/* \
    && apt-get autoremove

# This file is installed by NGINX as a default but we don't need it
RUN rm -rf /etc/nginx/sites-enabled/default

WORKDIR /

# Copy root filesystem
COPY rootfs /

ENTRYPOINT ["/init"]
