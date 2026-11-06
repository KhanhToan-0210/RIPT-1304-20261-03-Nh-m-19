// Run inside the web image (mysql2 is already installed there).
// Only shoponline_check_* databases are accepted; never uses shoponline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

async function main() {
  const mode = process.argv[2] || 'init';
  assert(['init', 'api', 'verify'].includes(mode), 'Mode must be init, api or verify');
  const database = process.env.CHECK_DATABASE;
  assert.match(database || '', /^shoponline_check_[a-z0-9_]+$/);
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true
  });
  try {
    if (mode === 'init') {
      // Deliberately fails if the target database already exists.
      await c.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [database]);
    }
    await c.changeUser({ database });
    if (mode === 'init') {
      for (const file of ['schema.sql', 'seed.sql']) {
        await c.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      // Reapplying schema must preserve existing sample data.
      await c.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    }
    // Check the contract that both productController and orderController use.
    const [columns] = await c.query(`SELECT TABLE_NAME AS tableName,
      COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
      CHARACTER_MAXIMUM_LENGTH AS maxLength, CHARACTER_SET_NAME AS charset,
      COLUMN_DEFAULT AS defaultValue
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?`, [database]);
    const column = (table, name) => {
      const result = columns.find(r => r.tableName === table && r.columnName === name);
      assert(result, `Missing column ${table}.${name}`);
      return result;
    };
    for (const field of ['id', 'name', 'price', 'stock', 'image', 'description']) column('products', field);
    for (const field of ['id', 'customer_name', 'customer_phone', 'customer_address', 'total_price', 'status', 'created_at']) column('orders', field);
    for (const field of ['id', 'order_id', 'product_id', 'product_name', 'price', 'quantity']) column('order_items', field);
    assert.equal(column('orders', 'id').columnType, 'varchar(50)');
    assert.equal(column('order_items', 'order_id').columnType, 'varchar(50)');
    assert.equal(column('orders', 'status').defaultValue, 'Chờ xác nhận');
    assert.equal(column('orders', 'customer_name').maxLength, 255);
    assert.equal(column('orders', 'customer_phone').maxLength, 50);
    assert.equal(column('orders', 'customer_address').columnType, 'text');
    assert.equal(column('products', 'image').maxLength, 500);
    for (const [table, field] of [['products', 'price'], ['orders', 'total_price'], ['order_items', 'price']]) {
      assert.equal(column(table, field).columnType, 'decimal(15,2)');
    }
    assert(columns.filter(r => r.charset).every(r => r.charset === 'utf8mb4'));
    const [products] = await c.query('SELECT * FROM products ORDER BY id DESC');
    assert.equal(products.length, 12);
    assert(products.every(p => p.name.startsWith('HP ') && p.stock >= 0 && p.image.startsWith('https://')));
    const [orders] = await c.query('SELECT * FROM orders ORDER BY created_at DESC');
    assert.equal(orders.length, 3);
    assert(orders.every(o => o.status === 'Chờ xác nhận'));
    const [totals] = await c.query(`SELECT o.id FROM orders o
      LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id, o.total_price
      HAVING o.total_price <> COALESCE(SUM(i.price*i.quantity), 0)`);
    assert.equal(totals.length, 0);
    const [items] = await c.query('SELECT product_id, product_name, price, quantity FROM order_items ORDER BY id');
    assert.equal(items.length, 4);
    assert.equal(orders.find(o => o.id === 'DEMO-HP-001').customer_address, 'Hà Nội (địa chỉ mẫu)');

    if (mode === 'api') {
      const base = process.env.CHECK_API;
      assert(base, 'CHECK_API is required');
      const request = async (route, method = 'GET', body, status = 200) => {
        const res = await fetch(base + route, {
          method, headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const json = await res.json();
        assert.equal(res.status, status, JSON.stringify(json));
        return json;
      };
      assert.equal((await request('/products')).length, 12);
      assert.equal((await request('/products/1')).name, 'HP Pavilion 15');
      assert.equal((await request('/orders')).length, 3);
      assert.equal((await request('/orders/DEMO-HP-001')).data.items.length, 2);
      const health = await fetch(new URL('/health', base));
      assert.equal(health.status, 200);
      assert.equal((await health.json()).database, 'connected');
      // In merged backend f20fd99 the final exports override product admin
      // handlers with 501 responses. Keep backend untouched; make SQL fixtures.
      await request('/products', 'POST', { name: 'HP kiểm thử', price: 1234567, stock: 5 }, 501);
      const [inserted] = await c.query(`INSERT INTO products (name, price, stock, image, description)
        VALUES (?, ?, ?, ?, ?)`, ['HP kiểm thử', 1234567, 5, products[0].image, 'Kiểm tra dấu tiếng Việt']);
      const p = { id: inserted.insertId };
      let orderId;
      try {
        await request('/products/' + p.id, 'PUT', { stock: 999 }, 501);
        await request('/products/' + p.id, 'DELETE', undefined, 501);
        assert.equal((await request('/products/' + p.id)).stock, 5);
        const order = await request('/orders', 'POST', {
          customerName: 'Khách thử nghiệm', customerPhone: '0900000099',
          customerAddress: 'Địa chỉ thử nghiệm', items: [{ id: p.id, quantity: 2 }]
        }, 201);
        orderId = order.order.id;
        assert.match(orderId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        assert.equal(Number(order.order.totalPrice), 2469134);
        assert.equal(order.order.status, 'Chờ xác nhận');
        assert.equal((await request('/products/' + p.id)).stock, 3);
        const detail = (await request('/orders/' + orderId)).data;
        assert.equal(detail.items[0].name, 'HP kiểm thử');
        assert.equal(detail.items[0].quantity, 2);
        assert.equal(detail.status, 'Chờ xác nhận');
        // Old orders must retain the original product name and price.
        await c.query('UPDATE products SET name=?, price=? WHERE id=?', ['HP đổi tên', 2000000, p.id]);
        const snapshot = (await request('/orders/' + orderId)).data;
        assert.equal(snapshot.items[0].name, 'HP kiểm thử');
        assert.equal(Number(snapshot.items[0].price), 1234567);
        const [[before]] = await c.query('SELECT COUNT(*) AS n FROM orders');
        // The first product can be locked before a later item fails. No stock
        // changes or partial order may survive the transaction rollback.
        await request('/orders', 'POST', {
          customerName: 'Khách thử nghiệm', customerPhone: '0900000099',
          customerAddress: 'Địa chỉ thử nghiệm',
          items: [{ id: 1, quantity: 1 }, { id: p.id, quantity: 9999 }]
        }, 409);
        const [[after]] = await c.query('SELECT COUNT(*) AS n FROM orders');
        assert.equal(after.n, before.n);
        assert.equal((await request('/products/1')).stock, products.find(p => p.id === 1).stock);
        await assert.rejects(c.query('UPDATE products SET stock=-1 WHERE id=?', [p.id]), e => e.errno === 3819);
        await assert.rejects(c.query('DELETE FROM products WHERE id=?', [p.id]), e => e.errno === 1451);
      } finally {
        if (orderId) await c.query('DELETE FROM orders WHERE id=?', [orderId]);
        const [[remaining]] = await c.query('SELECT COUNT(*) AS n FROM order_items WHERE product_id=?', [p.id]);
        assert.equal(remaining.n, 0, 'Deleting an order must cascade its items');
        await c.query('DELETE FROM products WHERE id=?', [p.id]);
      }
    }
    console.log(`PASS ${mode}: ${database}; 12 HP products, 3 orders, 4 items; totals and UTF-8 verified.`);
  } finally {
    await c.end();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
