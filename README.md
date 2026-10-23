# JumpKing Multiplayer

Game nhiều người chơi trên trình duyệt, tái hiện gameplay Jump King trên map Main Babe. Server quyết định trạng thái/kết quả; client dự đoán input để phản hồi nhanh. Trọng tâm học phần là đồng bộ trạng thái, xử lý nhiều kết nối và lưu tiến độ nhất quán.

Chơi tại [jumpking-multiplayer.pages.dev](https://jumpking-multiplayer.pages.dev/).

| Kiểu chơi | Phạm vi |
| --- | --- |
| Community | Tự ghép sảnh, lưu tiến độ theo Account, Continue và leaderboard |
| Room | Public/Private, Join Public hoặc ID; Race, Hardcore, Time Limit, No Walk; chọn độ dài map 1–10 |

Cả hai yêu cầu đăng nhập. Username chưa có được tạo khi Sign In; có đổi mật khẩu bằng mật khẩu hiện tại. Luật đầy đủ tại [gameplay](docs/gameplay.md).

## Kiến trúc và công nghệ

![Kiến trúc hệ thống](statics/architecture.svg)

Client: React + TypeScript strict + Vite; Phaser hiển thị game, API trình duyệt phát âm thanh. Server: Spring Boot/Java, HTTP REST và WebSocket JSON; MySQL qua Spring Data JPA/Hibernate. Xác thực bằng Spring Security, session cookie, CSRF và BCrypt.

Java simulation chính thức, TypeScript prediction/reconciliation, dữ liệu JSON dùng chung. Mỗi phòng xử lý tuần tự trên worker pool; gửi mạng/ghi database ngoài tick. Thiết kế và cấu trúc tại [architecture](docs/architecture.md).

## Cài đặt local

Cần **JDK 25, Node.js 24 và MySQL Server 8.4**; Maven Wrapper có sẵn. Workbench là công cụ quản trị tùy chọn. Lệnh dưới dùng PowerShell, chạy từ root project; lần cài/build đầu cần Internet.

**1. Tạo database.** Mở `source/database/schema.sql` trong Workbench và Execute bằng tài khoản quản trị. **Script xóa database `jumpking` nếu đã có; chỉ chạy khi cài mới hoặc chủ động reset.**

Tạo user ứng dụng một lần, thay mật khẩu mẫu:

```sql
CREATE USER 'jumpking_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';
GRANT SELECT, INSERT, UPDATE, DELETE ON jumpking.* TO 'jumpking_app'@'127.0.0.1';
```

**2. Tạo cấu hình riêng** nếu file chưa có:

```powershell
Copy-Item source/server/config/application-local.properties.example source/server/config/application-local.properties
```

Điền kết nối MySQL trong file vừa tạo:

```properties
spring.datasource.url=jdbc:mysql://127.0.0.1:3306/jumpking?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true
spring.datasource.username=jumpking_app
spring.datasource.password=CHANGE_ME
```

Password trùng user MySQL; đổi host/port khi cần, giữ các giá trị còn lại trong mẫu. File thật được Git ignore. Backend đọc `.properties`, không tự đọc `.env`.

Frontend không cần cấu hình riêng với mặc định local. Khi đổi backend, copy `source/client/.env.example` thành `.env.local` rồi sửa `BACKEND_URL`. Cấu hình và secrets theo [deployment](docs/deployment.md#cấu-hình).

## Chạy development

Mở hai terminal từ root. Backend:

```powershell
cd source/server
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=local"
```

Frontend:

```powershell
cd source/client
npm ci
npm run dev
```

Mở [http://127.0.0.1:5173](http://127.0.0.1:5173); backend **8080**, MySQL **3306**. Những lần sau chỉ chạy hai lệnh khởi động; cài lại dependencies khi lockfile đổi. Linux/macOS thay `.\mvnw.cmd` bằng `sh mvnw`, `Copy-Item` bằng `cp`.

## Build và chạy một JAR

Sau khi cài dependencies, từ root:

```powershell
cd source/client
npm run build
cd ../server
.\mvnw.cmd -Pweb clean package
java -jar target/jumpking-server.jar --spring.profiles.active=local
```

Dừng backend development nếu đang chiếm cổng 8080. Chạy JAR từ `source/server/` để đọc cấu hình local, mở [http://127.0.0.1:8080](http://127.0.0.1:8080); không cần Vite.

Người khác chỉ cần trình duyệt. [LAN/ZeroTier](docs/deployment.md#lan-và-zerotier) dùng IP host; triển khai chính dùng cùng JAR trên [VPS](docs/deployment.md#vps) với HTTPS/WSS. Có thể tách frontend lên [Cloudflare Pages](docs/deployment.md#cloudflare-pages-và-vps). [GitHub Actions](docs/deployment.md#github-actions) cập nhật JAR, không tự cập nhật schema.

## Demo

- Community: Sign In → New Game → Save & Exit → Continue; kiểm tra tiến độ và leaderboard.
- Room: dùng hai Account trên hai browser profiles hoặc normal/incognito; Create/Join cùng phòng, Host Start, thử điều khiển/chat/Results/Play Again. Chỉ cần một backend.

## Tài liệu và kiểm chứng

| Nguồn | Nội dung |
| --- | --- |
| [AGENTS](AGENTS.md) | Quy tắc làm việc và nguồn quyết định |
| [architecture](docs/architecture.md) | Công nghệ, cấu trúc và concurrency |
| [gameplay](docs/gameplay.md) | Luật chức năng |
| [protocol](docs/protocol.md) | HTTP/WS, xác thực và đồng bộ |
| [data](docs/data.md) | Database, checkpoint và thành tích |
| [deployment](docs/deployment.md) | Cấu hình và triển khai |
| [testing](docs/testing.md) | Biome, Spotless, Vitest, JUnit, Playwright; lệnh và tiêu chí nghiệm thu |

`docs/` là thiết kế đích. Báo cáo viết riêng theo [yêu cầu học phần](docs/final-project/Instruction.md), dùng lại sơ đồ/quyết định và bổ sung bằng chứng. [Thực nghiệm](docs/testing.md#phương-pháp-thực-nghiệm) so sánh snapshot-only với prediction/reconciliation; [kết quả và đóng góp](report/report.md) phải gắn với phiên bản đã đo.

Giới hạn: một backend; Room ở RAM, Community chỉ phục hồi tới checkpoint đã commit. Nguồn nội dung và tình trạng giấy phép tại [attribution](source/client/public/assets/ATTRIBUTION.md).
