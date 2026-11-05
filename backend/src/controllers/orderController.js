
const { randomUUID } = require('node:crypto');
const pool = require('../config/db');

// ============================================
// HÀM ĐỊNH DẠNG ĐƠN HÀNG CHO FRONTEND
// ============================================

function formatOrder(order, items) {
    return {
        id: order.id,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
        totalPrice: order.total_price,
        status: order.status,
        createdAt: order.created_at,

        items: items.map(item => ({
            id: item.product_id,
            productId: item.product_id,
            name: item.product_name,
            price: item.price,
            quantity: item.quantity
        }))
    };
}

// Lấy danh sách sản phẩm trong một đơn hàng
async function getOrderItems(orderId) {
    const [items] = await pool.query(
        `SELECT product_id, product_name, price, quantity
         FROM order_items
         WHERE order_id = ?
         ORDER BY id`,
        [orderId]
    );

    return items;
}

// ============================================
// API 1: POST /api/orders
// TẠO ĐƠN HÀNG MỚI
// ============================================

exports.createOrder = async (req, res) => {

    const body = req.body || {};

    // Nhận dữ liệu từ Frontend hoặc Postman
    const name = body.customerName ?? body.customer_name;
    const phone = body.customerPhone ?? body.customer_phone;
    const address = body.customerAddress ?? body.customer_address;
    const items = body.items;

    // BƯỚC 1: Kiểm tra thông tin khách hàng
    if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 255 ||
        typeof phone !== 'string' ||
        !phone.trim() ||
        phone.trim().length > 50 ||
        typeof address !== 'string' ||
        !address.trim() ||
        address.trim().length > 2000
    ) {
        return res.status(400).json({
            success: false,
            message: 'Thông tin khách hàng không hợp lệ'
        });
    }

    // BƯỚC 2: Kiểm tra giỏ hàng
    if (
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > 50
    ) {
        return res.status(400).json({
            success: false,
            message: 'Giỏ hàng không hợp lệ'
        });
    }

    const productIds = new Set();
    const cartItems = [];

    // Kiểm tra từng sản phẩm trong giỏ
    for (const item of items) {

        const id = item?.id ?? item?.product_id;
        const quantity = item?.quantity;

        if (
            !Number.isInteger(id) ||
            id <= 0 ||
            id > 2147483647 ||
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            quantity > 2147483647 ||
            productIds.has(id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'ID, số lượng hoặc sản phẩm bị trùng'
            });
        }

        productIds.add(id);
        cartItems.push({ id, quantity });
    }

    // Sắp xếp sản phẩm để khóa theo thứ tự
    cartItems.sort((a, b) => a.id - b.id);

    let connection;

    try {
        // BƯỚC 3: Lấy kết nối MySQL
        connection = await pool.getConnection();

        // Bắt đầu transaction
        await connection.beginTransaction();

        const products = [];

        // BƯỚC 4: Kiểm tra sản phẩm và tồn kho
        for (const item of cartItems) {

            const [rows] = await connection.query(
                `SELECT id, name, price, stock
                 FROM products
                 WHERE id = ?
                 FOR UPDATE`,
                [item.id]
            );

            // Sản phẩm không tồn tại
            if (rows.length === 0) {
                const error = new Error(
                    `Sản phẩm ${item.id} không tồn tại`
                );

                error.statusCode = 404;
                throw error;
            }

            const product = rows[0];

            // Kiểm tra số lượng tồn kho
            if (product.stock < item.quantity) {
                const error = new Error(
                    `Sản phẩm ${product.name} không đủ tồn kho`
                );

                error.statusCode = 409;
                throw error;
            }

            products.push({
                ...product,
                quantity: item.quantity
            });
        }

        // BƯỚC 5: Tạo mã đơn hàng duy nhất
        const orderId = randomUUID();

        // BƯỚC 6: Lưu đơn hàng vào bảng orders
        await connection.query(
            `INSERT INTO orders
             (
                id,
                customer_name,
                customer_phone,
                customer_address,
                total_price
             )
             VALUES (?, ?, ?, ?, 0)`,
            [
                orderId,
                name.trim(),
                phone.trim(),
                address.trim()
            ]
        );

        // BƯỚC 7: Lưu chi tiết và trừ tồn kho
        for (const product of products) {

            // Lưu chi tiết đơn hàng
            await connection.query(
                `INSERT INTO order_items
                 (
                    order_id,
                    product_id,
                    product_name,
                    price,
                    quantity
                 )
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    orderId,
                    product.id,
                    product.name,
                    product.price,
                    product.quantity
                ]
            );

            // Trừ số lượng sản phẩm trong kho
            const [result] = await connection.query(
                `UPDATE products
                 SET stock = stock - ?
                 WHERE id = ? AND stock >= ?`,
                [
                    product.quantity,
                    product.id,
                    product.quantity
                ]
            );

            if (result.affectedRows !== 1) {
                const error = new Error(
                    'Không thể cập nhật tồn kho'
                );

                error.statusCode = 409;
                throw error;
            }
        }

        // BƯỚC 8: Tính tổng tiền từ MySQL
        const [totalRows] = await connection.query(
            `SELECT COALESCE(
                SUM(price * quantity), 0
             ) AS total
             FROM order_items
             WHERE order_id = ?`,
            [orderId]
        );

        const totalPrice = totalRows[0].total;

        // Cập nhật tổng tiền cho đơn hàng
        await connection.query(
            `UPDATE orders
             SET total_price = ?
             WHERE id = ?`,
            [totalPrice, orderId]
        );

        // BƯỚC 9: Lưu toàn bộ transaction
        await connection.commit();

        // Trả kết quả thành công
        return res.status(201).json({
            success: true,
            message: 'Đặt hàng thành công',

            order: {
                id: orderId,
                customerName: name.trim(),
                customerPhone: phone.trim(),
                customerAddress: address.trim(),
                totalPrice: totalPrice,
                status: 'Chờ xác nhận'
            }
        });

    } catch (error) {

        // Nếu có lỗi thì hoàn tác transaction
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    'Lỗi rollback:',
                    rollbackError.message
                );
            }
        }

        console.error('Lỗi tạo đơn hàng:', error.message);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : 'Lỗi tạo đơn hàng'
        });

    } finally {

        // Trả kết nối về pool
        if (connection) {
            connection.release();
        }
    }
};

// ============================================
// API 2: GET /api/orders
// LẤY DANH SÁCH TẤT CẢ ĐƠN HÀNG
// ============================================

exports.getAllOrders = async (req, res) => {
    try {

        const [orders] = await pool.query(
            `SELECT *
             FROM orders
             ORDER BY created_at DESC
             LIMIT 100`
        );

        const result = await Promise.all(
            orders.map(async (order) => {

                const items = await getOrderItems(order.id);

                return formatOrder(order, items);
            })
        );

        return res.status(200).json(result);

    } catch (error) {

        console.error('Lỗi lấy đơn hàng:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy danh sách đơn hàng'
        });
    }
};

// ============================================
// API 3: GET /api/orders/:id
// XEM CHI TIẾT ĐƠN HÀNG
// ============================================

exports.getOrderById = async (req, res) => {
    try {

        const orderId = req.params.id;

        // Kiểm tra mã đơn hàng
        if (!orderId || orderId.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'Mã đơn hàng không hợp lệ'
            });
        }

        // Tìm đơn hàng trong MySQL
        const [orders] = await pool.query(
            `SELECT *
             FROM orders
             WHERE id = ?`,
            [orderId]
        );

        // Không tìm thấy đơn hàng
        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy đơn hàng'
            });
        }

        // Lấy các sản phẩm trong đơn
        const items = await getOrderItems(orderId);

        return res.status(200).json({
            success: true,
            data: formatOrder(orders[0], items)
        });

    } catch (error) {

        console.error('Lỗi chi tiết đơn:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Không thể lấy chi tiết đơn hàng'
        });
    }
};
