const find = require('lodash/find');
const orderBy = require('lodash/orderBy');
const stylelint = require('stylelint');
const fs = require('fs');
const cwd = require('path').resolve('config');
const relative = require('path').relative.bind(null, cwd);
const CLIEngine = require('eslint').CLIEngine;

const util = require('../util/helpers');
const github = require('../github/api');
const config = require('../../config');

const JS_FILE_FILTER = new RegExp('\.(js|jsx)$');
const CSS_FILTER = new RegExp('\.(css|scss)$');

const MAX_ROWS_PER_FILE = 300;
const verifier = util.createAuth('pull_request', ['opened', 'synchronize']);
const APPROVE_PR = 'APPROVE';

/**
 * Main method that runs eslint and comments automatically the PR
 *
 * - run eslint on any files modified by a pull-request
 * - run csslint for the files in the pull-request
 * - calculate the range of the diff modified and filter the results
 * - post the results in a review-comment in the line of the finding.
 * - if no findings approve the PR automaticallys
 */
module.exports = function* (next) {
  if (this.path !== '/run') return yield next;

  yield verifier;
  const base = this.request.body.pull_request.base;
  const head = this.request.body.pull_request.head;
  const number = this.request.body.pull_request.number;
  const diff = yield github.compare({
    repo: base.repo.full_name,
    base: base.sha,
    head: head.sha,
  });

  // Get the CSS and Js files to be analyzed
  const files = diff.files.filter(el => JS_FILE_FILTER.test(el.filename));
  const cssFiles = diff.files.filter(el => CSS_FILTER.test(el.filename));

  if (!files.length && !cssFiles.length) {
    this.body = 'No files were modified';
    this.log.info(this.body);
    return;
  }

  // Eslintrc file configuration
  let eslintFilePath = '';
  const eslintFileLocation = `${config.eslint_file_path}${config.eslint_file_name}`;
  try {
    const blobFile = yield github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: eslintFileLocation,
    });
    yield new Promise((resolve, reject) => {
      const savedFilePath = `${config.eslint_file_name}TMP`;
      fs.writeFile(savedFilePath, blobFile.toString(), (err) => {
        if (err) {
          console.log(`Eslint file couldn't be saved ${err.message}`);
          reject(err);
        } else {
          console.log(`Eslint file saved from ${eslintFileLocation}`);
          eslintFilePath = savedFilePath;
          resolve(eslintFilePath);
        }
      });
    });
  } catch (error) {
    this.log.info(`Error ${error.message} retrieving eslint file from  ${head.repo.full_name} in location ${eslintFileLocation}`);
  }

  const cliEngineOptions = { useEslintrc: true };
  // Add an external eslintRc file from the repo
  if (eslintFilePath !== '') {
    cliEngineOptions.configFile = eslintFilePath;
  }
  const cli = new CLIEngine(cliEngineOptions);


  const filesRange = [];
  files.map((el) => {
    const range = getModifiedRangeLines(el);
    filesRange.push({
      range,
      number,
      filename: el.filename,
      repo: head.repo.full_name,
      commit_id: base.sha,
    });
  });

  // Map the file line with the diff line of Github
  const filesMap = [];
  files.map((el) => {
    const fileMap = getLineMapFromPatchString(el.patch);
    filesMap.push(fileMap);
  });

  const fetchers = files.map((el) => {
    this.log.info(`Processing JS File: ${el.filename} REF: ${head.ref}`);
    return github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename,
    });
  });
  const blobs = yield Promise.all(fetchers);

  // JS Analysis
  let result = files.map((el, index) => ({
    name: el.filename,
    sha: el.sha,
    content: blobs[index].toString(),
  }))
    .map(file => cli.executeOnText(file.content, file.name).results[0]);

  // We format the results in a structure [{file: 'name', errors: []}, ...]
  result = format(result, filesRange, filesMap);

  // CSS Analysis - TODO: Refactor to improve now doing for working only purposes.
  const fetchersCSS = cssFiles.map((el) => {
    this.log.info(`Processing CSS File: ${el.filename} REF: ${head.ref}`);
    return github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename,
    });
  });
  const blobsCSS = yield Promise.all(fetchersCSS);
  const reportCss = [];
  for (let c = 0; c < cssFiles.length; c++) {
    const code = blobsCSS[c].toString();
    let resultCSS = yield stylelint.lint({ code, formatter: 'json' });
    if (resultCSS.errored) {
      const errors = resultCSS.results[0].warnings;
      if (errors.length > 0) {
        resultCSS = pruneCssResults(cssFiles[c], errors);
        reportCss.push(resultCSS);
      }
    }
  }

  // List all PR reviews from linter users to approve or dismiss it
  const listPRReviewsReq = {
    repo: base.repo.full_name,
    pr: number,
  };
  const reviewList = yield github.listPRReviews(listPRReviewsReq);
  const orderedReviewList = orderBy(reviewList, 'id', 'desc');
  const review = find(orderedReviewList, item => item.user.login === config.github_user);

  // If no errors Approve the PR automatically
  if (!result && reportCss.length === 0) {
    this.body = `No problems were found for PR ${number}`;
    const reviewReq = {
      repo: base.repo.full_name,
      pr: number,
      event: APPROVE_PR,
      body: 'Yey!! this PR doesn\'t contain linter errors',
    };
    // If a review was found, sent a submit review for that specific review
    if (review) {
      // TODO: submitting a review here when has comments is not working
      reviewReq.review_id = review.id;
      reviewReq.commit_id = head.sha;
      yield github.submitPRReview(reviewReq);
    } else {
      reviewReq.commit_id = head.sha;
      yield github.createPRReview(reviewReq);
    }
    return;
  }

  // Merge the results and get the model ready to comment
  if (reportCss.length > 0) {
    if (!result) result = [];
    result = result.concat(reportCss);
  }

  // Get existent comments
  const listPRRCommentsReq = {
    repo: base.repo.full_name,
    pr: number,
  };
  const reviewComments = yield github.getPRComments(listPRRCommentsReq);

  // Iterate the results and add the comments with the found errors.
  for (let i = 0; i < result.length; i++) {
    console.log(`RESULT for file ${result[i].file}`);
    if (result[i].errors.length > 0) {
      for (let j = 0; j < result[i].errors.length; j++) {
        console.log(`ERRORS: ${JSON.stringify(result[i].errors[j])}`);
        const commentBody = `<summary><b>[${result[i].errors[j].rule}]: </b>${result[i].errors[j].message}</summary>`;
        const commentReq = {
          repo: base.repo.full_name,
          pr: number,
          commit_id: head.sha,
          body: commentBody,
          path: result[i].file,
          position: result[i].errors[j].line,
        };
        const existentComment = reviewComments.find(comment => comment.body === commentReq.body
            && commentReq.position === comment.position && commentReq.path === comment.path);
        // If the comment alreay exists. Skip it
        if (existentComment) {
          this.log.info(`SKIP: The comment ${commentReq.body} already exists in position ${commentReq.position} for file ${commentReq.path}`);
          continue;
        }
        // Comment to the PR
        try {
          const comment = yield github.commentPR(commentReq);
          console.log(`URL: ${comment.html_url}`);
        } catch (e) {
          console.log(`SKIPPED COMMENT ${JSON.stringify(e.message)}`);
          continue;
        }
      }
    }
  }

  // Return result
  this.body = result;
};

