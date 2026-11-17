# Database và môi trường TEST — PHA B

Các lệnh dưới đây chạy từ worktree `D:\BTL_platform\shoponline-integration`, nhánh `integration/shoponline-completion`. Kết quả thực chạy được cập nhật trong `docs/IMPLEMENTATION_STATUS.md`.

## Cấu hình TEST

| Thành phần | Cấu hình |
| --- | --- |
| Compose độc lập | `compose.test.yml` |
| Project của lần kiểm tra PHA B | `shoponline-test-b-20261117` |
| Web A / Web B | `http://127.0.0.1:18000` / `http://127.0.0.1:18001` |
| Database của mỗi cặp | `shoponline_check_phase_b` trên hai MySQL riêng |
| Volume | `shoponline-test-b-20261117_primary_test_data`, `shoponline-test-b-20261117_standby_test_data` |
| Mạng | Network riêng theo project. MySQL chỉ mở trong network này |
| Quyền web | Tài khoản `shoponline_test`, quyền trên DB TEST do MySQL entrypoint tạo |
| Khởi tạo volume mới | `01-schema.sql` rồi `02-seed.sql`, mount chỉ đọc |

Compose dùng tên container theo project. Backend/frontend được đóng gói từ worktree, và thư mục `database` được mount chỉ đọc để chạy verifier. Các mật khẩu trong file TEST là credential dành cho dữ liệu giả của môi trường này.

## Khởi tạo và chạy smoke

Sau khi Docker Engine và builder hoạt động, kiểm tra cấu hình rồi khởi tạo TEST bằng cùng project name.

```powershell
docker compose -f compose.test.yml -p shoponline-test-b-20261117 config --quiet
docker compose -f compose.test.yml -p shoponline-test-b-20261117 up -d --build --wait --wait-timeout 180
docker compose -f compose.test.yml -p shoponline-test-b-20261117 ps

# Dành cho lần đầu với volume TEST mới, trước khi tạo thêm dữ liệu.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -ProjectName shoponline-test-b-20261117 -Mode seed

# CRUD, đơn hàng, tồn kho, rollback và cạnh tranh trên MySQL.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -ProjectName shoponline-test-b-20261117 -Mode api

# Đối chiếu schema, ràng buộc và tổng tiền với số lượng bản ghi hiện tại.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -ProjectName shoponline-test-b-20261117 -Mode verify
```

Mode `seed` xác nhận 12 sản phẩm, 3 đơn, 4 chi tiết và tiếng Việt trên cả hai DB vừa khởi tạo. Các lần smoke tiếp theo dùng `api` hoặc `verify`, vì dữ liệu TEST đã phát sinh thêm. Init script của MySQL chỉ được thực thi khi volume mới được khởi tạo.

Mode `api` tạo sản phẩm và đơn hàng giả với tên riêng cho từng lượt. Các bản ghi này được giữ lại để kiểm tra. Ca DELETE sử dụng một sản phẩm giả vừa tạo, và ca kiểm tra FK thực hiện trên sản phẩm giả đã có đơn. Các API được kiểm tra gồm đọc/thêm/sửa/xóa sản phẩm, tạo/đọc đơn, rollback thiếu hàng, CHECK/FK, hai đơn tranh tồn kho cuối cùng và cập nhật stock đồng thời với đặt đơn.

## Quy ước cập nhật tồn kho

PUT sản phẩm hỗ trợ cập nhật từng phần. Khi chỉ sửa thông tin sản phẩm, bên gọi bỏ trường `stock`. Khi chỉnh tồn kho, gửi cả `stock` mới và `expectedStock` đã đọc khi mở form.

```json
{ "stock": 10, "expectedStock": 5 }
```

API thực hiện một UPDATE có điều kiện `WHERE id = ? AND stock = ?`. Nếu đơn hàng hoặc người khác đã đổi tồn kho, API trả JSON HTTP 409 và yêu cầu tải lại sản phẩm. Thiếu `expectedStock` khi gửi `stock` trả 428. Dữ liệu không hợp lệ trả 400. Admin đã gửi giá trị này từ snapshot lúc mở form.

