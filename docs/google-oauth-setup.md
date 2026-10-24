# Cấu hình Google Sign-In

Google Sign-In là tùy chọn; username/password hoạt động độc lập. Frontend dùng Google Identity Services; backend xác minh token bằng GoogleIdTokenVerifier rồi tạo session của ứng dụng.

## Cấu hình mặc định

Project có sẵn OAuth Client ID của game. Khi tiếp tục dùng Google project hiện tại, không cần thêm cấu hình Google vào GitHub, Cloudflare Pages hoặc VPS. Frontend đọc ID từ `/api/game-config`; Client ID là định danh công khai, không phải secret.

Chỉ khi dùng Google project khác, đặt `GOOGLE_CLIENT_ID` trong môi trường backend hoặc `app.google-client-id` trong file properties riêng đang được backend nạp. Restart backend sau khi đổi cấu hình; không cần đặt ID riêng ở frontend. Để tắt Google Sign-In, đặt rõ `app.google-client-id=` hoặc biến `GOOGLE_CLIENT_ID` rỗng; không hiện nút Google và endpoint từ chối xác thực Google.

## Google Cloud Console

Chủ Google project quản lý origins và thông tin ứng dụng trong Console. Khi đổi domain hoặc dùng Google project khác:

1. Mở [Google Auth Platform](https://console.cloud.google.com/auth/clients), chọn project và dùng OAuth Client loại **Web application** của game; chỉ tạo Client mới nếu chưa có.
2. Trong **Authorized JavaScript origins**, thêm các origin thực tế, không có path hoặc dấu `/` cuối:
   - `https://jumpking-multiplayer.pages.dev`
   - `http://localhost:5173`, `http://127.0.0.1:5173` khi phát triển local.
   - Origin VPS/JAR nếu còn mở frontend trực tiếp từ đó.
3. Trong **Branding**, điền tên ứng dụng, email hỗ trợ/liên hệ, homepage `https://jumpking-multiplayer.pages.dev/` và privacy policy `https://jumpking-multiplayer.pages.dev/privacy.html`. Chỉ dùng logo có quyền sử dụng; trạng thái xét duyệt theo Google Cloud Console.
4. Nếu Google yêu cầu xác minh website, dùng [Search Console](https://search.google.com/search-console) với URL prefix frontend; file HTML xác minh đặt trong `source/client/public/` rồi deploy. DNS TXT chỉ áp dụng khi quản lý tên miền riêng.
5. Kiểm tra Audience, test users và yêu cầu xác minh trước khi xuất bản. Làm theo [hướng dẫn chính thức](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Đổi tên miền Pages chỉ cần cập nhật origins/homepage/privacy trên Client ID hiện có, không cần tạo Client ID mới.

Origin allowlist, HTTPS và cookies khi Pages khác site backend theo [deployment](deployment.md#cloudflare-pages-và-vps). Push code không tự sửa cấu hình riêng trên VPS hoặc Google Cloud Console.

## Kiểm tra

Mở game từ origin đã đăng ký, đăng nhập Google và kiểm tra Account/Community/Room. Account Google nhận diện bằng `sub`, không ghép theo email hoặc username trùng. Account chỉ dùng Google không có mật khẩu và không hiện Change Password.

Khi SDK không tải được, có Retry thủ công; username/password vẫn dùng được. Backend kiểm chữ ký, audience, issuer và thời hạn theo [hướng dẫn Google](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), giữ session cookie/CSRF của ứng dụng.
