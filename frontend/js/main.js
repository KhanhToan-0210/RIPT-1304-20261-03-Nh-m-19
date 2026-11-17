// Quản lý hiển thị sản phẩm và chi tiết ở trang chủ
let allProducts = [];

async function loadProducts() {
  const container = document.getElementById('product-list');
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const products = await res.json();
    if (!Array.isArray(products)) throw new Error('Dữ liệu sản phẩm không hợp lệ');
    allProducts = products.filter(p => p && Number.isInteger(p.id) && p.id > 0 && p.id <= 2147483647);

    if (!allProducts || allProducts.length === 0) {
      container.innerHTML = '<p>Chưa có sản phẩm nào.</p>';
      return;
    }

    container.innerHTML = allProducts.map(p => `
      <div class="product-card">
        <img src="${escapeHtml(safeImageUrl(p.image))}" alt="${escapeHtml(p.name)}" class="product-img" onclick="showProductDetail(${p.id})">
        <div class="product-info">
          <h4 class="product-name" onclick="showProductDetail(${p.id})">${escapeHtml(p.name)}</h4>
          <div class="product-price">${formatCurrency(p.price)}</div>
          <div class="product-stock"><i class="fa-solid fa-boxes-stacked"></i> Còn lại: <strong>${escapeHtml(p.stock)}</strong></div>
          <div class="card-actions">
            <button class="btn btn-outline" style="flex: 1;" onclick="showProductDetail(${p.id})">
              <i class="fa-solid fa-circle-info"></i> Xem
            </button>
            <button class="btn btn-primary" style="flex: 1;" onclick="addToCartById(${p.id})">
              <i class="fa-solid fa-cart-plus"></i> Mua
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p style="color: red;">Không thể tải sản phẩm. Vui lòng đảm bảo backend đang chạy.</p>';
  }
}

function addToCartById(id) {
  const product = allProducts.find(p => p.id === id);
  if (product) {
    addToCart(product, 1);
  }
}

function showProductDetail(id) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div class="detail-view">
      <img src="${escapeHtml(safeImageUrl(product.image))}" alt="${escapeHtml(product.name)}">
      <div>
        <h2>${escapeHtml(product.name)}</h2>
        <p class="product-price" style="margin: 10px 0;">${formatCurrency(product.price)}</p>
        <p class="product-stock"><i class="fa-solid fa-boxes-stacked"></i> Số lượng tồn kho: <strong>${escapeHtml(product.stock)}</strong></p>
        <p style="margin: 15px 0; color: #475569; line-height: 1.5;">${escapeHtml(product.description || "Chưa có mô tả chi tiết.")}</p>
        <div style="display: flex; gap: 10px; align-items: center; margin-top: 20px;">
          <input type="number" id="detail-qty" value="1" min="1" step="1" max="${escapeHtml(product.stock)}" style="width: 70px; padding: 8px; border-radius: 6px; border: 1px solid #ccc;">
          <button class="btn btn-primary" onclick="addFromDetail(${product.id})">
            <i class="fa-solid fa-cart-plus"></i> Thêm Vào Giỏ Hàng
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('product-modal').classList.add('active');
}

function addFromDetail(id) {
  const qtyInput = document.getElementById('detail-qty');
  const qty = positiveInteger(qtyInput?.value);
  if (!qty) {
    alert('Số lượng phải là số nguyên dương hợp lệ');
    return;
  }
  const product = allProducts.find(p => p.id === id);
  if (product) {
    if (addToCart(product, qty)) closeModal();
  }
}

function closeModal() {
  document.getElementById('product-modal').classList.remove('active');
}

window.onclick = function(event) {
  const modal = document.getElementById('product-modal');
  if (event.target === modal) {
    closeModal();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
});

