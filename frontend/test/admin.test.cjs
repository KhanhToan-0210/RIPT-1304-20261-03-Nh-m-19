const test = require('node:test');
const assert = require('node:assert/strict');
const browserContext = require('./browser-context.cjs');

test('editing captures expectedStock when the form opens', async () => {
    const browser = browserContext(['admin.js']);
    browser.evaluate("adminProducts = [{id:1,name:'HP',price:'100.00',stock:5,image:'',description:''}]");
    browser.context.editProduct(1);
    browser.evaluate('adminProducts[0].stock = 3');
    browser.element('p-stock').value = '10';
    // Real DOM input values are strings.
    for (const id of ['p-id','p-name','p-price','p-stock','p-image','p-desc']) {
        browser.element(id).value = String(browser.element(id).value);
    }
    browser.element('p-expected-stock').value = String(browser.element('p-expected-stock').value);
    let payload;
    browser.context.fetch = async (url, options = {}) => {
        if (options.body) payload = JSON.parse(options.body);
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] };
    };
    await browser.context.handleProductSubmit({ preventDefault() {} });
    assert.equal(payload.expectedStock, 5);
    assert.equal(payload.stock, 10);
});

test('admin preview rejects active image schemes', () => {
    const browser = browserContext(['admin.js']);
    browser.context.updateImagePreview('javascript:alert(1)');
    assert.equal(browser.element('p-image-preview').src, '');
    assert.equal(browser.element('image-preview-container').style.display, 'none');
});