API lỗi trả JSON có `success: false` và `message`. `/health` bổ sung `environment`, `databaseName`, `node`. Verifier kiểm tra `APP_ENV=test`, DB đích và prefix `shoponline_check_*` trước khi ghi qua HTTP.

## Unit test

Lệnh chính là `npm --prefix backend test`. Npm script chạy tuần tự các file test để giảm số tiến trình đồng thời trên máy Windows hiện tại.

Trong phiên PHA B, dependency được cài theo `backend/package-lock.json` tại `D:\BTL_platform\shoponline-unit-deps-20261117`. Có thể chạy lại bằng các lệnh sau.

```powershell
$env:NODE_PATH = 'D:\BTL_platform\shoponline-unit-deps-20261117\node_modules'
npm --prefix backend test
```

Để chuẩn bị dependency riêng trên máy khác, tạo thư mục mới rồi chạy từ worktree.

```powershell
$testDependencyPath = Join-Path ([IO.Path]::GetTempPath()) ('shoponline-unit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDependencyPath | Out-Null
Copy-Item -LiteralPath backend/package.json,backend/package-lock.json -Destination $testDependencyPath
npm ci --prefix $testDependencyPath --ignore-scripts --no-audit --no-fund
$env:NODE_PATH = Join-Path $testDependencyPath 'node_modules'
npm --prefix backend test
```

Các unit test dùng DOM/localStorage giả lập và pool DB giả lập. Nhóm kiểm tra lỗi HTTP dùng Express thật trên cổng loopback ngẫu nhiên. Kiểm thử MySQL thực tế được thực hiện bằng smoke `api` trên TEST.

## Browser smoke trên cả A/B

`scripts/browser-smoke.cjs` chạy Chrome headless với profile tạm. Script kiểm tra health có định danh TEST trước khi thao tác trên cổng 18000/18001, rồi tạo sản phẩm/đơn giả qua UI và kiểm tra giỏ hàng, XSS render, tồn kho, form cũ và CRUD admin. Các record giả được giữ lại để đối chiếu.

Phiên PHA B đã kiểm tra với Playwright `1.65.1` và Chrome `157.0.8103.79`. Máy cần có Google Chrome và hai web TEST đang hoạt động. Dependency Playwright của phiên này nằm ở thư mục riêng, có thể chạy lại bằng các lệnh sau.

```powershell
$env:NODE_PATH = 'D:\BTL_platform\shoponline-browser-deps-20261117\node_modules'
node scripts/browser-smoke.cjs
```

Để chuẩn bị công cụ kiểm thử trên máy khác, dùng thư mục mới rồi cài đúng phiên bản đã kiểm tra.

```powershell
$browserTestPath = Join-Path ([IO.Path]::GetTempPath()) ('shoponline-browser-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $browserTestPath | Out-Null
npm install --prefix $browserTestPath --ignore-scripts --no-audit --no-fund playwright@1.65.1
$env:NODE_PATH = Join-Path $browserTestPath 'node_modules'
node scripts/browser-smoke.cjs
```

Sau reboot ngày 17/11/2026, cả bootstrap seed, hai vòng smoke API, verify động và browser smoke trên A/B đều PASS. Kết quả chi tiết cùng ID đơn UI đã đối chiếu trực tiếp MySQL nằm trong mục 17 của `docs/IMPLEMENTATION_STATUS.md`.

## Các mode verifier

| Mode | Hành vi |
| --- | --- |
| `init` | Tạo DB `shoponline_check_*` mới, nạp schema/seed và kiểm tra fixture. Cần tài khoản có quyền CREATE DATABASE |
| `seed` | Đọc và xác nhận schema cùng fixture ngay sau bootstrap mới |
| `verify` | Đọc schema, FK, dữ liệu và tổng tiền với số bản ghi động |
| `api` | Kiểm tra schema rồi kiểm thử CRUD/đặt đơn trên API có định danh TEST |

