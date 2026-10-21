# architecture.md

## Công nghệ và trách nhiệm

| Thành phần | Công nghệ và trách nhiệm |
| --- | --- |
| UI | React + TypeScript: menu, Account, phòng và Records |
| Hiển thị | Phaser: map, sprite, animation và camera; Web Audio/HTMLAudio: âm thanh |
| Online | Spring Boot/Java quyết định physics, thời gian, tiến độ và kết quả |
| Persistence | MySQL + Spring Data JPA/Hibernate: identity, lượt chơi, checkpoint và kết quả |

![Kiến trúc hệ thống](../statics/architecture.svg)

Community/Room nhận input qua WebSocket; Java quyết định state, TypeScript dự đoán nhân vật của mình và nội suy peers. HTTP xử lý identity/Records theo [protocol](protocol.md).

Java/TypeScript dùng chung dữ liệu JSON, viết riêng simulation. Tính trung gian bằng double, ép float32 tại cùng điểm với `Math.fround`. Simulation độc lập Spring/Phaser/DOM/database; không dùng Phaser physics thay simulation.

Adventure tách dữ liệu luật, trạng thái lượt chơi và nội dung hiển thị:

| Phần | Nơi sở hữu |
| --- | --- |
| Trigger hội thoại và tiến độ nội dung | source/common/adventure.json; hai simulation cùng dùng |
| Tiến độ hội thoại trong lượt | Simulation; server quyết định, TypeScript dự đoán |
| Câu chữ hội thoại, nhãn, metadata sprite/animation và âm thanh | Frontend; tra cứu bằng ID từ rule/state |

Backend chỉ nạp luật và state gameplay; nội dung hiển thị thuộc frontend.

## Cấu trúc code

`source/client/` dùng npm, `source/server/` dùng Maven; build độc lập. `source/common/` chứa dữ liệu JSON dùng chung.

```text
source/
  client/                         # React/TypeScript và Phaser
    public/assets/                # manifest, game assets và attribution
    src/
      app/                        # routing và bootstrap
      features/                   # online, community, rooms, account, records, settings
      components/                 # UI dùng chung
      game/                       # simulation, input, netcode và presentation
        content/                  # lời thoại và metadata hiển thị
      network/                    # HTTP/WebSocket adapter
      styles/
      main.tsx
    e2e/
    package.json
    package-lock.json
    biome.json
    vite.config.ts
  server/                         # Spring Boot
    config/                       # file mẫu và cấu hình riêng được ignore
    src/main/java/jumpking/
      JumpKingApplication.java
      controller/                 # REST API
      service/                    # nghiệp vụ, transactions và persistence workers
      repository/                 # JPA repositories và projections
      entity/                     # ánh xạ MySQL
      dto/                        # request/response
      security/                   # identity, session và rate limits
      exception/                  # lỗi HTTP
      config/                     # Spring wiring và runtime settings
      game/                       # simulation và luật xếp hạng
      room/                       # Community/Room lifecycle
      network/                    # WebSocket và dispatch
    src/main/resources/
    src/test/                     # tests và test resources
    .mvn/
    pom.xml
    mvnw
    mvnw.cmd
  common/                         # JSON dùng chung, không chứa mã thực thi
    maps/
    physics.json
    rules.json
    room-maps.json                # 10 mốc Finish của Room trên cùng geometry
    adventure.json
    fixtures/
  database/                       # schema.sql và test-mysql.ps1
docs/                             # thiết kế, runbooks và tài liệu học phần
statics/                          # sơ đồ kiến trúc/protocol
```

Báo cáo học phần đặt tại `report/report.md`; sơ đồ ở `statics/`. Service/queue/worker là thành phần nội bộ của server, không tách thêm ứng dụng hoặc thư mục service ở root.

