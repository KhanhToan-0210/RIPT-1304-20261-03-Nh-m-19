require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const productRoutes = require('./src/routes/productRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const pool = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Định tuyến API
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

app.get('/health', async (req, res) => {
    try {
        // Kiểm tra kết nối MySQL
        await pool.query('SELECT 1');

        res.status(200).json({
            status: 'ok',
            server: 'running',
            database: 'connected'
        });
    } catch (error) {
        console.error('Health check error:', error.message);

        res.status(503).json({
            status: 'error',
            server: 'running',
            database: 'disconnected'
        });
    }
});


// Phục vụ giao diện Frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại cổng ${PORT}`);
});
