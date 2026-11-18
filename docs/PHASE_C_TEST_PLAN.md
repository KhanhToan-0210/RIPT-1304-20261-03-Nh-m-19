# ShopOnline — Kế hoạch kiểm thử PHA C2

Ngày 17/11/2026, múi giờ Asia/Saigon. Tham chiếu thiết kế `PHASE_C_DESIGN.md`.

**Trạng thái toàn bộ ca C2 trong tài liệu này là NOT RUN.** C1 chỉ đọc Git, source, Docker metadata, HTTP GET và SELECT trên TEST để lập baseline. Các thao tác tạo dữ liệu, đổi state, restart, reload, backup/restore và fault injection bên dưới là kế hoạch cho C2 sau khi người dùng duyệt.

## 1. Điều kiện môi trường và baseline

| Hạng mục | Baseline C1 và điều kiện C2 |
| --- | --- |
| Worktree / branch | `D:\BTL_platform\shoponline-integration`, `integration/shoponline-completion` |
| Commit nền | `17c46552eb27a744c447bb7f323fb591e7f5058b` |
| Project TEST hiện tại | `shoponline-test-b-20261117`, bốn service healthy |
| Port dành cho TEST C2 | Gateway 127.0.0.1:18080, direct A/B 127.0.0.1:18000/18001 |
| DB hiện tại | Hai DB cùng tên `shoponline_check_phase_b`, có server UUID và volume riêng |
| Dữ liệu hiện tại A / B | A 26 products / 11 orders / 12 items; B 22 / 10 / 11, khớp báo cáo B |
| Đối tượng C2 bổ sung | Overlay TEST, gateway/control-db và volume riêng, DB C2 mới có gate/receipt |
| Môi trường tách biệt | DB/control chỉ trên network TEST; source của demo tiếp tục ở checkout ban đầu |
| Cổng nghiệm thu đầu vào | Người dùng duyệt D1–D7, đặc biệt nguồn A ban đầu, thêm coordinator/schema runtime và chính sách fence SQL |

C2 phải chụp baseline mới ngay trước khi thực thi để bảo toàn các thay đổi người dùng phát sinh sau C1. Fixture dùng tên/ID riêng theo test run. Snapshot/manifest/report runtime nằm trong thư mục TEST đã được ignore. Giữ các DB/artifact đã tạo cho đến khi có chính sách dọn được duyệt.

### Phạm vi được bảo vệ

- Các container `primary-web`, `standby-web`, `primary-db`, `standby-db` thuộc project demo và volume `ript-1304-20261-03-nh-m-19_*`.
- Các cổng demo 8000/8001/3308/3309, database demo và secret/môi trường demo hiện hữu.
- Checkout `D:\BTL_platform\RIPT-1304-20261-03-Nh-m-19` được bind vào demo và mọi thay đổi người dùng ngoài worktree được duyệt.
- Cấm lệnh xóa volume/database, import đè DB đang phục vụ, reset Git, commit/push/merge và gọi legacy sync/failback trong runner C2.

Runner phải resolve resource qua Compose project/service và xác nhận labels/container ID/DB UUID/prefix trước mỗi thao tác. Dry-run bị chặn ngay khi trỏ tới tài nguyên demo, tên DB `shoponline` hoặc namespace ngoài TEST. Việc cấp quyền/khóa account và read-only áp dụng đúng **server TEST**.

## 2. Trình tự thực hiện dự kiến

1. Ly kiểm thử admission/transaction/receipt và readiness bằng unit test với pool giả lập, giữ hồi quy PHA B.
2. Nam/Toàn bootstrap C2 ở MAINTENANCE, fence process/credential TEST legacy, backup baseline và clone nguồn A vào DB C2 mới, tạo control/gate/receipt. Kiểm tra cả hai DB PHA B được bảo quản.
3. Xác minh PRIMARY_ACTIVE ban đầu và các ca inactive/direct port/multi-worker.
4. Chạy các ca lỗi trước activation và rollback về A bằng epoch mới. Mỗi candidate restore dùng DB mới. Nguồn có thẩm quyền vẫn là A trong nhóm này.
5. Chuẩn bị B đúng snapshot, kết hợp kiểm tra hai switch cạnh tranh rồi hoàn thành một lần A → B có kế hoạch.
6. Khi B active, kiểm tra restart coordinator/gateway/node A cũ và rearm B cùng DB nếu cần. Kiểm tra scope demo sau toàn bộ lần chạy.
7. Ghi PASS/FAIL/BLOCKED thực tế và báo cáo người dùng. Luồng chuyển dữ liệu B → A đầy đủ để giữ đơn B được thiết kế cho PHA F.

Ca cần quay lại baseline sau activation phải dùng namespace TEST mới hoặc một quy trình dữ liệu được duyệt. Việc gán lại một enum hay restore snapshot cũ để làm sạch test sẽ làm sai nguồn có thẩm quyền.

## 3. Oracle và bằng chứng chung

