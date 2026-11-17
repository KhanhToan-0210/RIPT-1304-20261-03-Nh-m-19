const test = require('node:test');
const assert = require('node:assert/strict');
const browserContext = require('./browser-context.cjs');
const key = 'hp_store_cart';
const product = { id: 1, name: 'HP test', price: '100.50', stock: 5, image: '/images/hp-15s.jpg' };

for (const stored of ['{invalid', 'null', '{}', 'false']) {
    test(`invalid stored cart ${stored} recovers`, () => {
        const browser = browserContext();
        browser.storage.set(key, stored);
        assert.equal(browser.context.getCart().length, 0);
        browser.context.renderCartPage();
        assert.equal(browser.element('btn-submit-order').disabled, true);
    });
}

test('legacy numeric strings and duplicate items normalize safely', () => {
    const browser = browserContext();
    browser.storage.set(key, JSON.stringify([
        { ...product, id: '1', quantity: '2' }, { ...product, quantity: 1 },
        { ...product, id: 2, quantity: -1 }, { ...product, id: 3, quantity: true },
        { ...product, id: 4, quantity: 1, price: false }
    ]));
    const items = browser.context.getCart();
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].id, 1);
});

for (const quantity of [-2, 0, 1.5, true, null, '', '1x', '1e2', 2147483648]) {
    test(`addToCart rejects quantity ${JSON.stringify(quantity)}`, () => {
        const browser = browserContext();
        assert.equal(browser.context.addToCart(product, quantity), false);
        assert.equal(browser.storage.has(key), false);
    });
}

test('cart checks stock and handles numeric quantities from old storage', () => {
    const browser = browserContext();
    browser.storage.set(key, JSON.stringify([{ ...product, quantity: '4' }]));
    assert.equal(browser.context.addToCart(product, 2), false);
    assert.equal(browser.context.addToCart(product, '1'), true);
    assert.equal(browser.context.getCart()[0].quantity, 5);
    browser.context.updateQuantity(1, 0.5);
    assert.equal(browser.context.getCart()[0].quantity, 5);
});

test('storage failures do not report an item as added', () => {
    const browser = browserContext();
    browser.context.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    assert.equal(browser.context.addToCart(product), false);
    assert.equal(browser.alerts.length, 1);
});

test('cart escapes stored names and rejects active image schemes', () => {
    const browser = browserContext();
    browser.storage.set(key, JSON.stringify([{ ...product, name: '<svg onload=alert(1)>', image: 'javascript:alert(1)', quantity: 1 }]));
    browser.context.renderCartPage();
    const html = browser.element('cart-table-body').innerHTML;
    assert.match(html, /&lt;svg/);
    assert.doesNotMatch(html, /<svg|javascript:/);
});

function checkout(browser) {
    browser.storage.set(key, JSON.stringify([{ ...product, quantity: 1 }, { ...product, id: 2, quantity: 2 }]));
    browser.element('cust-name').value = 'Test customer';
    browser.element('cust-phone').value = '0900000000';
    browser.element('cust-address').value = 'Test address';
    browser.context.toggleCartSelection(1, true);
}

test('checkout sends selected IDs/quantities, prevents duplicate submit and preserves other-tab additions', async () => {
    const browser = browserContext();
    checkout(browser);
    let complete;
    let requests = 0;
    browser.context.fetch = async (url, options) => {
        requests++;
        assert.equal(JSON.parse(options.body).items.length, 1);
        assert.deepEqual(JSON.parse(options.body).items[0], { id: 1, quantity: 1 });
        await new Promise(resolve => { complete = resolve; });
        return { ok: true, json: async () => ({ order: { id: 'test-order' } }) };
    };
    const first = browser.context.handlePlaceOrder({ preventDefault() {} });
    await browser.context.handlePlaceOrder({ preventDefault() {} });
    assert.equal(requests, 1);
    browser.context.updateQuantity(1, 1);
    assert.equal(browser.context.getCart()[0].quantity, 1);
    browser.storage.set(key, JSON.stringify([{ ...product, quantity: 3 }, { ...product, id: 2, quantity: 2 }]));
    complete();
    await first;
    assert.equal(browser.context.getCart().length, 2);
    assert.equal(browser.context.getCart()[0].quantity, 2);
    assert.equal(browser.context.getCart()[1].quantity, 2);
});

test('checkout failure keeps cart and permits retry', async () => {
    const browser = browserContext();
    checkout(browser);
    browser.context.fetch = async () => ({ ok: false, json: async () => ({ message: 'Insufficient stock' }) });
    await browser.context.handlePlaceOrder({ preventDefault() {} });
    assert.equal(browser.context.getCart().length, 2);
    assert.equal(browser.evaluate('isSubmittingOrder'), false);
    assert.equal(browser.element('btn-submit-order').disabled, false);
});
