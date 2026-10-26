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
| Cảm ứng | Chơi ngang; nút trái/phải và giữ/thả Jump ở hàng dưới, hỗ trợ nhiều ngón |
| Tay cầm | D-pad/analog trái, A nhảy, Start mở menu |

Giữ physics gốc: charge quyết định lực nhảy, đủ charge tự bật, phải thả Jump trước lần charge mới; không đổi hướng hoặc nhảy lần hai trên không. Hướng nhảy dùng input hiện tại hoặc hướng gần nhất trong buffer. Va tường bật ngược, va trần dừng lên; giải collision cả slopes và góc. Băng có quán tính; tuyết cấm đi bộ và giới hạn charge; gió chỉ tác động trong vùng quy định. Splat là tiếp đất ở tốc độ rơi tối đa, tính một fall và giữ tư thế ngã trước khi đứng dậy.

Giải movement/collision trước input/launch; tick thả Jump vẫn tăng charge. Tuning tập trung trong `source/common/physics.json`, fixtures xác nhận thứ tự và kết quả; nhịp mô phỏng theo [architecture](architecture.md#xử-lý-đồng-thời). Không đơn giản hóa physics khi refactor giao diện hoặc networking.

Menu, chat, mất focus và disconnect hủy input/charge, không biến hủy thành nhảy. Touch cancel phải nhả input; lỗi gamepad không chặn keyboard/touch. Ẩn tab, mất focus hoặc không đổi input điều khiển trong 1 phút mở menu. Giữ nguyên phím, chat và heartbeat không tính là hoạt động điều khiển. Community Pause bản thân; Room vẫn chạy; trở lại phải Resume. Các thời hạn tập trung trong `source/common/rules.json`.

## Map và camera

Main Babe có 43 screens (0–42), mỗi screen 480×360 px. Camera chuyển nguyên screen 4:3 theo vị trí và hướng di chuyển, không smooth-follow. Tải tài nguyên trước khi chơi, chỉ vẽ screen hiện tại; không streaming tài nguyên theo screen.

Một geometry dùng cho mọi kiểu chơi. Room chia đường Main Babe thành 9 chặng: map 1 bắt đầu ở spawn gốc; map 2–9 bắt đầu trên nền Finish của map ngay trước và kết thúc tại Finish đã định cho map đó. Map 4 gộp cả đoạn Great Frontier; map 5 bắt đầu tại bệ mở đầu Windswept Bluff. Map 9 kết thúc tại đích The Tower; Community vẫn dùng toàn đường từ spawn gốc. Nếu rơi thấp hơn điểm bắt đầu của chặng Room, người chơi trở về spawn chặng và tính một fall. Đáp nền khác hoặc bay qua Finish không tính. Cờ FINISH chỉ dẫn vị trí, không thay collision. Geometry, spawn, camera và điều kiện Finish được kiểm chứng bằng fixtures.

Community New Game hiện Green Woods trong 3 giây. Sau đó, mỗi lần đáp an toàn lên bất kỳ bệ nào có cao độ bằng hoặc cao hơn mốc Finish của map N, hiển thị tên map N+1 trong 3 giây; nếu vượt nhiều mốc, dùng tên vùng cao nhất đã tới. Chỉ xét cao độ chân khi tiếp đất, không giới hạn bệ hoặc vị trí ngang. Bay qua cao độ, đáp SPLAT hoặc respawn không kích hoạt caption; rơi xuống rồi leo lại không phát lại tên vùng đã tới. Continue giữ tiến độ caption của lượt. Trong Room chỉ hiện tên map đã chọn khi trận bắt đầu; không đổi caption ở đích.

## Community

- Tự chọn sảnh còn chỗ, ưu tiên sảnh đông hơn; hết chỗ tạo sảnh mới. Save thuộc Account/lượt, không thuộc sảnh.
- Continue khôi phục đúng lượt ACTIVE; save đã đổi thì báo conflict, không tự tạo lượt mới. New Game phải xác nhận thay lượt đang dở, giữ lịch sử/thành tích cũ. Save & Exit rồi Continue có thể vào sảnh khác.
- Pause chỉ tác động bản thân: hủy charge, tiếp tục physics/clock tới khi đáp nền ổn định rồi dừng. Fly được Pause ngay; phasing fall phải thoát khối. Save & Exit/disconnect cũng chờ ổn định rồi lưu, không hoàn tác cú rơi.
- Paused/offline không tính active time. Pause liên tục 15 phút khi còn kết nối thì lưu, trả về menu và giải phóng slot; vẫn Continue được.

Leaderboard chỉ xét Community đã commit, lấy một best run/Account. Finish đứng trước, so finish time tăng dần; chưa Finish so peak giảm dần rồi active time lần đầu đạt peak tăng dần. Xét cả ACTIVE/ABANDONED, không ghép dữ liệu của nhiều lượt; bằng khóa đồng hạng 1,1,3.

## Room và xếp hạng

Room ID là chuỗi 6 chữ số, giữ số 0 đầu, ví dụ `001234`. Room mặc định Private, Race và map 1; biết ID thì Join được. Public chỉ xuất hiện khi WAITING và còn chỗ. Lobby tách ID/danh sách người chơi và settings thành hai phần, màn hẹp xếp dọc. Host đổi settings khi WAITING; Time Limit chọn Unlimited hoặc 1–10 phút, Items cooldown chọn No items hoặc 1–10 phút. Thành viên mặc định Confirmed khi tạo/Join phòng; trong WAITING có thể Cancel Confirm và Confirm lại. Server giữ trạng thái này qua cập nhật Lobby và reconnect.

```text
WAITING → COUNTDOWN → PLAYING → FINISHED
   ↑                              |
   └──────── Play Again ───────────┘
```

Host Start cần ít nhất một người connected. Chốt roster, renderer của Host sẵn sàng thì đếm ngược 3 giây, không chờ renderer của người khác. Host chưa tải xong quá 30 giây hoặc có người Leave trong lúc chuẩn bị thì về Lobby, không ghi trận. Người tải chậm nhận state hiện tại khi sẵn sàng, không khởi động lại countdown. Ngoài WAITING chỉ nhận reconnect của roster.

Host đã Confirmed có thể Start một mình; không chờ thêm thành viên hoặc người đã hủy xác nhận. Chỉ Host được Start, lệnh Start tiếp theo khi đã COUNTDOWN không tạo trận mới. Trong WAITING, Host có thể Kick người khác, kể cả người offline; không Kick chính mình. Kick kết thúc membership và thu hồi token reconnect, đồng thời cập nhật danh sách cho những người còn lại.

| Mode | Luật |
| --- | --- |
| RACE | Rơi vẫn tiếp tục |
| EASY | Tự nhớ vị trí đứng an toàn gần nhất; SPLAT quay về đó, không phải leo lại |
| HARDCORE | Splat về spawn; giữ clock, peak và thống kê trận |
| NO_WALK | Chỉ nhảy để di chuyển; input ngang chỉ chọn hướng, đáp nền thường thì dừng. Giữ quán tính băng, gió, bounce và trượt do Items |

Giới hạn thời gian là tùy chọn độc lập với mode, mặc định không giới hạn. Khi chọn 1–10 phút và hết giờ, trận kết thúc theo luật TIME_LIMIT.

Clock chung chạy từ hết countdown. Menu/chat/AFK không dừng physics/clock hoặc đuổi người vì mở menu; không Host Pause. All-offline ngừng tick trong hạn reconnect, không chạy bù thời gian offline.

Easy nhớ riêng vị trí đứng/đáp nền bình thường của từng người, không cần cờ hoặc thao tác lưu; vị trí gần nhất có thể thấp hơn vị trí trước. Không ghi điểm khi SPLAT, trượt, bị hất, Fly hoặc phasing. SPLAT trả về điểm đã nhớ (chưa có thì spawn), xóa vận tốc/charge/trượt và chờ thả Jump trước cú nhảy mới. Clock, jumps/falls, peak, Items/cooldown/bẫy và tiến độ NPC/quạ giữ nguyên; current progress cập nhật theo vị trí quay về. Điểm an toàn theo snapshot, giữ khi reconnect và reset mỗi ván; không lưu dài hạn. Kết quả/crown/Best Finish Time áp dụng như các mode Room khác.

Trong map 2–9, rơi qua ranh giới dưới chặng luôn đưa người chơi về spawn chặng và tính một fall; các lần SPLAT còn lại theo mode đã chọn. Tiến độ và peak Room tính từ đầu chặng, không cộng độ cao của các map trước.

Finish đầu tiên kết thúc trận sau khi xử lý mọi người trong cùng tick; Finish cùng tick đồng thắng. Time Limit chốt tại deadline, xét Finish hợp lệ trước timeout. Host có thể End khi PLAYING.

Finishers xếp trước theo finish time tăng dần. Người khác so current progress giảm dần; khi bật giới hạn thời gian thì thêm peak giảm dần. Bằng các khóa thì đồng hạng. Clock trận là đồng hồ chung, không tạo thêm khóa phân hạng. ID chỉ ổn định thứ tự hiển thị. Chưa ai Finish thì không có winner; DNF không thắng.

- Current progress: độ cao tại lần đáp nền hợp lệ gần nhất, không tính splat/phasing; khi trên không giữ giá trị đó.
- Peak: độ cao tức thời cao nhất từng đạt. Hardcore reset current về spawn, giữ peak/clock/falls.
- Không làm tròn trước xếp hạng. Rock chọn theo độ cao tức thời, không dùng current của lần đáp nền.

Play Again giữ room code/settings và thành viên, nhưng reset trạng thái ván, clock, bẫy và xác nhận. Người chọn đầu tiên đưa phòng về WAITING; danh sách Lobby chỉ hiển thị người đã chọn Play Again hoặc Join mới. Người còn ở Results giữ membership để có thể Play Again sau; Cancel Confirm không ẩn người đã vào Lobby. Từng người xác nhận lại, người Join mới được tính đã xác nhận. Host đã xác nhận mới Start; chỉ người connected đã xác nhận vào roster, người khác về menu. Mỗi Start dùng ID mới; chỉ ghi match/runs sau countdown.

## Items trong Room

Tại Lobby, Host chọn No items hoặc cooldown 1–10 phút; mặc định No items. Chọn số phút sẽ bật Items với cooldown tương ứng. Settings giữ qua Play Again, không đổi giữa trận.

Tối đa 64 bẫy Banana/phòng, cấu hình trong rules. Chạm trần thì hủy chuẩn bị, không đặt thêm, giữ item và không bắt đầu cooldown; bẫy cũ vẫn tồn tại đến khi bị giẫm.

| Item | Luật |
| --- | --- |
| Banana | Click khi đứng nền để chuẩn bị, click lại hủy. Cú bật nhảy thật tiếp theo để lại bẫy dưới chân; air grace/đặt trùng hủy chuẩn bị, giữ item. Bẫy hoạt động từ tick sau, không trúng người đang bay lên; tồn tại đến khi một người giẫm, kể cả chủ, rồi mất |
| Rock | Đánh trực tiếp người khác connected/ACTIVE cao nhất Room, bỏ người Fly/phasing/splat; hòa chọn theo roster. Hất ngang ra xa người ném và hủy vận tốc lên; cùng x dùng hướng quay người ném. Không mục tiêu thì giữ item. Đường bay chỉ là hiệu ứng, không projectile/né đá |
| Jump Boots | Dùng để tăng độ cao cú nhảy hợp lệ kế tiếp gần 2× với cùng mức charge; giữ tốc độ ngang, gravity và thời gian charge. Không cộng dồn hoặc hết hạn theo thời gian; launch thật tiêu hiệu lực, kể cả va trần. Hủy charge hoặc charge yếu trên tuyết chưa launch thì giữ hiệu lực |

- Hết countdown cấp ngẫu nhiên Banana/Rock/Jump Boots, mỗi loại 1/3, một ô không tích trữ. Click/chạm hoặc E để dùng; tiêu thụ thành công mới tính cooldown, hết cooldown cấp ngẫu nhiên tiếp. Boots bắt đầu cooldown khi kích hoạt, không dùng thêm Boots khi cú nhảy tăng lực còn chờ.
- Không dùng khi menu/chat/spectating, charge/splat/trượt/Fly/phasing; Rock dùng được trên không. Server quyết định item, vị trí, mục tiêu và người trúng; nhiều người giẫm cùng tick chọn theo roster. Chủ Leave không xóa Banana.
- Trúng item gây trượt ngang 4× walkSpeed, không ma sát/gió/đổi hướng/charge, không cộng dồn lực. Banana theo hướng di chuyển, đứng yên dùng hướng quay. Gravity/collision vẫn chạy; hết trượt khi va tường/trần/biên, splat hoặc rơi rồi đáp nền mới. Không bảo đảm rơi khỏi bệ; chỉ splat thật tăng falls/kích hoạt Hardcore.
- Item/cooldown/bẫy và hiệu lực Boots chưa dùng giữ qua reconnect/respawn, reset khi hết ván; all-offline cũng ngừng cooldown. State chỉ ở RAM; History lưu settings theo [data](data.md#room-và-kết-quả).

## Leave và reconnect

Leave kết thúc membership; khi trang còn hoạt động phải đợi server xác nhận. Đóng tab gửi Leave best effort, thất bại xử lý như disconnect. Đổi tab/blur hoặc chuyển Results/Lobby không phải Leave.

Disconnect hủy input/charge, giữ slot 5 phút. Reconnect đúng Account/player/token giữ tiến độ, không tự bật điều khiển; Community trở lại Pause và tính lại hạn Pause. Hết hạn Community vẫn giữ checkpoint. Room còn người connected vẫn chạy; all-offline chờ reconnect, hết hạn thì finalize. Trong Room, Leave/hết hạn chốt DNF, đóng băng metrics.

Lobby mất kết nối hiển thị Reconnect và tự thử lại có giới hạn khi có mạng; dùng chung thao tác khôi phục với nút thủ công theo [protocol](protocol.md#đồng-bộ-và-khôi-phục-kết-nối). Trong trận giữ nút Reconnect thủ công. Leave đã xác nhận, Kick hoặc membership hết hạn dừng khôi phục; không tự Join mới.

Host Leave/disconnect chuyển ngay cho người connected có joinOrder nhỏ nhất. Không còn ai thì Host=null, người reconnect đầu tiên nhận quyền. Mọi người Leave thì đóng phòng sau xử lý kết quả. Room gameplay chỉ giữ trong RAM; hành vi restart và commit theo [data](data.md#room-và-kết-quả).

## Nội dung và nhận diện

Giữ nhân vật, NPC/hội thoại, readables, đạo cụ, animation, ambience và âm thanh Main Babe. Hội thoại không Pause. Không intro/Press Start, Inventory, merchant, quest nhận đồ hoặc ending credit; Items Room độc lập với adventure.

Tên vùng hiện 6 giây khi lần đầu tới màn đầu vùng (Colossal Drain từ screen index 5). Tiến độ thuộc lượt/checkpoint, không phát lại khi rơi/respawn/Continue/reconnect; lượt mới reset, lên vượt bỏ qua vùng thấp. Menu giữ hiệu ứng, ending ẩn tên vùng.

Quạ đen có 14 điểm đậu, tới gần thì bay tiếp; đuổi hết rồi full Finish trong cùng lượt thì quạ trao vương miện đen thay thiên thần. Quạ trắng có 17 điểm trong Main Babe, bay đi sau điểm cuối; không thưởng/đổi ending. Tiến độ riêng từng người, lưu Community và reset mỗi trận Room.

Full Finish mở crown vàng Account vĩnh viễn; hoàn thành cả chuỗi quạ đen trong lượt đó nhận thẳng crown đen. Tự đeo cấp cao nhất đã nhận, chỉ nâng NONE → GOLD → BLACK; Finish thường không hạ crown đen. Có thể chơi lượt mới để lấy đen sau khi đã có vàng. Hai màu crown cố định, độc lập màu nhân vật. Chỉ Community mới phát ending cho người Finish; mọi Room map kết thúc ở Results, kể cả map 9 The Tower. Người thắng Room map 9 vẫn nhận crown và Best Finish Time full map. Map 1–8 không mở crown/Best Finish Time full map. Giữ cảnh/nhạc/ảnh ending và Skip trong Community; không ảnh hưởng kết quả/clock, không phát lại khi replay hoặc spectate.

Server cấp 10 màu riêng theo membership, giữ qua reconnect và nhất quán giữa các client. Bản thân opacity=1, vẽ trên peers opacity=0.7; tên rõ, nằm dưới hội thoại. Ngoại hình không đổi hitbox.

Tutorial Community chỉ hiện khi Account chưa có thời gian chơi, chưa tham gia trận Room và chưa có lượt Community đã lưu. Dùng dữ liệu Stats/checkpoint có sẵn trên server; Continue/reconnect không hiện lại. Thực hiện tuần tự di chuyển → charge → nhảy có hướng; hoàn tất bước 3 thì đóng ngay, không có bước xác nhận. Hoàn tất theo counter nhảy server, không tính rơi/Fly. Hoàn tất/Skip được nhớ thêm trên trình duyệt theo Account, không thêm bảng database.

## Thống kê và History

Stats tổng Community/Room: active time, jumps, falls, finishes, số trận/thắng Room và best finish time full map; không lọc kiểu chơi. Jump tính khi launch, fall khi splat; New Game/respawn không xóa tổng. Chưa Finish thì finish time=null. Thời lượng hiển thị theo đồng hồ kèm `s`, ví dụ `01:30 s`; chưa có thành tích hiện `—`.

History mở từ Account khi nhấn username, gồm lượt Community kết thúc và Room finalize, chỉ chủ lượt/thành viên trận xem; mỗi lượt/trận một mục, Room có chi tiết roster. Pause/Continue/Save & Exit không tạo mục mới. Ownership và chống cộng trùng theo [data](data.md#history-stats-và-leaderboard).

## Chat và các bảng trong trận

Chat theo sảnh/phòng, text thuần, không lưu MySQL; Lobby/game dùng chung form, luôn hiện ô nhập và giữ tối đa 30 tin gần nhất. Trong trận, lịch sử ẩn sau 5 giây không có tin mới; hover vùng tin nhắn giữ lịch sử mở, rời vùng này 2 giây thì ẩn. Tin mới hoặc focus chat tự hiện lại; giữ focus ô nhập không ngăn tự ẩn. Lobby không tự ẩn: khung phòng căn giữa, chat góc trái dưới có vùng riêng; màn hẹp dành chỗ chat bên dưới, không che khung phòng. Chỉ tự cuộn khi đang gần cuối; khi đọc tin cũ giữ vị trí, có Latest để về cuối. Enter focus/gửi, Escape hoặc rời ô nhập trả điều khiển; không bắt phím form khác. Menu/pause không che hoặc ngắt chat. Lỗi gửi chat, kể cả giới hạn tốc độ, chỉ hiển thị trong khung Chat.

Players realtime gồm cả phòng: Room theo comparator mode, Community theo current progress. Leaderboard chỉ Community, tải khi vào trận hoặc Refresh, không polling. Luôn hiện cả hai bảng; bảng ngắn nhường chiều cao cho bảng dài, cả hai dài thì chia đều vùng có sẵn. Mobile thu gọn hàng và tận dụng chiều cao cột phải phía trên nút Jump; desktop giới hạn tối đa 640 px hoặc 75% chiều cao màn hình. Chỉ danh sách dài cuộn; tiêu đề/Refresh luôn thấy và từng bảng vẫn thu gọn được.

Game ở giữa, giữ đủ screen 4:3 và camera gốc; dành hai cột riêng cho chat dưới trái, Players/Leaderboard trên phải, không đè lên canvas. Cột bên thu gọn theo viewport để ưu tiên game. Giới hạn kích thước khi vào màn chơi hoặc xoay thiết bị; F11 không phóng lớn game. Cửa sổ nhỏ hơn thì game thu vừa chỗ, mở rộng lại không vượt giới hạn đã đặt. Mobile ngang đặt nút di chuyển ở đáy cột trái, Jump ở đáy cột phải; chat/bảng ở phía trên, không dành dải trống dưới game. Màn nhỏ có nút Chat để mở lịch sử mà không bật bàn phím, ô nhập vẫn hiện. Mobile dọc mở Pause và yêu cầu xoay ngang; thử khóa hướng khi trình duyệt hỗ trợ, vẫn cho xoay thủ công. Timer, ping, Menu và Back to My Game nằm ở đầu cột trái, ngoài canvas và phía trên chat; jumps chỉ ở Stats/History. Nút dùng Item ở đáy cột phải, ngoài canvas; mobile đặt ngay trên Jump, bảng Players thu/cuộn trong phần chiều cao còn lại. Ping dưới 100 ms xanh, 100–150 ms vàng, trên 150 ms đỏ.

Sound và hướng dẫn phím chỉ ở Pause Menu. Nút cảm ứng/hướng dẫn touch theo khả năng chạm, không theo chiều rộng cửa sổ; desktop hẹp vẫn dùng hướng dẫn bàn phím. Trang chủ có Create Room, Join Public Room và ô Room ID kèm Join trực tiếp, không submenu Room hoặc Options. Mũi tên chọn mục hiện khi hover hoặc focus bàn phím; Tab/Shift+Tab đi qua cả ô Room ID. Mã mời chỉ hiện tại Lobby theo dạng `ROOM ID: <id>`; nhấn mã để sao chép và hiện Copied trong 3 giây kể từ lần sao chép thành công gần nhất, vẫn cho kéo chọn thủ công, không có nút Copy ID riêng. Khi clipboard bị chặn, hiện hướng dẫn sao chép thủ công. F11 do trình duyệt xử lý, không nút Fullscreen. Chỉ ô nhập/mã phòng cho chọn chữ. New Game Community chỉ tại menu sau Save & Exit.

Trên thiết bị có con trỏ chính là cảm ứng (`pointer: coarse`), cụm Left/Right khớp chiều rộng và hai mép ngoài với khung nhập chat (ô nhập và Send); Jump khớp với khung Leaderboard, hoặc Players khi chơi Room. Left/Right chia đều chiều rộng còn lại sau khoảng cách 8 px; nút hướng cao 54 px. Hai cụm thẳng mép trên/dưới, cách khung chat và vùng bảng 8 px khi bảng dùng hết chiều cao được cấp, chừa đáy theo safe area. Khi Fly bật, bốn nút hướng chia hai hàng và Jump giãn bằng chiều cao cả cụm. Các quy tắc này không áp dụng cho desktop có con trỏ chính là chuột.

## Xem người chơi khác

Chọn người connected trong Players cùng Community hoặc Room PLAYING để xem screen/nhân vật/môi trường/NPC/quạ/âm thanh của họ; người được xem rõ 100%, peers 70%. Không điều khiển họ, xem nối tiếp mục tiêu họ đang xem hoặc phát ending của họ.

Room vẫn mô phỏng bản thân/clock; Community Pause bản thân và không tăng active time khi đã paused. Cho chat/menu/đổi mục tiêu; Back to My Game chủ động Resume. Mục tiêu Leave/disconnect/Finish thì về bản thân/menu Resume; Room kết thúc tới Results. Reconnect không khôi phục mục tiêu. AFK không mở menu khi đang xem, mất focus vẫn mở.

## Fly Mode

Cờ server `FLY_ENABLED` mặc định false, cấp quyền mọi Account/kiểu chơi/môi trường; không Options hoặc cheat chat. Khi được phép, nhấn đúp Space/Jump cảm ứng trong 300 ms để bật/tắt bay, chỉ tính lần nhấn sau khi thả, không key repeat; nhấn đầu vẫn Jump bình thường.

Bay ngang 2× walkSpeed, dọc 4×, dùng WASD/mũi tên hoặc touch lên/xuống; Space không làm bay lên. Bay xuyên địa hình, không gravity/charge/splat, giữ biên world. Đổi trạng thái xóa charge/velocity, phải thả Jump trước charge mới. Tắt trong solid thì rơi thẳng không điều khiển/collision tới khi thoát khối; tới đáy vẫn kẹt thì về spawn. Restore save khi cờ tắt dùng cùng xử lý thoát khối.

Vẫn tính save/Stats/History/leaderboard bình thường; client không tự cấp quyền. Cấu hình theo [deployment](deployment.md#fly-mode).

## Nguồn nội dung

Chuyển thể từ Jump King của Nexile; [attribution](../source/client/public/assets/ATTRIBUTION.md) ghi nguồn/tình trạng giấy phép. Giữ attribution bắt buộc; sở hữu game không đồng nghĩa quyền phân phối tài nguyên.
