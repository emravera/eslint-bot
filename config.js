module.exports = {
  github_user: process.env.GH_USER || 'ci-agent-thirdlove',
  github_password: process.env.GH_TOKEN || 'Thirdlove123!',
  user_agent: process.env.USER_AGENT || 'ESLintBot',
  log_level: process.env.LOG_LEVEL || 'info',
  port: process.env.PORT || '5000',
  shutdown_idle: process.env.SHUTDOWN_SOCKET_IDLE || '3000',
  shared_secret: process.env.SHARED_SECRET || '160_BIT_KEY',
  eslint_file_name: '.eslintrc',
  eslint_file_path: process.env.ESLINT_FILE_PATH || 'tools/',
};

