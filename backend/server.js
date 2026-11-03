const express = require('express');
const path = require('path');
const cors = require('cors');

const productRoutes = require('./src/routes/productRoutes');
const orderRoutes = require('./src/routes/orderRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Định tuyến API
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// Phục vụ giao diện Frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại cổng ${PORT}`);
});
