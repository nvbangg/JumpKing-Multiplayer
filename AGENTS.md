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
- `docs/final-project/`: Yêu cầu bài tập lớn và tài liệu học phần; chỉ đọc.

Tài liệu thiết kế trong `docs/` quy định thiết kế đích. Mỗi quyết định có một nguồn chính; cập nhật đúng nguồn khi thay đổi, nơi khác tham chiếu thay vì sao chép.

Khi yêu cầu, tài liệu và code mâu thuẫn, xác định nguyên nhân và xử lý theo mục tiêu được làm rõ; không sửa tài liệu chỉ để hợp thức hóa lỗi code.

## 2. Quy ước và ràng buộc

- Tài liệu, comment code và commit messages dùng tiếng Việt; code, identifiers và UI dùng tiếng Anh.
- Commit message chỉ mô tả thay đổi, không kèm kết quả kiểm thử hoặc thông tin ghi công AI tự động.
- Bỏ qua `temp/`, trừ khi người dùng chỉ định nguồn cụ thể trong thư mục này.

## 3. Quy trình làm việc và Git

1. Đảm bảo làm việc đúng nhánh và pull code trước khi sửa.
2. Với tác vụ chỉnh sửa, thực hiện từng phần theo quy trình **Code → Test → Review → Commit**. Không push.
3. Ưu tiên gộp các thay đổi vào những commit chưa push có cùng mục đích để lịch sử Git gọn và hợp lý.
4. Trước khi commit, bảo đảm các checks bắt buộc theo `docs/testing.md` đạt; kiểm tra `git status`, chỉ stage thay đổi thuộc tác vụ và rà soát nội dung `git diff --cached` để xác nhận đúng yêu cầu và phạm vi.