# Cấu hình và triển khai

Production dùng frontend Cloudflare Pages, backend HTTPS/WSS và MySQL nội bộ trên VPS. Vẫn hỗ trợ một JAR chứa frontend/backend để chạy cùng origin. Cài mới, cấu hình local và chạy hai terminal theo [README](../README.md#cài-đặt-local).

## Môi trường

- Build/development: JDK 25, Node.js 24, npm và Maven Wrapper.
- Chạy JAR: Java 25 và MySQL 8.4; VPS không cần Node.js/Maven.
- Local mặc định: Vite `5173`, backend `8080`, MySQL `3306` trên loopback. Đổi địa chỉ bằng cấu hình, không sửa code.

## Cấu hình

| Mẫu trong Git | File riêng cần tạo |
| --- | --- |
| source/server/config/application-local.properties.example | source/server/config/application-local.properties |
| source/server/config/application-prod.properties.example | source/server/config/application-prod.properties |
| source/client/.env.example | source/client/.env.local, chỉ cần khi đổi mặc định |

Backend nạp `config/application-<profile>.properties` theo working directory. Chạy từ `source/server/` với profile `local` hoặc `prod`; nơi khác dùng `--spring.config.additional-location=file:<thư-mục>/`. Spring không tự đọc `.env`.

| Cấu hình | Quyết định |
| --- | --- |
| spring.datasource.url/username/password | Kết nối MySQL bằng user ứng dụng |
| server.address / server.port | Địa chỉ bind và cổng backend |
| app.allowed-origins | Origins được phép, phân cách bằng dấu phẩy; đủ scheme/host/port, không có path |
| app.google-client-id / GOOGLE_CLIENT_ID | Có sẵn Client ID của game, không cần cấu hình thêm; chỉ ghi đè khi dùng Google project khác, đặt rõ rỗng để tắt Google Sign-In |
| app.network.public-lookups-per-minute | Quota chung Rooms/leaderboard theo IP, mặc định 60/phút |
| BACKEND_URL | Proxy Vite, mặc định http://127.0.0.1:8080 |
| VITE_BACKEND_ORIGIN | Để trống khi cùng origin; chỉ đặt origin backend khi tách frontend |

JAR dùng URL cùng origin cho HTTP/WS, không cần gắn địa chỉ backend vào frontend. `VITE_*` là dữ liệu công khai tại thời điểm build. Credentials, keystore, session, dumps và file cấu hình thật nằm ngoài Git; không đặt secrets trong frontend.
Google Sign-In dùng Client ID mặc định qua `/api/game-config`, không cần thêm biến Google trong GitHub hoặc Pages. Cấu hình Google project riêng và origins xem tại [google-oauth-setup](google-oauth-setup.md).


## MySQL

**`source/database/schema.sql` xóa database `jumpking` nếu đã tồn tại.** Chỉ dùng để cài mới hoặc reset có chủ đích, không dùng để nâng cấp database cần giữ dữ liệu.

Khởi tạo schema và user ứng dụng theo [README](../README.md#cài-đặt-local). Backend chỉ có quyền SELECT/INSERT/UPDATE/DELETE; host của user phải khớp kết nối. MySQL chỉ nhận kết nối backend/quản trị, không mở cho người chơi.

Hibernate dùng `ddl-auto=validate`; deploy không tự ALTER/reset schema. Khi đổi schema, sao lưu và áp dụng DDL đã review trước khi chạy backend tương ứng. Thiết kế bảng thuộc [data](data.md).

## Build và kiểm tra triển khai

Build frontend trước, rồi dùng Maven profile `web` để đóng `client/dist` vào JAR; lệnh tại [README](../README.md#build-và-chạy-một-jar). Không chép build output vào source.

Sau khi chạy, kiểm tra health, đăng nhập, kết nối WebSocket, Room hai Account và Community Save & Exit/Continue. Hai browser profiles hoặc normal/incognito đủ kiểm tra nhiều phiên trên một máy; chất lượng Internet cần thử qua mạng thực.

## LAN và ZeroTier

Bind `server.address=0.0.0.0` hoặc IP cần nghe, thêm origin `http://<host-ip>:8080` và mở đúng cổng backend trên firewall. Người khác chỉ mở URL này trong trình duyệt. Với ZeroTier, các máy join cùng network đã authorize rồi dùng IP ZeroTier; ứng dụng không có logic riêng cho ZeroTier.

## VPS

Chạy một backend instance bằng user dịch vụ và MySQL nội bộ. Spring Boot phục vụ HTTPS/WSS trực tiếp; DNS chỉ trỏ tên miền. Keystore và cấu hình dịch vụ do VPS quản lý, lưu ngoài repository. Bổ sung vào file prod riêng, thay các giá trị ví dụ:

```properties
server.address=0.0.0.0
server.port=8443
server.ssl.enabled=true
server.ssl.key-store=file:/etc/jumpking/tls.p12
server.ssl.key-store-type=PKCS12
server.ssl.key-store-password=CHANGE_ME
app.allowed-origins=https://game.example.com:8443
server.forward-headers-strategy=none
server.servlet.session.store-dir=/var/lib/jumpking/sessions
```

Nếu dùng cổng `443`, điều chỉnh quyền lắng nghe và bỏ port khỏi origin. Chứng chỉ phải hợp lệ với domain. Ví dụ nạp cấu hình ngoài JAR:

```bash
java -jar /opt/jumpking/current.jar --spring.profiles.active=prod --spring.config.additional-location=file:/etc/jumpking/
```

Service cần restart, log và graceful shutdown; không kill cưỡng bức khi cập nhật. Không cần proxy hoặc Node server cho phương án này. Nếu tách frontend/domain, cấu hình lại cookies/CORS/WS theo [protocol](protocol.md#xác-thực-và-bảo-mật).

## Cloudflare Pages và VPS

Frontend hiện tại: [jumpking-multiplayer.pages.dev](https://jumpking-multiplayer.pages.dev/). Pages chỉ phục vụ frontend; HTTP/WebSocket kết nối trực tiếp backend HTTPS/WSS trên VPS, không cần website trung gian hoặc domain riêng cho Pages.

Trong Pages, chọn root `source/client`, build command `npm run build`, output `dist`. Đặt biến cho môi trường Production (Preview nếu dùng):

```text
NODE_VERSION=24
VITE_BACKEND_ORIGIN=https://api.example.com
```

Thay bằng địa chỉ HTTPS backend thực tế, không có path. Deploy lại sau khi đổi biến vì `VITE_*` được gắn vào bundle lúc build. `BACKEND_URL` chỉ dành cho proxy Vite local.

Trong file prod thật đang được backend nạp, thêm origin frontend vào allowlist. Nếu Pages và backend khác site, cấu hình:

```properties
app.allowed-origins=https://jumpking-multiplayer.pages.dev,https://api.example.com
server.servlet.session.cookie.same-site=none
server.servlet.session.cookie.secure=true
```

Thay origin backend ví dụ bằng địa chỉ thực tế, không có dấu `/` cuối; giữ các origins khác còn sử dụng. Khi đổi tên miền Pages, cập nhật origin frontend trong allowlist; `VITE_BACKEND_ORIGIN` vẫn trỏ tới VPS. Allowlist áp dụng cho cả HTTP và WebSocket. Giữ CSRF và cookie HttpOnly; không dùng wildcard với credentials. Cùng site giữ `SameSite=Lax`; local HTTP giữ `Secure=false`.

Restart backend sau khi sửa cấu hình. File `.example` chỉ là mẫu; workflow VPS không chép mẫu sang file cấu hình thật. Nếu trình duyệt chặn third-party cookies, đăng nhập cross-site vẫn có thể thất bại; dùng domain frontend/backend cùng site hoặc frontend đóng cùng JAR để tránh phụ thuộc này.

Mở game trên Pages, kiểm tra trong Network: request tới backend `/api/auth/csrf` và preflight không bị `ORIGIN_DENIED`, đăng nhập giữ được phiên, WebSocket kết nối và vào Room/Community được. Nếu dùng Google Sign-In, thêm origin frontend vào Authorized JavaScript origins theo [hướng dẫn Google](google-oauth-setup.md).

## Giữ phiên đăng nhập

Prod bật session persistence. Đặt `APP_SESSION_STORE_DIR` hoặc `server.servlet.session.store-dir` trỏ đến thư mục bền vững ngoài release, chỉ user dịch vụ được đọc/ghi. Tomcat lưu/nạp phiên khi shutdown/start bình thường; thời hạn phiên vẫn theo [protocol](protocol.md#xác-thực-và-bảo-mật). Thời gian dừng service phải dài hơn graceful shutdown của ứng dụng.

Lưu session không lưu trạng thái Room. Crash hoặc phiên hết hạn có thể yêu cầu đăng nhập lại.

## GitHub Actions

`.github/workflows/deploy-vps.yml` build frontend/JAR, upload `/opt/jumpking/next.jar`, giữ `previous.jar`, thay `current.jar` sau khi upload thành công và restart `jumpking.service`. Workflow chạy thủ công hoặc khi push `main` thay đổi `source/client/`, `source/common/`, `source/server/` hay chính workflow. Chỉ sửa docs/database không tự deploy; workflow không cập nhật schema.

GitHub Environment `production` cần `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_KNOWN_HOSTS`, `VPS_SSH_PORT` (mặc định `22`). Xác minh host key; SSH user cần quyền ghi `/opt/jumpking/` để thay JAR và restart đúng service. Giữ JAR trước để rollback; upload/restart thành công chưa thay nghiệm thu URL thực.

## Fly Mode

Đặt `FLY_ENABLED=true` trong môi trường backend hoặc `app.fly-enabled=true` trong file properties riêng. Mặc định `false`; đổi cờ cần restart backend và vào lại màn chơi, không cần build frontend. Phạm vi và điều khiển theo [gameplay](gameplay.md#fly-mode).
