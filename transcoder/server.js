const express =  require('express')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tmp = require('tmp')
const cors = require('cors')
const { spawn } = require('child_process')
const url = require('url')

var cache = require('./cache')

const settings = require('./settings.json')

const upstreamHostname = 'localhost'
const upstreamPort = 8080

const app = express()
app.use(cors())
const port = 8081

const qualities = settings.qualities
console.log("USING SETTINGS:")
console.log(JSON.stringify(settings, null, 2))

setTimeout(() => cache.tickCache(), settings.cache.interval * 1000)

/**
 * Convert a character stream into a string
 * @param {*} stream 
 * @returns string of stream
 */
function streamToString (stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    })
}

/**
 * Given a request for a segment, handle it.
 * @param {*} req Request
 * @param {*} res Response
 */
function handleSegmentRequest(req, res) {
    console.log(`Handling segment request ${req.url}`)
    // Check if the request is in the cache
    if (req.url in cache.cache) {
        console.log(`Found ${req.url} in cache`)
        cache.cache[req.url].expiration = settings.cache.expiration
        res.sendFile(cache.cache[req.url].file)
        return
    }
    // Determine quality
    let quality = req.query.quality
    if (quality == undefined) quality = "Source"
    if (!(quality in qualities)) qual = "Source"
    let path = url.parse(req.url).pathname
    // Open temporary file
    const tempFile = tmp.tmpNameSync() + '.ts'
    const fd = fs.openSync(tempFile, 'w')
    fs.closeSync(fd)
    // Open write stream
    const stream = fs.createWriteStream(tempFile)
    const options = {
        hostname: upstreamHostname,
        port: upstreamPort,
        path: path,
        headers: {
            Host: req.get("Host")
        }
    }
    // Request the resource from upstream nginx-vod-module
    const request = http.get(options, function(response) {
        // Pipe the response to the file
        response.pipe(stream)
        // When done
        stream.on('finish', () => {
            // Close the stream
            stream.close()
            // If Source quality, we dont have to transcode and just send it
            if (quality == "Source") {
                res.sendFile(tempFile)
                setTimeout(() => {
                    try {
                        fs.unlinkSync(tempFile)
                    } catch (err) {
                        console.log(err)
                    }
                }, 5000)
                return
            }
            // Otherwise we transcode the segment based on selected quality
            const outFile = tmp.tmpNameSync() + '.ts'
            const q = qualities[quality]
            const child = spawn('ffmpeg', ['-i', tempFile, '-vcodec', 'libx264', '-b:v', `${q.bitrate}`,'-acodec', 'copy', '-s', q.resolution.replace('x', ':'), 
                                            '-copyts', '-muxdelay', '0', outFile])
            // When transcoding is done we add the result to the cache and send it
            child.on('close', () => {
                if (settings.cache.maxSize > 0) cache.addToCache(req.url, outFile)
                // Send the output
                res.sendFile(outFile)
                // Delete the files
                setTimeout(() => {
                    try {
                        fs.unlinkSync(tempFile)
                        if (settings.cache.maxSize <= 0) fs.unlinkSync(outFile)
                    } catch (err) {
                        console.log(err)
                    }
                }, 5000)
            })
        })
    })
}

/**
 * Parse a line from upstream m3u8 response to get 
 * the bandwidth of the source file.
 * @param {*} line information line in m3u8 file
 * @returns bitrate of the source file, in bits per second
 */
function getBandwidthFromLine(line) {
    let fields = line.split(',')
    for (let i = 0; i < fields.length; i++) {
        if (fields[i].includes("BANDWIDTH")) {
            return Number(fields[i].split('=')[1])
        }
    }
}

/**
 * Based on the qualities available, change the master.m3u8
 * file to include those qualities as possible streams.
 * @param {*} m3u8 
 */
function modifyMaster(m3u8) {
    let lines = m3u8.split('\n')
    let info = lines[1]
    let index = lines[2]
    let bitrate = getBandwidthFromLine(info)
    // Include original start and source quality
    let output = "" + lines[0] + "\n"
    output += info + "\n"
    output += index + "?quality=Source" + "\n"
    // Add each quality with a bitrate of less than the source
    for (const q in qualities) {
        let quality = qualities[q]
        if (quality.bitrate < bitrate) {
            output += "#EXT-X-STREAM-INF:BANDWIDTH=" + quality.bitrate + ",RESOLUTION=" + quality.resolution + "\n"
            output += index + `?quality=${q}` + "\n"
        }
    }
    return output
}

/**
 * Given a request for a master.m3u8, handle it
 * @param {*} req request
 * @param {*} res response
 */
function handleMasterRequest(req, res) {
    console.log(`Handling Master request ${req.url}`)
    let path = url.parse(req.url).pathname
    const options = {
        hostname: upstreamHostname,
        port: upstreamPort,
        path: path,
        headers: {
            Host: req.get("Host")
        }
    }
    // GET the upstream file
    http.get(options, (response) => {
        streamToString(response).then(function (result) {
            // Respond with modified version
            res.send(modifyMaster(result))
        })
    })
}

/**
 * Modify an index m3u8 based on quality that was requested.
 * @param {*} m3u8 
 * @param {*} quality 
 * @returns 
 */
function modifyIndex(m3u8, quality) {
    if (quality == undefined) quality = "Source"
    let lines = m3u8.split('\n')
    for (let i = 0; i < lines.length; i++) {
        // Append to each .ts uri a query of quality
        if (lines[i].includes(".ts")) {
            lines[i] += "?quality=" + quality
        }
    }
    return lines.join('\n')
}

/**
 * Given a request for a index.m3u8, handle it
 * @param {*} req 
 * @param {*} res 
 */
function handleIndexRequest(req, res) {
    console.log(`Handling Index request ${req.url}`)
    let path = url.parse(req.url).pathname
    const options = {
        hostname: upstreamHostname,
        port: upstreamPort,
        path: path,
        headers: {
            Host: req.get("Host")
        }
    }
    http.get(options, (response) => {
        streamToString(response).then(function (result) {
            res.send(modifyIndex(result, req.query.quality))
        })
    })
}

/**
 * Given a request starting with /hls, handle it
 * @param {*} req 
 * @param {*} res 
 */
function handleHLS(req, res) {
    let path = url.parse(req.url).pathname
    if (path.endsWith('.ts')) {
        handleSegmentRequest(req, res)
    } else if (path.endsWith('master.m3u8')) {
        handleMasterRequest(req, res)
    } else if (path.endsWith('index-v1-a1.m3u8') || path.endsWith('index-v1.m3u8')) {
        handleIndexRequest(req, res)
    } else {
        res.status(404)
    }
}

/**
 * Simply proxy the request to upstream nginx-vod
 * @param {*} req 
 * @param {*} res 
 */
function proxy(req, res) {
    let path = url.parse(req.url).pathname
    const options = {
        hostname: upstreamHostname,
        port: upstreamPort,
        path: path,
        headers: {
            Host: req.get("Host")
        }
    }
    http.get(options, (response) => response.pipe(res))
}

// Handle all requests that come through
app.get('*', (req, res) => {
    let path = url.parse(req.url).pathname
    if (path.startsWith('/hls')) {
        handleHLS(req, res)
    } else if (path.startsWith('/cache')) {
        res.json({size: cache.getCacheSize(), cache: cache.cache})
    } else {
        proxy(req, res)
    } 
})

// Start the server
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})