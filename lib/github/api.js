'use strict';
const mapValues = require('lodash/mapValues');
const API_ORIGIN = 'https://api.github.com';
const createAPIRequest = require('./create-api');

module.exports = mapValues({
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.base A commit ref/tag/sha
   * @param {string} opt.head A commit ref/tag/sha
   */
  compare: {
    required: ['repo', 'base', 'head'],
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/compare/${opt.base}...${opt.head}`
  },
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string?} opt.ref An commit ref/tag/sha
   * @param {string} opt.path e.g. "lib/index.js"
   * @return {Buffer}
   */
  blob: {
    required: ['repo', 'path'],
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/contents/${opt.path}`,
    queryProps: ['ref'],
    parseResponse: 'raw',
    headers: {
      accept: 'application/vnd.github.v3.raw+json',
    },
  },
  /**
   * Use either {repo, parent} or {repo, sha, path, position}
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.body
   * @param {string} opt.sha The SHA of the commit to comment on
   * @param {string?} opt.path The file to comment on
   * @param {number?} opt.position The line index in the diff to comment on
   */
  comment: {
    required: ['repo', 'sha', 'body'],
    method: 'POST',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/commits/${opt.sha}/comments`,
    bodyProps: ['body', 'path', 'position'],
  },
  /**
   * Used to comment on a PR in a specific file and line
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.body
   * @param {string} opt.commit_id The SHA of the commit to comment on
   * @param {string} opt.path The file to comment on
   * @param {number} opt.position The line index in the diff to comment on
   * @param {number} opt.pr The PR number to comment on
   */
  commentPR: {
    required: ['repo', 'body', 'commit_id', 'path', 'position', 'pr'],
    method: 'POST',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.pr}/comments`,
    bodyProps: ['repo', 'body', 'commit_id', 'path', 'position', 'pr'],
  },
  /**
   * Get the list of comments from a PR
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.body
   */
  getPRComments: {
    required: ['repo', 'pr'],
    method: 'GET',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.pr}/comments`,
  },
  /**
   * Create a PR review
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.body
   * @param {string} opt.commit_id The SHA of the commit that needs a review. Not using the latest commit SHA may render
   * your review comment outdated if a subsequent commit modifies the line you specify as the position.
   * Defaults to the most recent commit in the pull request when you do not specify a value
   * @param {number} opt.pr The PR number to create the review
   * @param {string} opt.event The review action you want to perform. The review actions include: APPROVE,
   * REQUEST_CHANGES, or COMMENT
   */
  createPRReview: {
    required: ['repo', 'event', 'commit_id', 'pr'],
    method: 'POST',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.pr}/reviews`,
    bodyProps: ['repo', 'body', 'commit_id', 'event', 'pr'],
  },
  /**
   * Submit a PR review
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.body The body text of the pull request review
   * @param {string} opt.review_id The review for which an event will be sent
   * @param {number} opt.pr The PR number to submit the review on
   * @param {string} opt.event The review action you want to perform. The review actions include: APPROVE,
   * REQUEST_CHANGES, or COMMENT
   */
  submitPRReview: {
    required: ['repo', 'event', 'review_id', 'pr', 'body'],
    method: 'POST',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.pr}/reviews/${opt.review_id}/events`,
    bodyProps: ['body', 'event'],
  },
  /**
   * Used to list reviews from a PR on a chronological order
   */
  listPRReviews: {
    method: 'GET',
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.pr}/reviews`,
  },
  /**
   * @param {string} opt.repo e.g. "cody-greene/eslint-bot"
   * @param {string} opt.id The pull-request number
   */
  pull: {
    required: ['repo', 'id'],
    url: opt => `${API_ORIGIN}/repos/${opt.repo}/pulls/${opt.id}`,
  }
}, createAPIRequest);
