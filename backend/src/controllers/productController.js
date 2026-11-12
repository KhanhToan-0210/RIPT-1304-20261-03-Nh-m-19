const pool = require('../config/db');

// ================================
// HÀM KIỂM TRA DỮ LIỆU
// ================================

// Kiểm tra ID sản phẩm
function parseId(value) {
    const text = String(value);

    if (!/^[1-9]\d*$/.test(text)) {
        return null;
    }

    const id = Number(text);

    if (!Number.isSafeInteger(id) || id > 2147483647) {
        return null;
    }

    return id;
}

// Kiểm tra dữ liệu thêm hoặc sửa
function validateProduct(body, current = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Dữ liệu sản phẩm không hợp lệ' };
    }

    const get = (field, fallback) =>
        body[field] !== undefined ? body[field] : fallback;

    const name = get('name', current.name);
    const price = get('price', current.price);
    const stock = get('stock', current.stock ?? 0);
    const image = get('image', current.image ?? null);
    const description = get(
        'description',
        current.description ?? ''
    );

    // Kiểm tra tên
    if (typeof name !== 'string' ||
        !name.trim() || name.trim().length > 255) {
        return { error: 'Tên sản phẩm không hợp lệ' };
    }

    // DECIMAL(15,2): tối đa 13 chữ số phần nguyên
    const priceText = String(price ?? '').trim();

    if (!/^\d{1,13}(\.\d{1,2})?$/.test(priceText)) {
        return {
            error: 'Giá phải là số không âm, tối đa 2 chữ số thập phân'
        };
    }

    // Kiểm tra tồn kho
    const stockText = String(stock ?? '').trim();
    const stockNumber = Number(stockText);

    if (!/^\d+$/.test(stockText) ||
        !Number.isSafeInteger(stockNumber) ||
        stockNumber > 2147483647) {
        return {
            error: 'Tồn kho phải là số nguyên không âm'
        };
    }

    // Kiểm tra ảnh
    if (image !== null &&
        (typeof image !== 'string' || image.length > 500)) {
        return { error: 'Đường dẫn ảnh không hợp lệ' };
    }

    // Kiểm tra mô tả
    if (description !== null &&
        (typeof description !== 'string' ||
            description.length > 10000)) {
        return { error: 'Mô tả không hợp lệ' };
    }

    return {
        data: {
            name: name.trim(),
            price: priceText,
            stock: stockNumber,
            image: image?.trim() || null,
            description: description?.trim() || ''
        }
    };
}

// ================================
// 1. LẤY DANH SÁCH SẢN PHẨM
// GET /api/products
// ================================
exports.getAllProducts = async (req, res, next) => {
    try {
        const [products] = await pool.query(
            'SELECT * FROM products ORDER BY id DESC'
        );

        res.status(200).json(products);
    } catch (error) {
        next(error);
    }
};

// ================================
// 2. LẤY CHI TIẾT SẢN PHẨM
// GET /api/products/:id
// ================================
exports.getProductById = async (req, res, next) => {
    try {
        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                message: 'ID sản phẩm không hợp lệ'
            });
        }

        const [products] = await pool.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                message: 'Không tìm thấy sản phẩm'
            });
        }

        return res.status(200).json(products[0]);
    } catch (error) {
        next(error);
    }
};

// ================================
// 3. THÊM SẢN PHẨM
// POST /api/products
// ================================
exports.createProduct = async (req, res, next) => {
    try {
        const { data, error } = validateProduct(req.body);

        if (error) {
            return res.status(400).json({
                message: error
            });
        }

        const [result] = await pool.query(
            `INSERT INTO products
             (name, price, stock, image, description)
             VALUES (?, ?, ?, ?, ?)`,
            [
                data.name,
                data.price,
                data.stock,
                data.image,
                data.description
            ]
        );

        const [products] = await pool.query(
            'SELECT * FROM products WHERE id = ?',
            [result.insertId]
        );

        return res.status(201).json(products[0]);
    } catch (error) {
        next(error);
    }
};

// ================================
// 4. SỬA SẢN PHẨM
// PUT /api/products/:id
// ================================
exports.updateProduct = async (req, res, next) => {
    try {
        const id = parseId(req.params.id);

        if (!id) {
            return res.status(400).json({
                message: 'ID sản phẩm không hợp lệ'
            });
        }

        const [products] = await pool.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        if (products.length === 0) {
            return res.status(404).json({
                message: 'Không tìm thấy sản phẩm'
            });
        }

        const { data, error } = validateProduct(
            req.body,
            products[0]
        );

        if (error) {
            return res.status(400).json({
                message: error
            });
        }

        await pool.query(
            `UPDATE products
             SET name = ?,
                 price = ?,
                 stock = ?,
                 image = ?,
                 description = ?
             WHERE id = ?`,
            [
                data.name,
                data.price,
                data.stock,
                data.image,
                data.description,
                id
            ]
        );

        const [updated] = await pool.query(
            'SELECT * FROM products WHERE id = ?',
            [id]
        );

        return res.status(200).json(updated[0]);
    } catch (error) {
        next(error);
    }
};

// ================================
// 5. XÓA SẢN PHẨM
// DELETE /api/products/:id
// ================================
exports.deleteProduct = async (req, res, next) => {
    const id = parseId(req.params.id);

    if (!id) {
        return res.status(400).json({
            message: 'ID sản phẩm không hợp lệ'
        });
    }

    let connection;
    let transactionStarted = false;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;

        // Khóa sản phẩm trong lúc kiểm tra
        const [products] = await connection.query(
            'SELECT id FROM products WHERE id = ? FOR UPDATE',
            [id]
        );

        if (products.length === 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(404).json({
                message: 'Không tìm thấy sản phẩm'
            });
        }

        // Chặn xóa nếu sản phẩm đã có đơn hàng
        const [items] = await connection.query(
            `SELECT id FROM order_items
             WHERE product_id = ?
             LIMIT 1`,
            [id]
        );

        if (items.length > 0) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(409).json({
                message: 'Không thể xóa sản phẩm đã có đơn hàng'
            });
        }

        // Chỉ xóa sản phẩm chưa từng được đặt hàng
        await connection.query(
            'DELETE FROM products WHERE id = ?',
            [id]
        );

        await connection.commit();
        transactionStarted = false;

        return res.status(200).json({
            success: true,
            message: 'Xóa sản phẩm thành công'
        });

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
        }

        next(error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
