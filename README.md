nginx-vod-transcoder
=======================

Builds upon nytimes/nginx-vod-module to allow for just-in-time transcoding of hls segments. Not robust at all and not production-ready in any case.

Usage
----
Pull the image with `docker pull vimodev/nginx-vod-transcoder`.

Run the image with `docker run --name transcoder -d -p 80:80 -v /path/to/your/videos/:/opt/static/videos:ro vimodev/nginx-vod-transcoder:latest`

To use custom settings mount a `.json` as follows `docker run --name transcoder -d -p 80:80 -v /path/to/your/videos/:/opt/static/videos:ro -v /path/to/config.json:/transcoder/config.json vimodev/nginx-vod-transcoder:latest`. An example `json` configuration is as follows (these are default settings):

```
// If you are copying this, make sure to remove the comments since they make for an invalid config
{
    // Cache settings
    // Set maxSize to 0 to disable cache
    "cache": {
        "maxSize": 5000, // max cache size in MB (10^6)
        "expiration": 300, // entries expire after x seconds
        "interval": 5 // when to check for expirations, seconds
    },
    // Quality settings, Source is always available
    // Name : { bitrate, resolution }
    "qualities": {
        "360p": { // Key is the name of the quality level
            "bitrate": 500000, // Bitrate in bps
            "resolution": "640x360" // Resolution w x h
        },
        "720p": {
            "bitrate": 1500000,
            "resolution": "1280x720"
        },
        "1080p": {
            "bitrate": 3000000,
            "resolution": "1920x1080"
        },
        "4K": {
            "bitrate": 10000000,
            "resolution": "3840x2160"
        }
    }
}
```

Input `http://<server>/hls/subfolder/video.mp4/master.m3u8` into any `hls` video player to play the video `/path/to/your/videos/subfolder/video.mp4`.

Has an internal cache where transcoded segments expire after 300 seconds with a max size of 5GB. `GET /cache` to query cache information including size and entries.


Detailed:


Take an example video at `path/to/your/videos/subfolder/video.mp4`. We can then get the master `m3u8` playlist that contains the different qualities depending on the source quality. If the source video is 4Mbps for example, only options with a bitrate of lower than 4Mbps are available. The following qualities are in the default config. Source is always available and the first stream in the playlist regardless of mounted configuration.
- Source: source
- 360p: 640x360 @ 500 kbps
- 720p: 1280x720 @ 1.5 Mbps
- 1080p: 1920x1080 @ 3 Mbps
- 4K: 3840x2160 @ 10 Mbps

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
The node server acts as a reverse proxy between the client and the nginx-vod server. It edits m3u8 playlists to provide multiple qualities for a single file. It transcodes proxy'd segments based on the quality specified in the query of the url.
