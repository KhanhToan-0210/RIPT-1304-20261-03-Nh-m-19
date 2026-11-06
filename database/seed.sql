-- Du lieu DEMO HP; gia va cau hinh minh hoa, khong phai bao gia thuc te.
-- Chi import mot lan vao database MOI sau schema.sql.
-- Anh laptop minh hoa; khong phai anh chinh xac tung model.
SET NAMES utf8mb4;
START TRANSACTION;
INSERT INTO products (id, name, description, price, stock, image) VALUES
(1, 'HP Pavilion 15', 'Laptop HP Pavilion 15 cho học tập và văn phòng (dữ liệu mẫu).', 15990000, 20, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(2, 'HP Pavilion 14', 'Laptop HP Pavilion 14 gọn nhẹ (dữ liệu mẫu).', 14990000, 18, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(3, 'HP Envy x360 14', 'Laptop HP Envy x360 cho công việc sáng tạo (dữ liệu mẫu).', 24990000, 12, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(4, 'HP Spectre x360 14', 'Laptop HP Spectre x360 cao cấp (dữ liệu mẫu).', 35990000, 8, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(5, 'HP Victus 15', 'Laptop gaming HP Victus 15 (dữ liệu mẫu).', 21990000, 15, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(6, 'HP OMEN 16', 'Laptop gaming HP OMEN 16 (dữ liệu mẫu).', 39990000, 10, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(7, 'HP ProBook 440', 'Laptop doanh nghiệp HP ProBook 440 (dữ liệu mẫu).', 18990000, 16, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(8, 'HP EliteBook 840', 'Laptop HP EliteBook 840 cho công việc di động (dữ liệu mẫu).', 28990000, 9, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(9, 'HP 15s', 'Laptop HP 15s dành cho sinh viên (dữ liệu mẫu).', 11990000, 25, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(10, 'HP 240 G10', 'Laptop HP 240 G10 màn hình 14 inch (dữ liệu mẫu).', 12990000, 22, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(11, 'HP ZBook Firefly 14', 'Máy trạm di động HP ZBook Firefly (dữ liệu mẫu).', 32990000, 6, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80'),
(12, 'HP Dragonfly G4', 'Laptop HP Dragonfly G4 mỏng nhẹ (dữ liệu mẫu).', 42990000, 5, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80');

-- Khach hang gia lap. Ton kho o tren la so luong con lai sau cac don nay.
INSERT INTO orders (id, customer_name, customer_phone, customer_address, total_price, status) VALUES
('DEMO-HP-001', 'Khách hàng mẫu A', '0900000001', 'Hà Nội (địa chỉ mẫu)', 27980000, 'Chờ xác nhận'),
('DEMO-HP-002', 'Khách hàng mẫu B', '0900000002', 'Hải Phòng (địa chỉ mẫu)', 21990000, 'Chờ xác nhận'),
('DEMO-HP-003', 'Khách hàng mẫu C', '0900000003', 'Đà Nẵng (địa chỉ mẫu)', 37980000, 'Chờ xác nhận');
INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES
('DEMO-HP-001', 1, 'HP Pavilion 15', 15990000, 1),
('DEMO-HP-001', 9, 'HP 15s', 11990000, 1),
('DEMO-HP-002', 5, 'HP Victus 15', 21990000, 1),
('DEMO-HP-003', 7, 'HP ProBook 440', 18990000, 2);
COMMIT;
