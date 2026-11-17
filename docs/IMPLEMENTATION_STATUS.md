# ShopOnline — Trạng thái triển khai PHA A và PHA B

Ngày kiểm tra 17/11/2026, múi giờ Asia/Saigon.

**Cập nhật hiện tại — PHA B đạt cổng nghiệm thu trên TEST sau khi khởi động lại Windows.** Unit test 47/47, bootstrap, hai vòng smoke API, UI trên cả A/B và đối chiếu MySQL đều PASS. Chi tiết file, kết quả và bàn giao ở mục 10–17. Đang chờ người dùng review kết quả PHA B trước PHA C.

## 1. Phạm vi và điểm xuất phát của PHA A

Yêu cầu trực tiếp hiện tại là kiểm tra mã mới nhất trong workspace, xác định chức năng còn thiếu và trình kế hoạch để người dùng duyệt. Tài liệu `ShopOnline_Codex_Hoan_Thien_Du_An_Truoc_Minh_Chung.md` được dùng để đối chiếu DOD và thứ tự các pha. Các prompt, lệnh vận hành và kết quả lịch sử trong tài liệu là dữ liệu tham khảo cho kế hoạch.

| Hạng mục | Kết quả |
| --- | --- |
| Repository thực tế | `D:\BTL_platform\RIPT-1304-20261-03-Nh-m-19` |
| Nhánh đang mở | `feature/nam-database` |
| HEAD | `b1aef42210aa6378808a550aad7530510afbdc46` |
| Commit gần nhất | `b1aef42` — `dong bo du lieu 2 trang` |
| Working tree trước audit | Sạch |
| Quan hệ tracking lưu cục bộ | Ahead 4 so với `origin/feature/nam-database` |
| Ref tích hợp lưu cục bộ | `origin/B24DCCC261-Toan` cùng HEAD `b1aef42` |
| Phạm vi xác nhận mã mới nhất | HEAD cục bộ và các remote-tracking ref đã có trong checkout. Thời điểm cập nhật trên GitHub chưa được xác minh trong lần audit này |
| Hướng dẫn repository | Tìm kiếm trong workspace và các đường dẫn tổ tiên đã kiểm tra cho kết quả 0 file `AGENTS.md` |
| Thay đổi tạo trong PHA A | `docs/IMPLEMENTATION_STATUS.md` |

### Môi trường quan sát được

- Node.js `v22.13.0`, npm `10.9.2`, Windows PowerShell `5.1.26100.9711`.
- `docker compose config --services` đọc được 4 dịch vụ `primary-db`, `primary-web`, `standby-db`, `standby-web`.
- Docker CLI `29.9.2` có sẵn. Lần đọc trong sandbox gặp cảnh báo quyền truy cập Docker config. Kiểm tra chỉ đọc với quyền mở rộng xác nhận context hiện tại là `desktop-linux` và endpoint `dockerDesktopLinuxEngine` chưa khả dụng.
- `docker compose ps` thất bại vì thiếu named pipe của Engine. Trạng thái kiểm thử Docker/MySQL hiện tại là **BLOCKED**.
- Cả 6 GET tới `/health`, `/api/products`, `/api/orders` trên `localhost:8000` và `localhost:8001` đều trả lỗi kết nối `ECONNREFUSED`.
- Sơ đồ cấu hình hiện tại gồm A tại `8000`, DB A publish `3308`, B tại `8001`, DB B publish `3309`. Hai cặp dùng volume riêng trên cùng host.
- Schema và dữ liệu thực tế trong các volume cần được xác nhận khi Engine sẵn sàng. Những kết quả ngày 06/11 được ghi trong `database/README.md` là lịch sử của phiên bản trước.

## 2. Đối chiếu tài liệu với HEAD tại PHA A

| Phát hiện trong tài liệu | Kết quả đọc mã hiện tại | Kết luận triển khai |
| --- | --- | --- |
| CRUD sản phẩm bị gán lại thành 501 | Commit `81fc0ee` đã khôi phục đầy đủ POST/PUT/DELETE. Route trỏ tới các hàm thực tế. Xóa sản phẩm đã bán trả 409 và dùng transaction | Phần khôi phục source đạt **DONE**. Cần kiểm thử CRUD và cập nhật verifier |
| Giỏ hàng cơ bản | Commit `3ac4b6b` thêm chọn từng sản phẩm và khóa gửi đơn khi đang chờ phản hồi | Đã có trong source. Cần kiểm tra biên dữ liệu giỏ hàng và luồng UI |
| Ảnh sản phẩm | Commit `7ae3170` bổ sung ảnh cục bộ, dropdown và preview trong admin | Kế hoạch sẽ tận dụng giao diện đã có |
| Thiếu đồng bộ A/B | Commit `b1aef42` thêm `sync-primary-to-standby.ps1` và `failback-to-primary.ps1` | Đã có script, còn thiếu điều phối writer, restore DB mới, xác minh và rollback |
| B cố định vào `shoponline` | `docker-compose.yml` vẫn cố định DB_NAME của cả A/B | Luồng restore an toàn trong `database/restore.ps1` chưa nối được tới web bằng cấu hình hiện tại |
| Thiếu replication | Compose và các script hiện có triển khai copy bằng dump/import | Cần thiết kế và đo RPO theo snapshot |
| Rủi ro encoding trong script cũ | Script đồng bộ mới tiếp tục dùng `>` và `Get-Content` qua pipe | Cả 5 dump được Git theo dõi hiện có BOM UTF-16LE `FF FE` |
| ERD cũ | Đã xem trực tiếp `docs/erd.png`. Ảnh dùng `product_id`, `stock_quantity`, `image_url`, `orders.order_id INT`, `total_amount` | Cần cập nhật theo schema SQL hiện tại |
| Secrets/root/port DB | Compose và các script cũ còn mật khẩu cố định, backend dùng root, publish DB trên mọi interface | Cần cấu hình bằng biến môi trường và quyền DB phù hợp |

