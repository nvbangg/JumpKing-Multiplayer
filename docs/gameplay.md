# Luật chơi và hành vi chức năng

Tái hiện trải nghiệm Main Babe của Jump King gốc, bổ sung Community và Room nhiều người chơi. [Kiểm thử](testing.md#tiêu-chí-nghiệm-thu) xác nhận physics và tuyến chơi; không mở rộng campaign khác.

## Kiểu chơi

| Kiểu | Tham gia | Tiến độ và thành tích |
| --- | --- | --- |
| Community | Account; New Game hoặc Continue; tự xếp sảnh | Checkpoint cá nhân và leaderboard |
| Room | Account; tạo Public/Private, Join Public hoặc bằng ID; Host Start | Cùng xuất phát, Results và History; không checkpoint dài hạn hoặc leaderboard |

Tối đa 10 người/sảnh, kể cả slot reconnect. Mỗi Account chỉ có một membership online; username là tên nhân vật. Join by ID chỉ dành cho Room. Người chơi không va chạm nhau; Items chỉ có trong Room khi Host bật.

## Điều khiển và physics

| Input | Hành vi |
| --- | --- |
| A/D hoặc Left/Right | Đi bộ/chọn hướng nhảy; hai hướng cùng lúc là trung tính |
| Space, W hoặc Up | Giữ để charge; thả hoặc đủ lực thì nhảy |
| Escape / Menu | Mở menu |
| Cảm ứng | Trái/phải và giữ/thả Jump; hỗ trợ nhiều ngón |
| Tay cầm | D-pad/analog trái, A nhảy, Start mở menu |

Giữ physics gốc: charge quyết định lực nhảy, đủ charge tự bật, phải thả Jump trước lần charge mới; không đổi hướng hoặc nhảy lần hai trên không. Hướng nhảy dùng input hiện tại hoặc hướng gần nhất trong buffer. Va tường bật ngược, va trần dừng lên; giải collision cả slopes và góc. Băng có quán tính; tuyết cấm đi bộ và giới hạn charge; gió chỉ tác động trong vùng quy định. Splat là tiếp đất ở tốc độ rơi tối đa, tính một fall và giữ tư thế ngã trước khi đứng dậy.

Giải movement/collision trước input/launch; tick thả Jump vẫn tăng charge. Tuning tập trung trong `source/common/physics.json`, fixtures xác nhận thứ tự và kết quả; nhịp mô phỏng theo [architecture](architecture.md#xử-lý-đồng-thời). Không đơn giản hóa physics khi refactor giao diện hoặc networking.

Menu, chat, mất focus và disconnect hủy input/charge, không biến hủy thành nhảy. Touch cancel phải nhả input; lỗi gamepad không chặn keyboard/touch. Ẩn tab, mất focus hoặc không đổi input điều khiển trong 1 phút mở menu. Giữ nguyên phím, chat và heartbeat không tính là hoạt động điều khiển. Community Pause bản thân; Room vẫn chạy; trở lại phải Resume. Các thời hạn tập trung trong `source/common/rules.json`.

## Map và camera

Main Babe có 43 screens (0–42), mỗi screen 480×360 px. Camera chuyển nguyên screen 4:3 theo vị trí và hướng di chuyển, không smooth-follow. Tải tài nguyên trước khi chơi, chỉ vẽ screen hiện tại; không streaming tài nguyên theo screen.

Một geometry dùng cho mọi kiểu chơi. `source/common/room-maps.json` quy định 10 độ dài Room cộng dồn từ spawn: map 1–9 kết thúc khi đáp đúng nền trong vùng Finish; đáp nền khác cao hơn hoặc bay qua không tính. Map 10 và Community dùng đích full. Cờ FINISH chỉ dẫn vị trí, không thay collision. Geometry, spawn, camera và điều kiện Finish được kiểm chứng bằng fixtures.

## Community

- Tự chọn sảnh còn chỗ, ưu tiên sảnh đông hơn; hết chỗ tạo sảnh mới. Save thuộc Account/lượt, không thuộc sảnh.
- Continue khôi phục đúng lượt ACTIVE; save đã đổi thì báo conflict, không tự tạo lượt mới. New Game phải xác nhận thay lượt đang dở, giữ lịch sử/thành tích cũ. Save & Exit rồi Continue có thể vào sảnh khác.
- Pause chỉ tác động bản thân: hủy charge, tiếp tục physics/clock tới khi đáp nền ổn định rồi dừng. Fly được Pause ngay; phasing fall phải thoát khối. Save & Exit/disconnect cũng chờ ổn định rồi lưu, không hoàn tác cú rơi.
- Paused/offline không tính active time. Pause liên tục 15 phút khi còn kết nối thì lưu, trả về menu và giải phóng slot; vẫn Continue được.

Leaderboard chỉ xét Community đã commit, lấy một best run/Account. Finish đứng trước, so finish time tăng dần; chưa Finish so peak giảm dần rồi active time lần đầu đạt peak tăng dần. Xét cả ACTIVE/ABANDONED, không ghép dữ liệu của nhiều lượt; bằng khóa đồng hạng 1,1,3.

## Room và xếp hạng

Room ID gồm 6 ký tự thuộc `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Room mặc định Private; biết ID thì Join được. Public chỉ xuất hiện khi WAITING và còn chỗ. Host đổi visibility, mode, map và Items tại Lobby; chỉ WAITING cho Join mới/đổi settings, không Ready thủ công.

```text
WAITING → COUNTDOWN → PLAYING → FINISHED
   ↑                              |
   └──────── Play Again ───────────┘
```

Host Start cần ít nhất một người connected. Chốt roster, chờ tất cả renderer sẵn sàng rồi đếm ngược 3 giây; quá 30 giây hoặc có người Leave trong lúc chuẩn bị thì về Lobby, không ghi trận. Ngoài WAITING chỉ nhận reconnect của roster.

| Mode | Luật |
| --- | --- |
| RACE | Rơi vẫn tiếp tục; không giới hạn thời gian |
| HARDCORE | Splat về spawn; giữ clock, peak và thống kê trận |
| TIME_LIMIT | Như Race; Host chọn 1–30 phút nguyên, mặc định 5 |
| NO_WALK | Chỉ nhảy để di chuyển; input ngang trên nền chọn hướng nhảy, vẫn có quán tính/bounce |

Clock chung chạy từ hết countdown. Menu/chat/AFK không dừng physics/clock hoặc đuổi người vì mở menu; không Host Pause. All-offline ngừng tick trong hạn reconnect, không chạy bù thời gian offline.

Finish đầu tiên kết thúc trận sau khi xử lý mọi người trong cùng tick; Finish cùng tick đồng thắng. Time Limit chốt tại deadline, xét Finish hợp lệ trước timeout. Host có thể End khi PLAYING.

Finishers xếp trước theo finish time tăng dần. Người khác so current progress giảm dần, thêm peak giảm dần riêng Time Limit; bằng các khóa thì đồng hạng. Clock trận là đồng hồ chung, không tạo thêm khóa phân hạng. ID chỉ ổn định thứ tự hiển thị. Chưa ai Finish thì không có winner; DNF không thắng.

- Current progress: độ cao tại lần đáp nền hợp lệ gần nhất, không tính splat/phasing; khi trên không giữ giá trị đó.
- Peak: độ cao tức thời cao nhất từng đạt. Hardcore reset current về spawn, giữ peak/clock/falls.
- Không làm tròn trước xếp hạng. Rock chọn theo độ cao tức thời, không dùng current của lần đáp nền.

Play Again giữ room code/settings và thành viên, nhưng reset trạng thái ván, clock, bẫy và xác nhận. Người chọn đầu tiên đưa phòng về WAITING; từng người xác nhận lại, người Join mới được tính đã xác nhận. Host đã xác nhận mới Start; chỉ người connected đã xác nhận vào roster, người khác về menu. Mỗi Start dùng ID mới; chỉ ghi match/runs sau countdown.

## Items trong Room

Host bật tại Lobby, mặc định Off; cooldown 1–15 phút nguyên, mặc định 3. Settings giữ qua Play Again, không đổi giữa trận.

Tối đa 64 bẫy Banana/phòng, cấu hình trong rules. Chạm trần thì hủy chuẩn bị, không đặt thêm, giữ item và không bắt đầu cooldown; bẫy cũ vẫn tồn tại đến khi bị giẫm.

| Item | Luật |
| --- | --- |
| Banana | Click khi đứng nền để chuẩn bị, click lại hủy. Cú bật nhảy thật tiếp theo để lại bẫy dưới chân; air grace/đặt trùng hủy chuẩn bị, giữ item. Bẫy hoạt động từ tick sau, không trúng người đang bay lên; tồn tại đến khi một người giẫm, kể cả chủ, rồi mất |
| Rock | Đánh trực tiếp người khác connected/ACTIVE cao nhất Room, bỏ người Fly/phasing/splat; hòa chọn theo roster. Hất ngang ra xa người ném và hủy vận tốc lên; cùng x dùng hướng quay người ném. Không mục tiêu thì giữ item. Đường bay chỉ là hiệu ứng, không projectile/né đá |

- Hết countdown cấp ngẫu nhiên Banana/Rock 50/50, một ô không tích trữ. Click/chạm hoặc E để dùng; tiêu thụ thành công mới tính cooldown, hết cooldown cấp ngẫu nhiên tiếp.
- Không dùng khi menu/chat/spectating, charge/splat/trượt/Fly/phasing; Rock dùng được trên không. Server quyết định item, vị trí, mục tiêu và người trúng; nhiều người giẫm cùng tick chọn theo roster. Chủ Leave không xóa Banana.
- Trúng item gây trượt ngang 4× walkSpeed, không ma sát/gió/đổi hướng/charge, không cộng dồn lực. Banana theo hướng di chuyển, đứng yên dùng hướng quay. Gravity/collision vẫn chạy; hết trượt khi va tường/trần/biên, splat hoặc rơi rồi đáp nền mới. Không bảo đảm rơi khỏi bệ; chỉ splat thật tăng falls/kích hoạt Hardcore.
- Item/cooldown/bẫy giữ qua reconnect/respawn, reset khi hết ván; all-offline cũng ngừng cooldown. State chỉ ở RAM; History lưu settings theo [data](data.md#room-và-kết-quả).

## Leave và reconnect

Leave kết thúc membership; khi trang còn hoạt động phải đợi server xác nhận. Đóng tab gửi Leave best effort, thất bại xử lý như disconnect. Đổi tab/blur hoặc chuyển Results/Lobby không phải Leave.

Disconnect hủy input/charge, giữ slot 5 phút. Reconnect đúng Account/player/token giữ tiến độ, không tự bật điều khiển; Community trở lại Pause và tính lại hạn Pause. Hết hạn Community vẫn giữ checkpoint. Room còn người connected vẫn chạy; all-offline chờ reconnect, hết hạn thì finalize. Trong Room, Leave/hết hạn chốt DNF, đóng băng metrics.

Host Leave/disconnect chuyển ngay cho người connected có joinOrder nhỏ nhất. Không còn ai thì Host=null, người reconnect đầu tiên nhận quyền. Mọi người Leave thì đóng phòng sau xử lý kết quả. Room gameplay chỉ giữ trong RAM; hành vi restart và commit theo [data](data.md#room-và-kết-quả).

## Nội dung và nhận diện

Giữ nhân vật, NPC/hội thoại, readables, đạo cụ, animation, ambience và âm thanh Main Babe. Hội thoại không Pause. Không intro/Press Start, Inventory, merchant, quest nhận đồ hoặc ending credit; Items Room độc lập với adventure.

Tên vùng hiện 6 giây khi lần đầu tới màn đầu vùng (Colossal Drain từ screen index 5). Tiến độ thuộc lượt/checkpoint, không phát lại khi rơi/respawn/Continue/reconnect; lượt mới reset, lên vượt bỏ qua vùng thấp. Menu giữ hiệu ứng, ending ẩn tên vùng.

Quạ đen có 14 điểm đậu, tới gần thì bay tiếp; đuổi hết rồi full Finish thay thiên thần trao vương miện. Quạ trắng có 17 điểm trong Main Babe, bay đi sau điểm cuối; không thưởng/đổi ending. Tiến độ riêng từng người, lưu Community và reset mỗi trận Room.

Full Finish mở crown Account vĩnh viễn. Community chỉ người Finish xem ending; Room full map chỉ winners xem, người khác tới Results. Map 1–9 chỉ Results, không crown/ending/Best Finish Time full map. Giữ cảnh/nhạc/ảnh ending và Skip; không ảnh hưởng kết quả/clock, không phát lại khi replay hoặc spectate.

Server cấp 10 màu riêng theo membership, giữ qua reconnect và nhất quán giữa các client. Bản thân opacity=1, vẽ trên peers opacity=0.7; tên rõ, nằm dưới hội thoại. Ngoại hình không đổi hitbox.

Tutorial Community: thực hiện tuần tự di chuyển → charge → nhảy có hướng; hành động ở bước sau không bỏ qua bước trước. Hoàn tất theo counter nhảy server, không tính rơi/Fly. Account đã hoàn tất/Skip trên thiết bị không hiện lại; lưu trạng thái local theo Account, không thêm bảng database.

## Thống kê và History

Stats tổng Community/Room: active time, jumps, falls, finishes, số trận/thắng Room và best finish time full map; không lọc kiểu chơi. Jump tính khi launch, fall khi splat; New Game/respawn không xóa tổng. Chưa Finish thì finish time=null.

History gồm lượt Community kết thúc và Room finalize, chỉ chủ lượt/thành viên trận xem; mỗi lượt/trận một mục, Room có chi tiết roster. Pause/Continue/Save & Exit không tạo mục mới. Ownership và chống cộng trùng theo [data](data.md#history-stats-và-leaderboard).

## Chat và các bảng trong trận

Chat theo sảnh/phòng, text thuần, không lưu MySQL; Lobby/game dùng chung form, luôn hiện ô nhập và giữ tối đa 30 tin gần nhất. Trong trận, lịch sử ẩn sau 5 giây không có tin mới; hover vùng tin nhắn giữ lịch sử mở, rời vùng này 2 giây thì ẩn. Tin mới hoặc focus chat tự hiện lại; giữ focus ô nhập không ngăn tự ẩn. Lobby không tự ẩn. Chỉ tự cuộn khi đang gần cuối; khi đọc tin cũ giữ vị trí, có Latest để về cuối. Enter focus/gửi, Escape hoặc rời ô nhập trả điều khiển; không bắt phím form khác. Menu/pause không che hoặc ngắt chat.

Players realtime gồm cả phòng: Room theo comparator mode, Community theo current progress. Leaderboard chỉ Community, tải khi vào trận hoặc Refresh, không polling. Hai bảng mặc định mở, có thể thu gọn; chiều cao giới hạn theo màn hình và danh sách dài cuộn. Desktop giữ game chính giữa, chat dưới trái, Players/Leaderboard trên phải; mobile xếp dọc. Timer luôn hiện góc trên trái game, jumps chỉ ở Stats/History. Sound bật/tắt trực tiếp, không màn Options hoặc nút Fullscreen; F11 do trình duyệt xử lý, không phóng game desktop theo chiều cao. Chỉ ô nhập/mã phòng cho chọn chữ. New Game Community chỉ tại menu sau Save & Exit.

## Xem người chơi khác

Chọn người connected trong Players cùng Community hoặc Room PLAYING để xem screen/nhân vật/môi trường/NPC/quạ/âm thanh của họ; người được xem rõ 100%, peers 70%. Không điều khiển họ, xem nối tiếp mục tiêu họ đang xem hoặc phát ending của họ.

Room vẫn mô phỏng bản thân/clock; Community Pause bản thân và không tăng active time khi đã paused. Cho chat/menu/đổi mục tiêu; Back to My Game chủ động Resume. Mục tiêu Leave/disconnect/Finish thì về bản thân/menu Resume; Room kết thúc tới Results. Reconnect không khôi phục mục tiêu. AFK không mở menu khi đang xem, mất focus vẫn mở.

## Fly Mode

Cờ server `FLY_ENABLED` mặc định false, cấp quyền mọi Account/kiểu chơi/môi trường; không Options hoặc cheat chat. Khi được phép, nhấn đúp Space/Jump cảm ứng trong 300 ms để bật/tắt bay, chỉ tính lần nhấn sau khi thả, không key repeat; nhấn đầu vẫn Jump bình thường.

Bay ngang 2× walkSpeed, dọc 4×, dùng WASD/mũi tên hoặc touch lên/xuống; Space không làm bay lên. Bay xuyên địa hình, không gravity/charge/splat, giữ biên world. Đổi trạng thái xóa charge/velocity, phải thả Jump trước charge mới. Tắt trong solid thì rơi thẳng không điều khiển/collision tới khi thoát khối; tới đáy vẫn kẹt thì về spawn. Restore save khi cờ tắt dùng cùng xử lý thoát khối.

Vẫn tính save/Stats/History/leaderboard bình thường; client không tự cấp quyền. Cấu hình theo [deployment](deployment.md#fly-mode).

## Nguồn nội dung

Chuyển thể từ Jump King của Nexile; [attribution](../source/client/public/assets/ATTRIBUTION.md) ghi nguồn/tình trạng giấy phép. Giữ attribution bắt buộc; sở hữu game không đồng nghĩa quyền phân phối tài nguyên.