ERD hiện tại nằm tại `docs/erd.png`, với nguồn Mermaid tại `docs/erd.mmd`. Các script backup, sync và failback hiện hữu được theo dõi tiếp trong kế hoạch PHA C–F.

<details>
<summary>Ghi chép lịch sử trước PHA B — code và kết quả ngày 06/11/2026</summary>

# Database tương thích backend Ly

Phạm vi thay đổi chỉ nằm trong `database/`. Backend, frontend, Docker Compose và
các script cũ trong `scripts/` được giữ nguyên. Đã đối chiếu truy vấn của backend
hiện tại sau cập nhật tại commit `f20fd99` (đã hợp nhất backend Ly).

## Chạy dự án như ban đầu

Tại thư mục gốc dự án, dùng đúng Docker Compose hiện có:

```powershell
docker compose up -d --build
```

Web chính: `http://localhost:8000`. Web dự phòng: `http://localhost:8001`.
Không cần tạo web riêng hoặc vào MySQL gõ lệnh để khởi động dự án. Các bước kiểm
thử bên dưới chỉ dành cho việc kiểm tra thay đổi database theo yêu cầu Ly; không
phải các bước chạy ứng dụng hằng ngày.

Compose hiện tại chỉ tự chạy `schema.sql` khi database volume mới được khởi tạo.
`seed.sql` là dữ liệu mẫu riêng, chưa được Compose tự nạp. Database trong volume
cũ cần được nhóm triển khai schema mới một lần; lệnh khởi động ứng dụng và cấu
hình Docker Compose vẫn giữ nguyên.

**Lưu ý về code mới:** cuối `backend/src/controllers/productController.js` đang
gán lại `createProduct`, `updateProduct`, `deleteProduct` thành các hàm trả HTTP
501. Đây là hành vi của backend hiện tại, không phải lỗi schema. Phần database
không sửa hoặc ghi đè backend. GET sản phẩm, health check và tạo/xem đơn hàng vẫn
được kiểm tra qua HTTP; dữ liệu phục vụ bài kiểm tra được tạo trực tiếp bằng SQL.

## Các trường đã đồng bộ

| Trước | Theo backend Ly |
| --- | --- |
| `products.product_id` | `products.id` |
| `products.stock_quantity` | `products.stock` |
| `products.image_url` | `products.image` |
| `orders.order_id INT` | `orders.id VARCHAR(50)` (hỗ trợ UUID) |
| `orders.total_amount` | `orders.total_price` |
| `order_items.order_item_id` | `order_items.id` |
| `order_items.order_id INT` | `order_items.order_id VARCHAR(50)` |
| `order_items.unit_price` | `order_items.price` |
| Thiếu tên sản phẩm tại thời điểm mua | Thêm `order_items.product_name` |
| Trạng thái tiếng Anh dạng ENUM | `VARCHAR(50)` mặc định `Chờ xác nhận` |
| `order_items.line_total` bắt buộc | Backend tính `SUM(price * quantity)` |

Giá dùng `DECIMAL(15,2)`, tên khách hàng 255 ký tự, điện thoại 50 ký tự, địa chỉ
`TEXT`, phù hợp với backend. Khóa ngoại chặn xóa sản phẩm đã có đơn hàng; xóa đơn
hàng sẽ xóa chi tiết của chính đơn đó. Các CHECK chặn giá/tồn kho âm và số lượng
đặt hàng không dương.

`seed.sql` chứa 12 sản phẩm HP, 3 đơn mẫu và 4 dòng chi tiết. Giá, mô tả, khách
hàng và ảnh chỉ dùng minh họa. Tồn kho mẫu là tồn kho còn lại sau các đơn mẫu.

