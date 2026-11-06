-- Schema theo truy van cua backend Ly, doi chieu code hop nhat f20fd99.
-- Chay tren database duoc chon boi mysql; khong tu chuyen sang shoponline.
-- Khong dung file nay de migrate cac bang cu co ten cot khac.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(15,2) NOT NULL DEFAULT 0,
  image VARCHAR(500) NULL,
  stock INT NOT NULL DEFAULT 0,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_products_name (name),
  CONSTRAINT chk_product_price CHECK (price >= 0),
  CONSTRAINT chk_product_stock CHECK (stock >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(50) NOT NULL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_address TEXT NOT NULL,
  total_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  -- Backend moi INSERT status truc tiep; DEFAULT nay cung dung cho import SQL.
  status VARCHAR(50) NOT NULL DEFAULT 'Chờ xác nhận',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_orders_created (created_at),
  CONSTRAINT chk_order_total CHECK (total_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  -- Giu lich su don hang khi san pham da duoc ban.
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_item_price CHECK (price >= 0),
  CONSTRAINT chk_item_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
