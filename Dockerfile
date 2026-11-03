# Sử dụng Node.js bản gọn (Alpine)
FROM node:20-alpine

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Copy các file cấu hình thư viện trước để tận dụng Docker cache
COPY backend/package*.json ./backend/

# Di chuyển vào thư mục backend và cài đặt thư viện
WORKDIR /app/backend
RUN npm install --omit=dev

# Trở về thư mục gốc và sao chép toàn bộ mã nguồn
WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend

# Khai báo cổng ứng dụng chạy
EXPOSE 3000

# Thiết lập thư mục chạy mặc định
WORKDIR /app/backend

# Lệnh khởi động server
CMD ["node", "server.js"]

