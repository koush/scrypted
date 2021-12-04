# docker buildx create --name mybuild
# docker buildx use mybuild
docker buildx build --push --tag koush/scrypted:latest --platform linux/amd64,linux/arm64,linux/armhf .
