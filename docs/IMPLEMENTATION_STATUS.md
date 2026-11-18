# ShopOnline — Trạng thái A/B, C1/C2a và nghiệm thu KT1–KT3

Ngày cập nhật 18/11/2026, múi giờ Asia/Saigon.

**Cập nhật hiện tại — KT1, KT2, KT3 và vận hành tối thiểu đã PASS trên TEST ngày 18/11/2026, dừng để người dùng review.** A đang là writer ở epoch/generation 5. Đơn tạo trên B được bảo toàn trên DB mới của A. Unit test cuối PASS 103/103 trên Windows và container. HEAD vẫn `17c4655`; lịch sử A/B, C1 và C2a giữ ở mục 1–19. Kết quả đầy đủ và giới hạn ở mục 20, ảnh/log tại `docs/EVIDENCE_INDEX.md`.

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

## 18. PHA C1 — Thiết kế chi tiết, chờ duyệt C2

Người dùng đã xác nhận PHA A/B được nghiệm thu và yêu cầu riêng PHA C1. Phạm vi thực hiện của lượt này gồm hai tài liệu mới cùng cập nhật trạng thái, với kiểm tra tĩnh và đọc hệ thống.

### Baseline và khác biệt so với các ghi chép trước

| Hạng mục | Kết quả C1 |
| --- | --- |
| Worktree | `D:\BTL_platform\shoponline-integration` |
| Branch | `integration/shoponline-completion` |
| HEAD | `17c46552eb27a744c447bb7f323fb591e7f5058b` |
| Log ba commit mới | `5ae7d1f` reliability, `61ad4e5` isolated tests, `17c4655` docs, khớp yêu cầu |
| Git trước khi viết | Status sạch, diff/stat rỗng và danh sách untracked rỗng |
| TEST | Project `shoponline-test-b-20261117`, bốn service running/healthy, Engine 29.9.2 |
| HTTP GET | A/B health 200, node TEST đúng; A 26 products/11 orders, B 22/10 |
| SELECT thực | DB `shoponline_check_phase_b` trên hai server UUID riêng, MySQL 8.0.46, items A/B 12/11, ba bảng nghiệp vụ |
| Quyền ghi hiện tại | read_only và super_read_only đều 0 ở A/B, source chưa có coordinator/write guard |

Các mục PHA B ghi HEAD `b1aef42` và source đang chờ review mô tả thời điểm trước ba commit được người dùng cung cấp. C1 dùng `17c4655` làm nền. Các quan sát Git, identity và số bản ghi hiện tại khớp phạm vi báo cáo B đã kiểm tra. A/B khác bộ dữ liệu thử như đã ghi nhận ở PHA B; lựa chọn nguồn A ban đầu cần được duyệt trước bootstrap C2.

### Tài liệu đã tạo/cập nhật

| File | Kết quả C1 |
| --- | --- |
| `docs/PHASE_C_DESIGN.md` mới | Kiến trúc, Mermaid, bốn state, admission/gate/fencing, drain/commit unknown, readiness, chọn DB sau restore, gateway/reload/restart, A → B, thiết kế B → A cho F và bảng lỗi/rollback |
| `docs/PHASE_C_TEST_PLAN.md` mới | 15 ca C2 bắt buộc, 9 ca failure window bổ sung, phương pháp, oracle, PASS/FAIL, giới hạn và người chủ trì |
| `docs/IMPLEMENTATION_STATUS.md` | Baseline C1, quyết định cần duyệt, file C2 dự kiến và bàn giao |

### Phương án thiết kế đề xuất

Một URL gateway TEST 18080, hai web/DB hiện hữu và bổ sung control-db có volume riêng. Mọi backend đọc trạng thái bền vững theo request, giữ gate trong cùng transaction nghiệp vụ và chỉ nhận quyền ghi theo node/epoch/binding. Điều phối dùng khóa session cùng journal; source DB được fence/đọc lại trước activation target. Gateway reload trong maintenance, xác minh generation rồi mới publish writer.

