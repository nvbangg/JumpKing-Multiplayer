# testing.md

## Nguyên tắc và workflow

Kiểm tra theo tài liệu sở hữu; báo PASS/FAIL/BLOCKED/NOT RUN đúng thực tế.

| Phần thay đổi | Checks bắt buộc |
| --- | --- |
| Frontend | npm run check, npm test, npm run build; E2E khi đổi luồng UI/gameplay |
| Backend | Maven verify; verify -Pintegration khi đổi persistence/security/HTTP/WS |
| Shared map/physics/rules/adventure | Fixtures và route replay TypeScript/Java; build cả hai phía |
| Luồng online/save/lifecycle | Playwright với backend/MySQL thật và hai identities |
| Tài liệu | Source of Truth, links/anchors, examples, scope và git diff --check |

Khi đổi dependency: frontend chạy `npm audit`; backend lấy version bằng `.\mvnw.cmd dependency:list -DincludeScope=runtime` rồi đối chiếu [OSV](https://google.github.io/osv.dev/post-v1-querybatch/) và advisory của nhà cung cấp. Báo kết quả cùng điều kiện ảnh hưởng/ngoại lệ có nguồn; không coi kết quả quét thô là bằng chứng khai thác được.

## Format và lint

Frontend dùng Biome mặc định cho format, lint và imports; `npm run check` chạy Biome rồi TypeScript (`tsc --noEmit`), không sửa file. `npm run check:fix` áp dụng format và các sửa lỗi an toàn rồi kiểm tra kiểu; lỗi còn lại cần xử lý thủ công. Cấu hình ở `source/client/biome.json`, chỉ quét `src/`, `e2e/` và cấu hình ở root frontend; không quét assets hoặc output sinh tự động. Warning/info giữ mức mặc định và cần được review, không đồng nghĩa lỗi chặn build.

Backend dùng Spotless với google-java-format mặc định, cấu hình trong `source/server/pom.xml`. `verify` kiểm tra format, compile và unit tests; không sửa source. Chạy `.\mvnw.cmd spotless:apply` trong `source/server/` để format, hoặc `spotless:check` để chỉ kiểm tra format. Spotless không thay thế compiler hoặc tests.

`.gitattributes` thống nhất text LF, gồm XML font; `.bat`/`.cmd` dùng CRLF khi checkout, ảnh/âm thanh/font TTF giữ binary. Hash assets trong manifest tính theo bytes sau chuẩn hóa, khớp file được Git lưu. Phiên bản tools được pin để các máy cho cùng kết quả. Sau khi fix, review diff và chạy checks theo phần bị ảnh hưởng; không dùng tự sửa unsafe hoặc nới rules để bỏ qua lỗi.

## Lệnh kiểm thử

Mỗi block chạy từ root project trong terminal riêng.

Frontend:

```powershell
cd source/client
npm run check
npm test
npm run build
npm run test:e2e
```

Backend:

```powershell
cd source/server
.\mvnw.cmd verify
.\mvnw.cmd verify -Pintegration
```

Linux/macOS dùng `sh mvnw`; cài Chromium cho E2E bằng `npx playwright install chromium`.

E2E (end-to-end) dùng Playwright thao tác trình duyệt qua UI → HTTP/WS → backend/MySQL để kiểm tra cả luồng. Chạy riêng vì cần ứng dụng đang chạy và trình duyệt, khác unit tests kiểm tra từng hàm/module.

Fly E2E đọc quyền từ backend thật, không nhúng cờ vào Vite/build. `CommunityFlyIT` chạy Community khi server bật Fly; `RoomFlyBrowserIT` kiểm tra cả bốn mode Room. Quyền bay chỉ phụ thuộc cờ server, không phụ thuộc profile; backend từ chối bay khi cờ tắt. `E2E_FLY_ENABLED` chỉ đặt kỳ vọng của `fly.spec.ts`, không bật Fly trong ứng dụng.

Integration dùng [Testcontainers MySQL](https://java.testcontainers.org/modules/databases/mysql/), Docker và MySQL theo [deployment](deployment.md#runtime-và-workflow). E2E dùng instance cô lập; không reset database cá nhân. Setup test chỉ nạp phần CREATE TABLE của schema.sql vào database test mới/rỗng, không chạy phần DROP/CREATE database hoặc USE. Runner chỉ cleanup resources/fixtures do nó tạo, kể cả khi test lỗi.

Windows không có Docker: chạy `./source/database/test-mysql.ps1 -MySqlHome '<thư mục MySQL 8.4>' -JavaHome '<thư mục JDK 25>'` từ root. Runner tạo instance loopback/cổng ngẫu nhiên, credentials riêng, chạy integration rồi dừng và xóa dữ liệu test; không sửa service/database đang dùng. Thêm `-Web` sau khi build frontend để kiểm tra JAR chứa web và Vite proxy. Integration cũng nhận `JK_TEST_DATABASE_URL/USERNAME/PASSWORD` cho database test rỗng có tên bắt đầu `jumpking_it`; runner bên ngoài chịu trách nhiệm cleanup.

Integration chỉ giữ tối đa bốn Spring test contexts để giới hạn tài nguyên của các server thử nghiệm.

Có thể chạy nhóm bị ảnh hưởng bằng `-IntegrationTest 'RoomRaceIT'` (nhiều class ngăn bằng dấu phẩy); bỏ tham số để chạy toàn bộ integration. Unit tests vẫn chạy trong cả hai trường hợp. Với `AccountBrowserIT`, đặt `E2E_SPECS=e2e/public-room-online.spec.ts` để chọn spec online cần chạy; mặc định chạy tất cả `*-online.spec.ts`.

Thêm `-DatabaseRecovery` để thử restart MySQL và restore dump vào database test mới; đối chiếu số dòng/checksum ba bảng. Chỉ thực hiện trên instance do runner tạo; dump được cleanup cùng instance.

Đặt `E2E_BROWSER_PATH` thành đường dẫn Chrome/Chromium trước khi chạy integration để nghiệm thu Account, contracts và checkpoint qua UI với backend/MySQL cô lập. Harness tự chạy Vite/cổng riêng và đóng sau test; bỏ biến này thì browser integration được ghi là skipped, không coi là đã nghiệm thu UI. `npm run test:e2e` riêng chỉ chạy các scenarios không cần backend, trừ khi cung cấp `E2E_BASE_URL` và cờ online tương ứng.

Kết quả E2E độc lập ở source/client/test-results; harness online dùng .local/browser-online-tests. Khi có E2E_BROWSER_PATH, integration chạy thêm harness riêng cho ending Room, Fly Community và Fly Room; output tương ứng .local/browser-room-ending-tests, .local/browser-fly-online-tests và .local/browser-room-fly-tests. Có thể đổi bằng E2E_OUTPUT_DIR; các lần chạy đồng thời phải dùng thư mục riêng.

Integration cũng chạy `IdentityRaceBrowserIT`: giữ phản hồi `/auth/me` ẩn danh thật đến sau khi đăng ký thành công; phản hồi cũ không được ghi đè Account mới. Output ở `.local/browser-identity-race-tests`.

Với `-Web` và `E2E_BROWSER_PATH`, `SchemaIT` còn chạy Chrome trực tiếp từ JAR: Account, Community save/Continue và Room hai người Start/End/Leave/History; không đi qua Vite. Output ở `.local/browser-packaged-tests`.

`ProductionProxyIT` kiểm tra profile prod: Secure cookies, HTTPS headers và rate-limit theo IP qua proxy tin cậy; forwarded headers từ peer khác không được đổi identity IP. `SchemaIT` kiểm tra static revalidation trả 304, API vẫn no-store.

## Scenarios và oracles

| Nhóm | Kiểm tra và kết quả mong đợi |
| --- | --- |
| Physics | Đi bộ, charge ngắn/full/auto, buffer/air grace, wall/ceiling/corner/slope, ice/snow/wind, splat/cancel; full state đúng expected mỗi tick |
| Map/camera | Toàn tuyến Main Babe từ spawn tới Finish bằng input hợp lệ; tile/biên/chuyển screen đúng, không stuck, không lọt solid |
| Fly Mode | Một cờ server cho mọi người/kiểu chơi/profile, không Options; nhấn đúp/repeat/cancel không launch thừa; giữ Space bay lên, keyboard/touch, biên world, thoát solid/đáy world/restore; save và thành tích đúng [gameplay](gameplay.md#fly-mode) |
| Nội dung/ending | Main Babe đủ NPC/readables/môi trường/audio; không Inventory/items/merchant/quest nhận đồ; ending/Skip đúng người, không credit hoặc phát trùng; build đúng scope |
| Adventure boundary | Hai simulation cùng luật/ID, frontend tra cứu đúng nội dung; Java/snapshot không chứa presentation; hội thoại/crown không nhân đôi qua restore/replay/input giả |
| Community | Continue/New Game trực tiếp từ trang chủ, Continue không tạo lượt khi save thiếu/đổi, New Game xác nhận và kiểm tra expectedRunId; Account bắt buộc; tự ghép/tạo sảnh, không Join bằng ID; lookup không lộ members/token; một lượt/Account, giữ state/time và không nhân đôi membership |
| Checkpoint | Restore đủ physics/adventure/world; metrics/snapshot/revision atomic; New Run đồng thời và rollback; Finish/Abandon không mất save hoặc bị writer cũ phục hồi |
| Pause/AFK | Hidden/blur và biên AFK theo gameplay; neutral frames/giữ phím/heartbeat/chat không reset AFK, input thật reset; Community đang rơi phải settle, hết hạn lưu/release slot; Room mở menu lâu không tự out hoặc dừng trận |
| Room | 1/2/max clients Start được, countdown/permissions; Join mới chỉ WAITING, reconnect đúng roster; Leave/Host transfer/End; Play Again từng người giữ code/settings/History, không kéo người chưa xác nhận vào match mới |
| Room lifecycle | Menu không dừng trận/Time Limit; không có Host Pause; all-offline giữ reconnect 5 phút rồi finalize một lần. Renderer sẵn sàng trước countdown 3 giây; load lỗi/timeout/rời quay lại Lobby |
| Modes/rank | Race first Finish; Hardcore splat respawn giữ clock/peak/falls; Time Limit biên phút/deadline; No Walk không tạo vận tốc đi bộ; comparator, DNF và đồng hạng theo gameplay |
| Leaderboard | Chỉ Community; best của một lượt/Account, không ghép peak/time khác lượt, không nhận Room hoặc client score |
| Identity/data | Schema/FK/CHECK/unique theo [data](data.md); Register/Login/Logout/Change Password, session rotation/ownership/ID enumeration; rollback/revision/save status |
| Stats/History | Tổng Community/Room đã commit; History chỉ terminal/finalized, ownership/pagination/best/wins đúng data; lỗi tải không thành dữ liệu rỗng giả |
| Identity/chat | Ngoại hình không trùng; username cả Room/Community đúng identity; adventure/effects không lặp qua replay; chat plain text, cooldown/history/focus |
| Mobile/browser | Multi-touch/cancel/capture, xoay màn hình, keyboard/gamepad fallback, viewport/menu, storage/audio bị chặn; refresh UI đúng route, API/asset thiếu giữ đúng lỗi |
| Assets | Manifest đủ file sử dụng, nguồn/tình trạng giấy phép rõ; artifact/Git đúng phạm vi và không chứa dữ liệu/công cụ riêng tư |

Fixtures cần input trace/map/tuning và expected states độc lập; hai simulation giống nhau chưa đủ chứng minh đúng. Kiểm tra float32/flags/buffers/restore/pha gió, không nới tolerance che lỗi.

Chơi toàn tuyến bằng input hợp lệ để nghiệm thu platform/charge/camera/audio/Finish; bay/teleport không thay route replay hoặc chơi trực tiếp. Dùng hai browser profiles hoặc normal/incognito cho identities độc lập.

## Lỗi mạng, database và bảo mật

- Ngắt mạng lúc charge/nhảy/countdown/Pause/Finish/save; reconnect trước/sau deadline, socket cũ/seq cũ, duplicate commands và server restart.
- Snapshot đến muộn/dồn: peers đi đều không giật tại thời điểm nhận packet; bộ đệm có giới hạn, không extrapolate hoặc phục hồi peer đã rời. Chuyển screen/respawn/reconnect không kéo nhân vật qua map. Pose chỉ gửi trong screen hiện tại/liền kề; Players vẫn đủ toàn phòng.
- Input FIFO giữ cạnh nhấn/thả và chỉ ACK khi consume. Input mới không che backlog quá hạn: socket bị đóng/resync, charge bị hủy an toàn và generation đổi khi reconnect; input timeout thông thường vẫn cancel. Restore lỗi ở bất kỳ phần physics/adventure/world không được sửa state đang chạy.
- Community đang rơi vẫn chịu physics trước Pause; Resume không mất velocity/buffers hoặc tăng peak giả. Room disconnect không tạo release-jump hoặc reset đồng hồ.
- Trì hoãn/lặp/đảo callbacks của checkpoint/Room writer: revision cũ, Finish/New Run/Leave không phục hồi lượt đã kết thúc, ghi sai owner hoặc tạo thêm rows. Cùng revision khác nội dung phải CONFLICT; UUID của identity/kind khác bị từ chối.
- Tắt MySQL trong instance test: Room tick không block, Community báo lỗi/tạm dừng, không phát SAVED trước commit; retry có giới hạn và transaction atomic.
- Gửi sai payload/protocol version/mode/input, position/clock online giả, input bay khi cờ tắt, cross-origin, CSRF thiếu và request vượt giới hạn; không làm dừng phòng khác hoặc lộ secrets.
- Kiểm tra cùng origin và khác origin nhưng cùng site: credentials, preflight, CSRF, WS Origin và cookies; idle/absolute expiry đóng WS, đăng nhập lại đúng Account reconnect Room còn hạn reconnect, sai owner/token bị từ chối. Internet phải nghiệm thu riêng khi deploy.
- Thử handshake/Create/Join/New Run flooding và connection/phòng hết quota; từ chối trước cấp phát, không làm treo phòng khác.
- Chặn storage/quota/autoplay/gamepad; báo đúng giới hạn, không đánh mất input hoặc báo lưu thành công giả.

## Thực nghiệm và bàn giao

Theo [yêu cầu học phần](final-project/Instruction.md), mỗi thực nghiệm có giả thuyết, baseline, workload, môi trường, số mẫu và phân tích giới hạn.

So sánh snapshot-only với prediction/reconciliation bằng cùng map/tuning và workload. Đo input-to-display latency, correction magnitude/frequency, snapshot jitter, tick time/overrun, messages/bytes, CPU/RAM và độ trễ/lỗi persistence. Dùng 1/2/max clients, thêm nhiều phòng để tìm giới hạn; báo p50/p95/p99 khi phù hợp. Không có clock synchronization thì đo RTT, không suy one-way latency.

Các thực nghiệm opt-in, từ root:

```powershell
$env:JK_WORKLOAD_RUN = 'true'
./source/database/test-mysql.ps1 -MySqlHome '<MySQL 8.4>' -JavaHome '<JDK 25>' -IntegrationTest OnlineWorkloadIT
Remove-Item Env:JK_WORKLOAD_RUN
cd source/client
$env:JK_NETCODE_EXPERIMENT = 'true'
npm run test:e2e -- e2e/netcode-experiment.spec.ts --workers=1
Remove-Item Env:JK_NETCODE_EXPERIMENT
```

Workload chạy Community một người, Room 2/10 người và hai Room; input 60 Hz, đo RTT/snapshot/bytes/CPU/heap/final save. Mỗi mẫu 5 giây, client và server chung JVM nên CPU/heap gồm cả driver, chưa xác định sức chứa tối đa. Compute tick đo riêng 1.800 mẫu sau 600 tick warm-up, không gồm scheduler/serialization/socket/database I/O. Netcode dùng Chrome với input chung, snapshot 20 Hz, độ trễ một chiều mô hình 0/50/100 ms và jitter 0–2 tick; không có packet loss/clock drift. Kết quả JSON ở `.local/reports/`; đây là các phép đo khác nhau, không suy độ trễ Internet từ mô hình.

Nghiệm thu Local, LAN/ZeroTier bằng hai thiết bị và điện thoại thật; kiểm tra clean clone, setup/config, build/run, restart, backup/restore và cập nhật tương thích. Thiếu thiết bị/Docker hoặc check thất bại phải ghi BLOCKED/NOT RUN, không đánh dấu hoàn tất.

Đối chiếu README với build configuration; báo checks đã chạy và phần chưa kiểm chứng khi bàn giao. Raw traces/screenshots/logs ở `.local/reports/` hoặc reports được ignore. Git giữ tests/fixtures/scripts tái tạo và báo cáo bàn giao, không dữ liệu riêng tư.

Báo cáo giải thích networking/concurrency/protocol, đóng góp có số đo, results/discussion/limitations và trích dẫn nguồn; đáp ứng Compilatio và demo theo yêu cầu học phần.

## Nghiệm thu thay đổi persistence và Room

- JPA mapping chạy trên MySQL, transaction/lock/rollback, generated unique Community và writer đến muộn; không dùng H2 thay MySQL.
- Schema hiện tại tạo đủ ba bảng, CHECK/unique/FK; test setup không thực thi lệnh reset database thật.
- Không còn SQL/JdbcTemplate trong Controller/Service; API không trả Entity hoặc truy vấn snapshot cho bảng tổng hợp.
- Room Public/Private: list chỉ WAITING còn chỗ, Join/Start cạnh tranh không vượt capacity, map không đổi giữa trận.
- Mười mốc Finish đạt bằng input không Fly và tất cả spawn; map ngắn không cấp crown/ending hoặc ghi đè best full-map.
- Chat Enter/Esc, focus form, tin mới 10 giây không tự lấy focus; Players luôn hiện gọn, chỉ leaderboard thu gọn; hai bảng tách phạm vi.
