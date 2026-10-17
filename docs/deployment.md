# deployment.md

## Runtime và workflow

JDK 25, Node.js 24, MySQL Server 8.4; build dùng Maven Wrapper/npm lockfile. Workbench quản trị MySQL; Docker phục vụ [integration tests](testing.md).

Community và Room đều cần frontend, backend và MySQL.

| Thành phần | Development | Local/LAN/ZeroTier |
| --- | --- | --- |
| Frontend | Vite 127.0.0.1:5173 | Static files phục vụ từ backend:8080 |
| Backend | 127.0.0.1:8080; Vite proxy /api và /ws | Bind IP host hoặc 0.0.0.0 |
| MySQL | 127.0.0.1:3306 | Chỉ backend truy cập |

## Cấu hình

| File mẫu trong Git | File riêng được ignore |
| --- | --- |
| source/server/config/application-local.properties.example | source/server/config/application-local.properties |
| source/server/config/application-prod.properties.example | source/server/config/application-prod.properties |
| source/client/.env.example | source/client/.env.local |

Chạy backend từ `source/server/`; profile local/prod đọc file tương ứng trong `config/`. Spring không tự nạp `.env`; backend dùng properties hoặc process ENV. Ví dụ local:

```properties
spring.datasource.url=jdbc:mysql://127.0.0.1:3306/jumpking?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true
spring.datasource.username=jumpking_app
spring.datasource.password=CHANGE_ME
server.address=127.0.0.1
server.port=8080
app.allowed-origins=http://127.0.0.1:5173,http://127.0.0.1:8080
server.servlet.session.cookie.secure=false
```

Dùng password thật chỉ trong file riêng/process ENV. Cấu hình frontend:

```dotenv
BACKEND_URL=http://127.0.0.1:8080
VITE_BACKEND_ORIGIN=
```

