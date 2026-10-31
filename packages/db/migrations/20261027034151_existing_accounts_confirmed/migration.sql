-- Signing in now needs a confirmed email address (D163). Accounts made before that count as
-- confirmed, so nobody already using Parley is locked out.
UPDATE "user" SET "email_verified" = true WHERE "kind" = 'user' AND "email_verified" = false;
