
 // Quản lý giỏ hàng dùng LocalStorage
const CART_KEY = 'hp_store_cart';

// Lưu danh sách sản phẩm được chọn mua
const selectedProductIds = new Set();
let isSubmittingOrder = false;

function getCart() {
  const cart = localStorage.getItem(CART_KEY);
  return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
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

// Thêm sản phẩm vào giỏ hàng
function addToCart(product, quantity = 1) {
  const cart = getCart();

  const existing = cart.find(
    item => String(item.id) === String(product.id)
  );

  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      quantity: quantity
    });
  }

  saveCart(cart);
  alert(`Đã thêm "${product.name}" vào giỏ hàng!`);
}

// Xóa sản phẩm
function removeFromCart(productId) {
  const cart = getCart().filter(
    item => String(item.id) !== String(productId)
  );

  selectedProductIds.delete(String(productId));

  saveCart(cart);
  renderCartPage();
}

// Thay đổi số lượng
function updateQuantity(productId, delta) {
  const cart = getCart();

  const item = cart.find(
    item => String(item.id) === String(productId)
  );

  if (item) {
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
            src="${escapeHtml(item.image || '')}"
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

  if (!customerName || !customerPhone || !customerAddress) {
    alert('Vui lòng nhập đầy đủ thông tin khách hàng!');
    return;
  }

  // Chỉ gửi những sản phẩm được chọn lên Backend
  const payload = {
    customerName,
    customerPhone,
    customerAddress,
    items: selectedItems
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

      // Chỉ xóa những sản phẩm đã thanh toán
      const purchasedIds = new Set(
        selectedItems.map(item => String(item.id))
      );

      const remainingCart = getCart().filter(
        item => !purchasedIds.has(String(item.id))
      );

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
