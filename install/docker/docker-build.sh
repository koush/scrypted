./template/generate-dockerfile.sh

set -x

NODE_VERSION=20
SCRYPTED_INSTALL_VERSION=beta
IMAGE_BASE=jammy
FLAVOR=full
BASE=$NODE_VERSION-$IMAGE_BASE-$FLAVOR
echo $BASE
SUPERVISOR=.s6
SUPERVISOR_BASE=$BASE$SUPERVISOR

docker build -t ghcr.io/koush/scrypted-common:$BASE -f Dockerfile.$FLAVOR \
    --build-arg NODE_VERSION=$NODE_VERSION --build-arg BASE=$IMAGE_BASE . && \
\
docker build -t ghcr.io/koush/scrypted:$SUPERVISOR_BASE -f Dockerfile$SUPERVISOR \
    --build-arg BASE=$BASE --build-arg SCRYPTED_INSTALL_VERSION=$SCRYPTED_INSTALL_VERSION .
