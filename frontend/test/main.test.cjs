const test = require('node:test');
const assert = require('node:assert/strict');
const browserContext = require('./browser-context.cjs');

test('catalog and modal escape API data and reject injected IDs and image schemes', async () => {
    const browser = browserContext(['cart.js', 'main.js']);
    browser.context.fetch = async () => ({ ok: true, json: async () => [
        { id: 1, name: '<svg onload=alert(1)>', description: '<script>alert(2)</script>', image: 'javascript:alert(3)', price: 100, stock: 3 },
        { id: '1);alert(4)', name: 'bad ID' }
    ] });
    await browser.context.loadProducts();
    browser.context.showProductDetail(1);
    const html = browser.element('product-list').innerHTML + browser.element('modal-body').innerHTML;
    assert.match(html, /&lt;svg/);
    assert.match(html, /&lt;script/);
    assert.doesNotMatch(html, /<svg|<script|javascript:|bad ID/);
});

for (const quantity of ['-1', '0', '1.5', '1x', '', '9999999999999999']) {
    test(`detail form rejects quantity ${JSON.stringify(quantity)}`, () => {
        const browser = browserContext(['cart.js', 'main.js']);
        browser.evaluate("allProducts = [{id:1,name:'HP',price:100,stock:5}]");
        browser.element('detail-qty').value = quantity;
        browser.context.addFromDetail(1);
        assert.equal(browser.context.getCart().length, 0);
    });
}

test('detail form adds a valid quantity through the normal entry point', () => {
    const browser = browserContext(['cart.js', 'main.js']);
    browser.evaluate("allProducts = [{id:1,name:'HP',price:100,stock:5}]");
    browser.element('detail-qty').value = '2';
    browser.context.addFromDetail(1);
    assert.equal(browser.context.getCart()[0].quantity, 2);
});

test('failed catalog HTTP response shows a loading error', async () => {
    const browser = browserContext(['cart.js', 'main.js']);
    browser.context.fetch = async () => ({ ok: false, status: 503 });
    await browser.context.loadProducts();
    assert.match(browser.element('product-list').innerHTML, /<p/);
    assert.equal(browser.evaluate('allProducts.length'), 0);
});