| Nhóm bằng chứng | Thu thập dự kiến |
| --- | --- |
| Scope | Git status/HEAD, inventory Docker labels/IDs/image/StartedAt/mounts/volumes/ports trước và sau |
| Authority | State/revision/epoch, owner connection ID, transition journal, generation gateway |
| Data fence | Gate row theo DB, read_only/super_read_only, durable startup policy, writer account/session/transaction/lock thuộc TEST |
| Traffic | URL, HTTP method/status, node/epoch/generation từ response, kết quả probe qua direct và gateway |
| Giao dịch | Idempotency key, receipt, order ID, nội dung items/price/total và stock đọc trực tiếp MySQL |
| Snapshot | Exit code, byte count/encoding/SHA-256, manifest, schema/row/receipt digests, khác biệt gate được phép |
| Restart | Boot ID/StartedAt, kết nối cũ, state/gate/DB flags sau restart và request tới process mới |

Response HTTP được đối chiếu với state và SQL. Một HTTP lỗi vẫn có thể đi kèm commit nếu mất ACK, nên ca lỗi cần kiểm tra receipt/dữ liệu. `COUNT(*)`, log báo thành công hoặc biến counter RAM chưa đủ làm oracle cho fencing/drain.

Test tải ghi ghi nhận các interval admission/commit theo node/epoch và barrier DB. Tại mọi điểm, node mới chỉ được admission sau khi source fence đã xác minh. Dữ liệu không đổi trên node inactive và quyền DB thực tế giúp kiểm tra độc lập với response API.

## 4. Mười lăm ca bắt buộc

### C2-01 — Gateway chọn A

- **Điều kiện/phương pháp** — Bootstrap đã xác minh A, gateway 18080. GET live/health/ready/status qua direct và gateway, thực hiện một mutation TEST có key, đọc lại DB A/B.
- **Kết quả mong đợi** — Node/DB/epoch/generation qua gateway khớp A; mutation chỉ xuất hiện tại DB A canonical.
- **PASS/FAIL** — PASS khi HTTP, control, binding và SQL cùng khớp. FAIL nếu chọn sai node/DB, generation lệch hoặc có dữ liệu ghi tại B.
- **Giới hạn** — Kiểm chứng trạng thái đã bootstrap trên host TEST; chưa kiểm chứng mất host.
- **Chủ trì** — Toàn, phối hợp Ly/Nam.

### C2-02 — Gateway chuyển sang B

- **Điều kiện/phương pháp** — A active; B là DB mới đã restore/verify. Ghi journal S0–S9, gửi request theo dõi qua URL chung suốt cutover, sau publish tạo đơn mới trên B và kiểm SQL.
- **Kết quả mong đợi** — Có khoảng maintenance 503; fence A hoàn tất trước admission B, gateway chọn đúng DB B và đơn mới chỉ ở B.
- **PASS/FAIL** — PASS khi thứ tự fence → route verified → publish đúng, đơn/stock B đúng và A giữ sealed. FAIL nếu B ghi sớm, route sai hoặc nguồn A còn quyền ghi.
- **Giới hạn** — Chuyển thủ công có kế hoạch với source DB quản trị được. Kiểm thử lỗi web bất ngờ được mở rộng ở ca 20.
- **Chủ trì** — Toàn, phối hợp Nam/Ly.

### C2-03 — Inactive từ chối mọi route ghi

- **Điều kiện/phương pháp** — A active. Gửi payload hợp lệ POST orders/products, PUT products, DELETE products và PATCH vào B; thêm fixture endpoint ghi qua wrapper để kiểm tra đường future route.
- **Kết quả mong đợi** — B trả JSON 503 code inactive và không có transaction nghiệp vụ/receipt mới. Route PATCH chưa được triển khai ở node active vẫn theo hợp đồng 404.
- **PASS/FAIL** — PASS khi tất cả mutation inactive bị chặn và row/digest không đổi. FAIL khi có side effect dù response báo lỗi.
- **Giới hạn** — Cần inventory route và review SQL của các GET để bao phủ endpoint mới.
- **Chủ trì** — Ly, phối hợp Nam.

### C2-04 — Direct port và header giả không bypass

- **Điều kiện/phương pháp** — Gọi thẳng inactive 18001 khi A active, sau chuyển gọi 18000 khi B active. Giả header node/active/generation/transition từ client.
- **Kết quả mong đợi** — Guard lấy authority từ control/gate; header client không đổi quyền ghi. Health có thể 200 trong khi active-ready/mutation là 503.
- **PASS/FAIL** — PASS khi đúng mã lỗi và DB inactive bất biến trên cả hai chiều. FAIL khi direct request hoặc header cho phép write.
- **Giới hạn** — Client không có quyền Docker/MySQL admin theo biên tin cậy đã nêu.
- **Chủ trì** — Ly, phối hợp Toàn/Nam.

### C2-05 — Hai writer và nhiều process

