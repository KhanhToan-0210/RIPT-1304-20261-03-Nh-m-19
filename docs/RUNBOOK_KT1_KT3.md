# ShopOnline TEST — Vận hành KT1–KT3

Ngày nghiệm thu 18/11/2026, Asia/Saigon. Project `shoponline-c2a-20261118`, worktree `D:\BTL_platform\shoponline-integration`, branch `integration/shoponline-completion`. Bộ minh chứng và kết quả nằm trong [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md) và mục 20 của [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Trạng thái bàn giao

Gateway `http://127.0.0.1:18080` đang phục vụ A, epoch/generation 5. A dùng DB `shoponline_check_c2a_a_r_1795000150418_7652da`. B dùng bản dữ liệu đã fenced `shoponline_check_c2a_b_r_1794999909587_9e1bb6`, tài khoản SELECT-only, gate đóng và server read-only. Hai DB C2a ban đầu, các DB trung gian và bản restore kiểm tra được giữ để đối chiếu.

| Địa chỉ | Công dụng |
| --- | --- |
| `http://127.0.0.1:18080/` | Website qua gateway |
| `http://127.0.0.1:18080/ready` | Active readiness, DB thực/UUID/epoch |
| `http://127.0.0.1:18080/gateway/status` | Upstream/generation do Nginx đang phục vụ |
| `http://127.0.0.1:18100/cluster/status` | State canonical của Control DB |
| `http://127.0.0.1:18100/health` | Health data pool A |
| `http://127.0.0.1:18101/health` | Health data pool B, có thể healthy dù inactive |
| `127.0.0.1:18106` | Control DB cho CLI trên host, tài khoản điều phối riêng |

```powershell
Set-Location 'D:\BTL_platform\shoponline-integration'
git status --short --branch
git rev-parse HEAD
docker compose --env-file .runtime/c2a/compose.env -p shoponline-c2a-20261118 -f compose.c2.test.yml ps
Invoke-RestMethod 'http://127.0.0.1:18080/ready'
```

## Dependency cho CLI

CLI dùng dependency trong runtime, cùng lockfile với backend. Repo hiện tracking một phần `backend/node_modules`; chuẩn bị bộ CLI bằng thư mục riêng để giữ diff nguồn gọn.

```powershell
New-Item -ItemType Directory -Force '.runtime/c2-cli-deps' | Out-Null
Copy-Item 'backend/package.json','backend/package-lock.json' '.runtime/c2-cli-deps/'
npm.cmd ci --prefix .runtime/c2-cli-deps --omit=dev --ignore-scripts
```

Thư mục này đã được chuẩn bị và CLI đã được kiểm tra trên máy hiện tại. Password cùng các config sinh nằm trong `.runtime/c2a/compose.env`, được ignore. CLI tạo thêm password theo node/epoch, dùng tài khoản inspector SELECT và writer có DML trên đúng bảng/DB mới. Các account writer cũ bị khóa, session cũ kết thúc khi fencing.

## Backup từ writer hiện tại

```powershell
node scripts/cluster-ops.cjs backup
```

Lệnh lấy named lock trên Control DB, đọc writer/binding thực, dump raw UTF-8 và kiểm exit code/checksum/schema/full-row digest trước sau. Artifact SQL/manifest mới nằm trong `.runtime/c2-backups/`. Khi state đang maintenance hoặc thiếu authority, lệnh báo lỗi và giữ các artifact đã có. Online snapshot cần một khoảng dữ liệu ổn định để đối chiếu trước/sau; nếu nguồn thay đổi, helper từ chối ghi nhận bản verified.

```powershell
node scripts/cluster-ops.cjs restore-check
```

Lệnh kiểm tra backup/restore từ writer sang một DB mới trên node inactive, so mọi row nghiệp vụ/receipt và schema, rồi seal bản mới. Binding website hiện tại được giữ. Đã chạy thành công với bản kiểm tra `shoponline_check_c2a_b_r_1795000320699_e495df` và đủ 30/17/18 row nghiệp vụ, 14 receipt.

### Backup định kỳ

**TODO — Chưa cài scheduler tự chạy.** Có thể tạo Windows Task Scheduler cho TEST, mỗi 15 phút, chạy bằng tài khoản đang sử dụng Docker Desktop.

1. Lấy đường dẫn Node bằng `(Get-Command node).Source`.
2. Action dùng Node đó, arguments `"D:\BTL_platform\shoponline-integration\scripts\cluster-ops.cjs" backup`.
3. Start in `D:\BTL_platform\shoponline-integration`.
4. Chọn chạy khi tài khoản đã đăng nhập và Docker Engine đang hoạt động. Bật history để kiểm tra mã thoát.

Lệnh backup đọc writer đang active thay vì cố định A. Nếu switch đang giữ named lock, backup trả `TRANSITION_BUSY`; lần chạy lịch tiếp theo có thể thực hiện lại. Chính sách retention/dọn artifact cần được người dùng quyết định sau review.

## Chuyển dịch vụ có kiểm soát

```powershell
node scripts/cluster-ops.cjs switch B
# Sau khi B có đơn mới và cần quay về A
node scripts/cluster-ops.cjs switch A
```

Mỗi lệnh thực hiện chuỗi sau trong project TEST đã xác minh.

1. Giữ `GET_LOCK` bằng một connection chuyên dụng, kiểm owner/session và state/revision.
2. Commit MAINTENANCE với writer NULL và epoch/generation mới, chặn admission mới.
3. Đóng source gate, đợi shared lock của các transaction; khóa writer cũ, kết thúc session và đọc lại read-only/transaction proof.
4. Backup nguồn sau fence, restore vào DB mới, đối chiếu metadata và mọi row products/orders/items/receipts. Gate được rebind có chủ đích.
5. Tạo credential theo epoch, recreate web đích và xác minh actual DB/UUID qua pool phục vụ.
6. Gateway render bundle immutable trong Linux named volume, `nginx -t`, reload và probe đúng target/generation; chờ worker cũ.
7. ARM target trong lúc coordinator vẫn writer NULL, kiểm promotion readiness và route thực.
8. Publish writer và journal cùng transaction coordinator. Kiểm lại gateway/readiness và source stale writer bị từ chối.

Để mô phỏng KT2, chỉ dừng `primary-web` của project TEST bằng Compose có đủ project/file/env.

```powershell
docker compose --env-file .runtime/c2a/compose.env -p shoponline-c2a-20261118 -f compose.c2.test.yml stop primary-web
node scripts/cluster-ops.cjs switch B
```

DB nguồn phải quản trị được và có fence proof. Khi SQL nguồn không truy cập được, giữ trạng thái fail-closed và phục hồi khả năng xác minh nguồn trước khi cân nhắc promotion. Mô hình hiện tại dùng snapshot trên cùng Docker host; lỗi host/WSL/ổ đĩa/control plane cần quy trình ngoài kịch bản primary-web đã kiểm.

## Xử lý lỗi và commit chưa rõ

Mutation cần `Idempotency-Key`. Frontend giữ key/body khi network hoặc commit chưa rõ. Cùng key/body trả lại receipt đã commit; khác body trả 409. Có thể tra kết quả tại `/api/write-status/<key>` trên writer canonical. UNKNOWN cần được đối chiếu, giữ nguyên key khi retry.

Trước publish, một transition dở có thể được đóng an toàn về zero writer bằng lệnh sau, sau khi owner cũ đã kết thúc và các lệnh admin liên quan không còn chạy.

```powershell
node scripts/cluster-ops.cjs abort
```

Lệnh xác minh fence hai phía, giữ source canonical cùng các DB, tăng epoch/generation và để hệ thống MAINTENANCE. Sau review trạng thái có thể dùng `activate A`; lệnh này lấy dữ liệu từ `nodes.canonicalSource` và restore sang DB mới của A.

Sau publish, writer mới là nguồn có thẩm quyền. Việc quay về node trước phải dùng một transition dữ liệu mới. `abort` từ chối state đã publish. Nếu mất ACK publish, đọc state/journal bền vững để xác định ranh giới trước khi hành động. Giữ tất cả DB/artifact khi kết quả còn chưa rõ.

## Chạy lại kiểm tra và đọc minh chứng

Unit test dùng dependency theo lockfile. Trong container C2 cần môi trường legacy riêng cho các test PHA B; các test C2 cung cấp config/mock riêng.

```powershell
docker compose --env-file .runtime/c2a/compose.env -p shoponline-c2a-20261118 -f compose.c2.test.yml exec -T -e CLUSTER_MODE= -e CLUSTER_NAMESPACE= -e CONTROL_DB_HOST= -e DB_NAME=shoponline_check_phase_b -e NODE_NAME=test-unit-regression primary-web npm test
```

Kết quả cuối là 103/103 trên Windows Node.js 22.13.0 và container Node.js 20.20.2. Playwright/Chrome đã chạy luồng mua thật qua gateway. `scripts/acceptance.cjs` lưu checkpoint theo chặng; thông báo `Already PASS` chỉ kết quả đã lưu. Một lần nghiệm thu mới cần run ID và thư mục minh chứng riêng, bảo quản lần này.

Các ảnh được chọn cho Notion chỉ chứa đơn/customer TEST của lượt này. Dùng các file trong `EVIDENCE_INDEX.md`. Raw SQL backup, env/secret và ảnh debug toàn trang được giữ riêng trong runtime. JSON/log lưu UTC; chỉ mục và ảnh hậu kiểm dùng Asia/Saigon (+07).
