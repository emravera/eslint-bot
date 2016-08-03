'use strict'
const request = require('./request')
const API_ORIGIN = 'https://api.github.com'
module.exports = {
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.base A commit ref/tag/sha
   * @param {string} opt.head A commit ref/tag/sha
   * @param {function} done(err, details)
   */
  compare(opt, done) {
    if (!opt.repo) done(new request.Error(400, '.repo missing'))
    else if (!opt.base) done(new request.Error(400, '.base missing'))
    else if (!opt.head) done(new request.Error(400, '.head missing'))
    else request({
      url: `${API_ORIGIN}/repos/${opt.repo}/compare/${opt.base}...${opt.head}`
    }, done)
  },
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string?} opt.ref An commit ref/tag/sha
   * @param {string} opt.path e.g. "lib/index.js"
   * @param {function} done(err, buffer)
   */
  blob(opt, done) {
    if (!opt.repo) done(new request.Error(400, '.repo missing'))
    else if (!opt.path) done(new request.Error(400, '.path missing'))
    else request({
      url: `${API_ORIGIN}/repos/${opt.repo}/contents/${opt.path}`,
      query: {ref: opt.ref},
      parseResponse: 'raw',
      headers: {
        accept: 'application/vnd.github.v3.raw+json'
      }
    }, done)
  },
  /**
   * Use either {repo, parent} or {repo, sha, path, position}
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.text
   * @param {string} opt.sha The SHA of the commit to comment on
   * @param {string?} opt.path The file to comment on
   * @param {number?} opt.position The line index in the diff to comment on
   * @param {function} done(err, result)
   */
  comment(opt, done) {
    if (!opt.repo) done(new request.Error(400, '.repo missing'))
    else if (!opt.sha) done(new request.Error(400, '.sha missing'))
    else request({
      method: 'POST',
      url: `${API_ORIGIN}/repos/${opt.repo}/commits/${opt.sha}/comments`,
      body: {
        body: opt.text,
        path: opt.path,
        position: opt.position
      }
    }, done)
  },
}
