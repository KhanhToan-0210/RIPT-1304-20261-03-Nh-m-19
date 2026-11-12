
// =====================================================
// LNT STORE - TRANG QUẢN TRỊ HỆ THỐNG
// Quản lý sản phẩm và đơn hàng
// =====================================================

// Lưu danh sách sản phẩm để dùng khi nhấn Sửa
let adminProducts = [];

// =====================================================
// 1. CÁC HÀM DÙNG CHUNG
// =====================================================

// Định dạng tiền Việt Nam
function formatCurrency(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        return 'Không hợp lệ';
    }

    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0
    }).format(value);
}

// Định dạng ngày giờ: DD/MM/YYYY HH:mm:ss
// Sử dụng múi giờ Việt Nam (UTC+7)
function formatDateTimeVN(value) {
    if (!value) return 'Chưa có thời gian';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Ngày không hợp lệ';
    }

    const formatter = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(date);

    const getPart = type =>
        parts.find(part => part.type === type)?.value || '00';

    const day = getPart('day');
    const month = getPart('month');
    const year = getPart('year');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');

    return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}

// Ngăn dữ liệu từ API bị hiểu thành HTML
function escapeHtml(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]
    );
}

// Chỉ sử dụng đường dẫn ảnh HTTP/HTTPS hợp lệ
function safeImageUrl(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    try {
        const url = new URL(value, window.location.origin);

        if (!['http:', 'https:'].includes(url.protocol)) {
            return '';
        }

        return url.href;
    } catch {
        return '';
    }
}

// Hàm gọi API và xử lý lỗi
async function callApi(url, options = {}) {
    const response = await fetch(url, {
        cache: 'no-store',
        ...options
    });

    const contentType =
        response.headers.get('content-type') || '';

    let data = null;

    if (contentType.includes('application/json')) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        const message =
            data && typeof data === 'object'
                ? data.message
                : null;

        throw new Error(
            message || `Máy chủ trả về lỗi HTTP ${response.status}`
        );
    }

    return data;
}

// =====================================================
// 2. CHUYỂN TAB SẢN PHẨM / ĐƠN HÀNG
// =====================================================

function switchTab(tabName) {
    const buttons = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');

    buttons.forEach(button => {
        button.classList.remove('active');
    });

    panes.forEach(pane => {
        pane.classList.remove('active');
    });

    if (tabName === 'products') {
        buttons[0]?.classList.add('active');

        document.getElementById('tab-products')
            ?.classList.add('active');

        loadAdminProducts();

    } else if (tabName === 'orders') {
        buttons[1]?.classList.add('active');

        document.getElementById('tab-orders')
            ?.classList.add('active');

        loadAdminOrders();
    }
}

// =====================================================
// 3. HIỂN THỊ DANH SÁCH SẢN PHẨM
// GET /api/products
// =====================================================