Snapshot được kiểm tra manifest, encoding, checksum, exit code và schema/toàn bộ row/receipt. Target restore vào DB mới, web được recreate theo binding mới và readiness xác nhận database thực trên pool phục vụ. Rollback trước publish có điều kiện; sau publish, nguồn writer mới giữ thẩm quyền và quay lại node trước cần luồng chuyển dữ liệu mới.

### File dự kiến ở C2 và phân công

Danh sách đầy đủ, nội dung từng file và người phối hợp ở mục 13 của `PHASE_C_DESIGN.md`. Phạm vi dự kiến được tổng hợp theo trách nhiệm chính dưới đây.

| Chủ trì | File mới dự kiến | File hiện có dự kiến cập nhật | Phối hợp |
| --- | --- | --- | --- |
| Nam | `database/control-schema.sql`, `database/runtime-schema.sql`, `database/compare-snapshot.cjs` | `database/backup.ps1`, `database/restore.ps1`, `database/verify.cjs` | Ly cho transaction/receipt, Toàn cho DB binding/recreate |
| Ly | `backend/src/config/controlDb.js`, `backend/src/middleware/trafficGuard.js`, `backend/src/middleware/writeGuard.js`, `backend/src/services/writeTransaction.js`, `backend/src/controllers/readinessController.js` | `backend/server.js`, `backend/src/config/db.js`, routes products/orders, controllers products/orders | Nam cho gate/schema, Toàn cho gateway/triển khai |
| Ly | `backend/test/writeGuard.test.js`, `backend/test/writeTransaction.test.js`, `backend/test/readiness.test.js`, `scripts/test-phase-c.ps1`, `tests/phase-c.test.cjs`, `tests/compose.phase-c.test.yml` | Test hồi quy liên quan khi tích hợp transaction wrapper | Toàn/Nam cho fixture và đối chiếu DB |
| Toàn | `compose.c2.test.yml`, `gateway/Dockerfile`, `gateway/nginx.conf.template`, ba template `gateway/upstreams/primary.conf.template`, `standby.conf.template`, `maintenance.conf.template` | `.gitignore`, `.dockerignore` | Nam cho volume/control/schema, Ly cho readiness |
| Toàn | `gateway/bootstrap.cjs`, `gateway/render-config.cjs`, `scripts/switch-active.ps1`, `scripts/switch-active.cjs`, `scripts/reconcile-active.ps1` | `frontend/js/cart.js`, `frontend/js/admin.js` cho request key và pending outcome | Nam cho source fence/snapshot, Ly cho API/control |
| Nam cùng Ly/Toàn | Tài liệu vận hành theo kết quả C2 khi được duyệt phạm vi | Hai tài liệu thiết kế C1, status và `database/README.md` | Cả nhóm |

Các script legacy sync/failback tiếp tục nằm trong backlog C–F đã nêu. Test C2 cần runner role-aware vì smoke PHA B hiện thực hiện mutation trên cả hai node độc lập.

### Các quyết định cần người dùng review

| ID | Đề xuất cần duyệt | Điểm đánh đổi/rủi ro còn lại |
| --- | --- | --- |
| D1 | Thêm control-db và volume riêng | Service phụ thuộc chung, cùng miền lỗi host |
| D2 | Thêm hai bảng runtime trong DB C2 mới, wrapper transaction cho mọi mutation | Tăng thay đổi backend/schema, cần xác minh đa process và tất cả route |
| D3 | Credential node/epoch và mặc định DB read-only qua restart | Restart có thể cần reconcile/rearm trước nhận ghi |
| D4 | Chỉ mở target khi có fence SQL nguồn được xác minh | Source DB/host mất truy cập gây downtime; hard-fence hạ tầng chưa được thiết kế ở C2 tối thiểu |
| D5 | Chọn A làm nguồn bootstrap, clone DB C2 mới và giữ hai DB B-phase cũ | Các record TEST riêng của B được bảo quản để review; cần thống nhất nguồn thẩm quyền |
| D6 | Switch thủ công, một upstream/generation, chặn business API khi state không xác định | Maintenance và phụ thuộc coordinator làm giảm availability |
| D7 | Idempotency key/receipt, pending outcome, deadline lab 5s/30s/15s | Cần thử commit ACK loss, timeout, khóa và tải thực tế |

