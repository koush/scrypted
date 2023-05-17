./template/generate-dockerfile.sh

set -x

NODE_VERSION=18
BASE=bookworm
FLAVOR=full
BASE=$NODE_VERSION-$BASE-$FLAVOR
echo $BASE
SUPERVISOR=.s6
SUPERVISOR_BASE=$BASE$SUPERVISOR

docker build -t koush/scrypted-common:$BASE -f Dockerfile.$FLAVOR \
    --build-arg NODE_VERSION=$NODE_VERSION --build-arg BASE=$BASE . && \
\
docker build -t koush/scrypted:$SUPERVISOR_BASE -f Dockerfile$SUPERVISOR \
    --build-arg BASE=$BASE .
