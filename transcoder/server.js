const express =  require('express')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tmp = require('tmp')
const cors = require('cors')
const { spawn } = require('child_process')
const url = require('url')

const upstream = 'http://localhost:8080'
const upstreamHostname = 'localhost'
const upstreamPort = 8080

const app = express()
app.use(cors())
const port = 8081

function handleSegmentRequest(req, res) {
    console.log(`Handling segment request ${req.url}`)
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
            // Let ffmpeg do its work
            const outFile = tmp.tmpNameSync() + '.ts'
            const child = spawn('ffmpeg', ['-i', tempFile, '-vcodec', 'libx264', '-acodec', 'copy', '-s', '640:480', 
                                            '-copyts', '-muxdelay', '0', outFile])
            child.on('close', () => {
                // Send the output
                res.sendFile(outFile)
                // Delete the files
                setTimeout(() => {
                    try {
                        fs.unlinkSync(tempFile)
                    } catch (err) {
                        console.log(err)
                    }
                    try {
                        fs.unlinkSync(outFile)
                    } catch (err) {
                        console.log(err)
                    }
                }, 5000)
            })
        })
    })
}

function handleMasterRequest(req, res) {
    console.log(`Handling Master request ${req.url}`)
    console.log(req.get("Host"))
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
    http.get(options, (response) => response.pipe(res))
}

// Handle all requests that come through
app.get('*', (req, res) => {
    let path = url.parse(req.url).pathname
    if (path.endsWith('.ts')) {
        handleSegmentRequest(req, res)
    } else if (path.endsWith('master.m3u8')) {
        handleMasterRequest(req, res)
    } else if (path.endsWith('index-v1-a1.m3u8')) {
        handleIndexRequest(req, res)
    }
})

// Start the server
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})