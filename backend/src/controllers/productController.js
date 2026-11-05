const pool = require('../config/db');

// Lấy danh sách sản phẩm
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

// [Admin] Thêm sản phẩm mới vào MySQL
exports.createProduct = async (req, res, next) => {
    try {
        const { name, price, image, stock, description } = req.body;

        if (!name || price === undefined || price === null) {
            return res.status(400).json({ message: 'Tên và giá sản phẩm là bắt buộc!' });
        }

        const parsedPrice = Number(price);
        const parsedStock = Number(stock) || 0;
        const imgUrl = image || 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80';
        const desc = description || '';

        const [result] = await pool.query(
            `INSERT INTO products (name, price, image, stock, description)
             VALUES (?, ?, ?, ?, ?)`,
            [name, parsedPrice, imgUrl, parsedStock, desc]
        );

        res.status(201).json({
            id: result.insertId,
            name,
            price: parsedPrice,
            image: imgUrl,
            stock: parsedStock,
            description: desc
        });
    } catch (error) {
        next(error);
    }
};

// [Admin] Sửa thông tin sản phẩm
exports.updateProduct = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const { name, price, image, stock, description } = req.body;

        const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sản phẩm!' });
        }

        const current = existing[0];
        const updatedName = name !== undefined ? name : current.name;
        const updatedPrice = price !== undefined ? Number(price) : current.price;
        const updatedImage = image !== undefined ? image : current.image;
        const updatedStock = stock !== undefined ? Number(stock) : current.stock;
        const updatedDesc = description !== undefined ? description : current.description;

        await pool.query(
            `UPDATE products 
             SET name = ?, price = ?, image = ?, stock = ?, description = ?
             WHERE id = ?`,
            [updatedName, updatedPrice, updatedImage, updatedStock, updatedDesc, id]
        );

        res.status(200).json({
            id,
            name: updatedName,
            price: updatedPrice,
            image: updatedImage,
            stock: updatedStock,
            description: updatedDesc
        });
    } catch (error) {
        next(error);
    }
};

// [Admin] Xóa sản phẩm
exports.deleteProduct = async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sản phẩm!' });
        }

        res.status(200).json({ message: 'Đã xóa sản phẩm thành công!' });
    } catch (error) {
        next(error);
    }
};
