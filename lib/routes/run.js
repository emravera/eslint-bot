const find = require('lodash/find');
const orderBy = require('lodash/orderBy');
const stylelint = require ('stylelint');
const fs = require('fs');
const cwd = require('path').resolve('config');
const relative = require('path').relative.bind(null, cwd);
const CLIEngine = require('eslint').CLIEngine;

const util = require('../util/helpers');
const github = require('../github/api');
const config = require('../../config');

const FILE_FILTER = new RegExp(process.env.FILE_FILTER);
const MAX_ROWS_PER_FILE = 300;
const verifier = util.createAuth('pull_request', ['opened', 'synchronize']);
const APPROVE_PR = 'APPROVE';

/**
 * Main method that runs eslint and comments automatically the PR
 *
 * - run eslint on any files modified by a pull-request
 * - calculate the range of the diff modified and filter the results
 * - post the results in a review-comment in the line of the finding.
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
  const files = diff.files.filter(el => FILE_FILTER.test(el.filename));
  if (!files.length) {
    this.body = 'No javascript files were modified';
    this.log.info(this.body);
    return;
  }

  // get eslint file from repo
  let eslintFilePath = '';
  const eslintFileLocation = `${config.eslint_file_path}${config.eslint_file_name}`;
  try {
    console.log(`location ${eslintFileLocation}`)
    const blobFile = yield github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: eslintFileLocation,
    });
    yield new Promise((resolve, reject) =>{
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
    this.log.info(`Error ${error.message} retrieving eslint file from  ${head.repo.full_name} in location ${eslintFileLocation} `);
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

  const fetchers = files.map(el => {
    this.log.info (`filename ${el.filename} ref ${head.ref}`);
    return github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename,
    });
  });
  const blobs = yield Promise.all(fetchers);

  let result = files.map((el, index) => ({
    name: el.filename,
    sha: el.sha,
    content: blobs[index].toString(),
  }))
    .map(file => cli.executeOnText(file.content, file.name).results[0]);

  // We format the results in a structure [{file: 'name', errors: []}, ...]
  result = format(result, filesRange, filesMap);

  if (!result) {
    this.body = `No problems were found for PR ${number}`;
    this.log.info(this.body);
    const listPRReviewsReq = {
      repo: base.repo.full_name,
      pr: number,
    };
    // List all PR reviews from linter users
    const reviewList = yield github.listPRReviews(listPRReviewsReq);
    console.log(`Review list ${JSON.stringify(reviewList)}`);
    const orderedReviewList = orderBy(reviewList, 'id', 'desc');
    const review = find(orderedReviewList, item => item.user.login === config.github_user);
    const reviewReq = {
      repo: base.repo.full_name,
      pr: number,
      event: APPROVE_PR,
      body: `Yey!! this PR doesn't contain linter errors`,
    };
    // if a review was found, sent a submit review for that specific review
    if (review) {
      // TODO submitting a review here is not working
      reviewReq.review_id = review.id;
      yield github.submitPRReview(reviewReq);
    }
    else {
      reviewReq.commit_id = head.sha;
      yield github.createPRReview(reviewReq);
    }
    return;
  }

  if (this.query.dry) {
    this.body = result;
    this.log.info(this.body);
    return;
  }

  // Iterate the results and add the comments with the found errors.
  for (let i = 0; i < result.length; i++) {
    console.log(`RESULT for file ${result[i].file}`);
    if (result[i].errors.length > 0) {
      for (let j = 0; j < result[i].errors.length; j++) {
        console.log(`ERRORS: ${JSON.stringify(result[i].errors[j])}`);
        const commentBody = `<details>${result[i].errors[j].message} (${result[i].errors[j].rule})</details>`;
        const commentReq = {
          repo: base.repo.full_name,
          pr: number,
          commit_id: head.sha,
          body: commentBody,
          path: result[i].file,
          position: result[i].errors[j].line,
        };

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
    count.errors += results[jj].errorCount;
    count.warnings += results[jj].warningCount;
    if (results[jj].errorCount + results[jj].warningCount === 0) continue;

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
  }

  if (count.errors + count.warnings < 1) return null;
  return fileDetails;
}

function formatRows(messages, fileRange, fileMap) {
  const rows = [];
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];

    // This logic only adds failures of the range of the code review.
    if (msg.line >= fileRange.range.from && msg.line <= fileRange.range.to) {
      if (!isBlacklistedRule(msg.ruleId)) {
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
    range.from = parseInt(regex[3],10);
    range.to = parseInt(regex[3],10) + parseInt(regex[4],10);
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
  return patchString.split('\n').reduce((lineMap, line) => {
    if (line.match(/^@@.*/)) {
      fileLineIndex = line.match(/\+[0-9]+/)[0].slice(1) - 1;
    } else {
      diffLineIndex++;
      if ('-' !== line[0]) {
        fileLineIndex++;
        if ('+' === line[0]) {
          lineMap[fileLineIndex] = diffLineIndex;
        }
      }
    }
    return lineMap;
  }, {});
};


/**
 * This method is to set up the blacklisted rules that has no sense to run in a diff
 *
 * @param rule
 */
function isBlacklistedRule(rule) {
  const rules = ['import/no-unresolved'];
  const isBlacklisted = rules.includes(rule);
  return isBlacklisted;
}

// Expose for testing
module.exports.format = format;
module.exports.formatRows = formatRows;
