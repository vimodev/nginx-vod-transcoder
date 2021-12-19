nginx-vod-transcoder
=======================

Builds upon nytimes/nginx-vod-module to allow for just-in-time transcoding of hls segments. Not robust at all and not production-ready in any case.

Usage
----
Pull the image with `docker pull vimodev/nginx-vod-transcoder`.

Run the image with `docker run --name transcoder -d -p 80:80 -v /path/to/your/videos/:/opt/static/videos:ro vimodev/nginx-vod-transcoder:latest`

Input `http://<server>/hls/subfolder/video.mp4/master.m3u8` into any `hls` video player to play the video `/path/to/your/videos//subfolder/video.mp4`.


Detailed:


Take an example video at `path/to/your/videos/subfolder/video.mp4`. We can then get the master `m3u8` playlist that contains the different qualities depending on the source quality. If the source video is 4Mbps, only options with a bitrate of lower than 4Mbps are available.
- Source: source
- 360p: 640x360 @ 1 Mbps
- 720p: 1280x720 @ 3.5 Mbps
- 1080p: 1920x1080 @ 7 Mbps
- 4K: 3840x2160 @ 14 Mbps

To get the master playlist for `path/to/your/videos/subfolder/video.mp4`, we `GET http://<server>:port/hls/subfolder/video.mp4/master.m3u8`, which can yield for instance the following `m3u8`:

```
#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1774955,RESOLUTION=1280x720,FRAME-RATE=24.000,CODECS="avc1.64001f,mp4a.40.2",VIDEO-RANGE=SDR
http://<server>:port/hls/subfolder/video.mp4/index-v1-a1.m3u8?quality=Source
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
http://<server>:port/hls/subfolder/video.mp4/index-v1-a1.m3u8?quality=360p
```

Each of the `index` files contains a list of all segments with the appropriate url's to call to get the matching quality.

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