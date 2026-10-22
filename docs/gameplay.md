# gameplay.md

## Phạm vi và kiểu chơi

Community dùng Main Babe hoàn chỉnh theo geometry, physics, camera và trải nghiệm Jump King gốc. Room chọn một trong 10 độ dài cộng dồn theo vùng; nghiệm thu theo [testing](testing.md).

| Kiểu chơi | Bắt đầu | Tiến độ và thành tích |
| --- | --- | --- |
| Community Tower | Bắt buộc Account; tạo mới hoặc tiếp tục lượt cá nhân | Lưu tiến độ/History trên server; chỉ kiểu chơi này lên leaderboard |
| Room | Account tạo Public/Private, Join Public hoặc bằng ID; chờ Host Start | Cuộc đua cùng xuất phát; lưu History, không lên leaderboard, không checkpoint dài hạn |

Community chỉ có chế độ bình thường; Continue chỉ dành cho lượt chưa kết thúc. Room chọn `RACE`, `HARDCORE`, `TIME_LIMIT` hoặc `NO_WALK`. Players không va chạm nhau. Community không có item; Room có tùy chọn [Items](#items-trong-room).

## Điều khiển và physics

| Điều khiển | Hành động |
| --- | --- |
| A/D hoặc Left/Right | Đi bộ và chọn hướng nhảy; trong No Walk chỉ chọn hướng nhảy; hai hướng cùng lúc là trung tính |
| Space, W hoặc Up | Giữ để charge; thả hoặc đủ lực thì nhảy |
| Escape / nút Menu | Mở menu theo quy tắc Pause của từng kiểu chơi |
| Cảm ứng | Trái/phải và giữ/thả Jump; nhận đồng thời hướng và Jump |
| Tay cầm | D-pad/analog trái, A để nhảy, Start mở menu |

Giá trị native tại timestep trong [architecture](architecture.md#xử-lý-đồng-thời):

| Thông số | Giá trị |
| --- | --- |
| Body | 18 × 26 px |
| Walking / jump ngang | 1.5 / 3.5 px/tick |
| Gravity | float32(153/595) px/tick² |
| Full jump velocity | −float32(34 × gravity) px/tick |
| Max fall speed | 10 px/tick |
| Full charge / direction buffer | 36 ticks / 4 mẫu charge cuối |
| Air charge grace | 2 ticks sau khi rời nền |
| Bounce / ice friction | 0.5 / 0.1 px/tick |
| Splat | 30 ticks |

Movement/collision xảy ra trước input/launch. Lực nhảy tỷ lệ charge/full charge; tick thả vẫn tăng charge trước launch. Charge trên nền thường dừng đi bộ. Launch lấy hướng hiện tại, nếu trung tính thì lấy hướng khác 0 gần nhất trong buffer. Đủ lực tự nhảy; sau đó phải thả toàn bộ phím nhảy trước charge mới.

Trên không không đổi hướng/double jump. Tường đảo vận tốc ngang theo bounce; va trần dừng vận tốc dọc và giảm ngang. Giải collision từng trục với tile/slope, giữ xử lý góc. Splat xảy ra khi tiếp đất ở max fall speed; chỉ đếm xuống khi grounded, hết thời gian mà không có input thì giữ tư thế nằm.

Băng có acceleration đi bộ 0.2 px/tick², vẫn friction khi charge. Tuyết không cho đi bộ: charge ≤20% không launch, >20% đến <30% nâng lên 30%. Rời nền quá air grace thì hủy charge.

Wind chỉ kích hoạt sau grounded trong screen có gió hoặc rơi vào screen gió; tuyết ngăn wind. Với t=ticks/60, phase=t×0.48124886, lực là clamp(2×sin(phase)+(cos(phase)>0?1:-1),−1,1)×0.1 mỗi tick. Tuning tập trung trong shared, không viết lại trong renderer.

Mất focus, menu, chat hoặc disconnect phải cancel input/charge, không tạo release-jump. Touch phải nhả input khi pointer cancel/lost capture; tay cầm lỗi vẫn dùng được bàn phím/cảm ứng.

Tab bị ẩn (visibilitychange/document.hidden), cửa sổ mất focus (window.blur), hoặc không nhấn/thả/đổi input điều khiển trong 1 phút thì mở menu/hủy input. Community yêu cầu Pause; Room chỉ mở menu, không dừng trận. Frame trung tính/giữ nguyên, heartbeat và chat không reset AFK; chat vẫn dùng được khi paused. Quay lại phải chọn Resume để nhận input và bắt đầu lại mốc AFK.

## Map và camera

Main Babe gồm screens 0–42. World rộng 480 px; screen cao 360 px; tile 8 px, 60 cột × 45 hàng. Body dùng góc trên trái; x tăng sang phải, y tăng xuống dưới; đỉnh screen i là −360i.

Spawn chuẩn (231,302), vx=0, vy=1, grounded=true, direction=1; buffers/counters ban đầu rỗng/0. Players cùng spawn, phân biệt bằng ngoại hình. Finish giữ đích gốc: grounded ở screen 42 và tâm body x≥336.

Tile codes: space rỗng, `#` solid, `a/b/c/d` bốn slope, `I` băng, `N` tuyết. Không thêm water/sand/teleport ngoài map; biên x của body clamp trong [−9,471].

Camera nguyên screen 4:3, letterbox; không smooth-follow. Screen ứng viên = clamp(−floor((y+bodyHeight/2)/360),0,42); chỉ đổi khi hướng vận tốc khớp hướng đổi screen, trừ lúc đang lên với |vy|<3. Textures được tải trước khi dựng màn chơi; chỉ hiển thị screen hiện tại.

## Fly Mode

Tính năng thử nghiệm cho Community và cả bốn mode Room, được mở bằng `FLY_ENABLED` theo [deployment](deployment.md#fly-mode). Khi server bật cờ, mọi người được dùng ngay ở mọi môi trường, không có thiết lập riêng theo Account hoặc Options; nhấn Space hai lần trong 300 ms để bắt đầu/tắt bay. Chỉ đếm lần nhấn mới sau khi thả, không tính key repeat; cảm ứng dùng nhấn đúp Jump. Tốc độ bay ngang 3 px/tick (2× tốc độ đi bộ), dọc 6 px/tick (4×); các giá trị và khoảng nhấn đúp tập trung trong shared tuning.

Khi bay, WASD hoặc các mũi tên di chuyển bốn hướng; Space không di chuyển nhân vật khi bay; cảm ứng thêm lên/xuống. Bay xuyên địa hình, không gravity/charge/splat, giữ biên world. Đổi trạng thái bay xóa charge/velocity; không tạo cú nhảy ngoài ý muốn và phải thả Jump trước khi charge tiếp. Khi chưa bay, lần nhấn Space đầu vẫn điều khiển nhảy bình thường, không chờ nhận diện nhấn đúp.

Tắt bay khi đang trong solid: tự rơi thẳng xuống, tạm bỏ collision đến khi toàn bộ body ra ngoài khối rồi khôi phục physics bình thường. Trong lúc thoát khối không nhận movement/charge; nếu tới đáy world vẫn chưa thoát thì đưa về spawn để tránh kẹt. Restore save khi tính năng đã tắt cũng áp dụng cách thoát khối này.

Bay vẫn tính save/Stats/History/xếp hạng/leaderboard bình thường. Community/Room do server mô phỏng; không có mã cheat hoặc lệnh chat.

## Community Tower

Mỗi sảnh tối đa 10 người, gồm slot reconnect còn hạn. Tự tìm sảnh còn chỗ, ưu tiên sảnh đông hơn; không còn chỗ thì tạo sảnh mới. Không chọn Community bằng ID; New Game/Continue tự xếp sảnh. Reconnect hợp lệ giữ membership khi còn hạn.

Một Account có một lượt Community đang lưu và một membership online hoạt động. Trang chủ mở thẳng lượt chơi bằng New Game hoặc Continue. Continue chỉ hiện khi có lượt ACTIVE và phải khôi phục đúng ID; nếu save đã đổi ở tab khác thì báo lỗi/tải lại, không tạo lượt mới. New Game xác nhận thay lượt đang dở, giữ thành tích cũ. Save & Exit rồi Continue giữ state/time; Room không chuyển tiến độ sang Community.

- Pause chỉ tác động bản thân. Nếu đang charge, cancel rồi pause; nếu đang trên không, simulation và clock chạy đến khi grounded ổn định rồi mới pause. Khi đang bay có thể pause ngay và xóa input; trạng thái đang rơi thoát solid phải hoàn tất như cú rơi bình thường.
- Save & Exit lưu state đã ổn định trước khi xác nhận rời. Disconnect xử lý như yêu cầu Pause rồi lưu; không kéo người chơi về checkpoint trước cú rơi.
- Khi còn kết nối, Pause liên tục 15 phút thì lưu và giải phóng slot, đưa về menu; lượt vẫn Continue được. Mốc tính từ lúc server xác nhận paused, tập trung trong shared rules.
- Resume tiếp tục state/time đã lưu; không tính thời gian thực sự paused/offline. Khôi phục sau crash theo [giới hạn kiến trúc](architecture.md#lỗi-và-khả-năng-mở-rộng).

Leaderboard xét thành tích tốt nhất của mỗi Account từ các lượt Community, kể cả lượt đang chơi/đã bỏ. Người Finish đứng trước và so finish time tăng dần; chưa Finish so peak giảm dần rồi active time lúc lần đầu đạt peak tăng dần. Cùng khóa đồng hạng kiểu 1,1,3. Không ghép peak của lượt này với thời gian lượt khác.

## Room và xếp hạng

Room tối đa 10 người; trận đầu Start cần ít nhất một người connected, không cần Ready. ID sáu ký tự từ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; Join by ID chỉ dành cho Room. Người tạo là Host; khi cần chuyển quyền, chọn người connected có joinOrder nhỏ nhất.

```text
WAITING -- Host Start --> COUNTDOWN -- 3 giây --> PLAYING -- finalize --> FINISHED
FINISHED -- Play Again --> WAITING
```

Room Private không được liệt kê, ai biết ID vẫn Join được; Public xuất hiện trong Join Public khi WAITING và còn chỗ. Host chọn visibility/mode/map trước Start. Chỉ WAITING nhận Join mới và cho Host đổi settings; COUNTDOWN/PLAYING/FINISHED chỉ nhận reconnect của thành viên cũ. Start chốt roster; client tải xong màn chơi rồi server đếm ngược 3 giây trước khi chạy physics/clock. Quá 30 giây chưa sẵn sàng hoặc thành viên rời khi chuẩn bị thì hủy về Lobby; không có nút Ready thủ công. FINISHED hiện Results. Ghi trận theo [data](data.md#kết-quả-room).

| Mode | Luật |
| --- | --- |
| RACE | Rơi vẫn tiếp tục; không giới hạn thời gian |
| HARDCORE | Splat đưa nhân vật về spawn để chơi tiếp; giữ clock và thống kê cả trận |
| TIME_LIMIT | Luật di chuyển như Race; Host chọn số phút nguyên 1–30 |
| NO_WALK | Luật kết thúc như Race; input ngang trên nền chỉ chọn hướng, không tạo vận tốc đi bộ; di chuyển ngang bằng nhảy, bounce hoặc quán tính còn lại |

Đồng hồ chung chạy từ hết countdown đến finalize. Menu/chat/đổi tab/mất focus/AFK không dừng physics hoặc clock; không tự rời Room vì mở menu lâu. Khi mọi người disconnect, tạm dừng tick trong hạn reconnect, không có Pause toàn phòng.


Finish đầu tiên kết thúc trận; xử lý hết players của tick đó trước finalize. Những người Finish cùng tick đồng hạng nhất. Time Limit hết giờ thì chốt state ở deadline; Finish hợp lệ tại tick deadline được xét trước timeout. Host End được dùng khi PLAYING.

Người Finish đứng đầu theo finish time. Người còn lại so current progress giảm dần, thêm peak giảm dần riêng Time Limit, rồi thời gian trận tăng dần. Vì dùng cùng clock, các khóa bằng nhau đồng hạng; ID chỉ ổn định hiển thị. Chưa ai Finish thì không có winner.

Progress = max(0, originFeetY−feetY); peak là progress cao nhất từng đạt. `currentProgress` chỉ cập nhật theo progress khi `grounded && splat == 0 && !phasingFall`, các trạng thái khác giữ giá trị lần tiếp đất hợp lệ gần nhất; `maxProgress` vẫn tính theo progress tức thời. Không làm tròn trước so sánh. Hardcore reset current về spawn, giữ peak và số lần rơi; không reset clock.

### Độ dài Room

Có 10 mốc Finish tăng dần từ chân tháp; map 10 là Main Babe đầy đủ. `source/common/room-maps.json` xác định đích trong đúng vùng của từng map; dùng nguyên geometry/spawn. Map 1–9 yêu cầu đáp đúng mặt nền đã đánh dấu, xác định bởi screen, minCenterX và minProgress; maxCenterX giới hạn đoạn nền khi cần. Không tính nền khác dù cao hơn. Map 10 giữ đích gốc. Host chọn trước Start, settings giữ khi Play Again. Map 1–9 chỉ Results, map 10 giữ ending. History lưu map của trận; Best Finish Time chỉ tính full map. Kiểm chứng các mốc bằng replay input hợp lệ từ spawn chuẩn ở cả hai simulation.

Room hiện cờ ca-rô và chữ FINISH tại một platform đủ điều kiện ở màn đích của map đã chọn. Dấu chỉ dẫn không đổi collision hoặc luật Finish; đang bay qua đích chưa tính hoàn thành.

## Items trong Room

Host chọn Items (mặc định Off) tại Lobby, cùng các settings của phòng; Item Cooldown là số phút nguyên 1–15, mặc định 3. Chỉ đổi trước Start, giữ settings qua Play Again. Áp dụng cho cả bốn mode; không Inventory hoặc chọn loại item.

- Hết countdown, server cấp ngẫu nhiên Banana/Rock 50/50, mỗi người một ô. Click/chạm nút vật phẩm để dùng. Dùng thành công mới bắt đầu hồi chiêu; hết hồi cấp ngẫu nhiên tiếp, không tích trữ/cấp đè vật phẩm đang giữ. Không dùng trong menu/chat/spectating, khi charge/splat/trượt/Fly/phasing; Rock dùng được trên không.
- Banana: click khi đứng trên nền để chuẩn bị, click lại hủy. Cú bật nhảy thật trên nền tiếp theo để lại vỏ chuối tại chân lúc nhảy và bắt đầu hồi chiêu. Air grace/đặt trùng bẫy không tiêu thụ vật phẩm, hủy chuẩn bị. Bẫy hoạt động từ tick tiếp theo, không trúng người đang bay lên. Không có TTL, rời phòng không xóa bẫy; một người giẫm thì bẫy mất, kể cả chủ. Nhiều người cùng chạm một tick chỉ một người trúng, theo thứ tự roster.
- Rock: server nhắm người khác connected/ACTIVE có progress thực tế cao nhất (kể cả đang nhảy), không dùng peak hoặc currentProgress của lần tiếp đất; bằng nhau chọn theo roster. Loại mục tiêu Fly/phasing/splat. Không có mục tiêu thì giữ item. Hất ngang từ người ném tới mục tiêu, cùng x dùng hướng người ném; hủy lực đi lên để bắt đầu rơi. Đá đánh trúng trực tiếp, đường bay chỉ minh họa, không projectile/né/va tường.
- Hai item gây cùng trạng thái trượt: vận tốc ngang ban đầu 4× walkSpeed, Banana dùng hướng vận tốc hiện tại hoặc hướng quay nếu đứng yên. Không ma sát/đổi hướng/charge trong khi trượt; không cộng dồn lực khi trúng thêm. Gravity/collision thật vẫn chạy; hết trượt khi va tường/biên hoặc rơi rồi đáp nền mới. Có thể bị tường chặn nên không bảo đảm mọi cú trượt đều làm rơi khỏi bệ. Trượt không tự tăng falls/respawn Hardcore; SPLAT thật vẫn áp dụng luật mode. Hình bẫy nhỏ, màu dịu nhưng nhìn được.
- Item/hồi chiêu/bẫy giữ qua reconnect; menu/respawn không reset, all-offline ngừng tick thì hồi chiêu ngừng. Kết thúc ván xóa runtime item; ván mới cấp lại. State thuộc server trong RAM; tuning ở shared rules/physics, persistence theo [data](data.md#kết-quả-room).

## Leave và reconnect online

Chủ động rời page (`pagehide`) hoặc điều hướng ra khỏi context online yêu cầu Leave; khi page còn hoạt động, client chờ xác nhận trước khi đóng socket/chuyển màn. Chuyển Game → Results/Lobby, đổi tab và blur không phải Leave. Khi page bị đóng, frame Leave chỉ được gửi best effort; nếu server chưa nhận được hoặc mất kết nối bất thường thì hủy input và giữ slot 5 phút từ lúc phát hiện disconnect. Reconnect cần đúng identity/token, không tự bật lại điều khiển. Với Community, hạn disconnect thay hạn Pause; reconnect khi còn paused bắt đầu lại hạn Pause. Các mốc AFK/Pause/reconnect tập trung trong shared rules.

Room giữ slot reconnect tối đa 5 phút. Khi còn người connected, trận tiếp tục; khi mọi người offline, ngừng tick đến lúc có reconnect hoặc hết hạn rồi finalize. Leave/hết hạn reconnect chốt DNF, đóng băng metrics.

Host disconnect/Leave chuyển quyền ngay, giữ nguyên tiến độ trận. Không ai connected thì Host=null; người reconnect đầu tiên nhận quyền, người về sau không giành lại Host. Leave là bỏ membership; nếu mọi người Leave thì đóng Room, xử lý kết quả theo [data](data.md#kết-quả-room).

Community giữ lượt theo Account dù slot hết hạn; sảnh mới cũng Continue được. Room chỉ khôi phục từ RAM khi phòng còn tồn tại; restart theo [architecture](architecture.md#lỗi-và-khả-năng-mở-rộng). Room giải tán sau khi đã vào gameplay phải finalize một lần; hủy trước gameplay không ghi kết quả.

Sau Results, mỗi người chọn Play Again để xác nhận ván mới. Người chọn đầu tiên đưa phòng về WAITING; người còn lại vẫn phải xác nhận, người Join mới được tính đã xác nhận. Giữ room code/settings/thành viên và History cũ. Host Start khi bản thân đã xác nhận và đang connected; chỉ nhóm này vào roster, các thành viên khác trở về menu. Start tạo match/lượt mới và reset state/clock; xóa xác nhận cũ khi trận kết thúc.

## Nội dung game

Chỉ triển khai Main Babe; không mở rộng campaign/DLC khác.

Timer luôn hiện; không hiển thị số lần nhảy trong HUD. Jumps vẫn được đếm cho Stats/History.

Tên vùng hiện ngay khi vào màn đầu của vùng, trong 6 giây; Colossal Drain bắt đầu từ màn 6 (index 5). Mốc khám phá và thời điểm hiệu ứng thuộc từng lượt, lưu trong checkpoint Community; rơi xuống, respawn, Continue hoặc reconnect không phát lại từ đầu. Lượt mới reset; tới vùng cao hơn bỏ qua tên các vùng thấp đã vượt qua. Menu tạm giữ hiệu ứng, ending không hiển thị tên vùng.

NPC/hội thoại, bảng/sách/nhật ký và môi trường thuộc Main Babe; đọc/hội thoại không trực tiếp yêu cầu Pause. Không có Inventory, nhặt/mua vật phẩm hoặc quest nhận đồ. Hội thoại/trigger không phụ thuộc vật phẩm; ending không có credit.

Hoàn thành Community hoặc Room map 10 tự mở vương miện trên Account cho các lượt sau; Room ngắn không mở vương miện. Màu của mỗi người nhất quán trên mọi client; bản thân opacity=1 và vẽ trên peers opacity=0.7. Nickname rõ và hội thoại vẽ trên tên.

Quạ Main Babe có 14 điểm đậu; tới gần trong bán kính 40 px khiến quạ kêu và bay tới điểm kế tiếp. Tiến độ riêng từng lượt; Community lưu qua Continue, Room khởi tạo lại mỗi ván. Đuổi quạ ở điểm cuối rồi Finish full map thì quạ thay thiên thần trao vương miện; không có vật phẩm nhận từ quạ, không đổi physics hoặc xếp hạng.

Quạ trắng là chi tiết môi trường với 17 điểm đậu trong Main Babe, dùng cùng cơ chế đuổi/lưu tiến độ riêng. Sau điểm cuối nó bay đi; không có vật phẩm, nhiệm vụ hoặc ảnh hưởng ending.

Ending giữ cảnh/nhạc/ảnh kết thúc và Skip, bỏ credit. Community chỉ người Finish xem; Room chỉ winners xem, người khác tới Results. End/timeout chưa có Finish không phát ending. Ending không đổi kết quả/thời gian, xử lý một lần theo runId/matchId và hủy khi chuyển lượt.

Server cấp một trong 10 ngoại hình riêng cho mỗi membership, giữ qua reconnect và giải phóng khi rời. Mọi player online dùng username của Account; kết quả Room giữ tên lúc Join. Trạng thái hiển thị không tác động hitbox/physics.

## Thống kê và History

Thống kê chỉ có tổng: active play time, jumps/falls, số lượt Finish, số trận/thắng Room và best finish time. Nhảy tính khi launch, ngã khi splat, thắng chỉ tính Room; respawn/lượt mới không xóa số liệu cũ. Lượt chưa Finish không có finish time. Nguồn số liệu và chống cộng trùng theo [data](data.md#history-và-leaderboard).

History gồm các lượt Community đã kết thúc và các trận Room đã finalize, chỉ Account sở hữu được xem. Continue/Pause/Save & Exit không tạo mục mới; cùng lượt/trận chỉ có một mục.

Community và Room có chat riêng theo sảnh; chat hủy input nhưng không trực tiếp Pause. AFK áp dụng theo [điều khiển](#điều-khiển-và-physics); định dạng, giới hạn và lưu chat theo [protocol](protocol.md).

Assets có manifest; `source/client/public/assets/ATTRIBUTION.md` ghi nguồn và tình trạng giấy phép của từng nhóm. Không gán giấy phép mã nguồn mở cho tài nguyên khi chưa có căn cứ; sở hữu bản game không mặc nhiên cấp quyền phân phối lại.

## Chat và bảng trong trận

Lobby luôn hiện chat và ô nhập. Trong trận, chat cố định ở góc dưới bên trái, hiển thị tối đa 10 tin gần nhất và tự cuộn xuống tin mới; không tự lấy focus. Enter mở/focus ô nhập hoặc gửi; Esc hoặc gửi thành công trả input cho game, khung chat vẫn hiện. Không bắt phím từ form khác hoặc che nút cảm ứng. Chat không đi vào database.

Players là thứ hạng hiện tại trong cùng phòng: Room theo comparator mode, Community theo độ cao hiện tại và đồng hạng khi bằng nhau. Server tính từ state RAM. Các bảng mặc định hiển thị gọn, danh sách dài cuộn riêng và không che nút cảm ứng. Mobile cho thu gọn Chat và Leaderboard, giữ nội dung/nháp; Players vẫn hiện. Leaderboard dùng thành tích đã commit, tải khi vào trận hoặc nhấn Refresh; không polling hoặc tải lại khi mở bảng đã thu gọn. Community chỉ bắt đầu lượt mới từ menu sau Save & Exit.

## Xem người chơi khác

Nhấn tên trong bảng Players để xem người đang kết nối trong cùng sảnh Community hoặc Room đang PLAYING; không xem qua leaderboard toàn server. Camera tự chuyển theo screen của mục tiêu, cùng nhân vật, môi trường, NPC/hội thoại, quạ và âm thanh. Người được xem rõ 100%, các nhân vật khác 70%. Luôn theo nhân vật của mục tiêu, không theo lựa chọn xem của họ. Không điều khiển được khi đang xem; vẫn dùng chat/menu và chọn người khác.

Back to My Game trở lại nhân vật của mình. Room vẫn mô phỏng nhân vật và đồng hồ trận; không đóng băng hoặc tránh cú rơi. Community yêu cầu Pause bản thân theo quy tắc hiện có, giữ giới hạn 15 phút; xem không tăng active time khi đã paused. Thoát chế độ xem chủ động tiếp tục lượt của mình; mục tiêu rời/mất kết nối/Finish thì trở về góc nhìn bản thân với menu Resume. Room kết thúc vẫn tới Results; không phát ending của mục tiêu. Reconnect không khôi phục mục tiêu đang xem. Thiếu input không tự mở menu khi đang xem; mất focus vẫn mở menu.
