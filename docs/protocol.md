# Giao tiếp mạng và bảo mật

HTTP JSON tại `/api` phục vụ tài khoản/dữ liệu; WebSocket thuần tại `/ws/game` phục vụ gameplay/chat. Contract dùng version 1. Internet dùng HTTPS/WSS; luật chức năng theo [gameplay](gameplay.md), persistence theo [data](data.md).

![Luồng giao tiếp Room](../statics/protocol.svg)

## Xác thực và bảo mật

- Spring Security quản lý session; cookie host-only, Path=/, HttpOnly, SameSite=Lax mặc định và Secure khi HTTPS; frontend khác site theo [deployment](deployment.md#cloudflare-pages-và-vps). HTTP gửi credentials; mutation cần CSRF token. Đăng nhập đổi session ID/CSRF; password băm BCrypt. Auth giới hạn 20 requests/phút/IP; xác thực hoặc đổi mật khẩu còn giới hạn theo Account ID trước BCrypt, kể cả username khác chữ hoa/dấu cùng trỏ tới một Account.
- Sign In nhận username/password: username chưa tồn tại thì tạo Account, đã có thì xác thực; sai password không tạo/sửa Account. Username 3–32 ký tự chữ/số/underscore/hyphen; password ít nhất 6 Unicode code points, tối đa 72 UTF-8 bytes. Khi tạo trùng username đồng thời, chỉ đăng nhập bằng mật khẩu của Account đã được tạo. Không đổi Account khi còn membership.
- Google Sign-In tùy chọn qua POST /auth/google: backend cung cấp Client ID theo [deployment](deployment.md), xác minh chữ ký/audience/issuer/thời hạn bằng GoogleIdTokenVerifier rồi nhận diện theo google_id; không ghép Account theo email. Khóa công khai được thư viện cache, không gửi ID token tới tokeninfo. Client ID rỗng thì ẩn nút và từ chối endpoint; tên Google được chuẩn hóa thành username hợp lệ.
- Logout hủy phiên. Đổi mật khẩu cần currentPassword, chỉ thành công sau commit và thu hồi mọi phiên/socket của Account; tài khoản chỉ dùng Google trả CONFLICT. Không có email hoặc khôi phục mật khẩu.
- Session idle/absolute và cookie đều 30 ngày; heartbeat không gia hạn idle. Hết phiên xử lý như disconnect, giữ checkpoint. Restart giữ phiên còn hạn, không gia hạn deadline; cấu hình theo [deployment](deployment.md#giữ-phiên-đăng-nhập).
- CORS/WS kiểm tra Origin trong allowlist; không wildcard với credentials, preflight trước authentication. WS bắt buộc Account, owner/tên lấy từ session. Kiểm tra lại quyền và state khi thực thi lệnh.
- Reconnect token ngẫu nhiên 256 bit, so sánh constant-time, chỉ gửi owner, thu hồi khi membership kết thúc. Không đưa password/token/stack trace vào URL, broadcast hoặc log; không trả Entity/credentials/checkpoint qua API dữ liệu.

## HTTP

Các path có prefix `/api`. Lỗi dạng `{error:{code,message}}`; không cache auth/private. Timestamp dùng ISO-8601 UTC, thời lượng dùng ms; chưa Finish là null.

| Method/path | Request → response |
| --- | --- |
| GET /health | Trạng thái ứng dụng |
| GET /auth/csrf | → {token,headerName} |
| GET /auth/me | → {authenticated,account:null hoặc {id,username,crown,hasPassword}}; crown=NONE/GOLD/BLACK |
| POST /auth/login | {username,password} → cùng response /auth/me, authenticated=true; Sign In như trên |
| POST /auth/google | {idToken} → cùng response /auth/me, authenticated=true |
| POST /auth/password | {currentPassword,newPassword} → {ok:true} |
| POST /auth/logout | → {ok:true} |
| GET /game-config | → {features:{flyEnabled:boolean},auth:{googleClientId:string|null}} |
| GET /map | → geometry, spawn và Finish |
| GET /rooms | → {rooms:[{roomId,mode,mapId,itemCooldownMinutes,timeLimitMinutes,playerCount,capacity}]} |
| GET /rooms/{roomId} | → {roomId,kind,joinable} |
| GET /community/current | Account → {run:RunSummary hoặc null,updatedAt,saveStatus} |
| GET /leaderboard?limit=100 | → {entries:[LeaderboardEntry]} |
| GET /profile/me | Account → {username,total:Statistics} |
| GET /history?page=0&size=20 | Account → {items,page,size,hasNext} |
| GET /history/{kind}/{id} | Owner → chi tiết; kind=COMMUNITY/ROOM, ID lượt/match |

Danh sách phòng chỉ có Public/WAITING còn chỗ. Room ID là chuỗi 6 chữ số ASCII, không đổi thành number để giữ số 0 đầu. Tra ID không lộ roster/token hoặc cấp quyền Join. History/detail kiểm tra owner, sai owner trả 404. ID Account truyền dưới dạng chuỗi.

| Kiểu dữ liệu | Fields |
| --- | --- |
| RunSummary | id, status, currentProgress, maxProgress, elapsedTimeMs, peakReachedTimeMs, finishTimeMs |
| LeaderboardEntry | RunSummary và rank, username |
| Statistics | totalPlayTimeMs, totalJumps, totalFalls, finishes, matchesPlayed, roomWins, bestFinishTimeMs |
| History summary | id, kind (derived from matchId), status, startedAt, endedAt, playTimeMs, jumps, falls, currentProgress, maxProgress, finishTimeMs, room |
| History room | mode, mapId, itemCooldownMinutes (nullable; null nghĩa là Items tắt), roomCode, durationMs, rank; null ở Community |
| Room detail | Summary và timeLimitMinutes, endReason, participants ở cấp ngoài cùng |
| Participant | runId, username, status, rank, currentProgress, maxProgress, finishTimeMs, playTimeMs, jumps, falls |

Page là integer 0–100000; size/limit 1–100. Status: 400 validation, 401 xác thực, 403 quyền/CSRF/Origin, 404 không có, 409 conflict, 429 quota, 5xx lỗi nội bộ. Client xử lý error code, không parse message hoặc coi lỗi là dữ liệu rỗng.

## WebSocket envelope

```json
{"v":1,"type":"PLAYER_INPUT","payload":{"playId":"00000000-0000-4000-8000-000000000001","generation":1,"seq":1,"left":false,"right":true,"jump":true}}
```

- Mọi message có v/type/payload. Control commands có requestId 1–64 ký tự; PLAYER_INPUT/CANCEL_INPUT không có. Response riêng giữ requestId; broadcast không mang requestId của người gửi.
- Reject version/type/field lạ, duplicate JSON keys, trailing data, số không hữu hạn hoặc sai kiểu; không tự đổi string thành boolean/number.
- playId là run ID Community hoặc match ID Room; generation tăng khi reconnect, đổi lượt hoặc Resume Community. seq là integer dương an toàn trong JSON, tăng trong context.
- Client chỉ gửi ý định điều khiển; không gửi position, velocity, score, clock hoặc checkpoint chính thức.

## Client → server

| Type | Payload |
| --- | --- |
| HEARTBEAT | {nonce} |
| JOIN_COMMUNITY | {newRun:boolean,expectedRunId:string hoặc null} |
| CREATE_ROOM | {settings?} |
| JOIN_ROOM | {roomId} |
| LEAVE_ROOM / GET_ROOM_STATE | {} |
| UPDATE_ROOM_SETTINGS | Patch {mode?,timeLimitMinutes?,mapId?,visibility?,itemCooldownMinutes?}; timeLimitMinutes=null là không giới hạn, itemCooldownMinutes=null là tắt Items, số phút bật Items và đặt cooldown |
| START_GAME / END_MATCH | {} |
| SET_ROOM_PAUSED | {paused:boolean}; chỉ Host trong Room khi PLAYING hoặc PAUSED |
| SET_ROOM_CONFIRMED | {confirmed:boolean}; chỉ thay đổi bản thân trong Room/WAITING |
| KICK_PLAYER | {playerId}; chỉ Host trong Room/WAITING, không chọn bản thân |
| GAME_READY | {playId,generation}; renderer sẵn sàng. Host bắt đầu countdown; người tải chậm được ACK trong PLAYING nếu cùng context, không khởi động lại countdown |
| PLAY_AGAIN | {matchId} |
| SET_COMMUNITY_PAUSED | {paused:boolean} |
| SET_SPECTATE | {playerId:string hoặc null} |
| USE_ITEM | {playId,generation} |
| CHAT_SEND | {text}; plain text, loại control characters |
| PLAYER_INPUT | {playId,generation,seq,left,right,jump,up?,down?,freeFlight?} |
| CANCEL_INPUT | {playId,generation,seq}; hủy charge/input, không launch |
| RECONNECT | {roomId,playerId,reconnectToken} |

Room mặc định RACE/không giới hạn/mapId=1/Items tắt/PUBLIC; Items theo [gameplay](gameplay.md#items-trong-room). ROOM_STATE của Room luôn trả settings đầy đủ, gồm mapId và itemCooldownMinutes; giá trị mặc định chỉ áp dụng tại đầu vào. Chỉ Host/WAITING được sửa settings; `timeLimitMinutes` là độc lập với mode, null nghĩa là không giới hạn và giá trị có hiệu lực là 1–10. `itemCooldownMinutes` null nghĩa là Items tắt; giá trị 1–5 bật Items và đặt cooldown. Backend kiểm tra giới hạn; database chỉ lưu giá trị nullable.

JOIN_COMMUNITY bắt buộc cả hai fields: Continue gửi false và đúng ID ACTIVE; New Game gửi true với ID ACTIVE hoặc null nếu chưa có. Sai ID/trạng thái trả CONFLICT; hết chỗ/lỗi DB giữ save cũ. Muốn thay lượt đang chơi phải Save & Exit trước.

`kind` trong API là giá trị backend suy ra: `matchId` null là COMMUNITY, có giá trị là ROOM. Database không lưu thêm cột kind. Username trong lịch sử Room lấy từ Account hiện tại, không lưu nickname riêng theo lượt. Room Results/History chỉ dùng rank; mọi `endReason` đều chốt thứ hạng và không có trường winner riêng.

Input fields là booleans, field tùy chọn mặc định false; movement chỉ áp dụng trong context ACTIVE. freeFlight là trạng thái mong muốn, chỉ nhận true khi server cho phép; up/down điều khiển bay, jump/Space không bay lên. CANCEL_INPUT/timeout không tự tắt bay. USE_ITEM không nhận loại/target/tọa độ; server quyết định, lỗi không tiêu thụ item.

## Server → client

| Type | Payload chính |
| --- | --- |
| ROOM_JOINED | {roomId,kind,playerId,reconnectToken,generation,playId}; riêng owner |
| ROOM_STATE | {roomId,kind,state,visibility?,hostPlayerId,settings,members,currentPlay,result} |
| ROOM_LEFT | {roomId,reason?}; roomId có thể null; reason=KICKED khi Host đưa ra khỏi Lobby |
| GAME_STARTED | {playId,generation,countdownMs} |
| GAME_SNAPSHOT | {roomId,serverTick,playId,generation,self,peers,players,spectating,elapsedTimeMs,remainingTimeMs,items?} |
| COMMUNITY_RUN_STATE | {run,generation,paused,pausePending,saveStatus} |
| PLAYER_EFFECTS | {roomId,events:[{eventSeq,playerId,playId,screen,effect,terrain}]} |
| ADVENTURE_EVENTS | {roomId,playId,sourcePlayerId,events:[{eventSeq,kind,type,id}]} |
| SPECTATE_STATE | {roomId,playerId:string hoặc null} |
| ITEM_USED | {roomId,playId} |
| PLAYER_FINISHED | {playerId,playId,result,showEnding,ending:{screen,ravenDone,crown}}; gửi sau khi lưu kết quả đủ điều kiện phát ending; crown=GOLD/BLACK đã sở hữu |
| GAME_FINISHED | {playId,mapId,reason,durationMs,results,saveStatus} |
| SAVE_STATUS | {playId,revision,saveStatus}; revision=null cho Room |
| CHAT_MESSAGE / CHAT_HISTORY | {roomId,messages:[{id,playerId,nickname,text,sentAt,colorSlot}]} |
| RECONNECT_OK | {roomId,playerId,generation,playId}; tiếp theo là full state |
| PONG / ERROR | {nonce} / {code,message,playId?,generation?,seq?} |

kind=COMMUNITY/ROOM. Community state=PLAYING, host/settings=null. Room state=WAITING/COUNTDOWN/PLAYING/PAUSED/FINISHED. currentPlay.countdownRemainingMs bằng 0 khi đợi Host tải, >0 khi đếm ngược. Member gồm playerId/nickname/colorSlot/connected/paused/nextMatchConfirmed; Room thêm nextMatchJoined để phân biệt người đã vào Lobby ván tiếp theo với trạng thái Confirmed. Create/Join và Play Again đặt nextMatchJoined=true, hết trận đặt false; Cancel Confirm không đổi trường này. Trường không áp dụng là null. Results gồm playerId/nickname/status/rank/currentProgress/maxProgress/finishTimeMs; tên lấy từ username.

Snapshot tách rõ:

- self: lastProcessedInputSeq, status, paused, crown và simulation={physics,adventure,world} đủ restore/replay, gồm buffers/counters/Fly/phasing fall; Easy có world.safePosition={x,y} để đồng bộ điểm an toàn khi SPLAT. Gốc playId/generation/self/ACK luôn thuộc người nhận; metrics để tính Stats/History/checkpoint không lặp trong snapshot gameplay.
- peers: public render state/tên/màu/crown/status ở screen đang xem và liền kề; positionRevision tăng mỗi lần server respawn, chỉ ở RAM để phân biệt dịch chuyển tức thời với chuyển động liên tục. players là toàn roster {playerId,nickname,colorSlot,rank,currentProgress}, lấy từ RAM.
- spectating: null hoặc {player,playId,elapsedTimeMs,paused,adventure,world}; chỉ dùng renderer, không thay prediction/checkpoint. Xóa mục tiêu khi reconnect hoặc mất hiệu lực.

Room bật Items có items={held:BANANA|ROCK|BOOTS|null,bananaArmed,cooldownMs,bananas:[{id,x,y,armedAtTick}],rocks:[{id,x,y,direction,tick}]}. Held/cooldown riêng owner; trap/cue lọc theo screen như peers. Banana dùng tâm chân, Rock dùng tâm mục tiêu lúc trúng. physics.slipping và physics.jumpBoost chỉ gửi khi true; jumpBoost cho phép prediction/replay cú nhảy Boots đúng state server. Community không có items. Crown trong self/peers/spectating.player dùng NONE/GOLD/BLACK, tách khỏi tiến độ adventure của lượt.

Effects JUMP/LAND/SPLAT/BUMP, terrain NORMAL/ICE/SNOW. Âm thanh chuyển động bản thân phát từ prediction, bỏ tiếng trùng từ server và không phát khi replay; peers/spectating dùng events server. Adventure/world events có kind=ADVENTURE/WORLD, chỉ gửi owner hoặc người đang xem owner, nội dung tra bằng ID. Dedupe theo eventSeq/context, không phát lại effects khi replay.

## Đồng bộ và khôi phục kết nối

1. Client gửi full input mỗi tick. Server áp dụng tối đa một frame/player/tick FIFO; thiếu frame giữ input cuối và không tăng ACK, quá timeout thì cancel. Backlog quá hạn khi input mới vẫn tới: đóng 1013/resync, không âm thầm bỏ cạnh nhấn/thả hoặc ACK frame chưa xử lý.
2. ACK/state cùng tick. Client restore snapshot mới hơn, bỏ input đã ACK và replay phần còn lại; đổi playId/generation thì xóa buffers. Peers nội suy với buffer 50 ms, không extrapolate; snap khi positionRevision/screen/falls đổi hoặc ticks lùi, không dùng ngưỡng khoảng cách cố định để đoán teleport. Nhịp tick theo [architecture](architecture.md#xử-lý-đồng-thời).
3. Mở Pause/menu/chat phải cancel, không tạo release-jump. Heartbeat đo RTT/jitter/stall; RTT không chứng minh one-way latency, packet loss hoặc TCP retransmission.
4. Duplicate requestId cùng type/payload trả kết quả cũ; khác nội dung trả CONFLICT. Timeout control dùng GET_ROOM_STATE/reconnect, không tự gửi lại Start/New Run/End. Bỏ phản hồi socket/context cũ; đóng socket kết thúc pending requests.
5. Mất kết nối/đầy input chưa ACK: dừng input và cho Reconnect/Back to Menu. Reconnect xác thực owner/token, nhận full state/generation trước Resume; không dùng Resume/Save & Exit trên socket đã đóng.
6. Context lưu IndexedDB theo backend origin và Account; chỉ xóa sau Leave được xác nhận hoặc membership hết hạn. Offline Back to Menu không báo Leave/SAVED thành công. ROOM_LEFT chủ động, RECONNECT_EXPIRED/ROOM_NOT_FOUND hoặc roomId=null kết thúc membership, giữ Account/checkpoint.
7. Lobby Room có nút Reconnect và tự thử lại tối đa 5 lần với thời gian chờ 1/2/4/8/16 giây; khi trình duyệt báo offline thì chờ sự kiện online. Hai thao tác dùng chung một yêu cầu khôi phục, không mở thêm socket khi đang kết nối. Hết lượt tự động vẫn cho thử thủ công. Ý định Leave dừng tự khôi phục ngay cả khi mất ACK; vẫn giữ context tới khi server xác nhận. Rời Lobby hoặc membership kết thúc thì dọn timer/listener; không áp dụng tự reconnect cho Community hoặc game đang chạy.

KICK_PLAYER giải phóng membership/token ngay cả khi mục tiêu offline; socket cũ và RECONNECT với token đó không khôi phục được phòng. CHAT_SEND bị từ chối vẫn trả ERROR có requestId như cũ; client chỉ hiển thị lỗi của lệnh này trong Chat, giữ lỗi của lệnh khác ở nơi đang xử lý.

Pagehide, grace, Pause và chuyển Host theo [gameplay](gameplay.md#leave-và-reconnect). Không chờ client chậm trong vòng tick; gửi snapshot/bảo vệ queue theo [architecture](architecture.md#xử-lý-đồng-thời).

## Giới hạn và xử lý lỗi

| Nhóm | Mặc định |
| --- | --- |
| HTTP body / WS message | 16 KiB |
| Auth / đọc Rooms và leaderboard | 20/phút/IP và Account cho auth; chung 60/phút/IP cho Rooms/leaderboard |
| WS handshake / Create-Join-New Run | 30/phút/IP / 20/phút/IP và identity |
| Connections / phòng | 2/identity, 32/IP, 256/server; 64 phòng kể cả đang reconnect/chờ ghi |
| Input | 120 messages/giây/connection; queue server 120, client 180 frames; timeout 500 ms |
| Outbound | 64 control messages/connection; deadline 5 giây; snapshot gộp bản mới nhất |
| Heartbeat / client deadline | Mỗi 10 giây, hết liveness sau 30 giây; HTTP/handshake/command tối đa 8 giây |
| Chat | 200 code points/tin, 1 tin/giây; giữ 30 tin gần nhất/sảnh trong RAM |

Quota là chính sách cấu hình, không phải năng lực phục vụ đã đo. Validate trước cấp phát/enqueue; quá tải trả RATE_LIMITED hoặc đóng connection, không queue vô hạn hoặc chặn phòng khác.

CHAT_HISTORY chỉ gửi các tin gần nhất vừa giới hạn bytes của message, bỏ tin cũ nếu cần; không chia trang/lô hoặc tăng trần WebSocket cho lịch sử chat. Quota bẫy theo [gameplay](gameplay.md#items-trong-room); đạt trần trả ITEM_UNAVAILABLE trước khi chuẩn bị, kiểm tra lại khi đặt để không tiêu thụ item.

Các mã lỗi: INVALID_MESSAGE, INVALID_INPUT, INVALID_SETTINGS, AUTH_REQUIRED, ACCOUNT_REQUIRED, ROOM_NOT_FOUND, ROOM_FULL, ROOM_NOT_JOINABLE, ALREADY_IN_ROOM, HOST_ONLY, STALE_PLAY, STALE_INPUT, INVALID_RECONNECT, RECONNECT_EXPIRED, INVALID_SPECTATE_TARGET, ITEM_UNAVAILABLE, ITEM_COOLDOWN, INVALID_ITEM_POSITION, NO_ITEM_TARGET, SAVE_FAILED, CONFLICT, RATE_LIMITED, INTERNAL_ERROR. Không lộ thông tin riêng tư hoặc coi lỗi là save rỗng/thành công.
