CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  subscription_until TEXT
);
