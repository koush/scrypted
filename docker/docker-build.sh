./template/generate-dockerfile.sh

docker build -t koush/scrypted-common:16-bullseye -f Dockerfile.common --build-arg NODE_VERSION=16 . && \
docker build -t koush/scrypted-common:16-bullseye-s6 -f Dockerfile.common.s6 --build-arg BASE=16-bullseye . && \
docker build -t koush/scrypted:16-bullseye-s6 -f Dockerfile --build-arg BASE=16-bullseye-s6 .