- **Điều kiện/phương pháp** — Tạo hai worker TEST của node A dùng chung DB/gate với boot ID khác nhau, thêm B. Gửi mutation đồng thời trên ba process trước/trong/sau chuyển; ghi receipt, epoch và timeline fence.
- **Kết quả mong đợi** — Nhiều worker của node active có thể phục vụ cùng DB; source in-flight kết thúc trước admission của node mới. Worker inactive không có commit mới.
- **PASS/FAIL** — PASS khi SQL/journal chứng minh không có khoảng hai node cùng được admission ghi. FAIL nếu có commit của node cũ sau fence hoặc B admission trước fence.
- **Giới hạn** — Fixture nhiều worker dùng network/port nội bộ TEST. Kiểm thử một process sẽ thiếu oracle cho yêu cầu này.
- **Chủ trì** — Ly, phối hợp Nam/Toàn.

### C2-06 — State bền vững qua restart

- **Điều kiện/phương pháp** — Khi B active, restart có kiểm soát control-db, gateway và web B từng thành phần. So epoch/state/DB binding trước sau; trong lúc authority mất, thử mutation có key.
- **Kết quả mong đợi** — Authority lỗi tạo 503 cho admission mới. Sau phục hồi, canonical vẫn B hoặc maintenance cần reconcile, gateway chọn B khi B ready.
- **PASS/FAIL** — PASS khi state/epoch không lùi, A không được chọn mặc định và SQL không có write sai node. FAIL khi state mất, cache fail-open hoặc role tự đảo.
- **Giới hạn** — Restart container là fault process; dữ liệu volume/hardware mất là một miền lỗi khác.
- **Chủ trì** — Toàn, phối hợp Ly/Nam.

### C2-07 — Node A cũ restart sau failover

- **Điều kiện/phương pháp** — B active. Restart A với config/credential/epoch cũ; thử direct write và kết nối qua session cũ được giữ từ fixture.
- **Kết quả mong đợi** — A active-ready 503, gate closed, credential cũ khóa, DB read-only; B vẫn là writer canonical.
- **PASS/FAIL** — PASS khi cả HTTP và DB fence chống write sau restart. FAIL nếu container cũ lấy lại DML hoặc thay role.
- **Giới hạn** — Boot mặc định read-only phải được kiểm riêng ở ca 19; server UUID tồn tại qua restart chưa xác định được một boot mới.
- **Chủ trì** — Ly, phối hợp Nam/Toàn.

### C2-08 — Maintenance chặn admission mới

- **Điều kiện/phương pháp** — Bắt đầu từ A active, pause điều phối sau commit S1, gửi cùng các mutation trên cả A/B qua direct/gateway, quan sát state từ hai worker.
- **Kết quả mong đợi** — Request admission mới nhận 503; static/diagnostic GET tiếp tục theo contract. Các request đã admission thuộc ca drain.
- **PASS/FAIL** — PASS khi sau ranh giới S1 không có admission mới ở cả hai node. FAIL nếu process dùng role cache để nhận thêm ghi.
- **Giới hạn** — Timestamp HTTP đơn lẻ không xác định thứ tự admission; dùng control transaction/journal.
- **Chủ trì** — Ly, phối hợp Toàn.

### C2-09 — Drain theo transaction thực

- **Điều kiện/phương pháp** — Dùng session TEST giữ row lock sản phẩm, gửi một đơn để request giữ shared gate rồi chờ row đó. Commit MAINTENANCE, thử request mới, bắt đầu đóng gate; lần lượt release lock, abort HTTP và kill worker trong các fixture trước activation.
- **Kết quả mong đợi** — Request mới bị chặn. Đóng gate phải đợi transaction cũ commit hoặc rollback thực; target chưa được mở. Client disconnect không xóa bằng chứng SQL đang chạy.
- **PASS/FAIL** — PASS khi gate exclusive chỉ hoàn tất sau transaction cũ kết thúc và data/receipt toàn vẹn. FAIL nếu counter về 0 làm mở B khi SQL còn hoạt động.
- **Giới hạn** — Quá timeout vẫn cần đối chiếu session/receipt. Abort HTTP chưa chứng minh rollback.
- **Chủ trì** — Ly, phối hợp Nam.

### C2-10 — Readiness phát hiện sai DB/server

- **Điều kiện/phương pháp** — Trỏ candidate B lần lượt tới DB TEST khác đã tồn tại, DB rỗng, DB cùng tên trên server A và pool cũ sau thay file config. Các DB sai đều thuộc TEST.
- **Kết quả mong đợi** — Readiness dùng actual connection, trả 503 với lý do binding/schema phù hợp, dù SELECT 1 có thể thành công.
- **PASS/FAIL** — PASS khi cả tên thực, UUID server, schema và pool generation được kiểm. FAIL nếu env đúng là đủ hoặc probe một connection khác pool phục vụ.
- **Giới hạn** — Cần config cố ý sai ở TEST và đọc metadata thực, mock env đơn thuần thiếu kiểm chứng pool.
- **Chủ trì** — Nam, phối hợp Ly/Toàn.

### C2-11 — Readiness lỗi chặn switch

