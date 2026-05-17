-- Add deterministic token columns for encrypted PII fields.
-- Tokens are generated in the API layer with HMAC-SHA256 and stored separately
-- from ciphertext to support equality checks and safe correlation without
-- exposing plaintext values.

alter table addresses
  add column if not exists recipient_phone_token text,
  add column if not exists line1_token text;

alter table quotes
  add column if not exists pickup_address_token text;

create index if not exists addresses_recipient_phone_token_idx
  on addresses(recipient_phone_token)
  where recipient_phone_token is not null;

create index if not exists addresses_line1_token_idx
  on addresses(line1_token)
  where line1_token is not null;

create index if not exists quotes_pickup_address_token_idx
  on quotes(pickup_address_token)
  where pickup_address_token is not null;
