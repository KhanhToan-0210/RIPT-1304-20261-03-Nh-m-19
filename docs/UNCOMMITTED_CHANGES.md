# ShopOnline — Thay đổi chưa commit và đề xuất chia commit

Ngày 18/11/2026. Branch `integration/shoponline-completion`, HEAD `17c4655`. Chỉ kiểm tra Git/file; không add, commit, reset, push hoặc merge. Không chạy Docker/database hoặc test nghiệp vụ trong lượt đóng gói.

**43 file chưa commit**: 11 tracked modified, 32 untracked; trong đó 34 file code/test/config và 9 tài liệu Markdown. Các thay đổi A/B đã commit giữ nguyên. Diff dependency/lockfile rỗng; index không có thay đổi đã stage. File dưới .runtime, ZIP và backup được ignore.

Lượt này sửa UTF-8/ánh xạ trong docs/EVIDENCE_INDEX.md, thêm docs/NOTION_MC01_MC12.md và báo cáo này. Mã ứng dụng/test/config giữ nguyên SHA-256 so với audit cuối KT1–KT3. Không chạy lại unit test; log 103/103 là kết quả nghiệm thu đã lưu.

## Đề xuất commit 1

`feat(cluster): add durable coordinator and guarded write transactions` — Nam / Ly.

| Git | File |
| --- | --- |
| M | `backend/server.js` |
| ?? | `backend/src/clusterFoundation.js` |
| ?? | `backend/src/config/controlDb.js` |
| M | `backend/src/config/db.js` |
| ?? | `backend/src/middleware/writeGuard.js` |
| ?? | `backend/src/services/clusterState.js` |
| ?? | `backend/src/services/requestTransaction.js` |
| ?? | `backend/src/services/writeTransaction.js` |
| ?? | `backend/test/clusterFoundation.test.js` |
| ?? | `backend/test/writeTransaction.test.js` |
| ?? | `database/control-schema.sql` |
| ?? | `database/runtime-schema.sql` |

## Đề xuất commit 2

`feat(ops): add isolated C2 gateway and verified snapshot transitions` — Toàn / Nam.

| Git | File |
| --- | --- |
| M | `.dockerignore` |
| M | `.gitignore` |
| ?? | `backend/test/c2aSnapshot.test.js` |
| ?? | `compose.c2.test.yml` |
| ?? | `database/c2a-snapshot.cjs` |
| ?? | `database/inspect-c2.cjs` |
| ?? | `gateway/Dockerfile` |
| ?? | `gateway/bootstrap.cjs` |
| ?? | `gateway/maintenance.conf` |
| ?? | `gateway/render-config.cjs` |
| ?? | `scripts/bootstrap-c2a.cjs` |
| ?? | `scripts/c2a-lib.cjs` |
| ?? | `scripts/cluster-ops.cjs` |
| ?? | `scripts/test-c2a.cjs` |

## Đề xuất commit 3

`feat(frontend): preserve mutation keys for safe retries` — Ly / Toàn.

| Git | File |
| --- | --- |
| M | `frontend/admin.html` |
| M | `frontend/cart.html` |
| M | `frontend/js/admin.js` |
| ?? | `frontend/js/api-client.js` |
| M | `frontend/js/cart.js` |
| ?? | `frontend/test/api-client.test.cjs` |

## Đề xuất commit 4

`test(docs): record KT1-KT3 acceptance and submission evidence` — Nam / Ly / Toàn.

| Git | File |
| --- | --- |
| M | `README.md` |
| M | `database/README.md` |
| ?? | `docs/EVIDENCE_INDEX.md` |
| M | `docs/IMPLEMENTATION_STATUS.md` |
| ?? | `docs/NOTION_MC01_MC12.md` |
| ?? | `docs/PHASE_C_DESIGN.md` |
| ?? | `docs/PHASE_C_TEST_PLAN.md` |
| ?? | `docs/RUNBOOK_KT1_KT3.md` |
| ?? | `docs/UNCOMMITTED_CHANGES.md` |
| ?? | `scripts/acceptance.cjs` |
| ?? | `scripts/kt-browser.cjs` |

Thứ tự đề xuất: coordinator/backend → ops/gateway/backup → frontend → acceptance/docs. Các phần phụ thuộc chéo đã được giữ cùng nhóm: transaction facade với db.js/server.js, snapshot helper với snapshot test, frontend helper với HTML/JS/test. Sau khi người dùng review và trước commit thực tế, kiểm tra patch và kiểm thử phù hợp; chưa có commit nào được tạo ở lượt này. Không đưa .runtime, ZIP, secret, dump hoặc node_modules vào commit.
