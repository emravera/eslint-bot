'use strict'
const zlib = require('zlib')
const once = require('lodash/once')
const request = require('@cody-greene/request')
const crypto = require('crypto')
const SHARED_SECRET = process.env.SHARED_SECRET

/**
 * @param {Buffer) buf
 * @returns {string} Url-safe base64 encoding
 */
function toSafe64(buf) {
  return buf.toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=+$/, '')
}

/**
 * Gracefully exit with SIGINT (^c) or SIGTERM
 * Forcefully exit with SIGQUIT (^\)
 * @param {function} fn Use this to close any open connections or timers so the process can exit
 */
function addShutdownListener(fn) {
  fn = once(fn)
  process.on('SIGINT', fn).on('SIGTERM', fn)
}

/**
 * Constant time equality between Buffers.
 * It shortcuts on length, but that doesn't leak the contents
 */
function equal(actual, expected) {
  if (!actual || !expected) return false
  let acc = 0
  let index = actual.length
  if (index !== expected.length) return false
  while (index--) acc |= actual[index] ^ expected[index]
  return !acc
}

// Generate a random 24-character (144-bit) string
function token() {
  return toSafe64(crypto.randomBytes(18))
}

function sign(payload) {
  return 'sha1=' + crypto.createHmac('sha1', SHARED_SECRET).update(payload).digest('hex')
}

function verify(signature, body) {
  var expected = sign(body)
  return equal(signature, expected)
}

/**
 * Perform the necessary verification for a GitHub webhook
 * @param {string} eventName https://developer.github.com/webhooks/#events
 * @param {string[]} actions List of event subtypes to accept
 * @param {function} callback(logger, responseBody)
 */
function createAuth(eventName, actions, callback) {
  return function authMiddleware(req, res) {
    const reqName = req.headers['x-github-event']
    const reqSignature = req.headers['x-hub-signature']
    req.resume() // Release any data even if we don't use it
    if (req.method !== 'POST') {
      res.send(400, 'method not supported')
    }
    else if (reqName !== eventName) {
      res.send(403, `event not supported: "${reqName}"`)
    }
    else collect(req, (err, body) => {
      if (err) {
        res.send(500, err.message)
      }
      else if (!verify(reqSignature, body)) {
        res.send(403, 'invalid signature')
      }
      else if (!(body = request.parseJSON(body.toString()))) {
        res.send(400, 'invalid JSON request body')
      }
      else if (actions.indexOf(body.action) === -1) {
        res.send(403, `action not supported: "${reqName}.${body.action}"`)
      }
      else {
        res.send(202)
        callback(req.log, body)
      }
    })
  }
}

/**
 * Condense a stream of data into a single buffer
 */
function collect(res, done) {
  let chunks = []
  res.on('error', done)
  if (['gzip', 'deflate'].indexOf(res.headers['content-encoding']) !== -1) {
    res = res.pipe(zlib.createUnzip()).on('error', done)
  }
  res.on('data', chunk => chunks.push(chunk))
  res.on('end', () => done(null, Buffer.concat(chunks)))
}

module.exports = {
  addShutdownListener,
  collect,
  createAuth,
  equal,
  sign,
  toSafe64,
  token,
  verify,
}
