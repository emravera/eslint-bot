'use strict'
const async = require('async')
const cwd = require('path').resolve('config')
const relative = require('path').relative.bind(null, cwd)
const cli = new (require('eslint').CLIEngine)({cwd})
const util = require('../util/helpers')
const github = require('../github/api')
const FILE_FILTER = new RegExp(process.env.FILE_FILTER)
const MAX_ROWS_PER_FILE = 25

/**
 * - run eslint on any files modified by a pull-request
 * - post the results in a review-comment
 */
module.exports = util.createAuth('pull_request', ['opened', 'synchronize'], function (log, res) {
  let base = res.pull_request.base
  let head = res.pull_request.head
  github.compare({
    repo: base.repo.full_name,
    base: base.sha,
    head: head.sha
  }, (err, res) => {
    if (err) return log.warn(err)
    let files = res.files.filter(el => FILE_FILTER.test(el.filename))
    if (!files.length) return log.warn('stop: no javascript files were modified')
    let fetchers = files.map(el => github.blob.bind(null, {
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename
    }))
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
      else github.comment({
        repo: base.repo.full_name,
        sha: head.sha,
        text: `${base.sha}...${head.sha}\n` + result
      }, (err, res) => {
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
    if (results[jj].errorCount + results[jj].warningCount === 0) continue
    let fileName = relative(results[jj].filePath)
    let messagesCount = results[jj].messages.length
    let detail = null
    if (messagesCount > MAX_ROWS_PER_FILE) {
      detail = `...omitted ${messagesCount} problems...`
    }
    else {
      detail = formatRows(results[jj].messages)
    }
    details.push(fileName + '\n' + detail)
  }
  if (count.errors + count.warnings < 1) return null
  let summary = `${count.errors + count.warnings} problems (${count.errors} errors, ${count.warnings} warnings)`
  return `<details><summary><b>${summary}</b></summary>\n\`\`\`\n${details.join('\n\n')}\n\`\`\`\n</details>`
}

function formatRows(messages) {
  let rows = []
  for (let index = 0; index < messages.length; index++) {
    let msg = messages[index]
    rows.push([
      msg.severity === 2 ? 'err' : 'warn',
      msg.ruleId,
      `${msg.line}:${msg.column}`,
      msg.message
    ])
  }
  return toColumns(rows)
}

function toColumns(rows) {
  let width = rows.length ? rows[0].length : 0
  for (let jj = 0; jj < width - 1; jj++) {
    let max = 0
    for (let ii = 0; ii < rows.length; ii++) {
      if (rows[ii][jj].length > max) max = rows[ii][jj].length
    }
    for (let kk = 0; kk < rows.length; kk++) {
      rows[kk][jj] += ' '.repeat(max - rows[kk][jj].length)
    }
  }
  for (let jj = 0; jj < rows.length; jj++) {
    rows[jj] = rows[jj].join(' ')
  }
  return rows.join('\n')
}

// Expose for testing
module.exports.format = format
module.exports.formatRows = formatRows
module.exports.toColumns = toColumns
