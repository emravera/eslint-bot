'use strict'
const zlib = require('zlib');
const once = require('lodash/once');
const request = require('honeybee');
const github = require('../github/api');
const fs = require('fs');
const crypto = require('crypto');
const config = require ('../../config');
const SHARED_SECRET = config.shared_secret;

/**
 * @param {Buffer) buf
 * @returns {string} Url-safe base64 encoding
 */
function toSafe64(buf) {
  return buf.toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')
    .replace(/=+$/, '');
}

/**
 * Gracefully exit with SIGINT (^c) or SIGTERM
 * Forcefully exit with SIGQUIT (^\)
 * @param {function} fn Use this to close any open connections or timers so the process can exit
 */
function addShutdownListener(fn) {
  fn = once(fn);
  process.on('SIGINT', fn).on('SIGTERM', fn);
}

/**
 * Constant time equality between Buffers.
 * It shortcuts on length, but that doesn't leak the contents
 */
function equal(actual, expected) {
  if (!actual || !expected) return false;
  let acc = 0;
  let index = actual.length;
  if (index !== expected.length) return false;
  while (index--) acc |= actual[index] ^ expected[index]
  return !acc
}

// Generate a random 24-character (144-bit) string
function token() {
  return toSafe64(crypto.randomBytes(18));
}

function sign(payload) {
  return 'sha1=' + crypto.createHmac('sha1', SHARED_SECRET).update(payload).digest('hex');
}

function verify(signature, body) {
  const expected = sign(body);
  return equal(signature, expected)
}

/**
 * Perform the necessary verification for a GitHub webhook
 * @param {string} eventName https://developer.github.com/webhooks/#events
 * @param {string[]} actions List of event subtypes to accept
 * @return {function*}
 */
function createAuth(eventName, actions) {
  return function* verifier() {
    // let reqName = this.headers['x-github-event']
    //let reqSignature = this.headers['x-hub-signature']
    let req = this.req;
    req.resume(); // Release any data even if we don't use it
    if (req.method !== 'POST') {
      this.throw('method not supported', 400);
    }
    // if (reqName !== eventName) {
    //   this.throw(`event not supported: "${reqName}" eventName ${eventName}`, 403)
    // }
    let body = yield collect(req);
    // if (!verify(reqSignature, body)) {
    //   this.throw('invalid signature', 403)
    // }
    if (!(body = request.parseJSON(body.toString()))) {
      this.throw('invalid JSON request body', 400);
    }
    if (actions.indexOf(body.action) === -1) {
      // TODO: Review this 200 is not the best but is making this works.
      this.throw(`action not supported: ".${body.action}"`, 200);
    }
    this.request.body = body;
  }
}

/**
 * Condense a stream of data into a single buffer
 */
function collect(req) {
  const chunks = [];
  return new Promise(function(resolve, reject) {
    req.on('error', reject);
    if (['gzip', 'deflate'].indexOf(req.headers['content-encoding']) !== -1) {
      req = req.pipe(zlib.createUnzip()).on('error', reject);
    }
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function fetchFileFromRepo(repoFullName, headSha) {
  return function* fetchRemoteFile(filePath, fileName) {
    const fileLocation = `${filePath}${fileName}`;
    try {
      const blobFile = yield github.blob({
        repo: repoFullName,
        ref: headSha,
        path: fileLocation,
      });
      return new Promise((resolve, reject) => {
        const savedFilePath = `${fileName}TMP`;
        fs.writeFile(savedFilePath, blobFile.toString(), (err) => {
          if (err) {
            console.log(`File couldn't be saved ${err.message}`);
            reject(err);
          } else {
            console.log(`File saved from ${fileLocation}`);
            resolve(savedFilePath);
          }
        });
      }); 
    } catch (error) {
      //this.log.info(`Error ${error.message} retrieving file from  ${repoFullName} in location ${fileLocation}`);
      console.error(`Error ${error.message} retrieving file from  ${repoFullName} in location ${fileLocation}`);
    }
  }
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
  fetchFileFromRepo,
}
