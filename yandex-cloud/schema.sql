CREATE TABLE users (
    telegram_id Int64 NOT NULL,
    first_name Utf8,
    subscription_until Utf8,
    PRIMARY KEY (telegram_id)
);
