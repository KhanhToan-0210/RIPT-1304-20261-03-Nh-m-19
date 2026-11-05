
const express = require('express');
const router = express.Router();

const orderController = require('../controllers/orderController');

// Lấy danh sách đơn hàng
router.get('/', orderController.getAllOrders);

// Tạo đơn hàng mới
router.post('/', orderController.createOrder);

// Xem chi tiết một đơn hàng
router.get('/:id', orderController.getOrderById);

module.exports = router;