Tất cả phương án trên đang ở mức thiết kế. Single-writer qua restart, mất owner, persistent variables và reload có worker cũ cần kiểm chứng C2. Snapshot bất đồng bộ còn khoảng dữ liệu có nguy cơ mất; mô hình một Docker host còn miền lỗi WSL/host/ổ đĩa chung.

### Kiểm tra C1 và trạng thái triển khai

| Hạng mục | Trạng thái |
| --- | --- |
| Git baseline, đọc source/config/helper, inventory TEST/demo | PASS cho các thao tác chỉ đọc đã mô tả |
| HTTP GET health/products/orders và SELECT metadata/counts TEST | PASS, khớp identity/counts PHA B trong phạm vi kiểm tra |
| Cấu trúc ba tài liệu, JSON mẫu, cạnh state machine, 24 mã test, D1–D7, code fence và phạm vi Git | PASS kiểm tra tĩnh; Mermaid chưa render, chưa kiểm chứng hành vi runtime C2 |
| Metadata demo cuối C1 | ID và StartedAt của bốn container khớp baseline, không ghi nhận restart trong C1 |
| Thiết kế C1 | DONE, chờ người dùng review các quyết định D1–D7 |
| Triển khai C2 | NOT IMPLEMENTED |
| Kiểm thử C2-01–24 | NOT RUN |

Phạm vi diff cuối C1 gồm một tài liệu tracked cập nhật và hai tài liệu mới chưa tracking. Các thống kê Git ở lần báo cáo kết thúc đi kèm danh sách file này. Điểm dừng là review C1 trước khi được phép triển khai C2.

## 19. PHA C2a — Nền tảng độc lập, chờ review

Người dùng đã duyệt có điều kiện D1–D7 với giới hạn C2a. Đã đọc lại C1, bảo toàn nội dung lịch sử và bổ sung phần điều chỉnh đã duyệt vào hai tài liệu thiết kế/test plan. Công việc thực hiện ngày 18/11/2026 trên `D:\BTL_platform\shoponline-integration`, branch `integration/shoponline-completion`, HEAD `17c46552eb27a744c447bb7f323fb591e7f5058b`.

### Trạng thái ban đầu và môi trường

Git đầu C2a có đúng ba thay đổi tài liệu C1. Docker CLI 29.9.2 ban đầu chưa kết nối được Linux Engine. Sau khi Docker Desktop/Engine hoạt động, bốn container demo đã chạy, bốn container TEST PHA B ở trạng thái Exited. Đã start lại chính các container PHA B bằng Compose start để đọc snapshot A. Inventory trước start được lưu riêng. Container ID, image và cấu hình PHA B được bảo toàn; StartedAt của PHA B thay đổi theo lần start này.

Baseline so tác động C2 được chụp sau khi PHA B healthy. PHA B A vẫn có 26 products/11 orders/12 items, B 22/10/11. Cả hai DB cũ giữ tên `shoponline_check_phase_b`, cùng grants và read_only/super_read_only bằng 0. Các phép so sánh dữ liệu, grants, metadata PHA B/demo trước bootstrap và sau test đều khớp.

| Thành phần | Cấu hình C2a đã chạy |
| --- | --- |
| Project / Compose | `shoponline-c2a-20261118` / `compose.c2.test.yml` |
| Service | control-db, primary-db, standby-db, primary-web, standby-web, gateway |
| Gateway / web A / web B | Loopback 18080 / 18100 / 18101 |
| Network | `shoponline-c2a-20261118_default`, bridge riêng |
| Volumes | `shoponline-c2a-20261118_control_data`, `_primary_data`, `_standby_data` |
| Control DB | `shoponline_control_c2a`, ba bảng state/journal/verification |
| Data DB A / B | `shoponline_check_c2a_a_20261118`, `shoponline_check_c2a_b_20261118` |
| Runtime tables | runtime_write_gate và runtime_write_receipts ở mỗi data DB mới |
| Quyền web / control reader | SELECT trên DB C2 tương ứng, password ngẫu nhiên riêng |
| State / writer / epoch | MAINTENANCE / NULL / 0, generation gateway 0 |
| Data DB protection | Gate đóng, read_only=1, super_read_only=1, flags được persist và đã đọc lại sau recreate |
| Phiên bản thực tế | Docker 29.9.2, MySQL 8.0.46, Nginx 1.30.6, container Node.js 20.20.2 |