## 3. Các thiếu sót ghi nhận trong PHA A

### P0 — Đường chuyển dữ liệu và quyền ghi

1. **Đồng bộ hiện tại có thể ghi đè dữ liệu đang phục vụ.** `scripts/sync-primary-to-standby.ps1` dòng 18–24 import trực tiếp vào `standby-db/shoponline`. `scripts/failback-to-primary.ps1` dòng 13–18 import trực tiếp vào `primary-db/shoponline`. Cả 5 dump hiện hữu chứa `DROP TABLE`. Cần đổi luồng sang DB đích mới và chuyển web sau khi xác minh.
2. **Các script trên có thể thông báo thành công sau khi Docker/MySQL lỗi.** Chúng thiếu kiểm tra `$LASTEXITCODE`. `$ErrorActionPreference = 'Stop'` trên PowerShell 5.1 chưa đủ để xử lý mã thoát lỗi của chương trình native. Backup legacy cũng thiếu `--single-transaction`.
3. **Bản dump đang có định dạng UTF-16LE.** `database/backup.ps1` đã dùng `docker cp` để giữ nguyên byte, nhưng `database/restore.ps1` chưa có kiểm tra định dạng byte hay checksum trước import. Cần xử lý rõ dump UTF-16LE và bảo toàn tiếng Việt.
4. **Thiếu một writer và maintenance/drain.** Hai web đều có route ghi đơn và CRUD. Compose, backend và scripts chưa có cơ chế fencing phía ứng dụng. Gateway cần đi cùng cơ chế chặn ghi ở backend, bao phủ cả cổng chẩn đoán.
5. **Thiếu URL chung và chuyển cấu hình DB có kiểm soát.** Chưa có gateway, script chuyển upstream, trạng thái bền vững, kiểm tra nguồn dữ liệu hoặc rollback theo bước.

### P1 — Ứng dụng và độ tin cậy kiểm thử

6. **Verifier lệch backend mới.** `database/verify.cjs` dòng 94, 100, 101 vẫn yêu cầu POST/PUT/DELETE trả 501. Bài kiểm thử hiện tại sẽ thất bại với CRUD mới. POST tại dòng 94 còn nằm trước khối `try/finally` dọn fixture, nên có thể để lại sản phẩm sau khi assertion lỗi.
7. **Verifier chỉ phù hợp fixture cố định.** Nó bắt buộc 12 sản phẩm, 3 đơn, 4 chi tiết và ảnh HTTPS. Cần tách kiểm tra fixture khởi tạo với đối chiếu snapshot động, hỗ trợ sản phẩm dùng ảnh cục bộ và đơn phát sinh trên B.
8. **Khởi tạo mới thiếu seed.** Compose chỉ mount `schema.sql`. Volume mới sẽ có bảng rỗng. Cần một đường khởi tạo TEST có thứ tự schema → seed và kiểm tra schema của volume cũ trước khi chọn cách chuyển dữ liệu.
9. **Lỗi dữ liệu giỏ hàng.** `getCart()` parse JSON trực tiếp, dữ liệu localStorage hỏng gây exception. `addToCart()` chấp nhận số lượng âm, trong khi form chi tiết dùng `parseInt()` và thiếu kiểm tra giới hạn trước khi lưu. Đã tái hiện parse lỗi và lưu số lượng âm bằng VM với bộ nhớ giả lập.
10. **Trang chủ render dữ liệu sản phẩm trực tiếp thành HTML.** `frontend/js/main.js` dòng 15–32 và 51–67 đưa tên, mô tả, URL ảnh vào `innerHTML`. Chẩn đoán VM xác nhận chuỗi thẻ HTML từ dữ liệu giữ nguyên trong kết quả render. Có thể tái sử dụng cách escape đang dùng trong frontend và kiểm tra URL ảnh.
11. **Cập nhật sản phẩm có nguy cơ ghi lại tồn kho cũ.** Admin luôn gửi cả `stock`. Backend đọc rồi cập nhật mọi trường bằng truy vấn riêng, nên lần sửa thông tin dựa trên form cũ có thể ghi đè phần tồn kho vừa bị đơn hàng trừ. Đây là suy luận từ đường thực thi, cần bài kiểm thử cạnh tranh trên MySQL để chốt cách xử lý xung đột.
12. **Health đã kiểm tra kết nối DB, còn thiếu thông tin phục vụ chuyển đổi.** `/health` có `SELECT 1` và HTTP 503 khi lỗi. Cần readiness kiểm tra bảng/DB đích và định danh node, DB active, trạng thái writer để script xác nhận đúng nguồn dữ liệu. Compose chưa khai báo healthcheck và điều kiện chờ DB healthy.
13. **Lỗi CRUD thiếu JSON error handler chung.** Controller sản phẩm gọi `next(error)` còn server hiện dùng xử lý lỗi mặc định của Express. Cần chuẩn hóa lỗi API và kiểm tra response khi MySQL gặp lỗi.

### P2 — Vận hành và đóng gói

14. **Backup định kỳ còn phụ thuộc terminal và cố định primary.** Hai vòng lặp backup thiếu scheduler khôi phục sau restart, trạng thái lần chạy, lưu log bền vững và lựa chọn nguồn theo writer active. Sau failover, backup phải lấy từ B.
15. **Repo còn theo dõi dữ liệu dump và dependency.** `git ls-files` xác nhận 5 dump cùng 625 file dưới `backend/node_modules`. `.gitignore` hiện chỉ bỏ qua `.env` đúng tên và chưa bao phủ dump, runtime state, log. Việc thêm ignore cần đi cùng xử lý các file đã được tracking trong phạm vi được duyệt.
16. **Hướng dẫn vận hành đã cũ.** README chính còn mô tả `database.json` và URL 3000. Database README còn khẳng định CRUD trả 501. Chưa có runbook A → B → A, architecture và kế hoạch KT1–KT3.

## 4. Trạng thái từng DOD sau PHA B

