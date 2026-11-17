// All write tests are restricted to a shoponline_check_* DB and an APP_ENV=test API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');

async function checkDatabase(connection, database, checkSeed) {
  const [columns] = await connection.query(`SELECT TABLE_NAME AS tableName,
    COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
    CHARACTER_MAXIMUM_LENGTH AS maxLength, CHARACTER_SET_NAME AS charset,
    COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?`, [database]);
  const column = (table, name) => {
    const result = columns.find(row => row.tableName === table && row.columnName === name);
    assert(result, `Missing column ${table}.${name}`);
    return result;
  };
  for (const name of ['id','name','price','stock','image','description']) column('products', name);
  for (const name of ['id','customer_name','customer_phone','customer_address','total_price','status','created_at']) column('orders', name);
  for (const name of ['id','order_id','product_id','product_name','price','quantity']) column('order_items', name);
  assert.equal(column('orders', 'id').columnType, 'varchar(50)');
  assert.equal(column('order_items', 'order_id').columnType, 'varchar(50)');
  assert.equal(column('orders', 'status').defaultValue, 'Chờ xác nhận');
  assert.equal(column('orders', 'customer_name').maxLength, 255);
  assert.equal(column('orders', 'customer_phone').maxLength, 50);
  assert.equal(column('orders', 'customer_address').columnType, 'text');
  assert.equal(column('products', 'image').maxLength, 500);
  for (const [table, name] of [['products','price'],['orders','total_price'],['order_items','price']]) {
    assert.equal(column(table, name).columnType, 'decimal(15,2)');
  }
  assert(columns.filter(row => row.charset).every(row => row.charset === 'utf8mb4'));
  const [keys] = await connection.query(`SELECT CONSTRAINT_NAME AS name, DELETE_RULE AS deleteRule
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=?`, [database]);
  assert.equal(keys.find(key => key.name === 'fk_order_items_order')?.deleteRule, 'CASCADE');
  assert.equal(keys.find(key => key.name === 'fk_order_items_product')?.deleteRule, 'RESTRICT');
  const [products] = await connection.query('SELECT * FROM products ORDER BY id');
  const [orders] = await connection.query('SELECT * FROM orders ORDER BY id');
  const [items] = await connection.query('SELECT * FROM order_items ORDER BY id');
  assert(products.every(product => product.stock >= 0 && Number(product.price) >= 0));
  assert(items.every(item => item.quantity > 0 && Number(item.price) >= 0));
  const [invalidTotals] = await connection.query(`SELECT o.id FROM orders o
    LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id,o.total_price
    HAVING o.total_price <> COALESCE(SUM(i.price*i.quantity),0)`);
  assert.equal(invalidTotals.length, 0, 'Order totals must match their item snapshots');
  if (checkSeed) {
    assert.equal(products.length, 12);
    assert.equal(orders.length, 3);
    assert.equal(items.length, 4);
    assert.equal(products.find(product => product.id === 1)?.name, 'HP Pavilion 15');
    assert.equal(orders.find(order => order.id === 'DEMO-HP-001')?.customer_address, 'Hà Nội (địa chỉ mẫu)');
    assert(orders.every(order => order.status === 'Chờ xác nhận'));
  }
  return { products: products.length, orders: orders.length, items: items.length };
}

