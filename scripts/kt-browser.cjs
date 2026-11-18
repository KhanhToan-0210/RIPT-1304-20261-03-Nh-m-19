const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function capturePage(url, file) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.screenshot({ path: file, fullPage: true });
    } finally { await browser.close(); }
}

async function browserOrder(stage, progress, directory, saveProgress) {
    const base = 'http://127.0.0.1:18080';
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    fs.mkdirSync(directory, { recursive: true });
    const errors = [];
    const dialogs = [];
    const screenshots = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN' });
        if (progress.pendingKey) {
            await context.addInitScript(({ key, body }) => localStorage.setItem('shoponline_pending_mutations_v1',
                JSON.stringify({ 'POST /api/orders': { key, body } })), { key: progress.pendingKey, body: progress.pendingBody });
        }
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => {
            const message = dialog.message();
            dialogs.push(message);
            const id = message.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
            if (id && message.includes('Đặt hàng thành công')) {
                progress.orderId = id;
                progress.confirmation = message;
                progress.orderAcknowledgedAt = new Date().toISOString();
                saveProgress();
            }
            await dialog.accept();
        });
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/orders') {
                progress.pendingKey = request.headers()['idempotency-key'];
                progress.pendingBody = request.postData();
                saveProgress();
            }
        });
        page.on('response', async response => {
            if (response.status() === 201 && response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/orders') {
                try {
                    const body = await response.json();
                    progress.orderId = body.order.id;
                    progress.orderResponse = body;
                    progress.orderAcknowledgedAt = new Date().toISOString();
                    saveProgress();
                } catch { /* The confirmation dialog retains the ID across navigation. */ }
            }
        });
        await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
        const card = page.locator('.product-card').filter({ hasText: progress.product.name });
        await card.waitFor();
        const catalog = path.join(directory, 'catalog.png');
        await page.screenshot({ path: catalog, fullPage: true });
        screenshots.push(catalog);
        if (!progress.orderId) {
            await card.getByRole('button', { name: /Xem/ }).click();
            await page.locator('#detail-qty').fill('2');
            await page.locator('#modal-body button').click();
            await page.locator('#product-modal').waitFor({ state: 'hidden' });
            await page.locator('a[href="cart.html"]').click();
            await page.locator(`.cart-select[data-id="${progress.product.id}"]`).click();
            await page.locator('#cust-name').fill(stage + ' TEST 20261118');
            await page.locator('#cust-phone').fill('0900000000');
            await page.locator('#cust-address').fill('Địa chỉ kiểm thử ShopOnline');
            const checkout = path.join(directory, 'checkout.png');
            await page.screenshot({ path: checkout, fullPage: true });
            screenshots.push(checkout);
            const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/orders');
            await page.locator('#btn-submit-order').click();
            const response = await submitted;
            assert.equal(response.status(), 201);
            await page.waitForURL(base + '/index.html');
            assert.ok(progress.orderId);
            assert.ok(dialogs.some(text => text.includes(progress.orderId)));
        }
        await page.goto(base + '/admin.html', { waitUntil: 'domcontentloaded' });
        await page.locator('button[onclick="switchTab(\'orders\')"]').click();
        const row = page.locator('#admin-orders-tbody tr').filter({ hasText: progress.orderId });
        await row.waitFor();
        await row.scrollIntoViewIfNeeded();
        const orderPage = path.join(directory, 'order-success.png');
        const orderRow = path.join(directory, 'order-row.png');
        // Capture only the TEST order, avoiding unrelated customer records.
        await row.screenshot({ path: orderPage });
        await row.screenshot({ path: orderRow });
        screenshots.push(orderPage, orderRow);
        assert.ok((await row.textContent()).includes(progress.product.name));
        assert.deepEqual(errors, []);
        const health = await context.newPage();
        await health.goto(base + '/ready');
        const ready = path.join(directory, 'gateway-readiness.png');
        await health.screenshot({ path: ready, fullPage: true });
        screenshots.push(ready);
        fs.writeFileSync(path.join(directory, 'browser.json'), JSON.stringify({ time: new Date().toISOString(),
            chrome: browser.version(), orderId: progress.orderId, dialogs, pageErrors: errors, screenshots }, null, 2));
        return { orderId: progress.orderId, screenshots, chrome: browser.version(), dialogs, pageErrors: errors };
    } finally { await browser.close(); }
}

module.exports = { browserOrder, capturePage };
