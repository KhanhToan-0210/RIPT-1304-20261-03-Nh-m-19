-- ShopOnline - Sample data
-- Chay sau schema.sql, chi mot lan tren database thu nghiem moi.
-- Chi su dung du lieu gia lap; khong import vao DB dang van hanh.

USE shoponline;
START TRANSACTION;

-- Tao 12 san pham gia lap.
INSERT INTO products (product_id, name, description, price, stock_quantity, image_url, status) VALUES
(1,'Ao thun nam','Ao cotton nam',199000,50,'aothun.jpg','active'),
(2,'Ao hoodie','Ao hoodie ni',399000,30,'hoodie.jpg','active'),
(3,'Quan jean','Quan jean slim fit',459000,25,'jean.jpg','active'),
(4,'Giay sneaker','Giay sneaker trang',699000,20,'sneaker.jpg','active'),
(5,'Tui tote','Tui tote canvas',149000,40,'tote.jpg','active'),
(6,'Mu luoi trai','Mu thoi trang',129000,35,'mu.jpg','active'),
(7,'Dong ho','Dong ho nam',899000,15,'dongho.jpg','active'),
(8,'Vi da','Vi da nam',249000,28,'vida.jpg','active'),
(9,'Kinh mat','Kinh thoi trang',319000,18,'kinh.jpg','active'),
(10,'Balo laptop','Balo laptop 15 inch',549000,22,'balo.jpg','active'),
(11,'Ao so mi','Ao so mi cong so',329000,32,'somi.jpg','active'),
(12,'Quan short','Quan short nam',229000,27,'short.jpg','active');

-- Tao 3 don hang gia lap.
INSERT INTO orders (order_id, customer_name, customer_phone, customer_address, total_amount, status) VALUES
(1,'Nguyen Van A','0912345678','Ha Noi',497000,'pending'),
(2,'Tran Thi B','0987654321','Hai Phong',828000,'confirmed'),
(3,'Le Van C','0901122334','Da Nang',1047000,'completed');

-- Tao 6 dong chi tiet; tong tien khop voi bang orders.
INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES
(1,1,1,199000,199000),
(1,5,2,149000,298000),
(2,4,1,699000,699000),
(2,6,1,129000,129000),
(3,2,2,399000,798000),
(3,8,1,249000,249000);

COMMIT;