- **Điều kiện/phương pháp** — Target health/readiness lỗi, wrong node, stale manifest, gate chưa rebind, epoch lệch hoặc coordinator unavailable. Snapshot gateway/state trước và sau thử switch.
- **Kết quả mong đợi** — Điều phối dừng trước publish, writer rỗng trong maintenance hoặc rollback source trước S8 có proof.
- **PASS/FAIL** — PASS khi HTTP 200 sai identity cũng bị từ chối, config/state không mở writer. FAIL nếu chỉ kiểm status code hoặc dùng readiness cũ.
- **Giới hạn** — Các nguyên nhân phải được thử riêng để xác định check nào thiếu.
- **Chủ trì** — Ly, phối hợp Nam/Toàn.

### C2-12 — Reload lỗi và rollback có kiểm chứng

- **Điều kiện/phương pháp** — Trước S8, tạo bundle TEST sai syntax; tiếp theo thử syntax hợp lệ nhưng apply/probe lỗi. Theo dõi config hash, worker PID, generation, route và writer.
- **Kết quả mong đợi** — Config lỗi bị chặn trước reload; apply lỗi giữ maintenance. Rollback route về source dùng generation/epoch mới và fence target trước mở lại.
- **PASS/FAIL** — PASS khi probes khớp state, old worker đã xử lý và không có writer mới khi route chưa đúng. FAIL nếu exit 0, file mới hoặc log đơn lẻ được coi là thành công.
- **Giới hạn** — Reload graceful có worker cũ; cần cả connection dài và request mới. Lỗi sau S8 dùng ca 17.
- **Chủ trì** — Toàn, phối hợp Ly/Nam.

### C2-13 — Hai switch chạy đồng thời

- **Điều kiện/phương pháp** — Hai process điều phối cùng namespace/expected revision, owner thứ nhất pause ở S1 trước publish. Process thứ hai thử cùng target B; kiểm lock, journal và SQL side effect.
- **Kết quả mong đợi** — Một owner được thực hiện, lượt thứ hai BUSY trước tác động. Owner thứ nhất tiếp tục một lần A → B khi đủ điều kiện.
- **PASS/FAIL** — PASS khi chỉ có một chuỗi journal và một activation epoch, không có lệnh admin cạnh tranh. FAIL nếu cả hai thực hiện hoặc một process lấy lock bằng phiên SQL đã kết thúc.
- **Giới hạn** — Mất lock khi owner vẫn sống được kiểm riêng ở ca 18; lock chỉ áp dụng trong control MySQL đã chọn.
- **Chủ trì** — Toàn, phối hợp Ly/Nam.

### C2-14 — Web B dùng DB mới sau restore

- **Điều kiện/phương pháp** — Tạo đơn/sản phẩm marker trên A trước MAINTENANCE và xác nhận commit. Sau drain/fence A, lấy snapshot chứa marker, restore DB B tên mới và đối chiếu row/schema/receipt. Sinh binding mới, recreate B và đọc candidate readiness qua direct/gateway.
- **Kết quả mong đợi** — DB B cũ còn để đối chiếu. Actual DB name/server UUID đúng target mới, mọi row nghiệp vụ/receipt và stock khớp. Gate được rebind closed có journal.
- **PASS/FAIL** — PASS khi dump verify, SQL trực tiếp và readiness cùng chứng minh DB mới. FAIL nếu restore vào DB phụ còn web dùng DB cũ, thiếu FK/row hoặc marker không khớp.
- **Giới hạn** — Pha B `verify` với counts động hỗ trợ schema/totals; cần comparator đầy đủ để chứng minh cùng snapshot.
- **Chủ trì** — Nam, phối hợp Toàn/Ly.

### C2-15 — Lỗi thử nghiệm bảo toàn demo

- **Điều kiện/phương pháp** — Chụp metadata container demo và fingerprint dữ liệu bằng SELECT chỉ đọc trong cửa sổ đã thống nhất. Thử tham số project/container/DB demo ở dry-run của runner C2; xác nhận bị chặn trước mutation. So baseline sau các fault/restart TEST.
- **Kết quả mong đợi** — Mọi lệnh thực thi có resolved ID/label/DB TEST; ID, StartedAt, mount, volume và dữ liệu demo khớp baseline.
- **PASS/FAIL** — PASS khi scope guard lẫn so sánh thực tế đều đạt. FAIL khi có write nhầm, restart/demo mount đổi hoặc dùng default legacy container name. Nếu người dùng đồng thời thao tác demo, kết quả fingerprint khác phải được điều tra và ghi INCONCLUSIVE.
- **Giới hạn** — Metadata khớp chỉ chứng minh resource identity; kiểm dữ liệu cần fingerprint riêng và kiểm soát các nguồn ghi khác.
- **Chủ trì** — Toàn, phối hợp Nam/Ly.

## 5. Ca bổ sung cho các failure window quan trọng

