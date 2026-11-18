(function () {
    const storageKey = 'shoponline_pending_mutations_v1';
    function read() {
        const text = localStorage.getItem(storageKey);
        if (!text) return {};
        try {
            const result = JSON.parse(text);
            if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
            return result;
        } catch {
            throw new Error('Không đọc được thông tin giao dịch đang chờ. Hãy kiểm tra đơn đã lưu trước khi đặt lại.');
        }
    }
    async function mutate(url, options) {
        const method = String(options.method || 'POST').toUpperCase();
        const operation = method + ' ' + url;
        const body = options.body || '';
        const pending = read();
        if (pending[operation] && pending[operation].body !== body) {
            throw new Error('Giao dịch trước đang chờ xác nhận. Hãy gửi lại nội dung cũ hoặc kiểm tra kết quả trước khi thay đổi.');
        }
        const request = pending[operation] || { key: crypto.randomUUID(), body };
        pending[operation] = request;
        localStorage.setItem(storageKey, JSON.stringify(pending));
        const headers = new Headers(options.headers || {});
        headers.set('Idempotency-Key', request.key);
        const response = await fetch(url, { ...options, headers });
        let result;
        try { result = await response.clone().json(); } catch { result = {}; }
        const refused = ['MAINTENANCE', 'NODE_INACTIVE', 'COORDINATOR_UNAVAILABLE', 'WRITE_ADMISSION_UNAVAILABLE',
            'ADMISSION_TIMEOUT', 'STALE_GATEWAY_GENERATION', 'DATABASE_BINDING_INVALID'];
        if (response.ok || response.status < 500 || refused.includes(result.code)) {
            const latest = read();
            delete latest[operation];
            localStorage.setItem(storageKey, JSON.stringify(latest));
        }
        return response;
    }
    window.ShopOnlineApi = { mutate, pending: read };
})();
