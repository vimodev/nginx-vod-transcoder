const express =  require('express')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tmp = require('tmp')
const cors = require('cors')
const { spawn } = require('child_process')
const url = require('url')

const settings = require('./settings.json')

const upstreamHostname = 'localhost'
const upstreamPort = 8080

const app = express()
app.use(cors())
const port = 8081

var cache = {}
var cacheSize = 0


const qualities = settings.qualities
console.log("USING SETTINGS:")
console.log(JSON.stringify(settings, null, 2))

function tickCache() {
    for (let c in cache) {
        cache[c].expiration -= settings.cache.interval
        if (cache[c].expiration <= 0) {
            cacheSize -= cache[c].size
            try {
                fs.unlinkSync(cache[c].file)
            } catch (err) {
                console.log(err)
            }
            delete cache[c]
        }
    }
    setTimeout(() => tickCache(), settings.cache.interval * 1000)
}

setTimeout(() => tickCache(), settings.cache.interval * 1000)

function removeOldestCacheEntry() {
    let minimum = settings.cache.expiration + 1
    let current = undefined
    for (let c in cache) {
        if (cache[c].expiration < minimum) {
            minimum = cache[c].expiration
            current = c
        }
    }
    cacheSize -= cache[current].size
    try {
        fs.unlinkSync(cache[current].file)
    } catch (err) {
        console.log(err)
    }
    delete cache[current]
}

async function addToCache(url, file) {
    console.log(`Adding ${url} to cache`)
    var stats = fs.statSync(file)
    cache[url] = {
        expiration: settings.cache.expiration,
        size: stats.size,
        file: file
    }
    cacheSize += stats.size
    while (cacheSize > settings.cache.maxSize * 1000000) {
        removeOldestCacheEntry()
    }
    console.log(`Cache size: ${cacheSize / 1000000} MB`)
}

// Pipe a stream into a string of utf-8
function streamToString (stream) {
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    })
}

function handleSegmentRequest(req, res) {
    console.log(`Handling segment request ${req.url}`)
    if (req.url in cache) {
        console.log(`Found ${req.url} in cache`)
        cache[req.url].expiration = settings.cache.expiration
        res.sendFile(cache[req.url].file)
        return
    }
    let quality = req.query.quality
    if (quality == undefined) quality = "Source"
    if (!(quality in qualities)) qual = "Source"
    let path = url.parse(req.url).pathname
    // Open temp file
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
    // Request the resource
    const request = http.get(options, function(response) {
        // Pipe the response to the file
        response.pipe(stream)
        // When done
        stream.on('finish', () => {
            // Close the stream
            stream.close()
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
            // Let ffmpeg do its work
            const outFile = tmp.tmpNameSync() + '.ts'
            const q = qualities[quality]
            const child = spawn('ffmpeg', ['-i', tempFile, '-vcodec', 'libx264', '-b:v', `${q.bitrate}`,'-acodec', 'copy', '-s', q.resolution.replace('x', ':'), 
                                            '-copyts', '-muxdelay', '0', outFile])
            child.on('close', () => {
                if (settings.cache.maxSize > 0) addToCache(req.url, outFile)
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

// Parse a line from m3u8 to get the bandwidth
function getBandwidthFromLine(line) {
    let fields = line.split(',')
    for (let i = 0; i < fields.length; i++) {
        if (fields[i].includes("BANDWIDTH")) {
            return Number(fields[i].split('=')[1])
        }
    }
}

// Modify the master m3u8 file to provide different qualities
function modifyMaster(m3u8) {
    let lines = m3u8.split('\n')
    let info = lines[1]
    let index = lines[2]
    let bitrate = getBandwidthFromLine(info)
    let output = "" + lines[0] + "\n"
    output += info + "\n"
    output += index + "?quality=Source" + "\n"
    for (const q in qualities) {
        let quality = qualities[q]
        if (quality.bitrate < bitrate) {
            output += "#EXT-X-STREAM-INF:BANDWIDTH=" + quality.bitrate + ",RESOLUTION=" + quality.resolution + "\n"
            output += index + `?quality=${q}` + "\n"
        }
    }
    return output
}

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
    http.get(options, (response) => {
        streamToString(response).then(function (result) {
            res.send(modifyMaster(result))
        })
    })
}

function modifyIndex(m3u8, quality) {
    if (quality == undefined) quality = "Source"
    let lines = m3u8.split('\n')
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(".ts")) {
            lines[i] += "?quality=" + quality
        }
    }
    return lines.join('\n')
}

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
        res.json({size: cacheSize, cache: cache})
    } else {
        proxy(req, res)
    } 
})

// Start the server
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})