| ID | Phương pháp | Kết quả / điều kiện PASS và FAIL | Giới hạn | Chủ trì |
| --- | --- | --- | --- | --- |
| C2-16 Commit UNKNOWN và key trùng | Unit fault injection làm mất ACK sau COMMIT; fixture trên MySQL thật đọc receipt/data, gửi lại cùng key và key khác body | PASS khi cùng key trả kết quả đã commit, khác body 409, dữ liệu có đúng một mutation. Key vắng phải chờ source fence/transaction kết thúc mới kết luận | Injection ở driver cần ghi rõ; muốn chứng minh lỗi mạng thật cần proxy ngắt kết nối có điều khiển | Ly / Nam, Toàn |
| C2-17 Lỗi sau publish writer | Sau B active, tạo đơn rồi làm post-check/gateway probe lỗi | PASS khi B vẫn là nguồn canonical hoặc maintenance chờ phục hồi; đơn mới còn. FAIL nếu tự về DB A cũ | Kiểm quy tắc rollback sau ranh giới S8, failback dữ liệu đầy đủ thuộc F | Toàn / Nam, Ly |
| C2-18 Owner chết hoặc mất named lock | Pause owner trước lệnh admin, ngắt control connection/kill process, giữ lệnh con ở trạng thái chưa rõ | PASS khi pending journal chặn takeover tới khi owner/lệnh con đã kết thúc và fence được đọc lại. FAIL nếu hết lease là đủ mở writer | Cần ghi rõ fault process/connection nào, thử cả ACK control commit không rõ | Toàn / Ly, Nam |
| C2-19 DB restart và persistent read-only | Khi B active, restart riêng TEST DB B; đọc persistent/runtime flags, old account/session; reconcile rearm B cùng DB bằng epoch mới | PASS khi B chưa đủ readiness thì ghi bị chặn, mặc định read-only đúng và rearm có proof. FAIL nếu role RW tự hồi theo setting runtime cũ | Thử MySQL 8.0.46 và volume thật; C1 chưa thực thi SET PERSIST/restart | Nam / Toàn, Ly |
| C2-20 Sự cố bất ngờ và fence thiếu | Hỏng web A với DB A còn đọc được; fixture khác khiến DB A không truy cập được trước fence | PASS khi nhánh web lỗi chỉ promote sau SQL fence; nhánh DB unreachable giữ maintenance và B closed. FAIL nếu ping/timeout được dùng thay fence | Chứng minh chính sách an toàn đã chọn, khả năng hard-fence hạ tầng cần thiết kế sau | Toàn / Nam, Ly |
| C2-21 Dump và restore thất bại | File empty/UTF-16/hash sai, lệnh native khác 0, DB đích có sẵn, import dở | PASS khi artifact không được publish verified, DB đang phục vụ an toàn, retry có tên DB mới/journal. FAIL nếu ghi đè, báo thành công giả hoặc cấp serving cho DB dở | Dùng artifact TEST đã sao chép; không chạy dump thật lên demo | Nam / Toàn |
| C2-22 Gateway restart/generation cũ | B active, restart gateway; đưa bundle A cũ vào fixture, kiểm header giả và connection old worker | PASS khi boot từ canonical B hoặc maintenance, request stale generation 503. FAIL nếu bundle cũ kéo traffic/writer về A | Cần bootstrap/reconcile và backend generation check đồng thời | Toàn / Ly |
| C2-23 Dữ liệu đích lệch sau verify | Trước promotion, admin fixture đổi row/stock/schema ở target TEST, giữ manifest cũ | PASS khi candidate bị seal/check lại và mismatch chặn switch. FAIL khi metadata `verified=true` bỏ qua live binding/data proof | Candidate có data bất biến; active DB dùng verified base, dữ liệu mới hợp lệ sẽ khác snapshot | Nam / Ly |
| C2-24 RPO snapshot online | Tạo các đơn có key trước/trong/sau dump ở fixture C2, giữ ACK độc lập, mô phỏng chỉ còn snapshot | PASS khi báo khoảng rủi ro cùng tập ID quan sát được, không lấy created_at làm commit time. FAIL nếu hứa bảo toàn các ACK ngoài snapshot | Chính sách không promote khi thiếu fence vẫn áp dụng; đây là đánh giá artifact/RPO | Nam / Ly |

## 6. Ghi kết quả và cổng nghiệm thu C2

Mỗi lần chạy có run ID, Git/image digest, project, dữ liệu đầu/cuối, steps/journal, response codes và kết quả SQL. Các trạng thái báo cáo là PASS, FAIL, BLOCKED hoặc NOT RUN. Bài test bị môi trường chặn giữ nguyên trạng thái đó và ghi nguyên nhân. C2-01–15 là bắt buộc; các ca 16–24 kiểm chứng các bảo đảm bổ sung đã chọn trong thiết kế và cần được chốt trong phạm vi phê duyệt C2.