`DONE` dùng cho hạng mục đã đạt và được kiểm tra đủ phạm vi. `TODO` thể hiện phần triển khai còn thiếu. `BLOCKED` thể hiện kiểm tra đang bị chặn bởi điều kiện môi trường. `NOT TESTED` thể hiện hành vi cần được chạy xác nhận.

| DOD | Trạng thái tổng thể | Đã có | Phần cần hoàn tất và nghiệm thu |
| --- | --- | --- | --- |
| DOD-01 — Luồng mua hàng | DONE | PASS unit, UI/API/MySQL trên cả A/B TEST. Đặt hàng chọn từng sản phẩm, tồn kho, lịch sử giá/tên, rollback và cạnh tranh đã chạy thực tế | Kết quả áp dụng cho môi trường TEST độc lập |
| DOD-02 — Admin | DONE | PASS CRUD UI/API, 400/404/409/428, expectedStock, FK chặn xóa sản phẩm đã bán và JSON error handler | Kết quả áp dụng cho môi trường TEST độc lập |
| DOD-03 — B phục vụ bản sao thật | TODO | Có helper backup và restore DB mới | Cấu hình web tới DB mới, đối chiếu snapshot và xác minh API B |
| DOD-04 — A → B | TODO | Hai cặp web/DB riêng | Gateway chung, chuyển thủ công có health/readiness check, fencing và rollback |
| DOD-05 — B → A giữ đơn mới | TODO | Có script failback legacy | Drain B, snapshot B, restore DB mới ở A, đối chiếu từng đơn/tồn kho rồi chuyển |
| DOD-06 — Một writer | TODO | Khóa hàng trong từng DB khi tạo đơn | Cơ chế điều phối A/B bền vững, chặn mọi route ghi trên node inactive, xử lý request đang chạy và restart |
| DOD-07 — Backup/restore | TODO | `database/backup.ps1` dùng snapshot transaction, kiểm tra mã thoát và copy raw byte. Restore từ chối DB đã tồn tại | Checksum/manifest, encoding, log, kiểm chứng nội dung, retry sau lỗi giữa chừng, thống nhất entry point |
| DOD-08 — Tự động hóa | TODO | Vòng lặp backup trong terminal | Scheduler bền vững, chọn active writer, phát hiện lỗi, đường dẫn lưu và chính sách retention được duyệt |
| DOD-09 — Runbook/test | TODO | Schema/seed, verifier động, smoke riêng cho TEST, hướng dẫn và unit test PHA B | Nghiệm thu MySQL PHA B và bổ sung runbook/KT1–KT3 trong các pha tiếp theo |
| DOD-10 — An toàn repo | TODO | `.env` đúng tên được ignore | Tách secrets, tài khoản ứng dụng, giới hạn port DB, xử lý tracking dump/dependency và ignore runtime artifact |

Docker/MySQL của TEST đã hoạt động và nghiệm thu PHA B đạt. DOD-03–10 tiếp tục theo các pha C–G. RPO/RTO được đo trong các lần chạy chuyển đổi sau.

## 5. Thiết kế đề xuất để duyệt

### Nhánh, checkout và môi trường

- Tạo nhánh tích hợp `integration/shoponline-completion` từ HEAD hiện tại sau khi được duyệt. Dùng worktree riêng dưới `D:\BTL_platform\shoponline-integration`.
- Worktree riêng cần thiết vì Compose hiện bind-mount trực tiếp `frontend`, `backend/src`, `backend/server.js`. Thao tác sửa trên checkout đang gắn với container có thể được áp dụng ngay khi web phục vụ request.
- Dùng `compose.test.yml` độc lập cho TEST với project name riêng, tên container theo project, volume mới và cổng riêng. Đề xuất A `127.0.0.1:18000`, B `127.0.0.1:18001`, gateway `127.0.0.1:18080`. Kiểm tra xung đột cổng trước khi khởi tạo.
- Nhóm Ly review backend/test, Toàn review frontend/Compose/gateway, Nam review database và dữ liệu chuyển đổi. Các cổng nghiệm thu B–G được kiểm tra theo thứ tự trong kế hoạch đã duyệt.

### Đường truy cập và chuyển đổi

```text
URL chung → gateway Nginx → web được chọn → DB đã được xác minh
                               A hoặc B      DB đích mới khi restore
```

- Đề xuất giữ CRUD hiện hữu, failover thủ công bằng script và snapshot MySQL bằng helper trong `database/`.
- Dùng một nguồn trạng thái điều phối bền vững cho `PRIMARY_ACTIVE`, `MAINTENANCE`, `STANDBY_ACTIVE`, `FAILBACK_PENDING`. Script chuyển trạng thái cần khóa loại trừ để chặn hai thao tác chuyển đồng thời.
- Backend kiểm tra quyền ghi theo node ở tất cả route thay đổi dữ liệu. Khi trạng thái điều phối lỗi hoặc chưa xác định, request ghi trả 503. Maintenance chặn request ghi mới và hỗ trợ chờ các request đã được nhận hoàn tất.
- Chọn DB qua cấu hình override sinh có kiểm soát, có lưu cấu hình trước bước chuyển để rollback. Readiness xác nhận node/DB/schema khớp kế hoạch trước khi gateway chọn upstream.
- Với A → B, chuẩn bị và đối chiếu snapshot ở DB mới trên B, xác nhận fencing A rồi chuyển. Với B → A, khóa ghi/drain B, backup B, restore DB mới ở A, đối chiếu dữ liệu rồi đổi gateway và mở ghi A.
- Dữ liệu phát sinh sau snapshot cần được tính trong RPO. Kiến trúc cùng host cần được mô tả trong tài liệu vận hành.

Thiết kế chi tiết về trạng thái, fencing, các bước lỗi và diff dự kiến sẽ được trình bày trong PHA C trước khi triển khai phần điều phối.

## 6. Danh sách file dự kiến

Các đường dẫn dưới đây là phạm vi đề xuất. Chốt diff cụ thể theo kết quả kiểm thử của từng pha.

