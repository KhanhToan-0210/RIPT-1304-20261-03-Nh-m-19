// Run with Playwright available through NODE_PATH and Google Chrome installed.
// All writes use the two local APP_ENV=test websites in compose.test.yml.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');

async function readJson(response, expectedStatus) {
    const text = await response.text();
    assert.equal(response.status(), expectedStatus, text);
    return JSON.parse(text);
}

function trackPage(page, errors) {
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { await dialog.accept(); });
}

async function actionResponse(page, method, path, action, expectedStatus) {
    const pending = page.waitForResponse(response =>
        new URL(response.url()).pathname === path && response.request().method() === method)
        .then(response => readJson(response, expectedStatus));
    await action();
    return pending;
}

async function createProduct(page, name, stock, description = '') {
    await page.locator('#p-name').fill(name);
    await page.locator('#p-price').fill('1000');
    await page.locator('#p-stock').fill(String(stock));
    await page.locator('#p-image').fill('/images/hp-15s.jpg');
    await page.locator('#p-desc').fill(description);
    await page.waitForFunction(() => document.querySelector('#p-image-preview').naturalWidth > 0);
    const product = await actionResponse(page, 'POST', '/api/products',
        () => page.locator('#btn-save-product').click(), 201);
    await page.waitForFunction(() => !document.querySelector('#btn-save-product').disabled);
    await page.locator(`button[onclick="editProduct(${product.id})"]`).waitFor();
    return product;
}

