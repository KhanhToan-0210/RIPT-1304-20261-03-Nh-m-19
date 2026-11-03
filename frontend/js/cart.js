// Quản lý giỏ hàng dùng LocalStorage
const CART_KEY = 'hp_store_cart';

function getCart() {
  const cart = localStorage.getItem(CART_KEY);
  return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(product, quantity = 1) {
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);

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

function removeFromCart(productId) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== productId);
  saveCart(cart);
  renderCartPage();
}

function updateQuantity(productId, delta) {
  const cart = getCart();
  const item = cart.find(item => item.id === productId);
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

function updateCartBadge() {
  const badge = document.getElementById('cart-count');
  if (badge) {
    const cart = getCart();
    const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.innerText = totalCount;
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Render dữ liệu nếu đang ở trang Cart
function renderCartPage() {
  const tbody = document.getElementById('cart-table-body');
  const totalPriceEl = document.getElementById('cart-total-price');
  const emptyMsg = document.getElementById('cart-empty-msg');
  const table = document.querySelector('.cart-table');
  const btnSubmit = document.getElementById('btn-submit-order');

  if (!tbody) return; // Không phải trang cart

  const cart = getCart();
  updateCartBadge();

  if (cart.length === 0) {
    tbody.innerHTML = '';
    if (table) table.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (totalPriceEl) totalPriceEl.innerText = formatCurrency(0);
    if (btnSubmit) btnSubmit.disabled = true;
    return;
  }

  if (table) table.style.display = 'table';
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (btnSubmit) btnSubmit.disabled = false;

  let total = 0;
  tbody.innerHTML = cart.map(item => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    return `
      <tr>
        <td><img src="${item.image}" class="cart-item-img" alt="${item.name}"></td>
        <td><strong>${item.name}</strong></td>
        <td>${formatCurrency(item.price)}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 2px 8px;" onclick="updateQuantity(${item.id}, -1)">-</button>
          <span style="margin: 0 8px; font-weight: bold;">${item.quantity}</span>
          <button class="btn btn-secondary" style="padding: 2px 8px;" onclick="updateQuantity(${item.id}, 1)">+</button>
        </td>
        <td style="color: #e11d48; font-weight: 600;">${formatCurrency(itemTotal)}</td>
        <td>
          <button class="btn btn-danger" style="padding: 4px 8px;" onclick="removeFromCart(${item.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (totalPriceEl) {
    totalPriceEl.innerText = formatCurrency(total);
  }
}

// Xử lý khi nhấn Đặt Hàng
async function handlePlaceOrder(e) {
  e.preventDefault();
  const cart = getCart();

  if (cart.length === 0) {
    alert("Giỏ hàng của bạn đang trống!");
    return;
  }

  const customerName = document.getElementById('cust-name').value.trim();
  const customerPhone = document.getElementById('cust-phone').value.trim();
  const customerAddress = document.getElementById('cust-address').value.trim();

  const payload = {
    customerName,
    customerPhone,
    customerAddress,
    items: cart
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      alert(`🎉 Đặt hàng thành công!\nMã đơn: ${data.order.id}\nCảm ơn bạn đã mua sắm tại HP Store!`);
      localStorage.removeItem(CART_KEY);
      window.location.href = 'index.html';
    } else {
      alert("Lỗi đặt hàng: " + (data.message || "Có lỗi xảy ra"));
    }
  } catch (error) {
    console.error(error);
    alert("Không thể kết nối máy chủ để đặt hàng. Vui lòng kiểm tra lại server backend.");
  }
}

// Tự động cập nhật badge khi mở trang
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  if (document.getElementById('cart-table-body')) {
    renderCartPage();
  }
});

