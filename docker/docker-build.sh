./template/generate-dockerfile.sh

docker build -t koush/scrypted-common:16-bullseye -f Dockerfile.common --build-arg BASE=16-bullseye . && \
docker build -t koush/scrypted:16-bullseye -f Dockerfile --build-arg BASE=16-bullseye .