Gateway phục vụ JSON maintenance 503. Direct `/health` trả tên DB thực/UUID/gate qua pool đang dùng; `/cluster/status` đọc coordinator mỗi lần. Middleware đặt trước parser/route, từ chối mutation khi thiếu authority hoặc chưa có activation/transaction admission. Header client không cấp quyền ghi. `/ready` trả 503 WRITE_ACTIVATION_REQUIRED trong C2a.

### File thực tế đã thêm/sửa và phân công

| File | Thay đổi C2a | Chủ trì / phối hợp |
| --- | --- | --- |
| `database/control-schema.sql` mới | Cluster state, CHECK writer/state, transition journal, snapshot verification | Nam / Ly, Toàn |
| `database/runtime-schema.sql` mới | Gate/receipt, định danh DB/node/epoch và ràng buộc | Nam / Ly |
| `database/c2a-snapshot.cjs` mới | Raw dump validation, read-only consistent snapshot, schema metadata và full-row digest, kiểm orphan/totals | Nam / Ly |
| `backend/src/config/controlDb.js` mới | Pool coordinator SELECT-only, query/connection timeout hữu hạn | Ly / Nam |
| `backend/src/services/clusterState.js` mới | Đọc/validate state, token dạng chuỗi, actual data connection identity/gate | Ly / Nam |
| `backend/src/middleware/writeGuard.js` mới | Guard global fail-closed, JSON 503, state/header handling | Ly / Nam |
| `backend/src/clusterFoundation.js` mới | Nhận diện cấu hình C2, gắn guard và live/health/status/ready contract | Ly / Toàn |
| `backend/server.js` | Gắn foundation trước middleware/route hiện có | Ly |
| `backend/test/clusterFoundation.test.js` mới | Test config/state lỗi, direct/future mutation, header giả và Express entry point | Ly |
| `backend/test/c2aSnapshot.test.js` mới | Dump/scope/fingerprint/consistent snapshot và schema metadata regression | Nam / Ly |
| `compose.c2.test.yml` mới | Sáu service, network/volume/account/port C2 riêng | Toàn / Nam, Ly |
| `gateway/maintenance.conf` mới | Gateway mặc định maintenance, liveness, JSON 503/generation 0 | Toàn / Ly |
| `scripts/c2a-lib.cjs` mới | Resolve/guard resource, SQL helper C2, Compose, đọc fingerprint PHA B/demo và grants | Toàn / Nam |
| `scripts/bootstrap-c2a.cjs` mới | Prepare env, snapshot A, restore DB mới, seal/verify/binding, journal và resume có kiểm tra | Toàn / Nam, Ly |
| `scripts/test-c2a.cjs` mới | 10 nhóm smoke, fault riêng control-db, kiểm dữ liệu/quyền và unit container | Ly / Toàn, Nam |
| `.gitignore`, `.dockerignore` | Loại `.runtime/` khỏi Git và build context | Toàn |
| `docs/PHASE_C_DESIGN.md` | Thêm mục 15 phản ánh phê duyệt/project C2a và hành vi đã chạy | Nam / Ly, Toàn |
| `docs/PHASE_C_TEST_PLAN.md` | Thêm mục 8, mã C2A, kết quả thực và giới hạn | Ly / Nam, Toàn |
| `docs/IMPLEMENTATION_STATUS.md` | Cập nhật hiện tại, giữ lịch sử 1–18 và bổ sung bàn giao C2a | Nam / Ly, Toàn |

Snapshot SQL, secret và log/report runtime được giữ trong `.runtime/c2a/` và được ignore. Các script legacy sync/failback, helper backup/restore cũ, schema/seed PHA B và Compose demo/PHA B tiếp tục nằm ngoài diff C2a.

