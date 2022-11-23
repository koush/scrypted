./template/generate-dockerfile.sh

set -x

NODE_VERSION=18
BUILDPACK_DEPS_BASE=bullseye
FLAVOR=full
BASE=$NODE_VERSION-$BUILDPACK_DEPS_BASE-$FLAVOR
S6_BASE=$BASE-s6

docker build -t koush/scrypted-common:$BASE -f Dockerfile.$FLAVOR \
    --build-arg NODE_VERSION=$NODE_VERSION --build-arg BUILDPACK_DEPS_BASE=$BUILDPACK_DEPS_BASE . && \
\
docker build -t koush/scrypted-common:$S6_BASE -f Dockerfile.s6 \
    --build-arg BASE=$BASE . && \
\
docker build -t koush/scrypted:$S6_BASE -f Dockerfile \
    --build-arg BASE=$S6_BASE .
