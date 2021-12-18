const express =  require('express')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tmp = require('tmp')
const cors = require('cors')
const { spawn } = require('child_process')

const upstream = 'http://localhost:8080'

const app = express()
app.use(cors())
const port = 8081

// Handle all requests that come through
app.get('*', (req, res) => {
    // Open temp file
    const tempFile = tmp.tmpNameSync() + '.ts'
    const fd = fs.openSync(tempFile, 'w')
    fs.closeSync(fd)
    // Open write stream
    const stream = fs.createWriteStream(tempFile)
    // Request the resource
    const request = http.get(upstream + req.url, function(response) {
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
})

// Start the server
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})