### Dữ liệu và lỗi đã xử lý

Nguồn là A PHA B, UUID `5197033f-e297-11f1-908f-321b3f12d865`. Dump 12.405 byte UTF-8, checksum `3355e9e8c8cd3368aa6b3208db3346263b0f65f3dfd86953a996a4c4500c3050`, manifest `c2a-e39a9923-4904-4b01-a4b7-c32548e87b3f`. Hai DB C2 có cùng 26/11/12 row nghiệp vụ và đã khớp mọi row/schema của snapshot. Receipt rỗng, gate đóng.

Các lỗi gặp và đã xử lý gồm published ports không hoạt động với network internal, so raw SHOW CREATE báo lệch do phần CHARACTER SET được in khác nhau, MySQL trả read-only flags dạng chuỗi khi bật bigNumberStrings, unit PHA B kế thừa env C2 và lỗi fetch trong một lượt fault probe. Đã đổi sang bridge riêng, fingerprint metadata schema, chuẩn hóa flags, chạy regression bằng env legacy và dùng kết nối HTTP mới mỗi probe. Lượt cuối PASS toàn bộ.

Lượt bootstrap đầu đã restore/seal hai DB rồi dừng ở verify schema. Đã dùng `--resume` để xác minh và hoàn tất journal. Việc sửa network chỉ tạo lại container/network C2, giữ nguyên named volumes và DB đã restore. Không chạy import đè để xử lý lỗi.

### Kiểm thử thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Unit Windows Node.js 22.13.0 | PASS 90/90, gồm 47 test PHA B và 43 test mới |
| Unit container Node.js 20.20.2 | PASS 90/90 |
| Compose config / source syntax | PASS, cấu hình sáu service và port/network/volume riêng |
| C2A-01–03 | PASS, isolation, control/journal/CHECK, runtime schema và snapshot |
| C2A-04–06 | PASS, gateway maintenance, mọi route ghi/direct/header giả bị chặn, account SELECT-only |
| C2A-07 | PASS, control-db C2 bị stop trả 503 ở cả hai web, start lại giữ MAINTENANCE/writer NULL |
| C2A-08–09 | PASS, zero mutation/receipt C2 và mọi fingerprint/grants/metadata PHA B/demo khớp baseline |
| C2A-10 | PASS, regression unit trong container |
| Activation writer, A → B, drain, commit UNKNOWN/receipt retry, gateway reload động, failback | NOT RUN, ngoài C2a |
| Timeout 5/30/15 và RPO/RTO | Chưa nghiệm thu, giữ là giá trị/giới hạn thiết kế |

Lượt đầu C2A-10 FAIL do env, lượt kế C2A-07 lỗi fetch, đã lưu báo cáo gốc. Báo cáo cuối `.runtime/c2a/test-results.json` có 10 PASS và zero FAIL. Unit log nằm ở `unit-results.log` và `unit-container.log`.

### Vấn đề còn tồn tại và điều kiện trước C2b

C2a mới có trạng thái zero writer. Admission/transaction wrapper dùng gate tới commit, receipt/idempotency, khóa switch theo session/epoch, fencing qua activation và dynamic gateway chưa được triển khai. Snapshot online và miền lỗi chung Docker/WSL/host vẫn có giới hạn đã ghi ở C1. Các bảo đảm chuyển role đầy đủ cần kiểm thử theo C2-01–24 khi được duyệt phạm vi tương ứng.

Điều kiện đầu vào C2b gồm người dùng review C2a và chốt phạm vi kế tiếp, kiểm tra baseline Git/Docker mới, giữ các artifact/DB C2a để đối chiếu và xác nhận bộ kiểm thử nền tảng vẫn PASS. Trước bất kỳ activation nào, cần hoàn tất cơ chế admission/transaction/fencing theo thiết kế và kiểm thử tương ứng. Việc mở quyền DML phải đi cùng giao thức đó.

Điểm dừng hiện tại là C2a đã hoàn thành và chờ người dùng review. HEAD vẫn `17c4655`; các thay đổi được giữ trong working tree để kiểm tra. C2b/C2c và D/E/F chưa thực hiện. Commit, push và merge chưa thực hiện.

