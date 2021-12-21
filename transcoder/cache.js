const fs = require('fs')

const settings = require('./settings.json')

// Static variables
var cache = {}
var cacheSize = 0

/**
 * Update the cache
 * This is called every `settings.cache.interval` seconds
 * and reduces each expiration by that amount
 * It removes cache entries when they expire.
 */
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
    // Set the interval for the next call again
    setTimeout(() => tickCache(), settings.cache.interval * 1000)
}

/**
 * Go through the cache and remove the entry
 * closest to expiration
 */
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

/**
 * Add the given file to the cache with the requesting url as key
 * @param {*} url The request url
 * @param {*} file The response file
 */
async function addToCache(url, file) {
    console.log(`Adding ${url} to cache`)
    var stats = fs.statSync(file)
    cache[url] = {
        expiration: settings.cache.expiration,
        size: stats.size,
        file: file
    }
    cacheSize += stats.size
    // Reduce the cache size to below the limit
    while (cacheSize > settings.cache.maxSize * 1000000) {
        removeOldestCacheEntry()
    }
    console.log(`Cache size: ${cacheSize / 1000000} MB`)
}

/**
 * Return the size of the cache in bytes
 */
function getCacheSize() {
    return cacheSize
}

module.exports = { cache, getCacheSize, tickCache, removeOldestCacheEntry, addToCache }