async function checkApi(connection, database) {
  const base = (process.env.CHECK_API || '').replace(/\/$/, '');
  assert(base, 'CHECK_API is required');
  let requests = 0;
  async function request(route, method = 'GET', body, expectedStatus = 200, raw = false) {
    const response = await fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const data = await response.json();
    const accepted = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    assert(accepted.includes(response.status), `${method} ${route}: expected ${accepted}, received ${response.status}: ${JSON.stringify(data)}`);
    if (response.status >= 400) assert.equal(typeof data.message, 'string');
    requests++;
    return { status: response.status, data };
  }
  // Check both endpoints before making any HTTP writes.
  const healthResponse = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(10000) });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.environment, 'test', 'Write tests require an APP_ENV=test web');
  assert.equal(health.databaseName, database, 'API must use the selected TEST DB');
  assert.equal(process.env.DB_NAME, database, 'Verifier must share the web DB configuration');
  assert.equal((await connection.query('SELECT DATABASE() AS name'))[0][0].name, database);

  const counts = await checkDatabase(connection, database, false);
  assert.equal((await request('/products')).data.length, counts.products);
  assert.equal((await request('/orders')).data.length, Math.min(counts.orders, 100));
  await request('/missing', 'GET', undefined, 404);
  await request('/products/0', 'GET', undefined, 400);
  await request('/products', 'POST', '{invalid', 400, true);
  await request('/products', 'POST', { name: 'Invalid', price: -1 }, 400);
  console.log('PASS API reads, JSON errors and validation');

  const createProduct = async stock => (await request('/products', 'POST', {
    name: `HP kiểm thử ${randomUUID()}`, price: '1234.50', stock,
    image: '/images/hp-15s.jpg', description: 'Kiểm tra tiếng Việt'
  }, 201)).data;
  const customer = { customerName: 'Khách thử nghiệm', customerPhone: '0900000099', customerAddress: 'Địa chỉ TEST' };
  const orderBody = items => ({ ...customer, items });
  const p = await createProduct(5);
  assert.equal((await request('/products/' + p.id)).data.stock, 5);
  const [[inserted]] = await connection.query('SELECT * FROM products WHERE id=?', [p.id]);
  assert.equal(inserted.description, 'Kiểm tra tiếng Việt');
  assert.equal(inserted.image, '/images/hp-15s.jpg');
  await request('/products/' + p.id, 'PUT', { stock: 6 }, 428);
  await request('/products/' + p.id, 'PUT', { stock: 6, expectedStock: 4 }, 409);
  await request('/products/' + p.id, 'PUT', { stock: 1.5, expectedStock: 5 }, 400);
  assert.equal((await request('/products/' + p.id, 'PUT', { stock: 6, expectedStock: 5 })).data.stock, 6);
  const disposable = await createProduct(0);
  await request('/products/' + disposable.id, 'DELETE');
  await request('/products/' + disposable.id, 'GET', undefined, 404);
  await request('/products/' + disposable.id, 'DELETE', undefined, 404);
  console.log('PASS product create/read/update/delete and stock preconditions');

  const placed = (await request('/orders', 'POST', orderBody([{ id: p.id, quantity: 2 }]), 201)).data.order;
  assert.match(placed.id, /^[0-9a-f-]{36}$/i);
  assert.equal(Number(placed.totalPrice), 2469);
  assert.equal(placed.status, 'Chờ xác nhận');
  const detail = (await request('/orders/' + placed.id)).data.data;
  assert.equal(detail.customerName, customer.customerName);
  assert.equal(detail.items[0].name, p.name);
  assert.equal(detail.items[0].quantity, 2);
  assert.equal(Number(detail.items[0].price), 1234.5);
  const [[saved]] = await connection.query(`SELECT o.total_price,i.quantity,i.product_name,i.price
    FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=?`, [placed.id]);
  assert.equal(Number(saved.total_price), 2469);
  assert.equal(saved.product_name, p.name);
  assert.equal(saved.quantity, 2);
  assert.equal((await request('/products/' + p.id)).data.stock, 4);
  await request('/products/' + p.id, 'PUT', { stock: 9, expectedStock: 6 }, 409);
  const metadata = (await request('/products/' + p.id, 'PUT', { name: 'HP đổi tên', price: '2000.00' })).data;
  assert.equal(metadata.stock, 4);
  const historical = (await request('/orders/' + placed.id)).data.data;
  assert.equal(historical.items[0].name, p.name);
  assert.equal(Number(historical.items[0].price), 1234.5);
  await request('/products/' + p.id, 'DELETE', undefined, 409);
  console.log('PASS order persistence, stock decrement and historical name/price');

  const shortStock = await createProduct(1);
  const [[before]] = await connection.query('SELECT COUNT(*) AS count FROM orders');
  await request('/orders', 'POST', orderBody([{ id: p.id, quantity: 1 }, { id: shortStock.id, quantity: 2 }]), 409);
  const [[after]] = await connection.query('SELECT COUNT(*) AS count FROM orders');
  assert.equal(after.count, before.count);
  assert.equal((await request('/products/' + p.id)).data.stock, 4);
  assert.equal((await request('/products/' + shortStock.id)).data.stock, 1);
  for (const quantity of [0, -1, 1.5]) {
    await request('/orders', 'POST', orderBody([{ id: p.id, quantity }]), 400);
  }
  await request('/orders', 'POST', orderBody([{ id: p.id, quantity: 1 }, { id: p.id, quantity: 1 }]), 400);
  await request('/orders', 'POST', orderBody([{ id: 2147483647, quantity: 1 }]), 404);
  await assert.rejects(connection.query('UPDATE products SET stock=-1 WHERE id=?', [p.id]), error => error.errno === 3819);
  await assert.rejects(connection.query('DELETE FROM products WHERE id=?', [p.id]), error => error.errno === 1451);
  console.log('PASS failed orders roll back, invalid quantities and DB constraints');

  const lastItem = await createProduct(1);
  const competing = await Promise.all([
    request('/orders', 'POST', orderBody([{ id: lastItem.id, quantity: 1 }]), [201,409]),
    request('/orders', 'POST', orderBody([{ id: lastItem.id, quantity: 1 }]), [201,409])
  ]);
  assert.deepEqual(competing.map(response => response.status).sort(), [201,409]);
  assert.equal((await request('/products/' + lastItem.id)).data.stock, 0);
  const racing = await createProduct(1);
  const [order, update] = await Promise.all([
    request('/orders', 'POST', orderBody([{ id: racing.id, quantity: 1 }]), 201),
    request('/products/' + racing.id, 'PUT', { stock: 2, expectedStock: 1 }, [200,409])
  ]);
  assert.equal((await request('/products/' + racing.id)).data.stock, update.status === 200 ? 1 : 0);
  const [[racedOrder]] = await connection.query('SELECT id FROM orders WHERE id=?', [order.data.order.id]);
  assert(racedOrder);
  console.log('PASS concurrent checkout and stock adjustment on MySQL');
  return { requests, orderIds: [placed.id, ...competing.filter(response => response.status === 201).map(response => response.data.order.id), order.data.order.id] };
}

async function main() {
  const mode = process.argv[2] || 'init';
  assert(['init','seed','verify','api'].includes(mode), 'Mode must be init, seed, verify or api');
  const database = process.env.CHECK_DATABASE;
  assert.match(database || '', /^shoponline_check_[a-z0-9_]+$/);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    charset: 'utf8mb4', multipleStatements: true
  });
  try {
    if (mode === 'init') {
      await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [database]);
    }
    await connection.changeUser({ database });
    if (mode === 'init') {
      for (const file of ['schema.sql','seed.sql']) {
        await connection.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      }
      await connection.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    }
    const counts = await checkDatabase(connection, database, mode === 'init' || mode === 'seed');
    console.log(`PASS ${mode}: schema, foreign keys, totals, UTF-8; ${JSON.stringify(counts)}`);
    if (mode === 'api') {
      const result = await checkApi(connection, database);
      await checkDatabase(connection, database, false);
      console.log(`PASS api: ${JSON.stringify(result)}; synthetic TEST records retained`);
    }
  } finally {
    await connection.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
