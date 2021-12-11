#!/usr/bin/env bash

set -x

# bad hack to run a dockerfile like a shell script.

RUN() {
    $@
    if [ "$?" != "0" ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

FROM() {
    echo 'Installing nodejs repo'
    RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    RUN apt-get install -y nodejs
}

ARG() {
    echo "ignoring ARG $1"
}

ENV() {
    echo "ignoring ENV $1"
}

source <(curl -s https://raw.githubusercontent.com/koush/scrypted/main/docker/Dockerfile.common)
