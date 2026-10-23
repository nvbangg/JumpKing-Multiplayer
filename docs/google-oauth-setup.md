# Hướng dẫn thiết lập Google OAuth cho Người quản trị Domain & Deploy

Tài liệu này dành cho người sở hữu tên miền (domain owner) hoặc người phụ trách triển khai (DevOps) cấu hình đăng nhập Google Sign-In (OAuth 2.0) cho dự án JumpKing Multiplayer.

---

## 1. Xác minh quyền sở hữu tên miền trên Google Search Console

Nếu Google yêu cầu xác minh quyền sở hữu website, thực hiện trên origin frontend đang dùng:

1. Truy cập [Google Search Console](https://search.google.com/search-console).
2. Thêm thuộc tính dạng **URL prefix (Tiền tố URL)**: `https://jumpking-multiplayer.pages.dev/`.
3. Chọn một trong hai phương thức xác minh:
   - **Cách 1 (Bản ghi DNS, chỉ khi dùng tên miền riêng)**: Thêm 1 bản ghi `TXT` vào trang quản lý DNS của domain theo hướng dẫn của Google.
   - **Cách 2 (Tệp HTML)**: Tải tệp HTML do Google cung cấp và đặt vào thư mục `source/client/public/` của dự án, sau đó deploy lên web và bấm nút **Xác minh (Verify)**.

---

## 2. Cấu hình Màn hình xác nhận OAuth (OAuth Consent Screen)

Truy cập [Google Cloud Console - Màn hình xác nhận OAuth](https://console.cloud.google.com/auth/audience):

1. **Loại người dùng (User Type)**: Chọn **Bên ngoài (External)**.
2. **Cấu hình thông tin thương hiệu (Branding)**:
   - **Tên ứng dụng (App name)**: `JumpKing Multiplayer`
   - **Email hỗ trợ người dùng**: Chọn email của bạn.
   - **Trang chủ ứng dụng**: `https://jumpking-multiplayer.pages.dev/`
   - **Liên kết chính sách quyền riêng tư**: `https://jumpking-multiplayer.pages.dev/privacy.html` *(dự án đã tạo sẵn file này trong thư mục web)*.
   - **Thông tin liên hệ nhà phát triển**: Điền email của bạn.
   - ⚠️ **LƯU Ý CỰC KỲ QUAN TRỌNG VỀ LOGO**: **ĐỂ TRỐNG Ô LOGO (KHÔNG TẢI ẢNH LÊN)**. 
     *Nếu tải logo Jump King lên, hệ thống kiểm duyệt tự động của Google sẽ quét và từ chối duyệt vì vi phạm bản quyền game gốc. Khi để trống logo, Google sẽ tự động chấp thuận mà không đòi hỏi chứng minh bản quyền.*
3. Bấm **Lưu và tiếp tục (Save and continue)**.

---

## 3. Tạo OAuth 2.0 Web Client ID

1. Vào menu bên trái chọn **Khách hàng (Clients)** hoặc [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients).
2. Bấm nút **`+ Tạo thông tin đăng nhập`** (Create Credentials) -> Chọn **Mã định danh máy khách OAuth** (OAuth client ID).
3. **Loại ứng dụng (Application type)**: Chọn **Ứng dụng web** (Web application).
4. **Tên**: Đặt tùy ý (ví dụ: `JumpKing Production`).
5. Kéo xuống mục **Nguồn gốc JavaScript được phép (Authorized JavaScript origins)**, bấm **+ THÊM URI** và điền đầy đủ các địa chỉ sau:
   - `http://localhost:5173` *(cho dev local)*
   - `http://127.0.0.1:5173` *(cho dev local)*
   - `http://localhost:8080` *(cho chạy thử file JAR)*
   - `http://127.0.0.1:8080` *(cho chạy thử file JAR)*
   - `https://jumpking-multiplayer.pages.dev` *(origin frontend, không có dấu `/` cuối)*
6. Bấm **Tạo (Create)**.
7. Google sẽ cấp một chuỗi **Mã khách hàng (Client ID)** có dạng:
   `xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`
   *(Hãy copy chuỗi Client ID này)*.

Khi đổi tên miền Pages, sửa **Authorized JavaScript origins** của Client ID hiện có; không cần tạo Client ID mới. Nếu còn mở game trực tiếp từ VPS, giữ thêm origin đó. Quy tắc origin theo [hướng dẫn Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

---

## 4. Cấu hình Client ID vào Game khi Deploy lên VPS

Khi chạy trên máy chủ VPS, bạn chỉ cần cấu hình Client ID mới theo một trong hai cách sau:

### Cách 1: Sử dụng biến môi trường (Khuyên dùng khi chạy Docker/Systemd)
Trước khi khởi động file JAR backend, đặt biến môi trường:
```bash
export GOOGLE_CLIENT_ID="CHUỖI_CLIENT_ID_MỚI.apps.googleusercontent.com"
export APP_ALLOWED_ORIGINS="https://jumpking-multiplayer.pages.dev"
```

### Cách 2: Điền vào file cấu hình `application-prod.properties`
Trong file `source/server/config/application-prod.properties` trên VPS:
```properties
# Domain HTTPS chính thức
app.allowed-origins=https://jumpking-multiplayer.pages.dev

# Bật bảo mật Cookie cho HTTPS
server.servlet.session.cookie.secure=true

# Client ID từ tài khoản Google của chủ domain
app.google-client-id=CHUỖI_CLIENT_ID_MỚI.apps.googleusercontent.com
```

Giữ các origins khác còn dùng và cấu hình cookie khi Pages khác site backend theo [deployment](deployment.md#cloudflare-pages-và-vps). Push code không cập nhật file cấu hình riêng trên VPS hoặc Google Cloud Console.

---

## 5. Xuất bản ứng dụng (Publish app)

1. Vào lại trang [Khán giả (Audience)](https://console.cloud.google.com/auth/audience).
2. Bấm nút **Xuất bản ứng dụng (Publish app)** và xác nhận.
3. Trạng thái xuất bản sẽ chuyển thành **Đang hoạt động trong giai đoạn sản xuất (In production)**.

👉 Sau khi xuất bản, **bất kỳ ai có tài khoản Google/Gmail đều có thể đăng nhập vào game**, không cần chủ sở hữu phải thêm email người chơi thủ công vào danh sách test nữa.
