# AGENTS.md

## 1. Nguồn chuẩn (Source of Truth)

Tham khảo các tài liệu liên quan đến tác vụ theo trách nhiệm sau:

- `README.md`: Bài toán, phạm vi và hướng dẫn bắt đầu.
- `docs/architecture.md`: Công nghệ, kiến trúc, cấu trúc code và concurrency.
- `docs/gameplay.md`: Luật chơi và hành vi chức năng.
- `docs/protocol.md`: HTTP/WebSocket, xác thực, đồng bộ và lỗi mạng.
- `docs/data.md`: Schema, transactions, checkpoint và thành tích.
- `docs/deployment.md`: Cấu hình và triển khai.
- `docs/testing.md`: Checks, tiêu chí nghiệm thu và phương pháp thực nghiệm.
- `report/`: Kết quả thực nghiệm, phân tích và kết luận theo phiên bản.
- `docs/final-project/`: Yêu cầu bài tập lớn và tài liệu học phần; chỉ đọc.

Tài liệu thiết kế trong `docs/` quy định thiết kế đích. Mỗi quyết định có một nguồn chính; cập nhật đúng nguồn khi thay đổi, nơi khác tham chiếu thay vì sao chép.

Khi yêu cầu, tài liệu và code mâu thuẫn, xác định nguyên nhân và xử lý theo mục tiêu được làm rõ; không sửa tài liệu chỉ để hợp thức hóa lỗi code.

## 2. Quy ước và ràng buộc

- Tài liệu, comment code và commit messages dùng tiếng Việt; code, identifiers và UI dùng tiếng Anh.
- Commit message chỉ mô tả thay đổi, không kèm kết quả kiểm thử hoặc thông tin ghi công AI tự động.
- Bỏ qua `temp/`, trừ khi người dùng chỉ định nguồn cụ thể trong thư mục này.

## 3. Quy trình làm việc và Git

1. Đảm bảo làm việc đúng nhánh và chạy `git pull --ff-only` trước khi sửa; nếu thất bại, dừng và báo lại.
2. Với tác vụ chỉnh sửa, thực hiện từng phần theo quy trình **Code → Test → Review → Commit**. Không push.
3. Sau thay đổi cuối, chạy các checks bắt buộc theo `docs/testing.md`.
4. Rà soát thay đổi qua `git status` và `git diff` để bảo đảm đúng yêu cầu và phạm vi; chỉ stage phần thuộc tác vụ và kiểm tra `git diff --cached` trước khi commit.
5. Chỉ commit khi các checks bắt buộc đạt; amend commit gần nhất nếu cùng tác vụ và chưa push, nếu không thì tạo commit mới.