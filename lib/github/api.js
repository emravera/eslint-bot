'use strict'
const request = require('./request')
const API_ORIGIN = 'https://api.github.com'
module.exports = {
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.base A commit ref/tag/sha
   * @param {string} opt.head A commit ref/tag/sha
   */
  compare(opt) {
    if (!opt.repo) return Promise.reject(new request.Error(400, '.repo missing'))
    if (!opt.base) return Promise.reject(new request.Error(400, '.base missing'))
    if (!opt.head) return Promise.reject(new request.Error(400, '.head missing'))
    return request({
      url: `${API_ORIGIN}/repos/${opt.repo}/compare/${opt.base}...${opt.head}`
    })
  },
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string?} opt.ref An commit ref/tag/sha
   * @param {string} opt.path e.g. "lib/index.js"
   * @return {Buffer}
   */
  blob(opt) {
    if (!opt.repo) return Promise.reject(new request.Error(400, '.repo missing'))
    if (!opt.path) return Promise.reject(new request.Error(400, '.path missing'))
    return request({
      url: `${API_ORIGIN}/repos/${opt.repo}/contents/${opt.path}`,
      query: {ref: opt.ref},
      parseResponse: 'raw',
      headers: {
        accept: 'application/vnd.github.v3.raw+json'
      }
    })
  },
  /**
   * Use either {repo, parent} or {repo, sha, path, position}
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.text
   * @param {string} opt.sha The SHA of the commit to comment on
   * @param {string?} opt.path The file to comment on
   * @param {number?} opt.position The line index in the diff to comment on
   */
  comment(opt) {
    if (!opt.repo) return Promise.reject(new request.Error(400, '.repo missing'))
    if (!opt.sha) return Promise.reject(new request.Error(400, '.sha missing'))
    return request({
      method: 'POST',
      url: `${API_ORIGIN}/repos/${opt.repo}/commits/${opt.sha}/comments`,
      body: {
        body: opt.text,
        path: opt.path,
        position: opt.position
      }
    })
  },
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.id The pull-request number
   */
  pull(opt) {
    if (!opt.repo) return Promise.reject(new request.Error(400, '.repo missing'))
    if (!opt.id) return Promise.reject(new request.Error(400, '.id missing'))
    return request({
      url: `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.id}`,
    })
  }
}