## 20. Hoàn thiện liên tục và nghiệm thu KT1–KT3 ngày 18/11/2026

Người dùng cho phép tiếp tục các chặng sau C2a khi cổng kiểm thử PASS, thu thập minh chứng thật ngay trong quá trình chạy. Đã đọc ba tài liệu, kiểm tra branch/HEAD/diff/untracked và sáu service C2 healthy ở MAINTENANCE. Baseline dữ liệu, quyền và tài nguyên lưu lúc 17:18:52 +07 trong `.runtime/evidence-20261118/baseline.json`. Mọi mutation, stop/restart, đổi quyền và restore của lượt này thực hiện trong project `shoponline-c2a-20261118` đã kiểm tra label/container/volume.

### Kết quả theo kịch bản

| Kịch bản | Trạng thái | Order ID thật | Database phục vụ ở kịch bản |
| --- | --- | --- | --- |
| KT1 — A qua Gateway | PASS | `59a46870-971a-405c-933f-d95b66dcbee5` | `shoponline_check_c2a_a_r_1794998788002_8f4457` |
| KT2 — primary-web lỗi, chuyển B | PASS | `acaf0cff-01cb-4894-b7ac-cc4f16a34129` | `shoponline_check_c2a_b_r_1794999909587_9e1bb6` |
| KT3 — failback về A | PASS | `567799c9-dc0a-4fb4-b821-90f737fa458f` | `shoponline_check_c2a_a_r_1795000150418_7652da` |
| Đơn B được admission trước drain | PASS, giữ trên A | `a569f29e-7aac-43a5-91d3-1c346e83a3b1` | B nguồn và A mới có cùng order/items/receipt |

KT1 đã chạy Chrome qua `127.0.0.1:18080`, hiển thị catalog, mở chi tiết, thêm quantity 2 vào giỏ, chọn sản phẩm, điền thông tin TEST và đặt đơn. SQL A xác nhận một item giá 125.000, quantity 2, total 250.000 và stock từ 10 còn 8. B từ chối mutation qua direct port và không có thay đổi row nghiệp vụ. Minh chứng ảnh, response và SQL nằm trong thư mục KT1 của evidence index.

KT2 đã tạo snapshot online A, dừng riêng primary-web C2 và quan sát gateway maintenance. DB A vẫn truy cập quản trị được. Điều phối commit MAINTENANCE, drain gate, khóa account cũ, kết thúc session và xác nhận gate 0, read_only/super_read_only 1, zero writer session/transaction. Sau đó lấy snapshot frozen, restore vào DB B mới, so schema/mọi row/receipt, rebind web B và kiểm actual pool/DB/UUID. Gateway được probe đúng target/generation trước publish B epoch 4. Đơn B qua UI có total 250.000, stock 8. A cũ được start với stale writer account và trả 503, sau đó rebind SELECT-only để health hoạt động. Gateway restart khi B active vẫn chọn B theo Control DB.

KT3 đã giữ row lock sản phẩm trên B, gửi một order để transaction giữ shared gate và chờ product lock. Trong MAINTENANCE, request mới bị 503 và thao tác đóng gate đợi exclusive lock. `performance_schema.data_locks` xác nhận product wait và shared gate thuộc cùng transaction. Sau release, order được ACK, gate mới đóng, B fenced và snapshot frozen chứa cả đơn B ban đầu lẫn đơn drain. Restore vào DB A mới, đối chiếu toàn bộ dữ liệu rồi publish A epoch 5. Hai đơn B được đọc lại qua Gateway A và SQL A, so chính xác ID/customer/items/quantity/giá lúc mua/total/receipt/stock với B đã fenced. Sản phẩm KT2 có stock 7 sau quantity 2 và một đơn drain quantity 1. Đơn mới trên A dùng sản phẩm riêng, stock 10 → 8. B hiện trả NODE_INACTIVE 503.