Cổng C2 chỉ đạt khi nguồn fence trước target admission, direct port bị chặn đúng, database binding xác minh được, cơ chế qua restart/lost-owner được kiểm chứng và scope demo bảo toàn. Kết quả cần gồm hồi quy luồng mua/admin trên node active qua URL chung, JSON 503/409 đúng và trạng thái pending/idempotency có outcome rõ ràng. Các giới hạn host đơn, source DB không fence được và RPO snapshot phải đi cùng báo cáo.

Các hạng mục dữ liệu phục hồi toàn diện, thực hành sự cố KT2 và B → A giữ đơn B tiếp tục theo D/E/F sau các cổng được duyệt. Việc đánh dấu C1 DONE chỉ xác nhận tài liệu thiết kế và test plan đã được rà soát.

## 7. Kiểm tra thực hiện trong C1

| Kiểm tra chỉ đọc / tĩnh | Kết quả C1 |
| --- | --- |
| Git branch/HEAD/log/status/diff/untracked trước viết tài liệu | PASS, sạch tại `17c4655`, ba commit đúng yêu cầu |
| Source route/transaction/Compose/helpers | Đã đối chiếu, ghi phát hiện trong mục 1 thiết kế |
| Docker metadata | Engine 29.9.2, TEST bốn service healthy, demo và volume có inventory |
| HTTP GET A/B | Health 200, identity TEST đúng, counts products/orders khớp PHA B |
| SELECT DB A/B | Actual DB đúng, MySQL 8.0.46, ba bảng và counts items đúng; read_only/super_read_only đều 0 |
| Cấu trúc ba tài liệu, JSON mẫu, cạnh state machine, 24 mã test, D1–D7 và phạm vi Git | PASS kiểm tra tĩnh; Mermaid chưa render |
| Các ca C2-01–24 | **NOT RUN trong C1** |

Git diff và kiểm tra tính nhất quán ba tài liệu được ghi ở cuối phần C1 trong `IMPLEMENTATION_STATUS.md`.

## 8. Phạm vi C2a được duyệt và kết quả ngày 18/11/2026

Các ca C2-01–24 phía trên tiếp tục là kế hoạch cho hệ thống chuyển role đầy đủ. C2a dùng mã C2A để ghi riêng các kiểm tra nền tảng đã chạy. Gateway ở MAINTENANCE, hai node C2 đều đóng ghi. Kết quả dưới đây lấy từ lượt cuối của `node scripts/test-c2a.cjs`.

| ID | Phương pháp và điều kiện PASS | Kết quả thực tế |
| --- | --- | --- |
| C2A-01 | Inspect sáu service healthy, network có namespace C2, ba volume DB độc lập, DB không publish port | PASS |
| C2A-02 | Đọc ba bảng control, journal COMPLETE/SEALED; thử hai UPDATE writer/state không hợp lệ phải bị CHECK chặn | PASS, writer vẫn NULL |
| C2A-03 | SQL actual DB/UUID, năm bảng/data DB, gate đóng/epoch 0, zero receipt, read-only flags; so toàn bộ schema/data với manifest A | PASS, mỗi bản 26/11/12 row nghiệp vụ |
| C2A-04 | `nginx -t`, GET liveness và GET/POST qua 18080 | PASS, liveness 200, các URL phục vụ maintenance 503 |
| C2A-05 | POST products/orders, PUT/PATCH/DELETE product và future route vào cả 18100/18101; gửi header active/generation giả | PASS, mọi mutation 503; health 200 và ready 503 |
| C2A-06 | SHOW GRANTS qua account web/control; thử UPDATE qua chính account đang dùng | PASS, SELECT-only và DML bị từ chối |
| C2A-07 | Dừng riêng control-db C2, gọi mutation/status ở hai web phải 503; start lại và đọc state | PASS, COORDINATOR_UNAVAILABLE, sau phục hồi MAINTENANCE/writer NULL |
| C2A-08 | So schema/digest mọi row và receipt/gate trước sau các ca lỗi | PASS, dữ liệu nghiệp vụ không đổi và zero receipt |
| C2A-09 | So tám container PHA B/demo, ID/StartedAt/mount/port/config hash, SHOW GRANTS, flags và fingerprint mọi row của bốn DB | PASS, khớp baseline trước bootstrap |
| C2A-10 | Chạy toàn bộ unit test trong image Node.js của C2, cấu hình legacy cho test PHA B và cấu hình C2 mock trong test mới | PASS 90/90, Node.js 20.20.2 |

Unit test trên Windows Node.js 22.13.0 cũng PASS 90/90, gồm 47 test PHA B và 43 test mới. Các test mới kiểm state/config không hợp lệ, thiếu authority, header giả, toàn bộ mutation qua Express, state active chưa có activation, raw dump lỗi, scope demo bị chặn và fingerprint schema/data. Schema metadata có test hồi quy cho khác biệt SHOW CREATE và thay đổi kiểu cột.

### Baseline và các lần sửa lỗi trong quá trình kiểm thử

