# Giao tiếp mạng và bảo mật

HTTP JSON tại `/api` phục vụ tài khoản/dữ liệu; WebSocket thuần tại `/ws/game` phục vụ gameplay/chat. Contract dùng version 1. Internet dùng HTTPS/WSS; luật chức năng theo [gameplay](gameplay.md), persistence theo [data](data.md).

![Luồng giao tiếp Room](../statics/protocol.svg)

## Xác thực và bảo mật

- Spring Security quản lý session; cookie host-only, Path=/, HttpOnly, SameSite=Lax và Secure khi HTTPS. HTTP gửi credentials; mutation cần CSRF token. Đăng nhập đổi session ID/CSRF; password băm BCrypt. Rate limit 20 requests/phút/IP và identity.
- Sign In nhận username/password: username chưa tồn tại thì tạo Account, đã có thì xác thực; sai password không tạo/sửa Account. Username 3–32 ký tự chữ/số/underscore/hyphen; password ít nhất 6 Unicode code points, tối đa 72 UTF-8 bytes. Khi tạo trùng username đồng thời, chỉ đăng nhập bằng mật khẩu của Account đã được tạo. Không đổi Account khi còn membership.
- Google Sign-In qua POST /auth/google: gửi idToken từ Google, tự động xác thực và liên kết theo google_id; tên Google được chuẩn hóa thành username hợp lệ.
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
| GET /auth/me | → {authenticated,account:null hoặc {id,username,crownUnlocked}} |
| POST /auth/register | {username,password} → cùng response /auth/me, authenticated=true |
| POST /auth/login | {username,password} → cùng response /auth/me, authenticated=true; Sign In như trên |
| POST /auth/google | {idToken} → cùng response /auth/me, authenticated=true |
| POST /auth/password | {currentPassword,newPassword} → {ok:true} |
| POST /auth/logout | → {ok:true} |
| GET /game-config | → {features:{flyEnabled:boolean},auth:{googleClientId:string|null}} |
| GET /map | → geometry, spawn và Finish |
| GET /rooms | → {rooms:[{roomId,mode,mapLevel,playerCount,capacity}]} |
| GET /rooms/{roomId} | → {roomId,kind,joinable} |
| GET /community/current | Account → {run:RunSummary hoặc null,updatedAt,saveStatus} |
| GET /leaderboard?limit=100 | → {entries:[LeaderboardEntry]} |
| GET /profile/me | Account → {username,total:Statistics} |
| GET /history?page=0&size=20 | Account → {items,page,size,hasNext} |
| GET /history/{kind}/{id} | Owner → chi tiết; kind=COMMUNITY/ROOM, ID lượt/match |

Danh sách phòng chỉ có Public/WAITING còn chỗ. Tra ID không lộ roster/token hoặc cấp quyền Join. History/detail kiểm tra owner, sai owner trả 404. ID Account truyền dưới dạng chuỗi.

| Kiểu dữ liệu | Fields |
| --- | --- |
| RunSummary | id, status, currentProgress, maxProgress, elapsedTimeMs, peakReachedTimeMs, finishTimeMs |
| LeaderboardEntry | RunSummary và rank, username |
| Statistics | totalPlayTimeMs, totalJumps, totalFalls, finishes, matchesPlayed, wins, bestFinishTimeMs |
| History summary | id, kind, status, startedAt, endedAt, playTimeMs, jumps, falls, currentProgress, maxProgress, finishTimeMs, room |
| History room | mode, mapLevel, itemsEnabled, itemCooldownMinutes, roomCode, durationMs, rank, isWinner; null ở Community |
| Room detail | Summary và room.{timeLimitMinutes,endReason,participants} |
| Participant | runId, nickname, status, rank, isWinner, currentProgress, maxProgress, finishTimeMs, playTimeMs, jumps, falls |

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
| UPDATE_ROOM_SETTINGS | Patch {mode?,timeLimitMinutes?,mapLevel?,visibility?,itemsEnabled?,itemCooldownMinutes?} |
| START_GAME / END_MATCH | {} |
| GAME_READY | {playId,generation}; renderer sẵn sàng |
| PLAY_AGAIN | {matchId} |
| SET_COMMUNITY_PAUSED | {paused:boolean} |
| SET_SPECTATE | {playerId:string hoặc null} |
| USE_ITEM | {playId,generation} |
| CHAT_SEND | {text}; plain text, loại control characters |
| PLAYER_INPUT | {playId,generation,seq,left,right,jump,up?,down?,freeFlight?} |
| CANCEL_INPUT | {playId,generation,seq}; hủy charge/input, không launch |
| RECONNECT | {roomId,playerId,reconnectToken} |

