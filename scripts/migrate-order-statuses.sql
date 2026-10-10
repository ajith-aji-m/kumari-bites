-- Run once against the existing Kumari Bites MySQL database before deploying the five-status code.
-- Keep legacy values temporarily so existing rows can be converted safely.
ALTER TABLE orders
  MODIFY COLUMN status ENUM('new', 'confirmed', 'placed', 'preparing', 'ready', 'completed', 'cancelled')
  NOT NULL DEFAULT 'placed';

UPDATE orders
SET status = 'placed'
WHERE status IN ('new', 'confirmed');

ALTER TABLE orders
  MODIFY COLUMN status ENUM('placed', 'preparing', 'ready', 'completed', 'cancelled')
  NOT NULL DEFAULT 'placed';
