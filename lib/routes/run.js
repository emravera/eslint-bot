'use strict';
const patchAditions = require('git-patch-additions');
const cwd = require('path').resolve('config');
const relative = require('path').relative.bind(null, cwd);
const cli = new (require('eslint').CLIEngine)({ useEslintrc: true });
const util = require('../util/helpers');
const github = require('../github/api');
const FILE_FILTER = new RegExp(process.env.FILE_FILTER);
const MAX_ROWS_PER_FILE = 80;
const verifier = util.createAuth('pull_request', ['opened', 'synchronize']);

/**
 * - run eslint on any files modified by a pull-request
 * - post the results in a review-comment
 */
module.exports = function* (next) {
  if (this.path !== '/run') return yield next;

  yield verifier;
  let base = this.request.body.pull_request.base;
  let head = this.request.body.pull_request.head;
  let number = this.request.body.pull_request.number;
  let diff = yield github.compare({
    repo: base.repo.full_name,
    base: base.sha,
    head: head.sha,
  });

  //console.log(`DIFF: ${JSON.stringify(diff)}`);

  const files = diff.files.filter(el => FILE_FILTER.test(el.filename));
  if (!files.length) {
    this.body = 'No javascript files were modified';
    this.log.info(this.body);
    return;
  }

  //console.log(`FILES: ${JSON.stringify(files)}`);

  const filesRange = [];
  files.map((el, index) => {
    const range = getModifiedRangeLines(el);
    filesRange.push({
      filename: el.filename,
      range,
    });
  });

  //console.log(`FILES RANGE: ${JSON.stringify(filesRange)}`);

  let fetchers = files.map(el => {
    this.log.info (`filename ${el.filename} ref ${head.ref}`);
    return github.blob({
      repo: head.repo.full_name,
      ref: head.sha,
      path: el.filename,
    });
  });
  let blobs = yield Promise.all(fetchers);

  let result = files.map((el, index) => ({
    name: el.filename,
    sha: el.sha,
    content: blobs[index].toString(),
  }))
    .map(file => cli.executeOnText(file.content, file.name).results[0]);

  // TODO: Here we will need to use this result and create one comment per error in each line.
  result = format(result, filesRange);

  console.log(`RESULT: ${JSON.stringify(result)}`);

  if (!result) {
    this.body = 'No problems found';
    this.log.info(this.body);
    return;
  }

  //result = `${base.sha}...${head.sha}\n ${result}`;

  if (this.query.dry) {
    this.body = result;
    this.log.info(this.body);
    return;
  }

  /*
  const commentReq = {
    repo: base.repo.full_name,
    pr: number,
    commit_id: head.sha,
    body: result,
    path: 'src/client.js',
    position: 1,
  };

  // Comment to the PR
  const comment = yield github.commentPR(commentReq);
  this.body = comment.html_url;
  this.log.info(this.body);
  */
};

/**
 * Convert some ESLint results into a GitHub comment
 * @param {array} results
 * @return {string|null}
 */
function format(results, filesRange) {
  const count = { errors: 0, warnings: 0 };
  const details = [];
  for (let jj = 0; jj < results.length; jj++) {
    if (!results[jj]) {
      continue;
    }
    count.errors += results[jj].errorCount;
    count.warnings += results[jj].warningCount;
    if (results[jj].errorCount + results[jj].warningCount === 0) continue;

    let fileName = relative(results[jj].filePath);
    let messagesCount = results[jj].messages.length;
    let detail = null;

    if (messagesCount > MAX_ROWS_PER_FILE) {
      detail = `...omitted ${messagesCount} too much problems...`;
    }
    else {
      detail = formatRows(results[jj].messages, filesRange[jj]);
    }
    details.push(fileName + '\n' + detail);
  }
  if (count.errors + count.warnings < 1) return null;
  const summary = `${count.errors + count.warnings} problems (${count.errors} errors, ${count.warnings} warnings)`;
  return `<details><summary><b>${summary}</b></summary>\n\`\`\`\n${details.join('\n\n')}\n\`\`\`\n</details>`;
}

function formatRows(messages, fileRange) {
  const rows = [];
  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index];
    // This logic only adds failures of the range of the code review.
    if (msg.line >= fileRange.range.from && msg.line <= fileRange.range.to) {
      rows.push([
        msg.severity === 2 ? 'ERROR' : 'WARN',
        msg.ruleId || '',
        `${msg.line}:${msg.column}`,
        msg.message,
      ]);
    }
  }
  return toColumns(rows);
}

function toColumns(rows) {
  let width = rows.length ? rows[0].length : 0;
  for (let jj = 0; jj < width - 1; jj++) {
    let max = 0
    for (let ii = 0; ii < rows.length; ii++) {
      if (rows[ii][jj].length > max) max = rows[ii][jj].length;
    }
    for (let kk = 0; kk < rows.length; kk++) {
      rows[kk][jj] += ' '.repeat(max - rows[kk][jj].length);
    }
  }
  for (let jj = 0; jj < rows.length; jj++) {
    rows[jj] = rows[jj].join(' ');
  }
  return rows.join('\n');
}

/**
 * This method extracts from the patch file the lines modified.
 * @param file
 * @returns {object}
 */
function getModifiedRangeLines(file) {
  let lines;
  if (file.patch) {
    const extract = file.patch.split('@@');
    lines = extract[1].trim().match('^-(\\d+),?(\\d*) \\+(\\d+),?(\\d*)$')[3];
    lines = parseInt(lines);
  }
  return { from: lines, to: lines + 14 };
}

/**
 * This method adds a comment to a file in a pr with the message in the body
 * @param repo
 * @param pr
 * @param commit_id
 * @param body
 * @param path
 * @param position
 */
function addComment(repo, pr, commit_id, body, path, position) {
  const commentReq = {
    repo,
    pr,
    commit_id,
    body,
    path,
    position,
  };

}


// Expose for testing
module.exports.format = format;
module.exports.formatRows = formatRows;
