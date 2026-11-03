// Quản lý nghiệp vụ trang Admin (CRUD sản phẩm & xem đơn hàng)
let adminProducts = [];

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

  if (tabName === 'products') {
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.getElementById('tab-products').classList.add('active');
    loadAdminProducts();
  } else {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('tab-orders').classList.add('active');
    loadAdminOrders();
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// 1. Quản lý sản phẩm
async function loadAdminProducts() {
  try {
    const res = await fetch('/api/products');
    adminProducts = await res.json();

    const tbody = document.getElementById('admin-product-tbody');
    tbody.innerHTML = adminProducts.map(p => `
      <tr>
        <td><img src="${p.image}" class="admin-item-img" alt="${p.name}"></td>
        <td><strong>${p.name}</strong></td>
        <td>${formatCurrency(p.price)}</td>
        <td>${p.stock}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 8px;" onclick="editProduct(${p.id})">
            <i class="fa-solid fa-pen"></i> Sửa
          </button>
          <button class="btn btn-danger" style="padding: 4px 8px;" onclick="deleteProduct(${p.id})">
            <i class="fa-solid fa-trash"></i> Xóa
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('p-id').value;
  const name = document.getElementById('p-name').value.trim();
  const price = document.getElementById('p-price').value;
  const stock = document.getElementById('p-stock').value;
  const image = document.getElementById('p-image').value.trim();
  const description = document.getElementById('p-desc').value.trim();

  const payload = { name, price, stock, image, description };

  try {
    let res;
    if (id) {
      // Sửa sản phẩm
      res = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      // Thêm sản phẩm
      res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (res.ok) {
      alert(id ? "Cập nhật sản phẩm thành công!" : "Thêm sản phẩm mới thành công!");
      resetProductForm();
      loadAdminProducts();
    } else {
      alert("Lỗi khi lưu sản phẩm!");
    }
  } catch (err) {
    console.error(err);
    alert("Không thể kết nối máy chủ!");
  }
}

function editProduct(id) {
  const p = adminProducts.find(item => item.id === id);
  if (!p) return;

  document.getElementById('p-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-stock').value = p.stock;
  document.getElementById('p-image').value = p.image || '';
  document.getElementById('p-desc').value = p.description || '';

  document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Cập Nhật Sản Phẩm';
  document.getElementById('btn-save-product').innerText = 'Cập Nhật';
  document.getElementById('btn-cancel-edit').style.display = 'inline-block';
}

function resetProductForm() {
  document.getElementById('product-form').reset();
  document.getElementById('p-id').value = '';
  document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-plus-circle"></i> Thêm Sản Phẩm Mới';
  document.getElementById('btn-save-product').innerText = 'Lưu Sản Phẩm';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

async function deleteProduct(id) {
  if (!confirm("Bạn có chắc chắn muốn xóa sản phẩm này không?")) return;

  try {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert("Đã xóa sản phẩm thành công!");
      loadAdminProducts();
    } else {
      alert("Xóa thất bại!");
    }
  } catch (err) {
    console.error(err);
    alert("Không thể kết nối máy chủ!");
  }
}

// 2. Quản lý đơn hàng
async function loadAdminOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();

    const tbody = document.getElementById('admin-orders-tbody');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Chưa có đơn hàng nào.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const itemsList = o.items.map(it => `• ${it.name} (x${it.quantity})`).join('<br>');
      return `
        <tr>
          <td><strong>${o.id}</strong></td>
          <td>${o.customerName}</td>
          <td>${o.customerPhone}</td>
          <td>${o.customerAddress}</td>
          <td><small>${itemsList}</small></td>
          <td style="color: #e11d48; font-weight: bold;">${formatCurrency(o.totalPrice)}</td>
          <td><small>${o.createdAt}</small></td>
          <td><span style="background: #e0f2fe; color: #0284c7; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${o.status}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAdminProducts();
});