Java dùng root package `jumpking`, main class đặt tại root để Spring scan. Backend chia theo layer controller/service/repository/entity/dto; `network` chỉ xử lý transport/dispatch, `game` giữ luật thuần. Controller nhận/trả DTO, Service sở hữu nghiệp vụ/transaction, Repository truy cập MySQL. Không trả Entity qua API hoặc giữ managed Entity trong simulation/worker. JPA không nằm trong vòng tick; worker trao đổi snapshot bất biến. Không tạo interface/base class chỉ để chuyển tiếp lời gọi.

Frontend nhóm màn hình/hooks theo feature. `game` giữ simulation/input/presentation/netcode, độc lập React UI; `network` chỉ xử lý HTTP/WS. Unit tests đặt cạnh code; E2E ở `e2e/`.

Phaser tải assets giữ nguyên tên từ `public/assets`; tài nguyên UI được import đặt cạnh component/feature trong `src`.

Dữ liệu common đóng gói vào cả hai build; backend nạp và kiểm tra map/tuning bất biến một lần từ classpath, các simulation dùng chung định nghĩa và giữ state riêng. Client online dùng map/config server công bố và luật adventure cùng bản phát hành. Nội dung frontend liên kết bằng ID; common không chứa lời thoại/font/đường dẫn assets. URL/secrets theo [deployment](deployment.md).

Profile web đóng gói frontend vào JAR. Static files được browser lưu và revalidate bằng Last-Modified; API giữ no-store. SPA fallback index.html chỉ áp dụng route UI, không áp dụng API/WS/asset thiếu.

JPA tắt Open EntityManager in View, chỉ validate schema khi start. Repository dùng Entity cho ghi và projection cho truy vấn; quan hệ chỉ tải khi cần, không dùng collection hai chiều mặc định. Native query dành cho truy vấn tổng hợp cần thiết. Revision checkpoint/protocol không đồng nghĩa `@Version`; giữ semantics theo [data](data.md).

## Xử lý đồng thời

- Một executor xử lý tuần tự commands, deadlines và ticks của từng sảnh/phòng; các executor dùng chung worker pool. Registry tìm/tạo phòng, executor kiểm tra lại capacity trước Join.
- Simulation fixed-step **60 Hz**, snapshot **20 Hz**, dùng monotonic clock. Không nhận deltaTime từ client hoặc tăng số bước theo số packet.
- Community giữ simulation và active clock riêng cho từng lượt; Pause/Continue không thay pha vật lý của lượt đó. Room dùng đồng hồ trận chung.
- Room giữ state, roster, reconnect tokens và xác nhận ván kế tiếp trong RAM; khi mọi thành viên offline chỉ giữ cửa sổ reconnect, không chạy bù ticks offline. Room không có Pause toàn phòng.
- Socket validate rồi enqueue; hàng đợi lệnh và callback hoàn tất có giới hạn riêng, ưu tiên callback để không mất save/cleanup khi quá tải. Tick không chờ database hoặc socket chậm; snapshots gộp bản mới nhất, control messages giữ thứ tự.
- Persistence worker xử lý ngoài tick theo [data](data.md).

## Lỗi và khả năng mở rộng

Lỗi command/connection không dừng scheduler; lỗi simulation chỉ cô lập sảnh/phòng bị ảnh hưởng. Khi mất MySQL, tạm dừng lượt Community bị ảnh hưởng, giữ state trong RAM để retry có giới hạn và không báo lưu thành công.

Một backend instance giữ membership/gameplay Room trong RAM. Phiên đăng nhập còn hạn được giữ qua restart bình thường trong profile prod theo [protocol](protocol.md#identity-và-security), cấu hình lưu phiên theo [deployment](deployment.md#giữ-phiên-khi-deploy). Restart mất gameplay Room, chỉ khôi phục checkpoint Community và metrics đã commit; có thể mất tiến độ từ lần ghi cuối. Cách đóng match dở theo [data](data.md#kết-quả-room).

Luật/Finish/comparator thuộc `game`, persistence thuộc `service`/`repository`, độc lập transport/UI.

Tham chiếu: [Spring Boot package layout](https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html), [Maven layout](https://maven.apache.org/guides/introduction/introduction-to-the-standard-directory-layout.html), [Vite assets](https://vite.dev/guide/assets.html).
