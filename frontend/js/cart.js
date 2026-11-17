
// Quản lý giỏ hàng dùng LocalStorage
const CART_KEY = 'hp_store_cart';
const MAX_CART_QUANTITY = 2147483647;

// Lưu danh sách sản phẩm được chọn mua
const selectedProductIds = new Set();
let isSubmittingOrder = false;

function positiveInteger(value) {
  if (typeof value !== 'number' &&
      (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_CART_QUANTITY
    ? number : null;
}

function normalizeCart(cart) {
  if (!Array.isArray(cart)) return [];
  const items = new Map();
  for (const item of cart) {
    if (!item || typeof item !== 'object') continue;
    const id = positiveInteger(item.id);
    const quantity = positiveInteger(item.quantity);
    const validPriceType = typeof item.price === 'number' ||
      (typeof item.price === 'string' && /^\d+(\.\d{1,2})?$/.test(item.price));
    const price = Number(item.price);
    if (!id || !quantity || !validPriceType || !Number.isFinite(price) || price < 0 ||
        typeof item.name !== 'string' || !item.name.trim()) continue;

    const existing = items.get(id);
    if (existing) {
      if (existing.quantity + quantity <= MAX_CART_QUANTITY) existing.quantity += quantity;
    } else {
      items.set(id, {
        id, name: item.name, price, quantity,
        image: typeof item.image === 'string' ? item.image : ''
      });
    }
  }
  return [...items.values()];
}

function getCart() {
  try {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? normalizeCart(JSON.parse(cart)) : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(normalizeCart(cart)));
  } catch {
    alert('Trình duyệt không lưu được giỏ hàng. Hãy kiểm tra quyền lưu trữ và thử lại');
    return false;
  }
  updateCartBadge();
  return true;
}

// Tránh lỗi khi hiển thị dữ liệu sản phẩm trong HTML
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

// Thêm sản phẩm vào giỏ hàng
function addToCart(product, quantity = 1) {
  if (isSubmittingOrder) return false;
  const item = normalizeCart([{ ...product, quantity }])[0];
  if (!item) {
    alert('Sản phẩm hoặc số lượng không hợp lệ. Số lượng phải là số nguyên dương');
    return false;
  }
  const cart = getCart();
  const existing = cart.find(row => row.id === item.id);
  const totalQuantity = (existing?.quantity || 0) + item.quantity;
  const availableStock = product.stock === undefined ? MAX_CART_QUANTITY : Number(product.stock);
  if (!Number.isInteger(availableStock) || totalQuantity > availableStock ||
      totalQuantity > MAX_CART_QUANTITY) {
    alert('Số lượng trong giỏ vượt quá tồn kho hoặc giới hạn cho phép');
    return false;
  }

  if (existing) {
    Object.assign(existing, item, { quantity: totalQuantity });
  } else {
    cart.push(item);
  }

  if (!saveCart(cart)) return false;
  alert(`Đã thêm "${product.name}" vào giỏ hàng!`);
  return true;
}

// Xóa sản phẩm
function removeFromCart(productId) {
  if (isSubmittingOrder) return;
  const cart = getCart().filter(
    item => String(item.id) !== String(productId)
  );

  selectedProductIds.delete(String(productId));

  saveCart(cart);
  renderCartPage();
}

// Thay đổi số lượng
function updateQuantity(productId, delta) {
  if (isSubmittingOrder || (delta !== 1 && delta !== -1)) return;
  const cart = getCart();

  const item = cart.find(
    item => String(item.id) === String(productId)
  );

  if (item) {
    if (item.quantity + delta > MAX_CART_QUANTITY) {
      alert('Số lượng vượt quá giới hạn cho phép');
      return;
    }
    item.quantity += delta;

    if (item.quantity <= 0) {
      removeFromCart(productId);
      return;
    }
  }

  saveCart(cart);
  renderCartPage();
}

// Cập nhật số lượng trên biểu tượng giỏ hàng
function updateCartBadge() {
  const badge = document.getElementById('cart-count');

  if (badge) {
    const cart = getCart();

    const totalCount = cart.reduce(
      (sum, item) => sum + Number(item.quantity), 0
    );

    badge.innerText = totalCount;
  }
}

// Định dạng tiền
function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(amount);
}

// Chọn hoặc bỏ chọn sản phẩm
function toggleCartSelection(productId, checked) {
  if (isSubmittingOrder) return;
  const id = String(productId);

  if (checked) {
    selectedProductIds.add(id);
  } else {
    selectedProductIds.delete(id);
  }

  renderCartPage();
}

// Lấy những sản phẩm đã chọn
function getSelectedItems() {
  return getCart().filter(
    item => selectedProductIds.has(String(item.id))
  );
}

