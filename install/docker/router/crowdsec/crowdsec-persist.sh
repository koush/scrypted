#!/bin/bash
set -e

PERSIST_DIR=/server/volume/plugins/@scrypted/router/crowdsec

if [ ! -f "$PERSIST_DIR/.migrated" ]; then
    mkdir -p "$PERSIST_DIR"
    cp -a /var/lib/crowdsec/. "$PERSIST_DIR/"
    touch "$PERSIST_DIR/.migrated"
fi

rm -rf /var/lib/crowdsec
ln -sf "$PERSIST_DIR" /var/lib/crowdsec