## Kiểm tra an toàn trên database mới (tùy chọn, dành cho review)

Chạy từ thư mục gốc dự án, khi `docker compose up -d --build` đã hoàn tất:

```powershell
docker cp database primary-web:/tmp/ly-db-check
docker exec -e NODE_PATH=/app/backend/node_modules -e CHECK_DATABASE=shoponline_check_20261106_1 primary-web node /tmp/ly-db-check/verify.cjs init
```

Đổi hậu tố database mỗi lần chạy. Script chỉ nhận tên bắt đầu bằng
`shoponline_check_`, từ chối database đã tồn tại và không thay đổi `shoponline`.
Schema và seed không chứa `USE` hoặc `CREATE DATABASE`, nên luôn dùng database
do bên gọi chọn. `seed.sql` chỉ import một lần trên database mới.

`verify.cjs` kiểm tra tên trường, 12 sản phẩm HP, đơn hàng, chi tiết, tổng tiền,
UTF-8 và tính an toàn khi chạy lại schema. Để kiểm tra HTTP, chạy một web kiểm thử
riêng cùng backend hiện tại, kết nối đến database trên. Ví dụ PowerShell:

```powershell
$repoPath = (Get-Location).Path
$network = docker inspect primary-web --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}'
$image = docker inspect primary-web --format '{{.Config.Image}}'
docker run -d --name shoponline-db-check-web --network $network -p 127.0.0.1:18000:3000 -e PORT=3000 -e DB_HOST=primary-db -e DB_PORT=3306 -e DB_USER=root -e DB_PASSWORD=rootpassword -e DB_NAME=shoponline_check_20261106_1 --mount "type=bind,source=$repoPath/backend/src,target=/app/backend/src,readonly" --mount "type=bind,source=$repoPath/backend/server.js,target=/app/backend/server.js,readonly" $image
docker logs shoponline-db-check-web
# Chờ log "Server đang lắng nghe tại cổng 3000", rồi chạy:
docker exec -e NODE_PATH=/app/backend/node_modules -e CHECK_DATABASE=shoponline_check_20261106_1 -e CHECK_API=http://shoponline-db-check-web:3000/api primary-web node /tmp/ly-db-check/verify.cjs api
```

Chế độ `api` kiểm tra health check, danh sách/chi tiết sản phẩm và đơn hàng,
đặt đơn dùng UUID, trạng thái tiếng Việt, trừ tồn kho, rollback khi thiếu hàng,
khóa ngoại, và việc giữ tên/giá sản phẩm tại thời điểm đặt đơn. Bài kiểm tra cũng
xác nhận ba API quản trị hiện trả 501, không thay đổi dữ liệu; không coi đó là
CRUD đã hoạt động. Dữ liệu kiểm thử SQL và đơn hàng tạo thêm được dọn sau khi chạy.

Khi chủ động chạy bài kiểm tra trên, web kiểm thử dùng `http://localhost:18000`.
Dừng/xóa riêng container kiểm thử sau khi kiểm tra:

```powershell
docker rm -f shoponline-db-check-web
```

## Backup tự động và restore

Chạy bằng Windows PowerShell từ thư mục gốc:

```powershell
# Backup database kiểm thử; script in ra đường dẫn file SQL kết quả.
powershell -NoProfile -ExecutionPolicy Bypass -File database/backup.ps1 -DatabaseName shoponline_check_20261106_1

# Tự động backup mỗi 5 phút; Ctrl+C để dừng.
powershell -NoProfile -ExecutionPolicy Bypass -File database/auto-backup.ps1 -DatabaseName shoponline_check_20261106_1 -IntervalMinutes 5

# Restore vào database MỚI trên standby, dùng đường dẫn backup vừa tạo.
powershell -NoProfile -ExecutionPolicy Bypass -File database/restore.ps1 -BackupFile backups/TEN_FILE.sql -ContainerName standby-db -DatabaseName shoponline_check_restore_20261106

# Đối chiếu sau restore.
docker exec -e NODE_PATH=/app/backend/node_modules -e CHECK_DATABASE=shoponline_check_restore_20261106 -e DB_HOST=standby-db primary-web node /tmp/ly-db-check/verify.cjs verify
```