Room mặc định RACE/null/mapLevel=10, PRIVATE; Items theo [gameplay](gameplay.md#items-trong-room). ROOM_STATE của Room luôn trả settings đầy đủ, gồm mapLevel; giá trị mặc định chỉ áp dụng tại đầu vào. Chỉ Host/WAITING được sửa settings; patch atomic, mode/timeLimitMinutes phải hợp lệ cùng nhau. Join, Start, End và Play Again tuân thủ lifecycle gameplay.

JOIN_COMMUNITY bắt buộc cả hai fields: Continue gửi false và đúng ID ACTIVE; New Game gửi true với ID ACTIVE hoặc null nếu chưa có. Sai ID/trạng thái trả CONFLICT; hết chỗ/lỗi DB giữ save cũ. Muốn thay lượt đang chơi phải Save & Exit trước.

Input fields là booleans, field tùy chọn mặc định false; movement chỉ áp dụng trong context ACTIVE. freeFlight là trạng thái mong muốn, chỉ nhận true khi server cho phép; up/down điều khiển bay, jump/Space không bay lên. CANCEL_INPUT/timeout không tự tắt bay. USE_ITEM không nhận loại/target/tọa độ; server quyết định, lỗi không tiêu thụ item.

## Server → client

| Type | Payload chính |
| --- | --- |
| ROOM_JOINED | {roomId,kind,playerId,reconnectToken,generation,playId}; riêng owner |
| ROOM_STATE | {roomId,kind,state,visibility?,hostPlayerId,settings,members,currentPlay,result} |
| ROOM_LEFT | {roomId}; có thể null |
| GAME_STARTED | {playId,generation,countdownMs} |
| GAME_SNAPSHOT | {roomId,serverTick,playId,generation,self,peers,players,spectating,elapsedTimeMs,remainingTimeMs,items?} |
| COMMUNITY_RUN_STATE | {run,generation,paused,pausePending,saveStatus} |
| PLAYER_EFFECTS | {roomId,events:[{eventSeq,playerId,playId,screen,effect,terrain}]} |
| ADVENTURE_EVENTS | {roomId,playId,sourcePlayerId,events:[{eventSeq,kind,type,id}]} |
| SPECTATE_STATE | {roomId,playerId:string hoặc null} |
| ITEM_USED | {roomId,playId} |
| PLAYER_FINISHED | {playerId,playId,result,showEnding,ending:{screen,ravenDone}}; riêng owner/winners sau commit |
| GAME_FINISHED | {playId,mapLevel,reason,durationMs,results,saveStatus} |
| SAVE_STATUS | {playId,revision,saveStatus}; revision=null cho Room |
| CHAT_MESSAGE / CHAT_HISTORY | {roomId,messages:[{id,playerId,nickname,text,sentAt,colorSlot}]} |
| RECONNECT_OK | {roomId,playerId,generation,playId}; tiếp theo là full state |
| PONG / ERROR | {nonce} / {code,message,playId?,generation?,seq?} |

kind=COMMUNITY/ROOM. Community state=PLAYING, host/settings=null. currentPlay.countdownRemainingMs bằng 0 khi đợi tải, >0 khi đếm ngược. Member gồm playerId/nickname/username/colorSlot/connected/paused/nextMatchConfirmed; trường không áp dụng là null. Results gồm playerId/nickname/status/rank/currentProgress/maxProgress/isWinner/finishTimeMs; tên giữ lúc tham gia.

Snapshot tách rõ:

- self: lastProcessedInputSeq, status, paused, metrics và simulation={physics,adventure,world} đủ restore/replay, gồm buffers/counters/Fly/phasing fall. Gốc playId/generation/self/ACK luôn thuộc người nhận.
- peers: public render state/tên/màu/crown/status ở screen đang xem và liền kề. players là toàn roster {playerId,nickname,colorSlot,rank,currentProgress}, lấy từ RAM.
- spectating: null hoặc {player,playId,elapsedTimeMs,paused,adventure,world}; chỉ dùng renderer, không thay prediction/checkpoint. Xóa mục tiêu khi reconnect hoặc mất hiệu lực.

Room bật Items có items={held:BANANA|ROCK|null,bananaArmed,cooldownMs,bananas:[{id,x,y,armedAtTick}],rocks:[{id,x,y,direction,tick}]}. Held/cooldown riêng owner; trap/cue lọc theo screen như peers. Banana dùng tâm chân, Rock dùng tâm mục tiêu lúc trúng. physics.slipping chỉ gửi khi true; Community không có items.

Effects JUMP/LAND/SPLAT/BUMP, terrain NORMAL/ICE/SNOW. Âm thanh chuyển động bản thân phát từ prediction, bỏ tiếng trùng từ server và không phát khi replay; peers/spectating dùng events server. Adventure/world events có kind=ADVENTURE/WORLD, chỉ gửi owner hoặc người đang xem owner, nội dung tra bằng ID. Dedupe theo eventSeq/context, không phát lại effects khi replay.

## Đồng bộ và khôi phục kết nối

1. Client gửi full input mỗi tick. Server áp dụng tối đa một frame/player/tick FIFO; thiếu frame giữ input cuối và không tăng ACK, quá timeout thì cancel. Backlog quá hạn khi input mới vẫn tới: đóng 1013/resync, không âm thầm bỏ cạnh nhấn/thả hoặc ACK frame chưa xử lý.
2. ACK/state cùng tick. Client restore snapshot mới hơn, bỏ input đã ACK và replay phần còn lại; đổi playId/generation thì xóa buffers. Peers nội suy có giới hạn, không extrapolate hoặc kéo qua screen/respawn. Nhịp tick theo [architecture](architecture.md#xử-lý-đồng-thời).
3. Mở Pause/menu/chat phải cancel, không tạo release-jump. Heartbeat đo RTT/jitter/stall; RTT không chứng minh one-way latency, packet loss hoặc TCP retransmission.
4. Duplicate requestId cùng type/payload trả kết quả cũ; khác nội dung trả CONFLICT. Timeout control dùng GET_ROOM_STATE/reconnect, không tự gửi lại Start/New Run/End. Bỏ phản hồi socket/context cũ; đóng socket kết thúc pending requests.
5. Mất kết nối/đầy input chưa ACK: dừng input và cho Reconnect/Back to Menu. Reconnect xác thực owner/token, nhận full state/generation trước Resume; không dùng Resume/Save & Exit trên socket đã đóng.
6. Context lưu IndexedDB theo backend origin và Account; chỉ xóa sau Leave được xác nhận hoặc membership hết hạn. Offline Back to Menu không báo Leave/SAVED thành công. ROOM_LEFT chủ động, RECONNECT_EXPIRED/ROOM_NOT_FOUND hoặc roomId=null kết thúc membership, giữ Account/checkpoint.

Pagehide, grace, Pause và chuyển Host theo [gameplay](gameplay.md#leave-và-reconnect). Không chờ client chậm trong vòng tick; gửi snapshot/bảo vệ queue theo [architecture](architecture.md#xử-lý-đồng-thời).

## Giới hạn và xử lý lỗi

| Nhóm | Mặc định |
| --- | --- |
| HTTP body / WS message | 16 KiB |
| Auth / tra phòng | 20 / 60 requests/phút theo IP/identity |
| WS handshake / Create-Join-New Run | 30/phút/IP / 20/phút/IP và identity |
| Connections / phòng | 2/identity, 32/IP, 256/server; 64 phòng kể cả đang reconnect/chờ ghi |
| Input | 120 messages/giây/connection; queue server 120, client 180 frames; timeout 500 ms |
| Outbound | 64 control messages/connection; deadline 5 giây; snapshot gộp bản mới nhất |
| Heartbeat / client deadline | Mỗi 10 giây, hết liveness sau 30 giây; HTTP/handshake/command tối đa 8 giây |
| Chat | 200 code points/tin, 1 tin/giây; giữ 50 tin gần nhất/sảnh trong RAM |

Quota là chính sách cấu hình, không phải năng lực phục vụ đã đo. Validate trước cấp phát/enqueue; quá tải trả RATE_LIMITED hoặc đóng connection, không queue vô hạn hoặc chặn phòng khác.

CHAT_HISTORY chỉ gửi các tin gần nhất vừa giới hạn bytes của message, bỏ tin cũ nếu cần; không chia trang/lô hoặc tăng trần WebSocket cho lịch sử chat. Quota bẫy theo [gameplay](gameplay.md#items-trong-room); đạt trần trả ITEM_UNAVAILABLE trước khi chuẩn bị, kiểm tra lại khi đặt để không tiêu thụ item.

Các mã lỗi: INVALID_MESSAGE, INVALID_INPUT, INVALID_SETTINGS, AUTH_REQUIRED, ACCOUNT_REQUIRED, ROOM_NOT_FOUND, ROOM_FULL, ROOM_NOT_JOINABLE, ALREADY_IN_ROOM, HOST_ONLY, STALE_PLAY, STALE_INPUT, INVALID_RECONNECT, RECONNECT_EXPIRED, INVALID_SPECTATE_TARGET, ITEM_UNAVAILABLE, ITEM_COOLDOWN, INVALID_ITEM_POSITION, NO_ITEM_TARGET, SAVE_FAILED, CONFLICT, RATE_LIMITED, INTERNAL_ERROR. Không lộ thông tin riêng tư hoặc coi lỗi là save rỗng/thành công.
