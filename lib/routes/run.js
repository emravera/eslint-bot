'use strict'
const cwd = require('path').resolve('config')
const relative = require('path').relative.bind(null, cwd)
const cli = new (require('eslint').CLIEngine)({cwd})
const util = require('../util/helpers')
const github = require('../github/api')
const FILE_FILTER = new RegExp(process.env.FILE_FILTER)
const MAX_ROWS_PER_FILE = 25
const verifier = util.createAuth('pull_request', ['opened', 'synchronize'])

/**
 * - run eslint on any files modified by a pull-request
 * - post the results in a review-comment
 */
module.exports = function* (next) {
  if (this.path !== '/run') return yield next
  yield verifier
  let base = this.request.body.pull_request.base
  let head = this.request.body.pull_request.head
  let diff = yield github.compare({
    repo: base.repo.full_name,
    base: base.sha,
    head: head.sha
  })
  let files = diff.files.filter(el => FILE_FILTER.test(el.filename))
  if (!files.length) {
    this.body = 'no javascript files were modified'
    this.log.info(this.body)
    return
  }
  let fetchers = files.map(el => github.blob({
    repo: head.repo.full_name,
    ref: head.sha,
    path: el.filename
  }))
  let blobs = yield Promise.all(fetchers)
  let result = files.map((el, index) => ({
    name: el.filename,
    sha: el.sha,
    content: blobs[index].toString()
  }))
  .map(file => cli.executeOnText(file.content, file.name).results[0])
  result = format(result)
  if (!result) {
    this.body = 'no problems'
    this.log.info(this.body)
    return
  }
  result = `${base.sha}...${head.sha}\n` + result
  if (this.query.dry) {
    this.body = result
    this.log.info(this.body)
    return
  }
  let comment = yield github.comment({
    repo: base.repo.full_name,
    sha: head.sha,
    body: result
  })
  this.body = comment.html_url
  this.log.info(this.body)
}

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
      msg.ruleId || '',
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
