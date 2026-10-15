// 整合測試一律使用獨立的測試資料庫，避免動到開發或正式資料
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123";