// Hiển thị giỏ hàng
function renderCartPage() {
  const tbody = document.getElementById('cart-table-body');
  const totalPriceEl = document.getElementById('cart-total-price');
  const emptyMsg = document.getElementById('cart-empty-msg');
  const table = document.querySelector('.cart-table');
  const btnSubmit = document.getElementById('btn-submit-order');

  if (!tbody) return;

  const cart = getCart();

  updateCartBadge();

  // Giỏ hàng trống
  if (cart.length === 0) {
    tbody.innerHTML = '';

    if (table) table.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';

    if (totalPriceEl) {
      totalPriceEl.innerText = formatCurrency(0);
    }

    if (btnSubmit) btnSubmit.disabled = true;

    return;
  }

  if (table) table.style.display = 'table';
  if (emptyMsg) emptyMsg.style.display = 'none';

  // Tạo bảng sản phẩm kèm checkbox
  tbody.innerHTML = cart.map(item => {
    const selected = selectedProductIds.has(String(item.id));

    const itemTotal =
      Number(item.price) * Number(item.quantity);

    return `
      <tr>
        <td>
          <img
            src="${escapeHtml(safeImageUrl(item.image))}"
            class="cart-item-img"
            alt="${escapeHtml(item.name)}"
          >
        </td>

        <td>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input
              type="checkbox"
              class="cart-select"
              data-id="${escapeHtml(item.id)}"
              ${selected ? 'checked' : ''}
              ${isSubmittingOrder ? 'disabled' : ''}
              style="width:18px;height:18px;accent-color:#007bff;"
            >
            <strong>${escapeHtml(item.name)}</strong>
          </label>
        </td>

        <td>${formatCurrency(Number(item.price))}</td>

        <td>
          <button
            type="button"
            class="btn btn-secondary cart-action"
            data-action="decrease"
            ${isSubmittingOrder ? 'disabled' : ''}
            data-id="${escapeHtml(item.id)}"
            style="padding:2px 8px;"
          >-</button>

          <span style="margin:0 8px;font-weight:bold;">
            ${item.quantity}
          </span>

          <button
            type="button"
            class="btn btn-secondary cart-action"
            data-action="increase"
            ${isSubmittingOrder ? 'disabled' : ''}
            data-id="${escapeHtml(item.id)}"
            style="padding:2px 8px;"
          >+</button>
        </td>

        <td style="color:#e11d48;font-weight:600;">
          ${formatCurrency(itemTotal)}
        </td>

        <td>
          <button
            type="button"
            class="btn btn-danger cart-action"
            data-action="remove"
            ${isSubmittingOrder ? 'disabled' : ''}
            data-id="${escapeHtml(item.id)}"
            style="padding:4px 8px;"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Tổng tiền chỉ tính những sản phẩm đã chọn
  const selectedItems = getSelectedItems();

  const total = selectedItems.reduce(
    (sum, item) =>
      sum + Number(item.price) * Number(item.quantity),
    0
  );

  if (totalPriceEl) {
    totalPriceEl.innerText = formatCurrency(total);
  }

  if (btnSubmit) {
    btnSubmit.disabled =
      selectedItems.length === 0 || isSubmittingOrder;
  }
}

// Xử lý đặt hàng
async function handlePlaceOrder(e) {
  e.preventDefault();

  if (isSubmittingOrder) return;

  const selectedItems = getSelectedItems();

  if (selectedItems.length === 0) {
    alert('Vui lòng chọn ít nhất 1 sản phẩm để mua!');
    return;
  }

  const customerName =
    document.getElementById('cust-name').value.trim();

  const customerPhone =
    document.getElementById('cust-phone').value.trim();

  const customerAddress =
    document.getElementById('cust-address').value.trim();

  if (!customerName || !customerPhone || !customerAddress || customerName.length > 255 ||
      customerPhone.length > 50 || customerAddress.length > 2000 || selectedItems.length > 50) {
    alert('Thông tin khách hàng hoặc số lượng sản phẩm không hợp lệ');
    return;
  }

  // Chỉ gửi những sản phẩm được chọn lên Backend
  const payload = {
    customerName,
    customerPhone,
    customerAddress,
    items: selectedItems.map(item => ({ id: item.id, quantity: item.quantity }))
  };

  isSubmittingOrder = true;
  renderCartPage();

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      alert(
        `🎉 Đặt hàng thành công!\n` +
        `Mã đơn: ${data.order.id}\n` +
        `Đã mua ${selectedItems.length} loại sản phẩm.\n` +
        `Cảm ơn bạn đã mua sắm tại LNT Store!`
      );

      // Preserve quantities added in another tab while this request was pending.
      const purchasedQuantities = new Map(
        selectedItems.map(item => [item.id, item.quantity])
      );

      const remainingCart = getCart().map(item => ({
        ...item, quantity: item.quantity - (purchasedQuantities.get(item.id) || 0)
      })).filter(item => item.quantity > 0);

      saveCart(remainingCart);
      selectedProductIds.clear();

      window.location.href = 'index.html';
    } else {
      alert(
        'Lỗi đặt hàng: ' +
        (data.message || 'Có lỗi xảy ra')
      );
    }

  } catch (error) {
    console.error(error);

    alert(
      'Không thể kết nối máy chủ để đặt hàng. ' +
      'Vui lòng kiểm tra lại Backend.'
    );
  } finally {
    isSubmittingOrder = false;
    renderCartPage();
  }
}

// Khởi tạo khi mở trang
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();

  const tbody = document.getElementById('cart-table-body');

  if (tbody) {
    // Bắt sự kiện tích chọn sản phẩm
    tbody.addEventListener('change', event => {
      if (event.target.matches('.cart-select')) {
        toggleCartSelection(
          event.target.dataset.id,
          event.target.checked
        );
      }
    });

    // Bắt sự kiện tăng, giảm và xóa sản phẩm
    tbody.addEventListener('click', event => {
      const button = event.target.closest('.cart-action');
      if (!button) return;

      const id = button.dataset.id;
      const action = button.dataset.action;

      if (action === 'increase') {
        updateQuantity(id, 1);
      } else if (action === 'decrease') {
        updateQuantity(id, -1);
      } else if (action === 'remove') {
        removeFromCart(id);
      }
    });

    renderCartPage();
  }
});
