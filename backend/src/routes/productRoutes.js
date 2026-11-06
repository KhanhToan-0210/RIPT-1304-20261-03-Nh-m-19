
const express = require('express');
const router = express.Router();

const productController = require('../controllers/productController');

// Lấy toàn bộ sản phẩm
router.get('/', productController.getAllProducts);

// Lấy chi tiết sản phẩm theo ID
router.get('/:id', productController.getProductById);

// Admin: Thêm sản phẩm
router.post('/', productController.createProduct);

// Admin: Sửa sản phẩm
router.put('/:id', productController.updateProduct);

// Admin: Xóa sản phẩm
router.delete('/:id', productController.deleteProduct);

module.exports = router;
