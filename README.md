nginx-vod-transcoder
=======================

Builds upon nytimes/nginx-vod-module to allow for just-in-time transcoding of hls segments.

Building locally
----------------

This repository uses Docker's multi-stage builds, therefore building this image
requires Docker 17.05 or higher. Given that you have all the required
dependencies, building the image is as simple as running a ``docker build``:

```
docker build -t vimodev/nginx-vod-transcoder .
```

Architecture
-------------
The nginx config splits any .ts segment requests such that they go to a node server which calls the original vod module and transcodes the results which it forwards to the client.