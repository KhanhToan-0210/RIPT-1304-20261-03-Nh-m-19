
const pool = require('../config/db');

// Lấy danh sách sản phẩm
exports.getAllProducts = async (req, res, next) => {
    try {
        const [products] = await pool.query(
            'SELECT * FROM products'
        );

        res.status(200).json(products);
    } catch (error) {
        next(error);
    }
};

// Lấy chi tiết sản phẩm theo ID
exports.getProductById = async (req, res, next) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
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

        res.status(200).json(products[0]);
    } catch (error) {
        next(error);
    }
};

// Chức năng quản trị sẽ triển khai sau
exports.createProduct = (req, res) =>
    res.status(501).json({
        message: 'Chưa triển khai thêm sản phẩm'
    });

exports.updateProduct = (req, res) =>
    res.status(501).json({
        message: 'Chưa triển khai sửa sản phẩm'
    });

exports.deleteProduct = (req, res) =>
    res.status(501).json({
        message: 'Chưa triển khai xóa sản phẩm'
    });
