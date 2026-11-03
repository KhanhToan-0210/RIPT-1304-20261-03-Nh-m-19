# Dự Án Web Bán Hàng HP (Phân Tách Frontend & Backend API)

Dự án này đã được tổ chức phân chia rõ ràng thành 2 phần độc lập: **Giao diện Web (`frontend`)** và **Mã nguồn API (`backend`)**, kèm theo hỗ trợ **Docker & Docker Compose**.

---

## 1. Cấu Trúc Thư Mục

```text
Web bán hàng hp nhập môn cn nền tảng/
│
├── Dockerfile                    # Cấu hình đóng gói container Docker
├── docker-compose.yml            # Khởi chạy ứng dụng và cấu hình mount volume
├── .dockerignore                 # Các file bỏ qua khi đóng gói container
│
├── frontend/                     # 🌐 CHUYÊN CHỨA GIAO DIỆN WEB
│   ├── index.html                # Trang chủ (Danh sách & Xem chi tiết sản phẩm)
│   ├── cart.html                 # Giỏ hàng & Form nhập thông tin đặt hàng
│   ├── admin.html                # Bảng điều khiển quản trị (CRUD sản phẩm, xem đơn hàng)
│   ├── css/
│   │   └── style.css             # Định kiểu giao diện CSS
│   └── js/
│       ├── main.js               # Logic lấy sản phẩm từ API và hiển thị
│       ├── cart.js               # Logic giỏ hàng, gọi API đặt hàng
│       └── admin.js              # Logic gọi API Thêm/Sửa/Xóa sản phẩm, xem đơn hàng
│
├── backend/                      # ⚙️ CHUYÊN CHỨA MÃ NGUỒN MÁY CHỦ & API
│   ├── package.json              # Khai báo các thư viện (Express, CORS)
│   ├── server.js                 # Điểm khởi chạy chính của máy chủ Backend API
│   ├── data/
│   │   └── database.json         # Tệp lưu trữ CSDL (Tự động sinh khi chạy)
│   └── src/
│       ├── config/
│       │   └── db.js             # Cấu hình đọc/ghi cơ sở dữ liệu
│       ├── controllers/          # Tầng xử lý logic nghiệp vụ
│       │   ├── productController.js   # Logic: lấy, thêm, sửa, xóa sản phẩm
│       │   └── orderController.js     # Logic: tạo đơn, xem đơn hàng
│       └── routes/               # Tầng định tuyến API Endpoints
│           ├── productRoutes.js       # URL /api/products
│           └── orderRoutes.js         # URL /api/orders
│
└── README.md
```

---

## 2. Cách Chạy Với Docker (Khuyên Dùng) 🐳

Máy tính của bạn đã có sẵn **Docker & Docker Compose**.

### Cách 1: Sử dụng Docker Compose (Đơn giản nhất - chỉ 1 lệnh)
Mở terminal tại thư mục gốc của dự án (`Web bán hàng hp nhập môn cn nền tảng/`) và gõ:

```bash
docker-compose up --build
```
> Hoặc chạy ngầm trong nền (background):
> ```bash
> docker-compose up -d --build
> ```

- **Dừng container**:
  ```bash
  docker-compose down
  ```

### Cách 2: Sử dụng Dockerfile thuần
```bash
# Build image
docker build -t hp-store .

# Chạy container trên cổng 3000
docker run -p 3000:3000 --name hp-store-container hp-store
```

---

## 3. Cách Chạy Không Dùng Docker (Node.js truyền thống)

1. Mở terminal vào thư mục `backend`:
   ```bash
   cd backend
   ```
2. Cài thư viện và chạy:
   ```bash
   npm install
   npm start
   ```

---

## 4. Truy Cập Hệ Thống

Sau khi khởi chạy (bằng Docker hoặc Node.js):
- **Trang chủ mua hàng:** [http://localhost:3000](http://localhost:3000)
- **Trang giỏ hàng & thanh toán:** [http://localhost:3000/cart.html](http://localhost:3000/cart.html)
- **Trang quản trị (Admin):** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