Đã replay đúng key/body của đơn B trên A sau failback. Server trả cùng Order ID, header `Idempotency-Replayed: true`; full data/schema digest trước sau giữ nguyên. Bằng chứng ở `KT3-cross-node-idempotency.json`.

### Đo thực tế và phạm vi RPO/RTO

| Chỉ số | Giá trị và cách đo |
| --- | --- |
| KT2 RTO quan sát | 28,005 giây, từ primary-web C2 đã dừng lúc 18:04:59.016 đến Gateway active-ready B lúc 18:05:27.021 +07 |
| KT2 freeze / fence A | MAINTENANCE 18:05:03.257, source fence xác minh 18:05:05.944 +07 |
| KT3 khoảng maintenance quan sát | 29,306 giây, freeze B 18:08:59.090 đến Gateway active-ready A 18:09:28.396 +07 |
| Drain quan sát | Release row lock 18:09:01.167, ACK đơn drain 18:09:01.213, B fence xác minh 18:09:06.731 +07 |
| Dữ liệu khôi phục | Full-row/schema/receipt digest nguồn frozen và đích khớp; các đơn đã xác nhận trong kịch bản được giữ |

Các phép đo thuộc kịch bản primary-web lỗi, DB nguồn vẫn quản trị được, chuyển có kiểm soát và snapshot sau drain/fence. Snapshot bất đồng bộ còn khoảng mất dữ liệu trong các tình huống nguồn DB mất trước khi có snapshot mới. Mô hình cùng Docker host còn điểm lỗi chung WSL/host/ổ đĩa/control plane. RTO/RPO trên toàn bộ các miền lỗi đó chưa được nghiệm thu. Các timeout 5/30/15 giây là giá trị cấu hình thử ban đầu.

### Kiểm thử và vận hành cuối

| Cổng / kiểm tra | Kết quả thực tế |
| --- | --- |
| Chặng 1 | PASS, A CRUD/order, error rollback, replay/delete/concurrent key, 409 khác payload, B/direct/header spoof bị chặn, second coordinator BUSY, Control DB outage fail-closed |
| PHA B và test C2 | PASS 103/103 Windows Node.js 22.13.0 và 103/103 container Node.js 20.20.2 |
| Chặng 2 / KT1 | PASS, browser/SQL A và zero mutation B |
| Chặng 3 / KT2 | PASS, native backup/restore DB mới, fence SQL, readiness/rebind, B order, stale A bị chặn |
| Chặng 4 / KT3 | PASS, drain SQL thật, giữ hai order B đầy đủ, A order mới, B inactive |
| Gateway | PASS restart B và A canonical, generation cũ bị 503; native `nginx -t` từ chối config lỗi, con trỏ config đang phục vụ giữ nguyên |
| Chặng 5 | PASS backup active writer chạy lại, restore-check vào DB B mới, serving binding giữ nguyên |
| Bảo toàn PHA B/demo | PASS so baseline/final tám container và bốn DB về ID/StartedAt/mount/port/config, grants/flags/full-row fingerprints |
| Scheduler | TODO cài lịch. Runbook có Task Scheduler 15 phút chạy `cluster-ops.cjs backup` từ writer canonical |
| Các failure window nâng cao | Có phân loại PARTIAL/NOT RUN ở mục 9 test plan, không suy luận PASS từ thiết kế |

Bản restore-check cuối là `shoponline_check_c2a_b_r_1795000320699_e495df`, đủ 30 products, 17 orders, 18 order_items và 14 receipts, khớp A đang phục vụ. Snapshot kiểm tra 24.555 byte UTF-8, native exit 0 và checksum hợp lệ. B website tiếp tục dùng DB B đã fenced; bản restore-check là DB bổ sung để kiểm chứng chạy lại.

### Cấu hình và file triển khai

Gateway/Nginx 1.28.3 chạy cùng Node bootstrap, dùng named volume `gateway_config`. Control DB có cổng loopback 18106 cho CLI host. Backend/gateway đọc Control DB, quyền ghi được kiểm bằng node/epoch/username/actual DB/UUID/gate. Transaction wrapper giữ row gate và receipt tới commit; response chỉ được phát sau ACK commit. Các controller CRUD PHA B được tái sử dụng qua AsyncLocalStorage và connection facade, inner commit/release được quản lý bởi wrapper. Frontend lưu idempotency key/body cho kết quả chưa rõ.

