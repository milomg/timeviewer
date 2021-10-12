-- Add migration script here
CREATE TABLE IF NOT EXISTS times (
    starttime TEXT PRIMARY KEY NOT NULL,
    app TEXT NOT NULL,
    title TEXT,
    url TEXT,
    endtime TEXT
);