Docker Engine ban đầu chưa có pipe Linux. Khi Engine hoạt động, demo đã tự chạy, bốn container PHA B còn dừng. Đã dùng Compose start cho các container PHA B hiện hữu để đọc snapshot, giữ image/config/volume và quyền MySQL. Baseline bảo vệ C2 được chụp sau bước khôi phục khả dụng này. ID bốn container PHA B vẫn khớp inventory trước start; StartedAt thay đổi do start được ghi riêng trong báo cáo runtime.

Đã sửa network internal gây mất published ports, so sánh raw DDL gây báo lệch schema giả, kiểu chuỗi của biến MySQL read-only, và env C2 kế thừa vào test API PHA B. Runner dùng kết nối HTTP mới cho mỗi probe fault để kiểm tra response 503 qua cổng host. Lượt đầu có C2A-10 FAIL, lượt kế có C2A-07 lỗi fetch; các báo cáo này được giữ cạnh báo cáo cuối PASS.

### Artifact và giới hạn kiểm chứng

- `.runtime/c2a/snapshot-manifest.json` chứa checksum, thời gian dump, identity, metadata và row digest nguồn/đích.
- `.runtime/c2a/bootstrap-complete.json` chứa binding và trạng thái hoàn tất MAINTENANCE.
- `.runtime/c2a/environment-before-start.json`, `protected-before.json`, `protected-after-bootstrap.json`, `protected-after-tests.json` lưu inventory/fingerprint và quyền trước sau.
- `.runtime/c2a/unit-results.log`, `unit-container.log`, `test-results.json` giữ kết quả cuối. `test-results-first-run.json` và `test-results-second-run.json` giữ các lượt lỗi đã sửa.

Các file runtime nằm trong ignore. Khi một nguồn ghi khác làm thay đổi PHA B/demo trong cửa sổ so sánh, khác biệt cần được điều tra trước khi kết luận về tác động C2. Test C2A chỉ chứng minh zero writer ở MAINTENANCE và hành vi từ chối an toàn. Kiểm chứng một writer active, chuyển A → B, failback, admission/drain đa process, commit UNKNOWN, receipt retry và reload/generation động vẫn **NOT RUN**.

## 9. Nghiệm thu KT1–KT3 thực tế ngày 18/11/2026

Người dùng mở rộng phạm vi để hoàn thiện liên tục các cổng KT1–KT3. Kết quả bên dưới là kiểm thử runtime sau C2a. File máy lưu ở `.runtime/evidence-20261118/acceptance.json`; ảnh/log và hướng dẫn Notion tại `EVIDENCE_INDEX.md`.

| Cổng | Điều kiện đã kiểm | Kết quả |
| --- | --- | --- |
| Chặng 1 | A CREATE/UPDATE/DELETE và order, error rollback, replay key/concurrent key, conflict 409, inactive/direct spoof, mutex CLI và Control DB outage | PASS |
| KT1 | Chrome catalog → chi tiết → giỏ quantity 2 → checkout → Order ID, MySQL A total/items/stock | PASS, `59a46870-971a-405c-933f-d95b66dcbee5` |
| KT2 | Online backup, stop primary-web C2, SQL fence A, frozen snapshot/restore DB mới B, compare/rebind/readiness/gateway, B checkout và MySQL | PASS, `acaf0cff-01cb-4894-b7ac-cc4f16a34129` |
| KT3 | Shared gate và product wait cùng transaction, freeze chặn request mới, exclusive gate chờ; B snapshot/restore DB mới A; giữ đơn B/drain rồi A checkout | PASS, đơn mới A `567799c9-dc0a-4fb4-b821-90f737fa458f` |
| Vận hành tối thiểu | Backup active writer lặp lại, restore-check DB B mới, fingerprint/grants/metadata PHA B/demo và role cuối | PASS |
| Unit regression cuối | Windows Node.js 22.13.0 và container Node.js 20.20.2 | PASS 103/103 mỗi môi trường |

Đơn drain B là `a569f29e-7aac-43a5-91d3-1c346e83a3b1`. Full comparison trước publish A khớp 29 products, 16 orders, 17 items, 12 receipts. Sau đơn mới A, bản restore-check có 30/17/18 row nghiệp vụ và 14 receipts. Replay đúng key/body của đơn B trên A trả cùng Order ID, header replay true và data/schema digest giữ nguyên.

### Đối chiếu test plan C1 với phần đã thực sự chạy

PARTIAL nghĩa là các biến thể ghi trong cột giới hạn còn NOT RUN. PASS chỉ áp dụng phạm vi đã mô tả. Các JSON/timestamp/ảnh trong evidence phản ánh lượt chạy thực tế.

