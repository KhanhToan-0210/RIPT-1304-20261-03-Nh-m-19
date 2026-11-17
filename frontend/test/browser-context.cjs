const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browserContext(files = ['cart.js']) {
    const elements = new Map();
    const storage = new Map();
    const alerts = [];
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, {
                value: '', innerHTML: '', innerText: '', textContent: '', src: '', disabled: false,
                style: {}, addEventListener() {}, scrollIntoView() {}, reset() {},
                classList: {
                    add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
                    contains(name) { return classes.has(name); }
                }
            });
        }
        return elements.get(id);
    }
    const context = vm.createContext({
        console, URL, Intl,
        alert(message) { alerts.push(message); },
        window: { location: { origin: 'http://localhost:18000', href: '' } },
        localStorage: {
            getItem(key) { return storage.get(key) ?? null; },
            setItem(key, value) { storage.set(key, value); }
        },
        document: { getElementById: element, querySelector: element, addEventListener() {} }
    });
    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context, { filename: file });
    }
    return { context, storage, alerts, element, evaluate: code => vm.runInContext(code, context) };
}

module.exports = browserContext;