BACKEND_URL chỉ dùng cho proxy Vite. VITE_BACKEND_ORIGIN trống nếu cùng origin, nếu tách thì điền origin backend không có path. Adapter nối /api và /ws/game, đổi http/https thành ws/wss. VITE_* công khai, cố định khi build; không chứa secrets. [Vite env](https://vite.dev/guide/env-and-mode)

IP/port trong file mẫu là mặc định local, không phải địa chỉ bị khóa trong logic game. Với JAR cùng origin, frontend tự dùng URL đang mở; chuyển sang LAN/ZeroTier chỉ đổi cấu hình backend riêng, không sửa TypeScript/Java.

| ENV tương ứng | Property / mặc định |
| --- | --- |
| SPRING_PROFILES_ACTIVE | local cho HTTP Local/LAN; prod cho HTTPS |
| SPRING_DATASOURCE_URL/USERNAME/PASSWORD | spring.datasource.url/username/password |
| SERVER_ADDRESS/PORT | server.address/port |
| APP_ALLOWED_ORIGINS | app.allowed-origins; origins cụ thể cách nhau dấu phẩy |
| SERVER_SERVLET_SESSION_COOKIE_SECURE | true khi HTTPS |
| SERVER_SERVLET_SESSION_TIMEOUT | server.servlet.session.timeout; idle theo [protocol](protocol.md#identity-và-security) |
| APP_SESSION_ABSOLUTE_TIMEOUT | app.session-absolute-timeout; hạn tối đa theo protocol |
| APP_AUTH_RATE_PER_MINUTE / APP_HTTP_BODY_LIMIT | app.auth-rate-per-minute=20; app.http-body-limit=16384 bytes |
| APP_CHECKPOINT_INTERVAL_MS | app.checkpoint-interval-ms=1000; chu kỳ checkpoint Community và metrics Room |
| APP_PERSISTENCE_RETRY_COUNT | app.persistence-retry-count=3; tối đa 3 lần thử lại sau lần ghi đầu |
| APP_PERSISTENCE_RETRY_DELAY_MS | app.persistence-retry-delay-ms=1000; khoảng chờ giữa các lần thử |
| APP_PERSISTENCE_THREADS / QUEUE / RUN_QUEUE | app.persistence-threads=2, app.persistence-queue=256, app.persistence-run-queue=16; workers chung và hàng chờ từng lượt |
| FLY_ENABLED | app.fly-enabled=${FLY_ENABLED:false}; mặc định false |

Ưu tiên config: command-line → process ENV → external properties → JAR. Backend validate datasource/allowlist. Gameplay/rules ở source/common, network bounds theo protocol, presentation ở frontend config. [Spring external config](https://docs.spring.io/spring-boot/reference/features/external-config.html)

Root .gitignore chứa quy tắc chung; mỗi module ignore config riêng, dependencies, build/test output.

`source/server/config/` chỉ đưa các mẫu `.properties.example` lên Git. File thực tế phải có quyền đọc giới hạn cho người chạy ứng dụng. Tài khoản MySQL chỉ có quyền DML trong database của game; không dùng root.

## Fly Mode

Đặt `$env:FLY_ENABLED='true'` trong terminal backend trước khi chạy Maven/JAR, hoặc đặt `app.fly-enabled=true` trong file `source/server/config/application-<profile>.properties` đang dùng. Spring Boot không đọc `source/client/.env.local`. Đổi cờ cần restart backend và vào lại màn chơi; không cần build lại frontend hoặc bật Options.

Mặc định false. Cờ áp dụng cho mọi người trong Community và Room, ở localhost, LAN hoặc Internet, kể cả profile prod. Client đọc quyền qua `/api/game-config`. Điều khiển và save/thành tích theo [gameplay](gameplay.md#fly-mode).

## MySQL

1. Cài/chạy MySQL Server, kết nối bằng Workbench hoặc mysql CLI.
2. Dừng backend, review rồi chạy `source/database/schema.sql` bằng tài khoản quản trị. Script DROP database `jumpking` nếu tồn tại rồi tạo mới ba bảng trong [data](data.md); mọi dữ liệu cũ sẽ mất.
3. Tạo user ứng dụng một lần; thay password mẫu trong câu SQL trước khi chạy:

```sql
CREATE USER 'jumpking_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME';
GRANT SELECT, INSERT, UPDATE, DELETE ON jumpking.* TO 'jumpking_app'@'127.0.0.1';
```

4. Điền datasource; backend dùng `spring.jpa.hibernate.ddl-auto=validate`, `spring.jpa.open-in-view=false`, không tự reset/update và không chạy bằng root.

mysql CLI: từ root project mở mysql client rồi chạy `SOURCE source/database/schema.sql;`. Workbench: File → Open SQL Script → schema.sql → Execute. Chỉ chạy khi cài mới hoặc chủ động reset, không chạy mỗi lần khởi động. Reset database không xóa user MySQL đã tạo; không cần tạo lại user nếu thông tin và quyền vẫn đúng.

Backup bằng mysqldump/Workbench vào `.local/backups/`, dùng prompt nhập password hoặc cấu hình riêng. Thử restore vào instance cô lập, kiểm tra dữ liệu trước thay database thật; không commit dump. [MySQL CREATE USER](https://dev.mysql.com/doc/refman/8.4/en/create-user.html)

## Chạy development và build

Lệnh PowerShell dưới đây; Linux/macOS thay `.\mvnw.cmd` bằng `sh mvnw` và dùng cú pháp copy của shell.

Từ root, copy các file mẫu theo bảng cấu hình và điền datasource. Terminal backend:

```powershell
cd source/server
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=local"
```

Terminal frontend:

```powershell
cd source/client
npm ci
npm run dev
```

Mở http://127.0.0.1:5173. Hai người cùng máy dùng hai browser profiles hoặc normal/incognito với một backend.

Build frontend bằng `npm run build`. Từ backend chạy `.\mvnw.cmd -Pweb clean package`; profile web lấy source/client/dist làm static resources trong target, không chép generated files vào source. Chạy:

```powershell
java -jar target/jumpking-server.jar --spring.profiles.active=local
```

Mở http://127.0.0.1:8080. Backend độc lập bỏ profile web; frontend độc lập dùng static host và kết nối backend, không mở dist/index.html bằng file://.

## LAN và ZeroTier

1. Host bind backend vào IP cần dùng hoặc 0.0.0.0; thêm `http://<host-ip>:8080` vào allowed origins.
2. Cho phép inbound TCP 8080 từ LAN/overlay cần dùng, không tắt firewall hoặc mở MySQL cho players.
3. Chạy JAR; người chơi LAN mở `http://<host-lan-ip>:8080`.
4. Với ZeroTier, các máy join cùng private network, được chủ mạng authorize; dùng `http://<host-zerotier-ip>:8080`. [ZeroTier quickstart](https://docs.zerotier.com/quickstart/)

Frontend/backend/MySQL chạy trên host; người chơi chỉ cần trình duyệt. Dùng cùng hostname/IP nhất quán để cookie đúng host.

Windows host: mở PowerShell Administrator, thay IP/subnet ví dụ bằng mạng ZeroTier thực tế rồi tạo rule giới hạn trên mạng đó:

```powershell
New-NetFirewallRule -DisplayName 'JumpKing ZeroTier 8080' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -LocalAddress 10.147.17.5 -RemoteAddress 10.147.17.0/24 -Profile Any
```

Máy người chơi kiểm tra `Test-NetConnection 10.147.17.5 -Port 8080`; `TcpTestSucceeded=True` mới xác nhận cổng tới được. Sau đó dùng trình duyệt thử đăng nhập, hai người Create/Join cùng Room, Start/nhảy/chat/End/Leave; Community thử Save & Exit/Continue. Không chạy lại schema hoặc cài backend/MySQL ở máy người chơi.

| Lỗi | Kiểm tra |
| --- | --- |
| Host vào được, máy khác không | IP, authorization/route, bind và firewall |
| HTTP được, WS lỗi | Origin allowlist, cookie và /ws/game |
| Đăng nhập xong lại mất phiên | Dùng nhất quán một hostname/IP; HTTP Local/ZeroTier dùng profile local với cookie Secure=false, HTTPS dùng prod/Secure=true |
| Backend không start | MySQL, schema, grants và datasource |
| Community báo chưa lưu | Kết nối DB và save status; không khôi phục thủ công save cũ |

## VPS và GitHub Actions

VPS tự quản lý TLS, service và cấu hình riêng ngoài repository. Cần Java 25, MySQL trong mạng riêng và user chạy ứng dụng không có đặc quyền quản trị. Chạy profile `prod`, điền datasource và `app.allowed-origins` theo domain HTTPS thực tế; cookie Secure phải bật. Đường dẫn cấu hình do VPS quyết định và phải được service nạp khi khởi động. Không đưa credentials, chứng chỉ hoặc keystore lên Git.

Workflow `.github/workflows/deploy-vps.yml` build frontend, chạy Maven `-Pweb clean verify`, rồi upload JAR và restart service. VPS không cần Node.js hoặc Maven. Workflow chạy khi push lên `main` có thay đổi trong `source/client/`, `source/common/`, `source/server/` hoặc chính file workflow; cũng có thể chạy thủ công từ tab **Actions**. Chỉ sửa tài liệu hoặc database không tự kích hoạt deploy.

VPS cần service `jumpking.service` chạy `/opt/jumpking/current.jar`. Tài khoản SSH triển khai phải có quyền ghi JAR và chạy `sudo /usr/bin/systemctl restart jumpking.service` không cần mật khẩu; chỉ cấp sudo cho đúng lệnh này.

### GitHub Actions secrets

Các secrets được cấu hình trong GitHub Environment `production`:

| Secret | Nội dung |
| --- | --- |
| `VPS_HOST` | Hostname hoặc IP của VPS |
| `VPS_USER` | User SSH triển khai |
| `VPS_SSH_PRIVATE_KEY` | Private key Ed25519 của user triển khai |
| `VPS_SSH_KNOWN_HOSTS` | Host key đã xác minh của VPS |
| `VPS_SSH_PORT` | Cổng SSH; mặc định `22` nếu bỏ trống |

Workflow upload JAR trực tiếp đến `/opt/jumpking/current.jar`, sau đó restart dịch vụ. Workflow hiện chưa có bước health check tự động hoặc cơ chế rollback; nếu deploy gặp lỗi, kiểm tra trạng thái dịch vụ và log trên VPS:

```bash
sudo systemctl status jumpking.service
sudo journalctl -u jumpking.service -n 100 --no-pager
```

Sau deploy, kiểm tra từ mạng ngoài: đăng ký/đăng nhập, WebSocket, Room hai Account, Community Save & Exit/Continue và reconnect.

Không chạy lại script khởi tạo schema database trong quá trình deploy. Cập nhật code không đồng nghĩa với việc reset dữ liệu người chơi.
