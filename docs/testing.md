# Kiểm thử và nghiệm thu

## Phạm vi kiểm chứng

Chạy checks phù hợp sau thay đổi cuối; chỉ commit khi đạt. Báo đúng kết quả đã chạy và phần chưa kiểm chứng, không sửa tests để hợp thức hóa lỗi.

| Phần thay đổi | Checks bắt buộc |
| --- | --- |
| Client | Biome + TypeScript, Vitest và build; thêm Playwright khi đổi luồng tương tác |
| Server | Maven verify; thêm integration khi đổi HTTP/WS, security hoặc persistence |
| Simulation / dữ liệu dùng chung | Fixtures và replay Java/TypeScript; build cả hai phía |
| Luồng online | Browser → HTTP/WS → server → MySQL, với các Account độc lập |
| Tài liệu | Nội dung nhất quán, links/anchors, cấu hình/lệnh và git diff --check |

## Lệnh kiểm tra

Các block chạy từ root project trong terminal riêng, sau khi cài dependencies theo [README](../README.md#cài-đặt-local).

Client:

```powershell
cd source/client
npm run check
npm test
npm run build
```

`check` chạy Biome và `tsc --noEmit`, không sửa file. `npm run check:fix` áp dụng format/imports và sửa lỗi an toàn; review diff rồi chạy lại checks. Biome không thay kiểm tra kiểu hoặc hành vi.

Server:

```powershell
cd source/server
.\mvnw.cmd verify
```

`verify` kiểm tra Spotless, compile và JUnit. Format bằng `.\mvnw.cmd spotless:apply`; Linux/macOS dùng `sh mvnw`. Tuân thủ `.gitattributes`, không format ảnh/âm thanh hoặc output sinh tự động; hash assets phải khớp bytes trong Git.

## Integration và trình duyệt

Dùng MySQL thật và database test cô lập, không dùng database cá nhân hoặc VPS. Có Docker, Testcontainers tự tạo instance khi chạy:

```powershell
cd source/server
.\mvnw.cmd verify -Pintegration
```

Windows không có Docker dùng runner từ root:

```powershell
./source/database/test-mysql.ps1 -MySqlHome '<thư mục MySQL 8.4>' -JavaHome '<thư mục JDK 25>'
```

Runner tạo instance/cổng riêng rồi dọn dữ liệu do nó tạo, không đổi service MySQL đang dùng. `-Web` kiểm tra bản đóng gói sau khi build client; `-IntegrationTest '<tên IT>'` chọn nhóm cần chạy. Nếu tự cấp MySQL test, dùng `JK_TEST_DATABASE_URL`, `JK_TEST_DATABASE_USERNAME`, `JK_TEST_DATABASE_PASSWORD` với database mới có tên bắt đầu bằng `jumpking_it`.

Browser tests:

```powershell
cd source/client
npx playwright install chromium
npm run test:e2e
```

Browser integration qua backend/MySQL cần `E2E_BROWSER_PATH` trỏ đến Chrome/Chromium khi chạy integration hoặc runner. Chạy Playwright riêng không thay nghiệm thu online: các spec thiếu backend/cấu hình có thể bị skip. Phân biệt rõ tests đạt và tests bị skip; không coi skipped là đã kiểm chứng.

## Tiêu chí nghiệm thu

Luật và giới hạn lấy từ [gameplay](gameplay.md), [protocol](protocol.md) và [data](data.md). Kiểm tra cả đường đi thành công, lỗi, biên và thao tác đồng thời.

| Nhóm | Cần chứng minh |
| --- | --- |
| Physics và nội dung | Fixtures có expected độc lập; Java/TypeScript nhất quán; đi hết map bằng input hợp lệ, camera/Finish/NPC/quạ/ending đúng tiến độ |
| Community | New/Continue đúng owner và lượt; checkpoint đầy đủ, pause/reconnect không mất tiến độ hoặc tính thời gian offline |
| Room | Join/Start/countdown/Host/Play Again đúng lifecycle; modes, đồng hạng và DNF đúng comparator |
| Items và Fly | Server quyết định quyền, cooldown và tác động; reconnect/replay không lặp hiệu ứng; cờ Fly tắt từ chối input giả |
| Đồng bộ | FIFO/ACK/reconciliation đúng input; peers không giật xuyên screen; spectating không thay state/ACK/save của bản thân |
| Kết nối và quá tải | Timeout, mất mạng, socket cũ và queue đầy được xử lý; client chậm không chặn cả phòng hoặc phòng khác |
| Persistence | Revision/transaction/retry/finalize không ghi trùng hoặc ghi đè state mới; lỗi MySQL không chặn tick hoặc báo Saved giả |
| Bảo mật | Session/CSRF/Origin/ownership/validation/quota chặn request sai; logout/đổi mật khẩu thu hồi phiên; restart không gia hạn hạn dùng |
| Dữ liệu hiển thị | Stats/History/leaderboard lấy đúng dữ liệu đã commit, owner và xếp hạng; phản hồi cũ không khôi phục trạng thái đã rời |
| Browser và triển khai | Keyboard/touch/focus, chat và hiển thị dễ dùng; lỗi tải tài nguyên có Reload thủ công; cấu hình mẫu chạy được; nghiệm thu JAR, HTTPS/WSS, cookies và restart |

Dùng hai browser profiles hoặc normal/incognito để kiểm tra các phiên độc lập. Mobile giả lập không thay điện thoại thật; loopback không chứng minh chất lượng Internet. Không dùng mock hoặc Fly thay kiểm thử gameplay/kết nối cần nghiệm thu.

## Phương pháp thực nghiệm

Học phần yêu cầu [ít nhất một nhóm thực nghiệm](final-project/Instruction.md#9-yêu-cầu-thực-nghiệm). Chọn một câu hỏi rõ ràng, ưu tiên so sánh snapshot-only với prediction/reconciliation trên cùng input trace, map, số clients và điều kiện mạng.

Đo độ trễ phản hồi và sai lệch đồng bộ; dùng RTT, snapshot rate/jitter, tick time hoặc message/byte rate để giải thích khi cần. Thử nhiều clients và nhiều phòng để kiểm tra concurrency. Ghi baseline, phiên bản, môi trường, cấu hình, thời lượng, số mẫu và lệnh tái tạo; lặp phép đo và báo phân bố thay vì chỉ một giá trị trung bình.

RTT không phải độ trễ một chiều; độ trễ giả lập không phải phép đo Internet. Chưa có số đo thì không kết luận sức chứa hoặc mức cải thiện. Kết quả, biểu đồ, phân tích và giới hạn thuộc [report/](../report/), không ghi vào đặc tả thiết kế.