| Pha | File hiện có dự kiến sửa | File mới dự kiến | Nội dung |
| --- | --- | --- | --- |
| B | `database/verify.cjs`, `database/README.md` | `compose.test.yml`, `scripts/smoke-test.ps1` | Bỏ kỳ vọng 501, tách fixture với kiểm tra động, dùng CRUD thực tế, smoke health/sản phẩm/đơn/tồn kho/DB trên TEST |
| B | `backend/server.js`, `backend/src/controllers/productController.js`, `frontend/js/main.js`, `frontend/js/cart.js`, `backend/package.json` | `backend/test/productController.test.js`, `frontend/test/cart.test.cjs`, `frontend/test/main.test.cjs` | JSON error handling, xử lý xung đột tồn kho, render an toàn, kiểm tra số lượng và dữ liệu giỏ, test hồi quy cho các lỗi này |
| B | `frontend/js/admin.js`, `frontend/admin.html`, `frontend/cart.html` theo cách xử lý xung đột và validation được chọn | — | Tương thích phản hồi API, giới hạn input và cập nhật form khi tồn kho thay đổi |
| B | `docs/erd.png` | — | ERD kỹ thuật khớp schema hiện hành |
| C | `docker-compose.yml`, `compose.test.yml`, `backend/server.js` | `gateway/nginx.conf`, `gateway/upstreams/primary.conf`, `gateway/upstreams/standby.conf`, `backend/src/middleware/writeGuard.js`, `scripts/switch-active.ps1` | URL chung, chọn DB/node, readiness, trạng thái điều phối, chặn ghi và drain |
| C–D | `backend/src/config/db.js` nếu cần readiness/giới hạn kết nối, `database/backup.ps1`, `database/restore.ps1` | `database/compare-snapshot.cjs` | Xác nhận DB đích, checksum/encoding/log, so sánh schema/PK/FK/nội dung và tồn kho |
| D | `scripts/sync-primary-to-standby.ps1`, `scripts/backup.ps1`, `scripts/restore-standby.ps1`, `scripts/backup.bat`, `scripts/restore-standby.bat` | — | Thống nhất gọi helper an toàn, DB đích mới, chuyển cấu hình web sau đối chiếu, mã thoát rõ ràng |
| E–F | `scripts/switch-active.ps1`, `scripts/failback-to-primary.ps1` | `scripts/test-failover-failback.ps1` | Điều phối A → B → A, đơn phát sinh B, kiểm tra một writer, rollback và restart |
| G | `database/auto-backup.ps1`, `scripts/auto-backup-daemon.ps1` | `scripts/register-backup-task.ps1` | Scheduler, backup nguồn active, log và phát hiện lần chạy lỗi |
| G | `docker-compose.yml`, `Dockerfile`, `.gitignore`, `.dockerignore`, `README.md`, `database/README.md` | `.env.example`, `database/create-app-user.sql`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK_FAILOVER_FAILBACK.md`, `docs/TEST_PLAN.md` | Biến môi trường, tài khoản ứng dụng có quyền trên DB được chọn, giới hạn port, healthcheck, build từ lockfile và hướng dẫn vận hành |
| B–G | `docs/IMPLEMENTATION_STATUS.md` | — | Cập nhật DOD và kết quả thực chạy sau mỗi cổng nghiệm thu |

`schema.sql` và `seed.sql` hiện khớp các cột backend đang dùng. Chúng là đầu vào của kiểm tra schema và khởi tạo TEST. Việc chuyển dữ liệu từ schema volume cũ sẽ được chọn sau khi đọc schema thực tế.

Đề xuất xử lý các file dump và `backend/node_modules` đang tracking tại pha G bằng thay đổi Git index được duyệt, đồng thời bảo toàn bản cục bộ. Các backup mới, runtime state và log cần đi vào đường dẫn được ignore.

## 7. Thứ tự thực hiện và cổng nghiệm thu

| Pha | Công việc chính | Điều kiện đạt |
| --- | --- | --- |
| B | Tạo worktree/TEST tách biệt, khởi tạo schema/seed trên volume mới, sửa verifier và lỗi ứng dụng đã xác nhận | Hai web healthy, CRUD qua UI/API đúng 201/200/400/404/409, tạo/đọc đơn khớp MySQL, rollback thiếu hàng, cạnh tranh tồn kho đúng, smoke chạy lặp lại được |
| C | Thiết kế chi tiết và triển khai gateway, cấu hình DB có kiểm soát, trạng thái writer, maintenance/drain | URL chung chọn đúng web/DB, node inactive chặn route ghi qua cả cổng trực tiếp, lỗi cấu hình và restart có trạng thái xác định |
| D | Hoàn thiện helper backup/restore và chuyển A → DB mới B | Dump/checksum hợp lệ, đối chiếu schema và toàn bộ dữ liệu snapshot đạt, API B đọc đúng DB mới, retry lỗi giữa chừng bảo toàn các DB đang có |
| E | Chạy KT1/KT2 trên TEST, mô phỏng dừng `primary-web`, chuyển gateway sang B | URL chung phục vụ B, đơn mới chỉ ghi B, ghi nhận thời điểm snapshot/sự cố/phục hồi để tính RPO/RTO thực tế |
| F | Chạy KT3, maintenance/drain B, chuyển dữ liệu B → DB mới A rồi chuyển gateway | Đơn phát sinh trên B còn đủ tên/giá/số lượng/tổng tiền, tồn kho khớp sau failback, kiểm tra lỗi từng bước và một writer đạt |
| G | Scheduler, quyền DB, secrets/config, repo hygiene và runbook | KT1–KT3 chạy lại đạt, scheduler tiếp tục sau restart và báo được lỗi, người khác làm theo runbook khởi tạo TEST và chuyển đổi được |

Các ca âm bắt buộc gồm dump rỗng/hỏng checksum/UTF-16LE, DB đích đã tồn tại, Docker command lỗi, web trỏ sai DB, readiness lỗi, chuyển trạng thái đồng thời, node cũ khởi động lại và lỗi ở bước chuyển trung gian. Mỗi lần chạy dùng DB/volume TEST có định danh riêng.

## 8. Kiểm tra thực sự đã chạy trong PHA A

| Kiểm tra | Kết quả | Giới hạn |
| --- | --- | --- |
| Git status/branch/HEAD/log/ref và danh sách file | PASS | Snapshot checkout và remote-tracking ref lưu cục bộ |
| Đọc Compose bằng `docker compose config --services` | PASS | Xác nhận 4 service, cần Engine để kiểm tra runtime |
| `node --check` trên 10 file JS/CJS của dự án | PASS | Kiểm tra cú pháp |
| Parser PowerShell trên 8 file `.ps1` | PASS | Kiểm tra cú pháp |
| `git diff --check` trước và sau tạo tài liệu | PASS | Kiểm tra whitespace trong diff tracked. Tài liệu mới được kiểm tra whitespace riêng |
| Chẩn đoán giỏ hàng bằng Node VM | PASS cho cơ chế chọn ID. Xác nhận lỗi JSON hỏng và số lượng âm | DOM/localStorage giả lập trong bộ nhớ |
| Chẩn đoán render chi tiết sản phẩm bằng Node VM | Xác nhận dữ liệu được chèn dưới dạng HTML | Kiểm tra chuỗi HTML sinh ra |
| Đọc byte 5 dump, tính SHA-256 và kiểm tra cấu trúc | PASS | Xác nhận cả 5 file UTF-16LE và chứa `DROP TABLE`. Cần MySQL để kiểm tra restore |
| `docker compose ps` tại context `desktop-linux` | BLOCKED | Engine endpoint chưa khả dụng |
| GET health/products/orders ở A/B | BLOCKED | Cả 6 request bị `ECONNREFUSED` |
| CRUD/đặt đơn/backup/restore/KT1–KT3 trên MySQL | NOT TESTED | Chờ môi trường TEST và phê duyệt triển khai |

## 9. Nội dung cần duyệt để sang triển khai

- Nhánh tích hợp và worktree riêng xuất phát từ `b1aef42`.
- Phạm vi sửa code B–G, giữ CRUD hiện có, triển khai failover thủ công qua gateway và một writer.
- Môi trường nghiệm thu là TEST tách biệt với project/volume/cổng đề xuất ở mục 5. Máy Windows hiện tại cần có Docker Engine sẵn sàng khi bắt đầu chạy tích hợp, hoặc nhóm chỉ định máy Docker được phép dùng.
- Thao tác dữ liệu được đề xuất gồm tạo DB TEST mới, seed dữ liệu giả, tạo sản phẩm/đơn giả, backup, restore vào DB mới, đổi đích các web TEST và mô phỏng dừng/khởi động dịch vụ TEST theo KT1–KT3. Chính sách dọn dữ liệu và retention cần nằm trong phạm vi được duyệt.

Người dùng đã duyệt hướng triển khai và cho phép bắt đầu PHA B. Phạm vi hiện hành kết thúc ở báo cáo/nghiệm thu PHA B, với bước kiểm tra của người dùng trước PHA C.

## 10. Điểm xuất phát và môi trường PHA B

| Hạng mục | Kết quả thực hiện |
| --- | --- |
| Git kiểm tra lại | Nhánh `feature/nam-database`, HEAD `b1aef42210aa6378808a550aad7530510afbdc46` |
| Thay đổi cục bộ lúc bắt đầu | Chỉ có `docs/IMPLEMENTATION_STATUS.md` chưa tracking, là tài liệu PHA A đã được duyệt |
| Nhánh tích hợp | Đã tạo `integration/shoponline-completion` từ HEAD trên |
| Worktree triển khai | `D:\BTL_platform\shoponline-integration` |
| Tài liệu PHA A | Được sao chép sang worktree mới để tiếp tục cập nhật |
| Dependency unit test | 82 package cài bằng `npm ci --ignore-scripts` theo lockfile vào `D:\BTL_platform\shoponline-unit-deps-20261117`, dùng qua NODE_PATH trong tiến trình kiểm thử |
| Runtime unit test | 47/47 trên Windows Node.js `v22.13.0` trước reboot và 47/47 trong container Node.js `v20.20.2` sau reboot, chạy tuần tự |
| TEST đã cấu hình | Project `shoponline-test-b-20261117`, web A/B `127.0.0.1:18000` và `127.0.0.1:18001`, MySQL trong network riêng |
| TEST DB/volume | DB `shoponline_check_phase_b` trên hai cặp độc lập. Volume dự kiến `shoponline-test-b-20261117_primary_test_data` và `shoponline-test-b-20261117_standby_test_data` |
| Bootstrap TEST | Mount `01-schema.sql`, `02-seed.sql` chỉ đọc. DB healthcheck xác nhận truy vấn được bảng; web đợi DB healthy |
| Khởi tạo TEST thực tế | PASS sau reboot. Bốn container TEST healthy, hai volume mới và network riêng theo project |

Cấu hình TEST đã được trình bày cho người dùng trước khi thử build và được kiểm tra bằng `docker compose ... config --format json`. Kết quả kiểm tra xác nhận tên volume theo project, cổng web loopback, MySQL trong network riêng, mount init chỉ đọc, APP_ENV và DB_NAME dành cho TEST.

### Lịch sử sự cố Docker trước reboot

Ban đầu CLI đọc được phiên bản Engine `29.9.2` và metadata của bốn container demo. Bước build BuildKit bị treo. `docker buildx ls` sau đó báo `listing workers: DeadlineExceeded` cho cả `default` và `desktop-linux`. Thử builder legacy và chạy unit container độc lập cũng bị treo, các lệnh này đã được hủy.

Sau khi người dùng khởi động lại Docker Desktop, Dashboard vẫn hiển thị `Engine running` trong khi các request thực thi tiếp tục bị chặn. Log backend có `DockerDesktop/Wsl/ExecError`. Người dùng cung cấp ảnh lỗi **Docker Desktop — WSL is unresponsive**, với mã `DockerDesktop/Wsl/CommandTimedOut` khi gọi `wsl.exe -l -v --all`. Smoke chỉ đọc trên project TEST trả lỗi trực tiếp `Docker Desktop is unable to start`.

WSL/Docker Desktop cần phục hồi khả năng chạy container và BuildKit worker trước khi nghiệm thu tích hợp. Hướng dẫn đã gửi là lưu công việc WSL, thoát Docker Desktop, chạy `wsl --shutdown` rồi mở lại Docker Desktop. Lệnh này dừng toàn bộ distro WSL và VM WSL 2. Nếu shutdown cũng bị treo, người dùng cần lưu công việc rồi khởi động lại Windows. Tài liệu chính thức mô tả các bước chẩn đoán Docker Desktop và phạm vi tác động của shutdown WSL. [Docker Troubleshoot](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/), [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands#shutdown).

Sau khi người dùng reboot Windows và yêu cầu tiếp tục PHA B, Engine `29.9.2` và hai builder đều trả trạng thái running với BuildKit `v0.34.0`. Bước build/khởi tạo và toàn bộ nghiệm thu tích hợp đã hoàn tất, xem mục 17.

## 11. File đã sửa và trách nhiệm review

| File | Thay đổi | Chủ trì review |
| --- | --- | --- |
| `backend/src/controllers/productController.js` | PUT chỉ ghi stock khi bên gọi gửi trường này. Stock dùng UPDATE có điều kiện expectedStock, trả 409 khi xung đột và 428 khi thiếu precondition. Kiểm tra kiểu giá/stock/expectedStock và thống nhất envelope lỗi | Ly, Nam đối chiếu SQL |
| `backend/src/middleware/errorHandler.js` | Mới. JSON cho lỗi parser, quá kích thước, FK và lỗi máy chủ, với thông báo 500 đã lược bỏ chi tiết nội bộ | Ly |
| `backend/server.js` | Gắn error handler, JSON 404 cho API, bổ sung định danh health, export app để kiểm thử HTTP và giữ entry point `node server.js` | Ly |
| `backend/package.json` | Npm test script chạy bộ hồi quy tuần tự | Ly |
| `backend/test/productController.test.js` | Mới. Test precondition, xung đột tồn kho, sửa metadata và lỗi DB | Ly, Nam |
| `backend/test/apiErrors.test.js` | Mới. HTTP loopback với DB giả lập, kiểm tra JSON 400/404/413/500 và health 503 | Ly |
| `frontend/js/cart.js` | Phục hồi JSON hỏng, chuẩn hóa dữ liệu cũ, hợp nhất ID trùng, kiểm tra số lượng/giá, xử lý lỗi storage, URL ảnh an toàn, khóa thao tác trong lúc gửi đơn và bảo toàn số lượng thêm từ tab khác | Toàn, Ly |
| `frontend/js/main.js` | Kiểm tra response API, ID sản phẩm, escape nội dung/thuộc tính, URL ảnh an toàn, số lượng nguyên và giới hạn tồn kho ở entry point thêm giỏ | Toàn |
| `frontend/js/admin.js` | Gửi expectedStock chụp lúc mở form, xử lý phản hồi xung đột, kiểm tra URL preview | Toàn, Ly |
| `frontend/admin.html` | Hidden input lưu expectedStock của form sửa | Toàn |
| `frontend/cart.html` | Giới hạn độ dài thông tin khách hàng theo API | Toàn |
| `frontend/test/browser-context.cjs` | Mới. DOM/localStorage giả lập dùng chung cho test hồi quy frontend | Toàn |
| `frontend/test/cart.test.cjs` | Mới. JSON cũ/hỏng, số lượng, storage, render và đặt hàng chọn từng sản phẩm | Toàn, Ly |
| `frontend/test/main.test.cjs` | Mới. Render dữ liệu API, ID/URL độc hại, lỗi HTTP và input chi tiết sản phẩm | Toàn |
| `frontend/test/admin.test.cjs` | Mới. Snapshot expectedStock và preview URL | Toàn, Ly |
| `database/verify.cjs` | CRUD hiện hành, mode seed tách fixture cố định, kiểm tra dữ liệu động, bảo vệ DB TEST, đối chiếu đơn/tồn kho/FK/CHECK, rollback và ca cạnh tranh MySQL | Nam, Ly |
| `database/README.md` | Hướng dẫn TEST, smoke, unit, hợp đồng expectedStock, verifier. Giữ các ghi chép cũ trong mục lịch sử thu gọn | Nam, Toàn |
| `compose.test.yml` | Mới. Hai cặp web/DB TEST, seed/schema theo thứ tự, healthcheck, tài khoản ứng dụng và tài nguyên theo project | Toàn, Nam |
| `.dockerignore` | Bổ sung `**/node_modules` để build cài dependency từ manifest/lockfile và tránh bản dependency cục bộ được copy đè vào image | Toàn |
| `scripts/smoke-test.ps1` | Mới. Chỉ nhận project có prefix shoponline-test, gọi verifier trên cả A/B và dừng khi native command lỗi | Ly, Nam, Toàn |
| `scripts/browser-smoke.cjs` | Mới sau reboot. Chrome headless kiểm tra CRUD admin, giỏ hàng, đặt đơn, XSS render và form stock cũ trên cả A/B TEST | Toàn, Ly |
| `docs/erd.png` | Tạo lại sơ đồ trực tiếp từ tên/kiểu cột và PK/FK trong schema SQL hiện hành, đã xem ảnh để kiểm tra layout | Nam |
| `docs/erd.mmd` | Mới. Nguồn Mermaid thể hiện quan hệ, kiểu/precision, mặc định và các ràng buộc | Nam |
| `docs/IMPLEMENTATION_STATUS.md` | Trạng thái DOD, diff PHA B, kiểm thử thực chạy, blocker và bàn giao | Nam, Ly, Toàn |

## 12. Lỗi đã xử lý và thay đổi hợp đồng API

- Giỏ hàng có JSON hỏng hoặc cấu trúc sai phục hồi về danh sách hợp lệ để trang tiếp tục hoạt động. Các dòng không hợp lệ được loại trong kết quả đọc, ID/số lượng dạng chuỗi số của dữ liệu cũ được chuẩn hóa. Thêm giỏ từ chối số âm, 0, thập phân, chuỗi sai định dạng, boolean và vượt INT.
- Các vị trí render sản phẩm ở catalog/modal/cart escape dữ liệu. URL ảnh trong cart/catalog/admin preview được giới hạn HTTP/HTTPS với hỗ trợ đường dẫn ảnh cục bộ.
- PUT cập nhật metadata giữ stock trong DB. PUT gửi stock cần gửi thêm expectedStock từ lần đọc trước. UPDATE kiểm tra stock hiện tại nguyên tử ở DB. Admin đã dùng hợp đồng này và yêu cầu mở lại form khi có xung đột.
- Các lỗi parser/DB và API route không tồn tại có phản hồi JSON. API thành công tiếp tục dùng shape sản phẩm/đơn hiện có. Health bổ sung định danh TEST để verifier kiểm tra đúng đích trước khi ghi.
- Verifier bỏ kỳ vọng 501. `seed` dùng số fixture cố định cho bootstrap mới. `verify` và `api` làm việc với số bản ghi động. Ca API giữ các bản ghi giả theo lượt để phục vụ đối chiếu và kiểm tra lịch sử tên/giá.
- Compose TEST có schema/seed và healthcheck riêng. ERD khớp schema file hiện tại. Verifier đã đối chiếu các cột, kiểu, PK/FK và dữ liệu bootstrap trên MySQL của cả A/B.

## 13. Kết quả kiểm thử PHA B

| Kiểm tra | Trạng thái | Kết quả thực tế |
| --- | --- | --- |
| Unit test hồi quy cuối cùng | PASS | **47/47**, thêm lần chạy trong container Node.js 20.20.2 với dependency build thực tế. DB/DOM/storage giả lập, HTTP loopback thật cho lỗi API |
| Các lần unit ban đầu | FAIL đã khắc phục | Lần đầu thiếu dependency mysql2 trong worktree. Đã cài 82 package theo lockfile ở thư mục TEST riêng. Lượt chạy nhiều file đồng thời gặp Node `Fatal process out of memory: Zone`; lượt chạy tuần tự sau đó đạt toàn bộ |
| Backend product controller | PASS | 12 ca, gồm expectedStock không hợp lệ, 428/409, giữ stock khi chỉ sửa metadata và chuyển lỗi tới middleware |
| API error qua Express | PASS | 5 ca, HTTP 400/404/413/500 là JSON, health 503 khi DB giả lập lỗi |
| Frontend cart/main/admin | PASS | 30 ca, bao gồm JSON hỏng/cũ, số lượng sai, render/URL, chặn gửi trùng trong một request và giữ số lượng phát sinh từ tab khác |
| Kiểm tra cú pháp JS/CJS | PASS | 17 file source/test/verifier và file browser-smoke mới bằng `node --check` |
| Parser PowerShell | PASS | `scripts/smoke-test.ps1` và các script hiện hữu |
| Kiểm tra Compose TEST tĩnh | PASS | Parse được cấu hình, xác nhận project/volume riêng, web loopback, DB nội bộ, định danh TEST, mount init chỉ đọc |
| Guard của verifier | PASS | Cả `init`, `verify`, `api` từ chối CHECK_DATABASE=`shoponline` trước khi kết nối DB |
| Diff/whitespace và ERD | PASS | Kiểm tra diff tracked, whitespace file mới và ảnh sơ đồ sinh từ schema |
| Docker BuildKit build và runtime | PASS | Sau reboot, hai image build thành công, bốn container TEST healthy. Lỗi WSL/legacy build trước reboot được giữ ở mục lịch sử |
| Smoke `verify` trên project TEST | PASS | Cả A/B xác nhận schema, FK, tổng tiền và dữ liệu động sau các lần smoke/UI |
| Bootstrap schema/seed trên volume mới | PASS | Cả hai DB mới có 12 sản phẩm, 3 đơn, 4 chi tiết, tiếng Việt và schema/FK đúng |
| Smoke CRUD/tạo đơn/tồn kho/rollback/MySQL concurrency | PASS | Hai vòng trên cả A/B, mỗi vòng 40 request/web, gồm race đặt đơn và cập nhật tồn kho trên MySQL |
| UI qua trình duyệt với API/MySQL TEST | PASS | Chrome 157.0.8103.79 headless, 7 nhóm luồng/web trên cả A/B, cộng đối chiếu hai đơn UI trực tiếp với MySQL |
| Các lượt browser smoke ban đầu | FAIL đã khắc phục | Sửa locator cho nút có icon Font Awesome và cách đọc ID đơn từ dialog trước khi chuyển trang. Bản cuối PASS trên cả hai web |
| Cách ly demo và TEST | PASS | So sánh trước/sau cho thấy bốn container demo cùng ID, StartedAt và mount. TEST dùng namespace/volume/port riêng |

Lệnh chạy lại unit, khởi tạo TEST và smoke nằm ở đầu `database/README.md`. Kết quả MySQL, RPO/RTO và chuyển đổi A/B cần được ghi từ các lần thực chạy tiếp theo.

## 14. Công việc còn lại và điều kiện trước PHA C

1. DONE — Engine/BuildKit hoạt động sau reboot.
2. DONE — Bốn container TEST healthy, schema/seed đúng 12/3/4 ở cả hai DB mới.
3. DONE — Hai vòng smoke API và verify động trên cả A/B, có FK/CHECK, rollback, giữ lịch sử và kiểm tra cạnh tranh MySQL.
4. DONE — Chrome kiểm tra catalog → giỏ chọn sản phẩm → tạo đơn, CRUD admin và form stock cũ. Hai đơn UI đã đối chiếu với MySQL.
5. Chờ người dùng review diff, môi trường TEST và kết quả PHA B trước khi bắt đầu PHA C.

Các script `scripts/sync-primary-to-standby.ps1`, `scripts/failback-to-primary.ps1`, `scripts/restore-standby.ps1`, `scripts/backup.ps1` còn rủi ro import vào DB đang dùng, UTF-16LE và xử lý mã thoát. Công việc sửa các luồng đó được theo dõi ở PHA C–F, cùng gateway, chọn DB sau restore, một writer, maintenance/drain và rollback. Backup bền vững, secrets, tài khoản DB của demo và repo hygiene tiếp tục thuộc pha G.

## 15. Bàn giao Nam, Ly và Toàn

| Thành viên | Phần source PHA B đã chuẩn bị | Việc cần xác nhận tiếp |
| --- | --- | --- |
| Nam | Verifier, ERD, schema/seed hai DB TEST, đối chiếu đơn UI/tồn kho, README và trạng thái DOD đã PASS | Review SQL/ERD và chuẩn bị thiết kế dữ liệu C–F sau khi người dùng duyệt chuyển pha |
| Ly | JSON error, precondition stock, unit/HTTP và hai vòng smoke API/MySQL đã PASS | Review hợp đồng 428/409, rollback và kết quả race; phối hợp thiết kế health/readiness ở pha C |
| Toàn | Hai web TEST healthy, cart/catalog/admin và Chrome UI end-to-end đã PASS | Review giao diện, Compose/cổng/network và chuẩn bị gateway khi được duyệt pha C |

Trạng thái bàn giao hiện tại là **PHA B PASS trên TEST**. Người dùng review kết quả trước PHA C.

## 16. Checkpoint trước khi người dùng reset Windows

Người dùng yêu cầu lưu công việc trước khi reset máy do WSL mất phản hồi và tắt WSL cũng bị treo. Source, test và tài liệu đã được lưu trong worktree `D:\BTL_platform\shoponline-integration`. Checkpoint tiếp tục công việc nằm tại `D:\BTL_platform\SHOPONLINE_RESUME.md`, gồm vị trí Git/worktree, kết quả 47/47 unit test, blocker và các lệnh nghiệm thu còn lại của PHA B. Phần tiếp tục sau reboot bắt đầu bằng kiểm tra lại Git và Docker rồi hoàn tất nghiệm thu PHA B.

## 17. Nghiệm thu thực tế sau reboot

Ngày 17/11/2026, người dùng yêu cầu đọc checkpoint và tiếp tục PHA B. Git vẫn ở `integration/shoponline-completion`, HEAD `b1aef42210aa6378808a550aad7530510afbdc46`, các thay đổi đã lưu còn nguyên trong working tree. Đã khởi tạo và kiểm thử project TEST được duyệt.

| Hạng mục | Kết quả cuối |
| --- | --- |
| Web A | `http://127.0.0.1:18000`, node `test-primary` |
| Web B | `http://127.0.0.1:18001`, node `test-standby` |
| Database | `shoponline_check_phase_b` trên hai container DB riêng, tài khoản ứng dụng `shoponline_test` |
| Service | Bốn service của project `shoponline-test-b-20261117` running/healthy |
| Unit trong image build | 47/47 PASS, Node.js 20.20.2 |
| Smoke API | Hai vòng × hai web × 40 request được verifier đếm mỗi vòng/web |
| Browser | Playwright 1.65.1, Chrome 157.0.8103.79, profile tạm, 14 nhóm luồng PASS và zero page errors |
| Dữ liệu cuối A | 26 sản phẩm, 11 đơn, 12 chi tiết, verify schema/FK/tổng tiền PASS |
| Dữ liệu cuối B | 22 sản phẩm, 10 đơn, 11 chi tiết, verify schema/FK/tổng tiền PASS |

