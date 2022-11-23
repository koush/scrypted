./template/generate-dockerfile.sh

BUILDPACK_DEPS_BASE=bullseye
NODE_VERSION=18
BASE=$BUILDPACK_DEPS_BASE-$NODE_VERSION
S6_BASE=$BASE.s6

docker build -t koush/scrypted-common:$BASE -f Dockerfile.common \
    --build-arg NODE_VERSION=$NODE_VERSION --build-arg BUILDPACK_DEPS_BASE=$BUILDPACK_DEPS_BASE . && \
\
docker build -t koush/scrypted-common:$S6_BASE -f Dockerfile.common.s6 \
    --build-arg BASE=$BASE . && \
\
docker build -t koush/scrypted:$S6_BASE -f Dockerfile \
    --build-arg BASE=$S6_BASE .
