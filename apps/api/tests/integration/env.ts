// Must be imported FIRST before any module that evaluates src/config/index.ts
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '4099';
process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://fincore:fincore_dev@localhost:55432/fincore_test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6379';
process.env['ACCESS_TOKEN_SECRET'] = 'test_access_secret_at_least_32_characters_long';
process.env['REFRESH_TOKEN_SECRET'] = 'test_refresh_secret_at_least_32_characters_long';
process.env['ACCESS_TOKEN_EXPIRY'] = '15m';
process.env['REFRESH_TOKEN_EXPIRY'] = '7d';
process.env['RISK_SERVICE_URL'] = process.env['RISK_SERVICE_URL'] || 'http://127.0.0.1:8999';
process.env['RISK_SERVICE_TOKEN'] = 'test_risk_service_token';
process.env['SANDBOX_WEBHOOK_SECRET'] = 'test_sandbox_webhook_secret_12345';
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['LOG_LEVEL'] = 'error';
