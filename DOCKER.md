## Docker

Docker images are published on [Docker Hub](https://hub.docker.com/repository/registry-1.docker.io/koush/scrypted/tags?page=1&ordering=last_updated). The images will not work properly on [Mac](https://github.com/docker/for-mac/issues/68) or [Windows](https://github.com/docker/for-win/issues/543), because the `--network host` argument does not work for those platforms.

```sh
# pull the image
sudo docker pull koush/scrypted
# run the image, saving the database and configuration files in a subdirectory named "scrypted"
sudo docker run --network host -v $(pwd)/scrypted:/server/volume koush/scrypted
```


## Docker Compose

```yaml
version: '3.5'

services:
    scrypted:
        image: koush/scrypted
        container_name: scrypted
        restart: unless-stopped
        ports:
            - 9443:9443
        environment:
            - TZ=America/Seattle
        volumes:
            - LOCAL_STORAGE/scrypted:/server/volume
```

## Docker Compose with Z-Wave USB

```yaml
version: '3.5'

services:
    scrypted:
        image: koush/scrypted
        container_name: scrypted
        restart: unless-stopped
        ports:
            - 9443:9443
        environment:
            - TZ=America/Seattle
        devices:
            - /dev/ttyACM0
        volumes:
            - LOCAL_STORAGE/scrypted:/server/volume
```