async function checkWebsite(browser, base) {
    const context = await browser.newContext();
    await context.addInitScript(() => { window.__shopXss = 0; });
    const errors = [];
    const tag = randomUUID().slice(0, 8);
    try {
        const admin = await context.newPage();
        const shop = await context.newPage();
        trackPage(admin, errors);
        trackPage(shop, errors);
        await admin.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
        await admin.locator('#admin-product-tbody button').first().waitFor();
        const originalName = `PHA B UI ${tag} <img src=x onerror="window.__shopXss=1">`;
        const p = await createProduct(admin, originalName, 5, '<script>window.__shopXss=2</script>');
        const other = await createProduct(admin, `PHA B UI unselected ${tag}`, 3);
        await admin.locator(`button[onclick="editProduct(${p.id})"]`).click();
        assert.equal(await admin.locator('#p-expected-stock').inputValue(), '5');
        console.log(`PASS UI ${base}: create/read products, local image preview, stock snapshot`);

        await shop.goto(base + '/cart.html', { waitUntil: 'domcontentloaded' });
        await shop.evaluate(() => localStorage.setItem('hp_store_cart', '{invalid'));
        await shop.reload({ waitUntil: 'domcontentloaded' });
        assert(await shop.locator('#cart-empty-msg').isVisible());
        await shop.evaluate(product => {
            localStorage.setItem('hp_store_cart', JSON.stringify([
                { ...product, id: String(product.id), quantity: '1' },
                { ...product, quantity: 2 },
                { ...product, id: product.id + 100000, quantity: -1 }
            ]));
        }, p);
        await shop.reload({ waitUntil: 'domcontentloaded' });
        assert.equal(await shop.locator('#cart-table-body tr').count(), 1);
        assert.equal((await shop.locator('#cart-table-body tr td').nth(3).locator('span').textContent()).trim(), '3');
        await shop.evaluate(() => localStorage.setItem('hp_store_cart', '[]'));
        console.log(`PASS UI ${base}: malformed/legacy cart recovery`);

        await shop.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
        const card = shop.locator('.product-card').filter({ hasText: originalName });
        await card.getByRole('button', { name: /Xem/ }).click();
        assert.equal(await shop.locator('#modal-body h2').textContent(), originalName);
        assert.equal(await shop.locator('#modal-body h2 img, #modal-body script').count(), 0);
        assert.equal(await shop.evaluate(() => window.__shopXss), 0);
        for (const quantity of ['-1', '1.5']) {
            await shop.locator('#detail-qty').fill(quantity);
            await shop.locator('#modal-body button').click();
            assert.equal(await shop.evaluate(() => JSON.parse(localStorage.getItem('hp_store_cart')).length), 0);
        }
        await shop.locator('#detail-qty').fill('2');
        await shop.locator('#modal-body button').click();
        await shop.locator('#product-modal').waitFor({ state: 'hidden' });
        const otherCard = shop.locator('.product-card').filter({ hasText: other.name });
        await otherCard.getByRole('button', { name: /Mua/ }).click();
        console.log(`PASS UI ${base}: escaped catalog/modal and quantity validation`);

        await shop.locator('a[href="cart.html"]').click();
        assert.equal(await shop.locator('#cart-table-body tr').count(), 2);
        assert(await shop.locator('#btn-submit-order').isDisabled());
        await shop.locator(`.cart-select[data-id="${p.id}"]`).click();
        assert(await shop.locator(`.cart-select[data-id="${p.id}"]`).isChecked());
        await shop.locator('#cust-name').fill('Khach UI TEST ' + tag);
        await shop.locator('#cust-phone').fill('0900000088');
        await shop.locator('#cust-address').fill('Dia chi UI TEST');
        // Checkout navigates immediately after the success dialog. Read the ID
        // from that user-visible dialog and verify the saved order through GET.
        const submitted = shop.waitForResponse(response =>
            new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST');
        const confirmation = shop.waitForEvent('dialog').then(dialog => dialog.message());
        await shop.locator('#btn-submit-order').click();
        assert.equal((await submitted).status(), 201);
        const orderId = (await confirmation).match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
        assert(orderId, 'Checkout must show the saved order ID');
        await shop.waitForURL(base + '/index.html');
        const remaining = await shop.evaluate(() => JSON.parse(localStorage.getItem('hp_store_cart')));
        assert.deepEqual(remaining.map(item => ({ id: item.id, quantity: item.quantity })), [{ id: other.id, quantity: 1 }]);
        const detail = (await readJson(await shop.request.get(base + '/api/orders/' + orderId), 200)).data;
        assert.equal(Number(detail.totalPrice), 2000);
        assert.equal(detail.items.length, 1);
        assert.equal(detail.items[0].name, originalName);
        assert.equal(detail.items[0].quantity, 2);
        assert.equal(Number(detail.items[0].price), 1000);
        const afterOrder = await readJson(await shop.request.get(base + '/api/products/' + p.id), 200);
        assert.equal(afterOrder.stock, 3);
        const unselected = await readJson(await shop.request.get(base + '/api/products/' + other.id), 200);
        assert.equal(unselected.stock, 3);
        console.log(`PASS UI ${base}: selected checkout, persisted order, stock and remaining cart`);

        await actionResponse(admin, 'PUT', '/api/products/' + p.id,
            () => admin.locator('#btn-save-product').click(), 409);
        await admin.waitForFunction(() => !document.querySelector('#btn-save-product').disabled);
        await admin.locator(`button[onclick="editProduct(${p.id})"]`).click();
        assert.equal(await admin.locator('#p-expected-stock').inputValue(), '3');
        await admin.locator('#p-stock').fill('4');
        await admin.locator('#p-name').fill(`PHA B UI renamed ${tag}`);
        await admin.locator('#p-price').fill('1500');
        await admin.locator('#p-desc').fill('Updated UI TEST product');
        const updated = await actionResponse(admin, 'PUT', '/api/products/' + p.id,
            () => admin.locator('#btn-save-product').click(), 200);
        assert.equal(updated.stock, 4);
        await admin.waitForFunction(() => !document.querySelector('#btn-save-product').disabled);
        console.log(`PASS UI ${base}: stale form 409, reload and valid stock update`);

        await actionResponse(admin, 'DELETE', '/api/products/' + p.id,
            () => admin.locator(`button[onclick="deleteProduct(${p.id})"]`).click(), 409);
        const disposable = await createProduct(admin, `PHA B UI delete ${tag}`, 1);
        await actionResponse(admin, 'DELETE', '/api/products/' + disposable.id,
            () => admin.locator(`button[onclick="deleteProduct(${disposable.id})"]`).click(), 200);
        await readJson(await admin.request.get(base + '/api/products/' + disposable.id), 404);
        console.log(`PASS UI ${base}: delete unused product and protect purchased product`);

        await admin.locator('button[onclick="switchTab(\'orders\')"]').click();
        const orderRow = admin.locator('#admin-orders-tbody tr').filter({ hasText: orderId });
        await orderRow.waitFor();
        assert((await orderRow.textContent()).includes(originalName));
        assert.equal(await orderRow.locator('script, img').count(), 0);
        assert.equal(await admin.evaluate(() => window.__shopXss), 0);
        assert.deepEqual(errors, []);
        console.log(`PASS UI ${base}: order history render and zero page errors`);
        return { base, orderId, productId: p.id, otherProductId: other.id, stock: 4 };
    } finally {
        await context.close();
    }
}

async function main() {
    const bases = ['http://127.0.0.1:18000', 'http://127.0.0.1:18001'];
    for (const base of bases) {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        const health = await response.json();
        assert.equal(health.environment, 'test');
        assert.equal(health.databaseName, 'shoponline_check_phase_b');
        assert(health.node === 'test-primary' || health.node === 'test-standby');
    }
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        console.log('Chrome ' + browser.version());
        const results = [];
        for (const base of bases) results.push(await checkWebsite(browser, base));
        console.log('PASS browser smoke: ' + JSON.stringify(results));
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
