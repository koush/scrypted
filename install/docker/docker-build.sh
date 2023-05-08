./template/generate-dockerfile.sh

set -x

NODE_VERSION=18
BUILDPACK_DEPS_BASE=bullseye
FLAVOR=full
BASE=$NODE_VERSION-$BUILDPACK_DEPS_BASE-$FLAVOR
echo $BASE
SUPERVISOR=.s6
SUPERVISOR_BASE=$BASE$SUPERVISOR

docker build -t koush/scrypted-common:$BASE -f Dockerfile.$FLAVOR \
    --build-arg NODE_VERSION=$NODE_VERSION --build-arg BUILDPACK_DEPS_BASE=$BUILDPACK_DEPS_BASE . && \
\
docker build -t koush/scrypted:$SUPERVISOR_BASE -f Dockerfile$SUPERVISOR \
    --build-arg BASE=$BASE .