Các record TEST của các lượt chạy, bao gồm fixture từ lượt browser smoke đang hoàn thiện, được giữ lại. Hai DB hiện hoạt động độc lập; sao chép dữ liệu và chuyển đổi có kiểm soát tiếp tục thuộc các pha sau.

### Đơn tạo qua giao diện và đối chiếu MySQL

| Node | Order ID | Dữ liệu đã kiểm tra trực tiếp |
| --- | --- | --- |
| A | `0d352355-a661-44b3-9dc0-d04651d9df5d` | Quantity 2, giá lúc mua 1.000, tổng 2.000, tên/giá lúc mua được giữ sau sửa sản phẩm; giá hiện tại 1.500, stock sau cập nhật 4, sản phẩm chưa chọn stock 3 |
| B | `d62b3ba8-bff1-40aa-92d5-bf8e4e332802` | Quantity 2, giá lúc mua 1.000, tổng 2.000, tên/giá lúc mua được giữ sau sửa sản phẩm; giá hiện tại 1.500, stock sau cập nhật 4, sản phẩm chưa chọn stock 3 |

Browser smoke đã kiểm tra create/read sản phẩm và ảnh cục bộ; JSON giỏ hỏng/cũ; escape catalog/modal/cart/order history; số lượng âm/thập phân; checkout chọn một trong hai sản phẩm; giữ phần giỏ chưa mua; form admin cũ nhận 409; tải lại và sửa tồn kho hợp lệ; DELETE sản phẩm chưa bán thành công và sản phẩm đã bán nhận 409. Các ID trên được đọc từ dialog thành công mà người dùng nhìn thấy rồi GET lại và đối chiếu với MySQL.

Đã so sánh metadata trước/sau của bốn container demo. ID, StartedAt và mount khớp snapshot ban đầu. Git diff cho các file Compose demo, schema/seed và script backup/sync/failback hiện hữu rỗng. Source PHA B gồm 24 file thay đổi đang chờ review trong worktree riêng.

Cổng B đã đạt. Điểm dừng hiện tại là người dùng review PHA B trước PHA C.
