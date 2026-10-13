# AGENTS.md

## Mục tiêu

Xây dựng website game online nhiều người chơi theo mô hình server-authoritative, lấy cảm hứng từ Jump King; đáp ứng yêu cầu bài tập lớn trong `docs/final-project/`.

## Cách làm việc

1. Xác định đúng yêu cầu; đọc các tài liệu liên quan theo bảng “Source of Truth”; kiểm tra Git và bảo toàn thay đổi có sẵn.
2. Làm từng phần nhỏ trong phạm vi yêu cầu: Code → Test → Review → Commit. Không push.
3. Tài liệu, comment code và commit messages dùng tiếng Việt; code, identifiers và UI dùng tiếng Anh.
4. Không hard-code secrets hoặc cấu hình riêng của máy; không để lại code/nội dung tạm trong phần bàn giao.
5. Kiểm chứng theo `docs/testing.md`; kiểm tra Git diff/status trước khi commit và bàn giao. Nêu thay đổi, kết quả kiểm tra và phần chưa hoàn tất.
6. Bỏ qua `temp/` trừ nguồn được người dùng chỉ định.

## Source of Truth

| File | Trách nhiệm |
| --- | --- |
| README.md | Tổng quan, yêu cầu môi trường và hướng dẫn bắt đầu |
| docs/architecture.md | Công nghệ, kiến trúc hệ thống và cấu trúc code |
| docs/gameplay.md | Luật chơi, map, các kiểu chơi và nội dung game |
| docs/protocol.md | Giao tiếp HTTP/WebSocket và bảo mật |
| docs/data.md | Thiết kế database, lưu tiến độ và thành tích |
| docs/deployment.md | Cài đặt, cấu hình và triển khai Local/LAN/ZeroTier/Internet |
| docs/testing.md | Kiểm thử, nghiệm thu và đo hiệu năng |
| docs/final-project/ | Yêu cầu bài tập lớn và tài liệu học phần; chỉ đọc |

Mỗi quyết định có một tài liệu trong `docs/` làm nguồn chính, tài liệu khác dẫn link thay vì sao chép. `docs/` chứa thiết kế và hướng dẫn lâu dài; Thay đổi thiết kế phải cập nhật đúng tài liệu.

Khi yêu cầu, tài liệu và code mâu thuẫn, xác định nguyên nhân và sửa đúng phần theo yêu cầu của người dùng. Hỏi lại nếu có quyết định chưa rõ; không sửa tài liệu chỉ để hợp thức hóa lỗi code.
