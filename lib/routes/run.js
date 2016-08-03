'use strict'
const async = require('async')
const cwd = require('path').resolve('config')
const relative = require('path').relative.bind(null, cwd)
const cli = new (require('eslint').CLIEngine)({cwd})
const util = require('../util/helpers')
const github = require('../github/api')
const FILE_FILTER = new RegExp(process.env.FILE_FILTER)

/**
 * - run eslint on any files modified by a pull-request
 * - post the results in a review-comment
 */
module.exports = createAuth('pull_request', ['opened', 'synchronize'], function (log, res) {
  let base = res.pull_request.base.sha
  let head = res.pull_request.head.sha
  let repo = res.pull_request.head.repo.full_name
  log.debug({repo, base, head}, 'processing')
  github.compare({repo, base, head}, function (err, res) {
    if (err) return log.warn(err)
    let files = res.files.filter(el => FILE_FILTER.test(el.filename))
    if (!files.length) return log.warn('stop: no javascript files were modified')
    let fetchers = files.map(el => github.blob.bind(null, {repo, ref: head, path: el.filename}))
    async.parallel(fetchers, (err, blobs) => {
      if (err) return log.warn(err)
      let result = files.map((el, index) => ({
        name: el.filename,
        sha: el.sha,
        content: blobs[index].toString()
      }))
      .map(file => cli.executeOnText(file.content, file.name).results[0])
      result = format(result)
      if (!result) log.info('done: no problems')
      else github.comment({repo, sha: head, text: result}, (err, res) => {
        if (err) log.warn(err)
        else log.info('done: ' + res.html_url)
      })
    })
  })
})

/**
 * Convert some ESLint results into a GitHub comment
 * @param {array} results
 * @return {string|null}
 */
function format(results) {
  let count = {errors: 0, warnings: 0}
  let details = []
  for (let jj = 0; jj < results.length; jj++) {
    count.errors += results[jj].errorCount
    count.warnings += results[jj].warningCount
    let detail = [relative(results[jj].filePath)]
    for (let ii = 0; ii < results[jj].messages.length; ii++) {
      let msg = results[jj].messages[ii]
      detail.push(`  ${msg.severity === 2 ? 'err' : 'warn'} ${msg.line}:${msg.column} ${msg.message} [${msg.ruleId}]`)
    }
    details.push(detail.join('\n'))
  }
  if (count.errors + count.warnings < 1) return null
  let summary = `${count.errors + count.warnings} problems (${count.errors} errors, ${count.warnings} warnings)`
  return `<details><summary><b>${summary}</b></summary>\n\`\`\`\n${details.join('\n')}\n\`\`\`\n</details>`
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
    else collect(req, body => {
      if (!util.verify(reqSignature, body)) {
        res.send(403, 'invalid signature')
      }
      else if (!(body = util.parseJSON(body.toString()))) {
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

function collect(src, cb) {
  let chunks = []
  src.on('data', chunk => chunks.push(chunk))
  src.on('end', () => cb(Buffer.concat(chunks)))
}
