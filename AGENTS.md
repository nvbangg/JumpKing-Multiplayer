# AGENTS.md

## Cách làm việc

1. Xác định rõ yêu cầu; hỏi lại khi cần, tự quyết định khi phù hợp và nêu những quyết định quan trọng.
2. Đọc tài liệu liên quan theo bảng “Source of Truth”; đảm bảo sửa đúng nhánh, pull code trước khi sửa.
3. Làm từng phần nhỏ trong phạm vi yêu cầu: Code → Test → Review → Commit. Không push.
4. Tài liệu, comment code và commit messages dùng tiếng Việt; code, identifiers và UI dùng tiếng Anh. Commit message chỉ mô tả thay đổi, không kèm kết quả kiểm thử.
5. Không hard-code secrets hoặc cấu hình riêng của máy; không để lại code/nội dung tạm trong phần bàn giao.
6. Chạy các checks bắt buộc theo `docs/testing.md` sau thay đổi cuối; chỉ commit khi đạt và đã review Git diff/status đúng phạm vi. Khi bàn giao, nêu thay đổi, kết quả kiểm tra và phần chưa kiểm chứng nếu có trong phần trả lời.
7. Bỏ qua `temp/` trừ nguồn được người dùng chỉ định.

## Source of Truth

| Nguồn | Trách nhiệm |
| --- | --- |
| README.md | Bài toán, phạm vi và hướng dẫn bắt đầu |
| docs/architecture.md | Công nghệ, kiến trúc, cấu trúc code và concurrency |
| docs/gameplay.md | Luật chơi và hành vi chức năng |
| docs/protocol.md | HTTP/WebSocket, xác thực, đồng bộ và lỗi mạng |
| docs/data.md | Schema, transactions, checkpoint và thành tích |
| docs/deployment.md | Cấu hình và triển khai |
| docs/testing.md | Checks, tiêu chí nghiệm thu và phương pháp thực nghiệm |
| report/ | Kết quả thực nghiệm, phân tích và kết luận theo phiên bản |
| docs/final-project/ | Yêu cầu bài tập lớn và tài liệu học phần; chỉ đọc |

`docs/` quy định thiết kế đích. Mỗi quyết định có một nguồn chính; cập nhật đúng nguồn khi thay đổi, nơi khác dẫn link thay vì sao chép.

Khi yêu cầu, tài liệu và code mâu thuẫn, xác định nguyên nhân và sửa đúng phần theo yêu cầu của người dùng. Hỏi lại nếu có quyết định chưa rõ; không sửa tài liệu chỉ để hợp thức hóa lỗi code.