| ID | Trạng thái | Bằng chứng/phạm vi | Giới hạn còn NOT RUN |
| --- | --- | --- | --- |
| C2-01 | PASS | KT1 gateway A, readiness/DB/SQL/order | Mất host |
| C2-02 | PASS | KT2 source fenced trước target B publish, order B | Tự động failover |
| C2-03 | PASS | Inactive POST products/orders, PUT/PATCH/DELETE, future route và SQL digest không đổi | Endpoint ghi mới ngoài contract hiện tại |
| C2-04 | PASS | Direct 18100/18101, header active/generation giả bị chặn trên node inactive | Client có Docker/MySQL admin ngoài biên tin cậy |
| C2-05 | PARTIAL | Concurrent request cùng key chỉ một order/stock decrement; SQL gate thuộc transaction nghiệp vụ | Hai worker A độc lập cộng B dưới tải |
| C2-06 | PARTIAL | Control restart khi A active, gateway restart khi B active và khi A đã failback | Restart đồng thời control/gateway/data/host |
| C2-07 | PASS | A cũ start sau B publish bị NODE_INACTIVE, account cũ khóa; B stale sau A publish bị chặn | Ngoài các process/config C2 đã kiểm |
| C2-08 | PASS | KT3 MAINTENANCE chặn request mới trong lúc order đã admission còn chạy | Tải lớn kéo dài |
| C2-09 | PARTIAL | Product row lock, shared gate và exclusive gate wait có proof performance_schema; order drain được bảo toàn | Abort HTTP/kill worker ở các mốc transaction khác |
| C2-10 | PARTIAL | Unit reject wrong DB/UUID/user/epoch; actual readiness đúng DB mới ở cả B/A | Fault injection pool cũ/wrong server trên container thật |
| C2-11 | PARTIAL | Precondition/readiness gates trong script, gateway maintenance khi thiếu readiness/authority | Cố ý HTTP 200 sai identity/manifest trước publish |
| C2-12 | PARTIAL | Native nginx -t reject config lỗi, current pointer/route giữ nguyên; pre-publish abort đã chạy | Ép reload OS/apply lỗi khi master đang chạy |
| C2-13 | PARTIAL | Hai connection/process cùng named lock, contender CLI trả TRANSITION_BUSY | Hai switch actuator cùng chạy và owner mất lock giữa side effect |
| C2-14 | PASS | KT2 web B actual new DB, full schema/row/receipt compare; KT3 A tương tự | Hardware storage loss |
| C2-15 | PASS | Tám protected container, grants/flags và bốn DB fingerprints khớp trước/sau | Writer ngoài tác vụ cùng thay đổi demo trong cửa sổ đo |
| C2-16 | PARTIAL | Unit mất ACK commit → UNKNOWN; thực tế duplicate/concurrent key và replay B key trên A | Ngắt TCP thật tại COMMIT |
| C2-17 | PARTIAL | Abort trước publish giữ canonical source/zero writer; failback dùng dữ liệu B mới | Fault post-publish/ACK publish không rõ |
| C2-18 | NOT RUN | Có guard owner/PID/admin-session và pending journal trong code | Crash/pause owner giữa các native command |
| C2-19 | PARTIAL | Persisted read-only ON đã đọc lại; C2a từng recreate data container sealed | Active DB restart rồi rearm protocol v2 |
| C2-20 | PARTIAL | primary-web dừng, DB A vẫn quản trị và fencing được, KT2 PASS | Source DB/host unreachable trước fence |
| C2-21 | PARTIAL | Unit dump empty/UTF/DB switch, checksum thực và native restore mới nhiều lần | Native import dở/collision DB được cố ý gây lỗi |
| C2-22 | PARTIAL | Gateway restart giữ canonical B/A, stale generation request bị 503 | Cố ý tráo bundle cũ vào volume |
| C2-23 | NOT RUN | Candidate sealed và verification/binding được kiểm trong code | Admin sửa dữ liệu đích sau verify |
| C2-24 | NOT RUN | Đã đo frozen copy có DB nguồn còn đọc được | Chỉ còn snapshot cũ, mất các ACK sau snapshot |

### Kết quả đo và cách đọc

KT2 RTO 28,005 giây đo từ source web đã dừng đến gateway active-ready B. KT3 maintenance 29,306 giây từ freeze đến gateway active-ready A. Mỗi transition lưu frozen/fence/dump/candidate/armed/publish/ready timestamp UTC. UI/ảnh hậu kiểm chuyển giờ Asia/Saigon (+07).

Không có order/receipt đã xác nhận bị mất trong các bản frozen đã so. Phép thử này dựa trên source DB còn quản trị được sau lỗi web. Kết quả không đại diện cho RPO/RTO khi mất DB/host hoặc backup online đã cũ.

### Lỗi đã sửa và khả năng tái lập

Đã lưu transition lỗi trước publish và recovery zero writer, lỗi log Nginx subprocess, retry chụp ảnh sau navigation với Order ID đã lưu, và dependency Git cleanup. Các chặng chỉ đi tiếp sau PASS. Bộ ảnh public chọn dòng đơn TEST để tránh đưa lịch sử customer khác lên Notion. Raw dump/secret giữ ngoài thư mục evidence được chọn.

Scheduler chưa được cài. Runbook có lệnh backup canonical đã chạy thực và hướng dẫn Task Scheduler. Các checkpoint PASS trong `acceptance.json` là kết quả của run ID `7996e0b7-33e9-4d34-8910-d185909317e7`; một lần nghiệm thu mới cần run ID/thư mục riêng.
