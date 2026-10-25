# Kiến trúc hệ thống

Client–Server, server-authoritative: client gửi input; server quyết định physics, thời gian và kết quả. Một backend phục vụ nhiều phòng, chỉ backend truy cập MySQL.

![Kiến trúc hệ thống](../statics/architecture.svg)

## Công nghệ và trách nhiệm

| Phần | Quyết định |
| --- | --- |
| Client | React + TypeScript strict + Vite; React quản lý giao diện và vòng đời màn chơi |
| Game | Phaser hiển thị sprite, animation và camera; Web Audio/HTMLAudio phát âm thanh |
| Server | Một ứng dụng Spring Boot/Java, giao tiếp HTTP REST và WebSocket JSON |
| Persistence | MySQL + Spring Data JPA/Hibernate |
| Xác thực | Spring Security + session cookie + CSRF + BCrypt; contract tại [protocol](protocol.md#xác-thực-và-bảo-mật) |
| Chất lượng | Biome, TypeScript, Spotless, Vitest, JUnit, Playwright theo [testing](testing.md) |

Simulation độc lập React, Phaser, Spring và database. Phaser không quyết định physics; React không cập nhật gameplay theo render.

## Cấu trúc code

```text
source/
├── client/
│   ├── public/assets/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/        # account, chat, community, online, records, rooms, settings
│   │   ├── game/            # content, input, simulation, netcode, presentation
│   │   ├── network/
│   │   └── styles/
│   └── e2e/
├── server/
│   ├── config/              # Mẫu được commit; cấu hình thật được ignore
│   ├── src/main/java/jumpking/
│   │   ├── JumpKingApplication.java
│   │   ├── controller/
│   │   ├── service/
│   │   ├── repository/
│   │   ├── entity/
│   │   ├── dto/
│   │   ├── config/
│   │   ├── security/
│   │   ├── exception/
│   │   ├── game/
│   │   ├── room/
│   │   └── network/
│   ├── src/main/resources/
│   └── src/test/
├── common/                  # Map, physics, rules, adventure và fixtures JSON
└── database/                # schema.sql, test-mysql.ps1
```

| Phần | Ranh giới trách nhiệm |
| --- | --- |
| Client app/features | App điều phối; component/hook nằm cùng feature sở hữu. HUD, tutorial, touch controls thuộc online; chat dùng chung thuộc chat |
| Client components | UI dùng chung, không import từ features |
| Client game | Simulation thuần; netcode dự đoán/hiệu chỉnh; presentation chứa Phaser scene, camera và âm thanh |
| Client network | HTTP/WS adapter, contracts và trạng thái kết nối |
| Server controller/service/repository | DTO vào/ra → nghiệp vụ/transaction → truy cập database; Entity không đi vào API hoặc simulation |
| Server game/room/network | Luật thuần → state/lifecycle → transport/dispatch; RoomManager quản lý các mode, helper snapshot thuộc room |

Unit tests đặt cạnh code TypeScript và trong `server/src/test/java`; E2E ở `client/e2e`. Sơ đồ ở `statics/`, báo cáo ở `report/`. Chỉ tách module khi có trách nhiệm riêng; không thêm lớp chỉ để chuyển tiếp lời gọi.

## Simulation và dữ liệu dùng chung

- Java chạy simulation chính thức; TypeScript prediction/reconciliation cho nhân vật bản thân và interpolation cho peers.
- Phaser đọc view chỉ đọc trong frame hiện tại; snapshot riêng dành cho lưu/restore. HUD cập nhật khi giá trị hiển thị đổi, không chạy theo từng frame render.
- Hai phía dùng chung map/tuning/rules JSON, có mã thực thi riêng. Thứ tự tính toán và điểm ép float32 phải tương đương; kiểm chứng bằng fixtures/replay theo [testing](testing.md#tiêu-chí-nghiệm-thu).
- Định nghĩa bất biến nạp một lần và dùng chung, không deep-copy qua nhiều lớp; mỗi lượt giữ state riêng. Common chứa geometry, trigger và ID adventure; lời thoại, đường dẫn assets, font và âm thanh thuộc client, tra bằng ID.
- Client/server dùng cùng bản phát hành dữ liệu. Địa chỉ và secrets theo [deployment](deployment.md#cấu-hình); luật chức năng theo [gameplay](gameplay.md).

## Xử lý đồng thời

- Fixed-step **60 Hz**, snapshot **20 Hz**, dùng monotonic clock; số packet hoặc deltaTime của client không quyết định thời gian trận.
- Mỗi lượt actor xử lý bù tối đa 5 tick và giữ phần còn nợ cho lượt sau; chỉ đặt lại clock khi ngừng mô phỏng hoặc Room không còn kết nối, không chạy bù thời gian nghỉ.
- Mỗi phòng/sảnh xử lý commands và tick tuần tự trên worker pool chung; các phòng có thể chạy song song. Trong tick cập nhật mọi player, không chờ mạng của từng người.
- Mọi thay đổi state, kể cả callback I/O, quay về executor sở hữu phòng. Queue có giới hạn, bảo đảm callback của công việc đã nhận vẫn được xử lý khi quá tải.
- Chụp state bất biến một lần/player trong mỗi đợt snapshot, tái sử dụng cho owner/spectator theo đúng quyền. Gộp bản chưa gửi trước khi serialize JSON trên send worker; control messages giữ thứ tự. Không truyền state đang bị simulation sửa sang worker.
- Community không còn lượt cần mô phỏng thì không dựng snapshot định kỳ; vẫn xử lý heartbeat/deadline/commands và gửi khi state đổi. Không dừng mô phỏng chỉ vì input đứng yên.
- Gửi socket và ghi database ngoài vòng tick; client chậm bị timeout/giới hạn riêng.
- Persistence nhận payload bất biến, xử lý theo [data](data.md#transaction-và-ghi-dữ-liệu). Không giữ transaction hoặc managed Entity trong gameplay.

## Triển khai và giới hạn

Production: frontend trên Cloudflare Pages, một backend HTTPS/WSS trên VPS và MySQL nội bộ. Development dùng Vite proxy; vẫn hỗ trợ đóng frontend cùng JAR để chạy cùng origin. Cấu hình cookies/Origin theo [deployment](deployment.md). Static assets được cache/revalidate, API không cache; SPA fallback không che lỗi API/WS/asset. Lỗi tải cho phép reload thủ công, không polling phiên bản hoặc tự reload giữa trận.

Membership và gameplay Room ở RAM; restart không phục hồi trận. Community phục hồi checkpoint đã commit; phiên đăng nhập được lưu riêng theo [deployment](deployment.md#giữ-phiên-đăng-nhập).

Lỗi một client/command không dừng phòng khác. Database lỗi không chặn tick hoặc báo Saved giả. Quá tải và lỗi I/O phải có giới hạn, phản hồi rõ theo [protocol](protocol.md); năng lực phục vụ được [đo thực tế](testing.md#phương-pháp-thực-nghiệm).