/**
 * Convert some ESLint results into a GitHub comment
 * @param {array} results
 * @return {array}
 */
function format(results, filesRange, filesMap) {
  const count = { errors: 0, warnings: 0 };
  const fileDetails = [];

  for (let jj = 0; jj < results.length; jj++) {
    if (!results[jj]) {
      continue;
    }

    const messagesCount = results[jj].messages.length;
    let detail = null;
    const descriptor = {};

    if (messagesCount > MAX_ROWS_PER_FILE) {
      detail = `OMITTED:  ${messagesCount} found! Too much problems...`;
    } else {
      detail = formatRows(results[jj].messages, filesRange[jj], filesMap[jj]);
    }
    descriptor.file = filesRange[jj].filename;
    descriptor.errors = detail;
    fileDetails.push(descriptor);
    // Sum error counts
    count.errors += detail.length;
  }

  if (count.errors < 1) return null;
  return fileDetails;
}

/**
 * Returns the eslint errors formatted in a model form to comment the PR
 *
 * @param messages
 * @param fileRange
 * @param fileMap
 * @returns {Array}
 */
function formatRows(messages, fileRange, fileMap) {
  const rows = [];
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];

    // This logic only adds failures of the range of the code review.
    if (msg.line >= fileRange.range.from && msg.line <= fileRange.range.to) {
      // If not blacklisted and in the lines diff
      if (!isBlacklistedRule(msg.ruleId) && fileMap[msg.line]) {
        rows.push({
          type: msg.severity === 2 ? 'ERROR' : 'WARN',
          rule: msg.ruleId || '',
          line: fileMap[msg.line],
          column: msg.column,
          message: msg.message,
        });
      }
    }
  }
  return rows;
}