| File/chức năng thêm hoặc mở rộng sau C2a | Chủ trì / phối hợp |
| --- | --- |
| `backend/src/services/requestTransaction.js`, `writeTransaction.js`, `backend/src/config/db.js` | Ly / Nam, connection context, transaction admission/receipt/commit |
| `backend/src/clusterFoundation.js`, `services/clusterState.js`, `middleware/writeGuard.js`, `backend/server.js` | Ly / Nam, actual readiness, read/write guard, status/outcome |
| `backend/test/writeTransaction.test.js` | Ly / Nam, regression/commit UNKNOWN và gate/response lifecycle |
| `frontend/js/api-client.js`, cart/admin JS, cart/admin HTML, `frontend/test/api-client.test.cjs` | Ly / Toàn, key/body retry, giữ API PHA B khi helper chưa nạp |
| `database/c2a-snapshot.cjs`, `database/inspect-c2.cjs` | Nam / Ly, schema metadata và full-row/receipt digest |
| `scripts/cluster-ops.cjs` | Toàn / Nam, named lock/journal, fence, backup/restore mới, credential/rebind và rollback zero writer |
| `gateway/Dockerfile`, `bootstrap.cjs`, `render-config.cjs`, `compose.c2.test.yml` | Toàn / Ly, gateway dynamic/candidate/promotion, safe config và generation |
| `scripts/acceptance.cjs`, `scripts/kt-browser.cjs` | Ly / Toàn, cổng test, Chrome/SQL/evidence và order checkpoint |
| README, database README, `docs/RUNBOOK_KT1_KT3.md` | Nam / Toàn, vận hành TEST và hướng dẫn backup lịch |
| Ba tài liệu lịch sử và `docs/EVIDENCE_INDEX.md` | Nam / Ly, Toàn, kết quả/giới hạn và chuyển minh chứng lên Notion |

Các helper C2a, schema bootstrap và snapshot gốc được giữ. Schema/seed, Compose PHA B/demo và script sync/failback legacy tiếp tục giữ nguyên trong diff. CLI dependency theo lockfile nằm trong `.runtime/c2-cli-deps/`, được ignore.

### Lỗi gặp, xử lý và phần còn lại

Lượt kích hoạt đầu gặp UPDATE metadata trên source đã super-read-only. Đã rollback có kiểm chứng về zero writer, giữ canonical A, rồi xác nhận fence hiện có khi gate đã đóng; epoch tăng từ 1 qua rollback 2 tới activation A 3. KT2 dùng epoch 4, KT3 epoch 5. Nginx `nginx -t` gặp lỗi mở /dev/stderr trong subprocess, đã đổi error_log sang stderr và access log vào volume. Browser mất response body khi trang điều hướng đã được xử lý bằng lưu key/Order ID từ request/response/dialog và dùng lại ID khi chụp ảnh. Lệnh npm ci đã tác động dependency đang tracking; chỉ các dependency phát sinh từ lệnh đó được phục hồi theo HEAD, bộ CLI chuyển vào runtime. Diff dependency/lockfile cuối rỗng.

Ảnh public được giới hạn vào đơn/customer TEST và các trang status. Raw SQL backup, secret/env và ảnh debug toàn trang giữ riêng. Danh sách minh chứng đã chọn, thời điểm và ghi chú Notion nằm trong `docs/EVIDENCE_INDEX.md`.

Scheduler chưa cài tự chạy, replication liên tục và HA đa host chưa triển khai. Fault giữa COMMIT ở tầng mạng, owner chết giữa lệnh admin/publish, active DB restart/rearm và các nhánh lỗi nâng cao chưa có kiểm chứng đầy đủ. Kết quả nghiệm thu hiện tại là ba kịch bản KT1–KT3 nêu trên cùng vận hành tối thiểu. Đã dừng để người dùng review; Git HEAD/branch giữ nguyên, thay đổi ở working tree, chưa commit/push/merge.
