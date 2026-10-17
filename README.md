# JumpKing Multiplayer

Website game Jump King với một map Main Babe đầy đủ, chơi qua mạng trong Community Tower hoặc Room. Thuộc Chủ đề 2 – Phát triển game mạng: đồng bộ trạng thái nhiều client, xử lý kết nối đồng thời và lưu tiến độ/kết quả nhất quán.

| Kiểu chơi | Mục đích |
| --- | --- |
| Community Tower | Account được tự xếp sảnh, lưu tiến độ trên server và tính leaderboard |
| Room | Account tạo Public/Private, Join Public hoặc bằng ID, từ 1 người và Host Start; Race, Hardcore, Time Limit hoặc No Walk; Results và History |

Frontend dùng React + TypeScript/Phaser; backend Spring Boot/Java quyết định trạng thái và kết quả online. Spring Data JPA/Hibernate truy cập MySQL để lưu identity, lượt chơi và trận Room. Thống kê tổng và History gồm Community và Room; chơi game yêu cầu Account. Đăng ký/đăng nhập bằng username và password, có đổi mật khẩu bằng mật khẩu hiện tại; chưa có khôi phục mật khẩu. Luật chơi trong [gameplay](docs/gameplay.md).

## Kiến trúc

![Kiến trúc hệ thống](statics/architecture.svg)

Client–Server, server-authoritative: client gửi input, server quyết định trạng thái và kết quả online. HTTP/REST phục vụ Account/Records; WebSocket trao đổi input/snapshot. Queue và workers nằm trong một backend, ghi MySQL ngoài vòng tick. [Chi tiết](docs/architecture.md)

## Cài đặt và chạy

Cần **JDK 25, Node.js 24 và MySQL Server 8.4**. Workbench là công cụ quản trị tùy chọn; không thay MySQL Server. Maven Wrapper được cung cấp sẵn.

**1. Database.** Dừng backend nếu đang chạy, mở `source/database/schema.sql` bằng Workbench và Execute bằng tài khoản quản trị MySQL. Script xóa database `jumpking` nếu đã tồn tại rồi tạo mới toàn bộ bảng; mọi dữ liệu cũ sẽ mất. Trong SQL editor, tạo user ứng dụng một lần; thay password mẫu:

```sql
CREATE USER 'jumpking_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';
GRANT SELECT, INSERT, UPDATE, DELETE ON jumpking.* TO 'jumpking_app'@'127.0.0.1';
```

Chỉ chạy script khi cài mới hoặc chủ động reset dữ liệu; không chạy mỗi lần khởi động game. [Chi tiết MySQL](docs/deployment.md#mysql)

**2. Cấu hình riêng.** Từ root project:

```powershell
Copy-Item source/server/config/application-local.properties.example source/server/config/application-local.properties
Copy-Item source/client/.env.example source/client/.env.local
```

Trong `source/server/config/application-local.properties`, điền:

```properties
spring.datasource.url=jdbc:mysql://127.0.0.1:3306/jumpking?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true
spring.datasource.username=jumpking_app
spring.datasource.password=CHANGE_ME
```

Password phải trùng user vừa tạo; đổi host/port nếu MySQL chạy nơi khác. Giữ các giá trị còn lại trong file mẫu. `source/client/.env.local` dùng mặc định khi chạy local, không cần thêm secrets. Hai file riêng được Git ignore; chỉ commit các file `.example`. Backend không tự đọc file `.env`.

**3. Chạy hai terminal** từ root project. Backend:

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

Mở **http://127.0.0.1:5173**. Backend dùng **8080**, MySQL **3306**. Linux/macOS thay `.\mvnw.cmd` bằng `sh mvnw`, `Copy-Item` bằng `cp`. Hai người trên cùng máy dùng hai browser profiles hoặc normal/incognito, chỉ chạy một backend; không cần hai máy hoặc hai backend.

**Build một ứng dụng:** tại `source/client/` chạy `npm run build`; tại `source/server/` chạy `.\mvnw.cmd -Pweb clean package`, rồi `java -jar target/jumpking-server.jar --spring.profiles.active=local`. Mở **http://127.0.0.1:8080**; JAR phục vụ cả frontend/backend, không cần Vite. Dừng backend development trước để giải phóng cổng 8080. Các lệnh cài dependencies/build lần đầu cần Internet.

## Demo nhanh

- **Community Tower:** đăng ký/đăng nhập, chọn New Game hoặc Continue ngay tại trang chủ; tiến độ tự lưu và được tính leaderboard trong trận.
- **Room:** đăng nhập hai Account ở hai browser profiles, một người Create Room; người còn lại Join by ID hoặc tìm phòng Public bằng Join Public; Host chọn mode, map 1–10 và Start (một người cũng chơi được).

## Chơi qua LAN/ZeroTier

Dùng JAR đã build. Trong cấu hình local của host, thay `10.147.17.5` bằng IP LAN/ZeroTier thực tế:

```properties
server.address=0.0.0.0
app.allowed-origins=http://127.0.0.1:8080,http://10.147.17.5:8080
```

Restart JAR, cho phép inbound TCP 8080 từ mạng cần dùng; players mở `http://10.147.17.5:8080`. ZeroTier cần cùng network và được authorize. Players chỉ cần trình duyệt; không mở MySQL ra mạng. [Chi tiết và xử lý lỗi](docs/deployment.md#lan-và-zerotier)

## VPS

Chạy cùng JAR và MySQL nội bộ; cấu hình domain, HTTPS/WSS, origins và cookie theo [deployment](docs/deployment.md#vps-và-github-actions). Không cần tách frontend sang dịch vụ hosting khác.

## Tài liệu

| Nội dung | Nguồn chính |
| --- | --- |
| Công nghệ, thành phần và cấu trúc code | [architecture](docs/architecture.md) |
| Gameplay, map, kiểu chơi và nội dung game | [gameplay](docs/gameplay.md) |
| HTTP/WebSocket và bảo mật | [protocol](docs/protocol.md) |
| Database, checkpoint và thành tích | [data](docs/data.md) |
| Cấu hình, MySQL, Local/LAN/ZeroTier/Internet | [deployment](docs/deployment.md) |
| Lệnh kiểm thử và tiêu chí nghiệm thu | [testing](docs/testing.md) |
| Báo cáo kỹ thuật học phần | [report.md](report/report.md) |
| Quy trình agent | [AGENTS](AGENTS.md) |
| Yêu cầu bài tập lớn | [Instruction](docs/final-project/Instruction.md) |

## Kiểm thử và giới hạn

Lệnh kiểm thử, tiêu chí nghiệm thu và thực nghiệm theo [testing](docs/testing.md).

Giới hạn: Room gameplay ở RAM, restart không phục hồi trận. Framework và nguồn nội dung theo [architecture](docs/architecture.md), [học phần](docs/final-project/Instruction.md) và [attribution](source/client/public/assets/ATTRIBUTION.md).