/**
 * This method extracts from the patch file the lines modified.
 * @param file
 * @returns {object}
 */
function getModifiedRangeLines(file) {
  const range = {};
  if (file.patch) {
    const extract = file.patch.split('@@');
    const regex = extract[1].trim().match('^-(\\d+),?(\\d*) \\+(\\d+),?(\\d*)$');
    range.from = parseInt(regex[3], 10);
    range.to = parseInt(regex[3], 10) + parseInt(regex[4], 10);
  }
  return range;
}

/**
 * Compute a mapping object for the relationship 'file line number' <-> 'Github's diff view line number'.
 * This is necessary for the comments, as Github API asks to specify the line number in the diff view to attach an inline comment to.
 * If a file line is not modified, then it will not appear in the diff view, so it is not taken into account here.
 * The linter will therefore only mention warnings for modified lines.
 *
 * @param  {String}   patchString               The git patch string.
 * @return {Object} An object shaped as follows : {'file line number': 'diff view line number'}.
 */
const getLineMapFromPatchString = (patchString) => {
  let diffLineIndex = 0;
  let fileLineIndex = 0;
  if (!patchString) return {};
  return patchString.split('\n').reduce((lineMap, line) => {
    if (line.match(/^@@.*/)) {
      fileLineIndex = line.match(/\+[0-9]+/)[0].slice(1) - 1;
    } else {
      diffLineIndex++;
      if (line[0] !== '-') {
        fileLineIndex++;
        if (line[0] === '+') {
          lineMap[fileLineIndex] = diffLineIndex;
        }
      }
    }
    return lineMap;
  }, {});
};

/**
 * Takes the file object and results from linter and generates error object of the model
 *
 * @param file
 * @param results
 * @returns {{file: string, errors: Array}}
 */
function pruneCssResults(file, results) {
  const range = getModifiedRangeLines(file);
  const resultCss = { file: file.filename, errors: [] };
  const fileMap = getLineMapFromPatchString(file.patch);

  for (let i = 0; i < results.length; i++) {
    if (results[i].line >= range.from && results[i].line <= range.to) {
      if (fileMap[results[i].line]) {
        const err = {
          type: results[i].severity === 'error' ? 'ERROR' : 'WARN',
          rule: results[i].rule || '',
          line: fileMap[results[i].line],
          column: results[i].column,
          message: results[i].text,
        };
        resultCss.errors.push(err);
      }
    }
  }

  return resultCss;
}

/**
 * Checks blacklisted rules for ESLINT that has no sense to run in a diff
 *
 * @param rule
 */
function isBlacklistedRule(rule) {
  const rules = ['import/no-unresolved'];
  const isBlacklisted = rules.includes(rule);
  return isBlacklisted;
}

// TODO: fix the testing
module.exports.format = format;
module.exports.formatRows = formatRows;
