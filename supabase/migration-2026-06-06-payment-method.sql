-- Metodo di pagamento usato (card / paypal / satispay), mostrato nel back office.
-- Lo salva il webhook leggendo il PaymentIntent. Additiva. (Già applicata via MCP.)
alter table orders add column if not exists payment_method text;