async function loadAdminProducts() {
    const tbody =
        document.getElementById('admin-product-tbody');

    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="5" style="text-align:center">
                Đang tải danh sách sản phẩm...
            </td>
        </tr>
    `;

    try {
        const products = await callApi('/api/products');

        if (!Array.isArray(products)) {
            throw new Error('Dữ liệu sản phẩm không hợp lệ');
        }

        adminProducts = products;

        if (products.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center">
                        Chưa có sản phẩm nào trong kho
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = products.map(product => {
            const id = Number(product.id);
            const imageUrl = safeImageUrl(product.image);

            const imageHtml = imageUrl
                ? `
                    <img
                        src="${escapeHtml(imageUrl)}"
                        alt="${escapeHtml(product.name)}"
                        class="admin-item-img"
                        loading="lazy"
                    >
                  `
                : `
                    <span style="color:#94a3b8;font-size:13px">
                        Chưa có ảnh
                    </span>
                  `;

            return `
                <tr>
                    <td>${imageHtml}</td>

                    <td>
                        <strong>
                            ${escapeHtml(product.name)}
                        </strong>
                    </td>

                    <td>
                        ${formatCurrency(product.price)}
                    </td>

                    <td>
                        ${escapeHtml(product.stock)}
                    </td>

                    <td>
                        <button
                            type="button"
                            class="btn btn-secondary"
                            onclick="editProduct(${id})"
                        >
                            <i class="fa-solid fa-pen"></i>
                            Sửa
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                            onclick="deleteProduct(${id})"
                        >
                            <i class="fa-solid fa-trash"></i>
                            Xóa
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Lỗi tải sản phẩm:', error);

        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center">
                    ${escapeHtml(error.message)}
                </td>
            </tr>
        `;
    }
}

// =====================================================
// 4. THÊM / SỬA SẢN PHẨM
// POST /api/products
// PUT /api/products/:id
// =====================================================

async function handleProductSubmit(event) {
    event.preventDefault();

    const id = document.getElementById('p-id').value;

    const name =
        document.getElementById('p-name').value.trim();

    const price =
        document.getElementById('p-price').value.trim();

    const stock =
        document.getElementById('p-stock').value.trim();

    const image =
        document.getElementById('p-image').value.trim();

    const description =
        document.getElementById('p-desc').value.trim();

    // Kiểm tra tên
    if (!name || name.length > 255) {
        alert('Tên sản phẩm phải có từ 1 đến 255 ký tự!');
        return;
    }

    // Kiểm tra giá
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(price)) {
        alert('Giá sản phẩm phải là số không âm hợp lệ!');
        return;
    }

    // Kiểm tra số lượng
    const quantity = Number(stock);

    if (
        !/^\d+$/.test(stock) ||
        !Number.isSafeInteger(quantity) ||
        quantity > 2147483647
    ) {
        alert('Số lượng tồn kho phải là số nguyên không âm!');
        return;
    }

    if (image && !safeImageUrl(image)) {
        alert('URL ảnh phải sử dụng HTTP hoặc HTTPS!');
        return;
    }

    if (description.length > 10000) {
        alert('Mô tả quá dài!');
        return;
    }

    const payload = {
        name,
        price,
        stock: quantity,
        image,
        description
    };

    const isEditing = Boolean(id);

    const url = isEditing
        ? `/api/products/${encodeURIComponent(id)}`
        : '/api/products';

    const method = isEditing ? 'PUT' : 'POST';

    const saveButton =
        document.getElementById('btn-save-product');

    const originalLabel = saveButton.textContent;

    try {
        saveButton.disabled = true;
        saveButton.textContent = 'Đang lưu...';

        await callApi(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        alert(
            isEditing
                ? 'Cập nhật sản phẩm thành công!'
                : 'Thêm sản phẩm mới thành công!'
        );

        resetProductForm();

        await loadAdminProducts();

    } catch (error) {
        console.error('Lỗi lưu sản phẩm:', error);

        alert(`Không thể lưu sản phẩm: ${error.message}`);

    } finally {
        saveButton.disabled = false;

        if (saveButton.textContent === 'Đang lưu...') {
            saveButton.textContent = originalLabel;
        }
    }
}

// =====================================================
// 5. ĐƯA SẢN PHẨM VÀO FORM ĐỂ SỬA
// =====================================================

function editProduct(id) {
    const product = adminProducts.find(
        item => Number(item.id) === Number(id)
    );

    if (!product) {
        alert('Không tìm thấy sản phẩm cần sửa!');
        return;
    }

    document.getElementById('p-id').value =
        product.id;

    document.getElementById('p-name').value =
        product.name ?? '';

    document.getElementById('p-price').value =
        product.price ?? '';

    document.getElementById('p-stock').value =
        product.stock ?? 0;

    document.getElementById('p-image').value =
        product.image ?? '';

    updateImagePreview(product.image ?? '');

    document.getElementById('p-desc').value =
        product.description ?? '';

    // Thay tiêu đề form
    document.getElementById('form-title').innerHTML = `
        <i class="fa-solid fa-pen-to-square"></i>
        Cập Nhật Sản Phẩm
    `;

    // Đổi tên nút lưu
    document.getElementById('btn-save-product')
        .textContent = 'Cập Nhật';

    // Hiển thị nút Hủy
    document.getElementById('btn-cancel-edit')
        .style.display = 'inline-flex';

    // Cuộn đến biểu mẫu sửa
    document.getElementById('product-form')
        .scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
}

// =====================================================
// 6. ĐẶT LẠI FORM THÊM SẢN PHẨM
// =====================================================

function resetProductForm() {
    const form = document.getElementById('product-form');

    form.reset();

    document.getElementById('p-id').value = '';

    document.getElementById('form-title').innerHTML = `
        <i class="fa-solid fa-plus-circle"></i>
        Thêm Sản Phẩm Mới
    `;

    document.getElementById('btn-save-product')
        .textContent = 'Lưu Sản Phẩm';

    document.getElementById('btn-cancel-edit')
        .style.display = 'none';

    updateImagePreview('');
}

// Cập nhật khung xem trước ảnh (Preview)
function updateImagePreview(src) {
    const container = document.getElementById('image-preview-container');
    const previewImg = document.getElementById('p-image-preview');
    const select = document.getElementById('p-image-select');

    if (!container || !previewImg) return;

    if (!src || !src.trim()) {
        container.style.display = 'none';
        previewImg.src = '';
        if (select) select.value = '';
        return;
    }

    previewImg.src = src.trim();
    container.style.display = 'block';

    if (select) {
        select.value = src.trim();
    }
}

// =====================================================
// 7. XÓA SẢN PHẨM
// DELETE /api/products/:id
// =====================================================

async function deleteProduct(id) {
    const product = adminProducts.find(
        item => Number(item.id) === Number(id)
    );

    if (!product) {
        alert('Không tìm thấy sản phẩm cần xóa!');
        return;
    }

    const confirmed = confirm(
        `Bạn có chắc chắn muốn xóa sản phẩm "${product.name}" không?`
    );

    if (!confirmed) return;

    try {
        await callApi(`/api/products/${id}`, {
            method: 'DELETE'
        });

        alert('Xóa sản phẩm thành công!');

        // Nếu đang sửa sản phẩm vừa xóa thì hủy form
        const editingId =
            document.getElementById('p-id').value;

        if (Number(editingId) === Number(id)) {
            resetProductForm();
        }

        await loadAdminProducts();

    } catch (error) {
        console.error('Lỗi xóa sản phẩm:', error);

        alert(
            `Không thể xóa sản phẩm: ${error.message}`
        );
    }
}

// =====================================================
// 8. QUẢN LÝ DANH SÁCH ĐƠN HÀNG
// GET /api/orders
// =====================================================

async function loadAdminOrders() {
    const tbody =
        document.getElementById('admin-orders-tbody');

    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="text-align:center">
                Đang tải danh sách đơn hàng...
            </td>
        </tr>
    `;

    try {
        const orders = await callApi('/api/orders');

        if (!Array.isArray(orders)) {
            throw new Error('Dữ liệu đơn hàng không hợp lệ');
        }

        if (orders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center">
                        Chưa có đơn hàng nào
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = orders.map(order => {
            // Danh sách sản phẩm trong từng đơn hàng
            const items = Array.isArray(order.items)
                ? order.items
                : [];

            const itemsHtml = items.length > 0
                ? items.map(item => `
                    <div style="margin-bottom:6px">
                        ${escapeHtml(item.name)}
                        <span style="color:#64748b">
                            (x${escapeHtml(item.quantity)})
                        </span>
                    </div>
                  `).join('')
                : '<span>Không có chi tiết</span>';

            // Định dạng ngày giờ Việt Nam
            const createdAt =
                formatDateTimeVN(order.createdAt);

            const status = order.status || 'Chờ xác nhận';

            return `
                <tr>
                    <td>
                        <strong>
                            ${escapeHtml(order.id)}
                        </strong>
                    </td>

                    <td>
                        ${escapeHtml(order.customerName)}
                    </td>

                    <td>
                        ${escapeHtml(order.customerPhone)}
                    </td>

                    <td>
                        ${escapeHtml(order.customerAddress)}
                    </td>

                    <td>
                        ${itemsHtml}
                    </td>

                    <td>
                        ${formatCurrency(order.totalPrice)}
                    </td>

                    <td class="order-date">
                        ${escapeHtml(createdAt)}
                    </td>

                    <td>
                        <span class="order-status">
                            ${escapeHtml(status)}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Lỗi lấy đơn hàng:', error);

        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center">
                    ${escapeHtml(error.message)}
                </td>
            </tr>
        `;
    }
}

// =====================================================
// 9. KHỞI TẠO TRANG QUẢN TRỊ
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    // Tải danh sách sản phẩm khi mở Admin
    loadAdminProducts();

    // Lắng nghe sự kiện chọn ảnh từ dropdown nội bộ
    const imageSelect = document.getElementById('p-image-select');
    const imageInput = document.getElementById('p-image');

    if (imageSelect && imageInput) {
        imageSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                imageInput.value = val;
                updateImagePreview(val);
            }
        });

        imageInput.addEventListener('input', (e) => {
            updateImagePreview(e.target.value);
        });
    }
});