Backup dùng `mysqldump --single-transaction`, đọc mật khẩu từ môi trường container
và sao chép file SQL nguyên byte bằng `docker cp`, tránh lỗi UTF-16/tiếng Việt
khi dùng chuyển hướng của Windows PowerShell. Tên file có timestamp và mã riêng;
không ghi đè các bản backup cũ. Restore chỉ chấp nhận database mới, từ chối dump
chứa lệnh chuyển/tạo/xóa database và kiểm tra mã thoát của Docker/MySQL. Không đưa
backup chứa thông tin khách hàng thật lên Git.

## Áp dụng cho môi trường chính

Việc sửa `schema.sql` không đổi bảng đã nằm trong Docker volume. Cấu hình Compose
hiện chỉ import schema khi MySQL khởi tạo lần đầu và chưa tự import seed.

Các bài kiểm tra riêng không thay đổi database `shoponline`. Khi triển khai vào
môi trường chính cần backup trước khi chuyển sang schema mới; không chạy
`docker compose down -v` chỉ để cập nhật schema.

## Kết quả kiểm tra với code mới `f20fd99`

Đã chạy schema và seed trên database mới `shoponline_check_20261106_v2`.
Bài kiểm tra đã dùng một web tạm tại cổng `18000`, mount backend chỉ đọc, và kết
nối đến database này. Web tạm được dọn sau kiểm tra; không tham gia cách chạy dự
án bằng Compose. Không thay đổi code backend hay cấu hình Compose.

- `init`: đạt; kiểm tra kiểu cột, độ dài, mặc định trạng thái, UTF-8, 12 sản phẩm
  HP, 3 đơn mẫu, 4 dòng chi tiết và tổng tiền.
- `api`: đạt; health check, đọc sản phẩm/đơn hàng, UUID, trạng thái lưu thực tế,
  trừ tồn kho, giữ tên/giá cũ trong chi tiết, rollback và ràng buộc khóa ngoại.
- POST/PUT/DELETE sản phẩm: xác nhận trả 501, không coi là chức năng đã hoàn tất.
- Backup/restore: đạt; khôi phục vào database mới
  `standby-db/shoponline_check_restore_20261106_v2` rồi đối chiếu lại dữ liệu.

Database `shoponline` chính và dự phòng được giữ nguyên trong giai đoạn kiểm thử.

## Lần triển khai theo yêu cầu người dùng ngày 06/11/2026

Sau khi được yêu cầu dừng web cũ và chạy lại với database mới, đã thực hiện:

- Dừng `primary-web`, `standby-web` và server Node.js cũ ở cổng 3000.
- Backup `shoponline` của cả hai container vào
  `D:\BTL_platform\database-deployment-backups`.
- Tạo lại riêng database `shoponline` trong `primary-db` và `standby-db`, nạp
  `schema.sql` và `seed.sql` đã kiểm thử. Các database kiểm thử khác không bị xóa.
- Khởi động lại bằng `docker compose up -d --build`, giữ nguyên backend và cấu
  hình Compose. Chỉ còn hai web của dự án ở cổng `8000` và `8001`.
- Xác nhận cả hai trang trả HTTP 200, `/health` báo database connected, API có
  12 sản phẩm HP và 3 đơn mẫu; đơn `DEMO-HP-001` có tổng 27.980.000 và trạng thái
  `Chờ xác nhận`.

Backup trước triển khai:

- Primary: `shoponline_20261106_231635_a087f9c4.sql`.
- Standby: `shoponline_20261106_231636_338c96fc.sql`.

Các lần khởi động sau tiếp tục dùng cùng lệnh Compose; không cần import lại seed.

</details>
