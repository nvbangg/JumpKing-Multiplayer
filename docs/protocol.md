# protocol.md

## Phạm vi

HTTP JSON `/api`, raw WebSocket `/ws/game`, contract version 1. Community/Room nhận map từ server; tuning dùng common trong cùng bản phát hành. Luật/lifecycle theo [gameplay](gameplay.md), ownership/persistence theo [data](data.md).

![Luồng giao tiếp Room](../statics/protocol.svg)

## Identity và security

Account dùng Spring Security server-side session, không JWT. Cookies HttpOnly, SameSite=Lax, Path=/, host-only; Secure theo [deployment](deployment.md#cấu-hình).

HTTP dùng credentials:include và CSRF trước mutation. Login/Register đổi session ID/CSRF; Logout hoặc đổi mật khẩu hủy session. Đổi mật khẩu yêu cầu Account, currentPassword/newPassword, validate/hash như Register; chỉ trả thành công sau commit và thu hồi các phiên/socket của Account. Chưa có khôi phục mật khẩu.

CORS nhận origins cụ thể, preflight trước authentication. WS yêu cầu Account và Origin trong allowlist; không tin tên/owner do client gửi. Login Account khác khi còn membership bị từ chối; đăng nhập lại đúng Account để reconnect vẫn cần token cũ. Session idle và absolute đều 30 ngày; cookie giữ 30 ngày kể cả khi đóng trình duyệt; HTTP/WS cùng kiểm tra, heartbeat không gia hạn idle. Hết session xử lý như disconnect, không xóa dữ liệu đã lưu.

Production lưu HTTP session qua restart bình thường bằng file ngoài JAR, cấu hình theo [deployment](deployment.md#giữ-phiên-khi-deploy). Mốc tạo/hoạt động được lưu cùng phiên và phục hồi vào registry trước khi ứng dụng sẵn sàng; restart không gia hạn idle/absolute. Phiên thiếu metadata thời hạn bị từ chối. Logout/đổi mật khẩu vẫn thu hồi phiên, kể cả phiên đã khôi phục chưa nhận request mới. Đây là phiên đăng nhập, không phải trạng thái trận Room trong RAM.

Frontend phát hiện bản mới qua static `/version.json` (không cookie, không gia hạn session), khi mở web, focus/hiện tab và mỗi 60 giây lúc tab hiển thị. Khi khác mã build, báo `New version available`; chỉ cho bấm reload tại màn hình chính khi không còn membership/lệnh đang thực hiện. Không tự reload giữa trận. Lỗi mạng khi kiểm tra không chặn chơi; lỗi tải dynamic chunk cho phép reload thủ công tại màn hình chính. Không thay contract WebSocket.

Register/Login/Change Password: 20 requests/phút/IP và identity, đổi session không reset quota IP. Password BCrypt; sai mật khẩu trả INVALID_CREDENTIALS, không sửa mật khẩu hoặc tạo Account khác. Reconnect token ngẫu nhiên 256 bit, so sánh constant-time, hết hiệu lực khi membership kết thúc; không đặt secrets vào URL/logs/broadcast.

Client giữ context reconnect (roomId/playerId/token) trong IndexedDB theo backend origin và identity để quay lại sau disconnect; xóa khi Leave đã xác nhận hoặc server báo hết hạn. Chủ động rời page gửi `LEAVE_ROOM` qua socket hiện có; không đóng socket trước `ROOM_LEFT` khi còn có thể chờ. Frame từ `pagehide` không bảo đảm được nhận trước khi browser đóng page; trường hợp đó vẫn dùng grace/reconnect hiện có, không suy diễn mọi socket close thành Leave. Không chia sẻ token qua room code.

Tham chiếu: [Spring CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html), [OWASP session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP WebSocket](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).

## HTTP

Các path có prefix `/api`. Auth/private responses dùng Cache-Control:no-store. Không body request thì để trống.

| Method/path | Request → response |
| --- | --- |
| GET /auth/csrf | → {token,headerName} |
| GET /auth/me | → {authenticated,account:null hoặc {id,username,crownUnlocked}}; id là chuỗi ID của chính Account |
| POST /auth/register | {username,password} → me |
| POST /auth/login | {username,password} → me; chưa có username thì tạo Account theo validation Register, đã có thì xác thực mật khẩu |
| POST /auth/password | Account + CSRF; {currentPassword,newPassword} → {ok:true}; thu hồi các phiên sau commit |
| POST /auth/logout | → {ok:true} |
| GET /game-config | → {features:{flyEnabled:boolean}} |
| GET /map | → GameMap |
| GET /rooms/{roomId} | Public → {roomId,kind,joinable}; chỉ tra loại/khả năng Join, không trả members hoặc tokens |
| GET /rooms | Public → {rooms:[{roomId,mode,mapLevel,playerCount,capacity}]}; chỉ Public/WAITING còn chỗ, không tokens |
| GET /community/current | Account → {run:null hoặc RunSummary của lượt ACTIVE,updatedAt,saveStatus}; không trả snapshot nội bộ |
| GET /leaderboard?limit=100 | Public → {entries:[LeaderboardEntry]} |
| GET /history?page=0&size=20 | Account → {items,page,size,hasNext}; History đã kết thúc theo data |
| GET /history/{kind}/{id} | Owner → History detail; kind=COMMUNITY/ROOM, id là run ID hoặc match ID |
| GET /profile/me | Account → {username,total} |

Sign In dùng chung luồng đăng nhập/tạo Account. Username trùng khi tạo đồng thời phải xác thực mật khẩu của Account đã được tạo, không ghi đè. Session đã đăng nhập không được tự tạo Account khác; đổi Account khi còn membership vẫn bị từ chối.

HTTP JSON body tối đa 16 KiB. Register: username 3–32 letters/numbers/_/-, password ≥6 Unicode code points và ≤72 UTF-8 bytes. Tên online lấy từ username đã xác thực, không nhận nickname từ client; playerId phân biệt người chơi.

GameMap={width,screenHeight,tileSize,progressOriginY,spawn,finish,screens}; spawn={x,y}, finish={screen,minCenterX,requiresGrounded,minProgress?}, screen={tiles:string[],wind:boolean}. minProgress mặc định 0; Room thay finish theo mapLevel trong shared, không thay geometry.

game-config trả tuning/rules từ shared; appearances=[{colorSlot,color}] ánh xạ slot sang màu hex. features do server quyết định theo cấu hình/profile, không nhận từ client.

RunSummary={id,status,currentProgress,maxProgress,elapsedTimeMs,peakReachedTimeMs,finishTimeMs}; LeaderboardEntry thêm {rank,username}.

History summary={id,kind,startedAt,endedAt,status,playTimeMs,jumps,falls,currentProgress,maxProgress,finishTimeMs,room}; room=null cho Community, Room có {mode,mapLevel,itemsEnabled,itemCooldownMinutes,roomCode,durationMs,rank,isWinner}. Detail Room thêm {timeLimitMinutes,endReason,participants}; detail Community dùng summary. Participant={runId,nickname,status,rank,isWinner,currentProgress,maxProgress,finishTimeMs,playTimeMs,jumps,falls}. Ownership và thứ tự theo [data](data.md#history-và-leaderboard).

Statistics={totalPlayTimeMs,totalJumps,totalFalls,finishes,matchesPlayed,wins,bestFinishTimeMs}; matchesPlayed/wins chỉ đếm Room, bestFinishTimeMs=null nếu chưa Finish. Không nhận bộ lọc kind/mode.

Page 0–100000, size/limit 1–100; timestamps ISO-8601 UTC. Chỉ trả Account ID của chính phiên, không lộ credentials/token. Detail sai owner trả 404 như không tồn tại.

Tra ID và danh sách phòng dùng chung giới hạn 60 requests/phút/IP; ID phải đúng định dạng trong gameplay. API liệt kê chỉ trả Public/WAITING còn chỗ; kết quả tra không cấp quyền Join/reconnect, server kiểm tra lại khi xử lý command.

Lỗi chung `{error:{code,message}}`: 400 validation, 401 credentials/identity, 403 quyền/CSRF, 404 not found, 409 conflict, 429 rate limit, 5xx lỗi server đã loại secrets. UI dựa code, không parse message.

## WebSocket envelope và giới hạn

```json
{"v":1,"type":"PLAYER_INPUT","payload":{"playId":"00000000-0000-4000-8000-000000000001","generation":1,"seq":1,"left":false,"right":true,"jump":true}}
```

Envelope gồm v/type/payload; control commands có requestId 1–64 ký tự, input/cancel không dùng. Response riêng giữ requestId, broadcast không mang requestId người khác. Reject version/type/field lạ, số không hữu hạn hoặc sai JSON type; không coerce string sang boolean/number.

playId là run ID Community hoặc match ID Room. generation tăng khi Join/reconnect/đổi lượt, Resume Community; sequence tăng trong playId/generation. Snapshot/ACK chỉ có hiệu lực cho context hiện hành.

| Giới hạn | Giá trị |
| --- | --- |
| WS handshake | 30 lần/phút/IP |
| WS connections | 2/identity, 32/IP, 256/server |
| Sảnh/phòng còn tồn tại | 64/server |
| Create/Join/New Run | 20 lệnh/phút/IP và identity |
| Inbound message / rate | 16 KiB / 120 messages/giây/connection |
| Sequence | Integer 1–9007199254740991 |
| Input queue server / client | 120 / 180 frames |
| Input timeout | 500 ms |
| Outbound control queue / send deadline | 64 messages / 5 giây |
| Heartbeat / connection expiry | 10 / 30 giây |
| Client HTTP/handshake/command deadline | 8 giây |
| Chat | 200 Unicode code points; 1 tin/giây; 50 tin gần nhất/sảnh |

Giới hạn mặc định tập trung tại cấu hình network của backend, kiểm tra trước cấp phát connection/phòng; quotas tính cả phòng đang chờ reconnect. Không mặc định coi các giới hạn này là năng lực đã đo. Vượt queue/rate thì báo lỗi hoặc ngắt connection; không âm thầm bỏ cạnh nhấn/thả Jump. Không dùng traffic/heartbeat thay input cho chính sách AFK.

## Client → server

| Type | Payload / hành vi |
| --- | --- |
| HEARTBEAT | {nonce} → PONG; đo RTT, jitter, stall detection và giám sát liveness |
| JOIN_COMMUNITY | {newRun:boolean,expectedRunId:string hoặc null}; false chỉ Continue đúng ID, true tạo/thay lượt sau xác nhận |
| CREATE_ROOM | {settings?} → tạo sảnh chờ và làm Host |
| JOIN_ROOM | {roomId} → vào đúng Room theo ID |
| LEAVE_ROOM | {} → Community flush checkpoint; Room Leave/DNF |
| GET_ROOM_STATE | {} → state hiện hành hoặc null khi đã rời |
| UPDATE_ROOM_SETTINGS | Patch {mode?,timeLimitMinutes?,mapLevel?,visibility?,itemsEnabled?,itemCooldownMinutes?}; Host/WAITING; cặp mode/timeLimitMinutes phải hợp lệ theo gameplay |
| GAME_READY | {playId,generation}; tự động khi renderer tải xong, chỉ roster COUNTDOWN; server bắt đầu countdown 3 giây khi tất cả sẵn sàng |
| START_GAME / END_MATCH | {}; quyền, roster và lifecycle theo gameplay; kiểm tra khi xử lý command |
| PLAY_AGAIN | {matchId}; mỗi thành viên xác nhận sau match vừa kết thúc, kể cả khi phòng đã về WAITING |
| USE_ITEM | {playId,generation} → ITEM_USED {roomId,playId}; server quyết định loại/vị trí/mục tiêu, không nhận tọa độ hoặc target từ client |
| SET_SPECTATE | {playerId:string hoặc null}; xem người cùng phòng hoặc hủy xem; server kiểm tra membership/trạng thái, không nhận vị trí hoặc screen từ client |
| SET_COMMUNITY_PAUSED | {paused:boolean}; Pause/Resume cá nhân, server xác nhận theo gameplay |
| CHAT_SEND | {text}; render plain text, lọc control characters |
| PLAYER_INPUT | {playId,generation,seq,left,right,jump,up?,down?,freeFlight?}; booleans, field tùy chọn mặc định false |
| CANCEL_INPUT | {playId,generation,seq}; hủy input/charge, không launch |
| RECONNECT | {roomId,playerId,reconnectToken} → full state |

Settings Room mặc định RACE/null/mapLevel=10, visibility mặc định PRIVATE; mode/biên timeLimitMinutes theo gameplay, mode khác TIME_LIMIT phải null. Patch atomic, sai field/state từ chối toàn bộ.

JOIN_ROOM chỉ nhận Room đang WAITING; Community chỉ vào bằng JOIN_COMMUNITY tự xếp sảnh. RECONNECT vẫn kiểm tra ID nội bộ, owner/player/token của membership cũ; không dùng ID để vượt roster.

JOIN_COMMUNITY luôn yêu cầu cả hai fields: Continue (newRun=false) phải gửi ID lượt ACTIVE; New Game (true) gửi ID ACTIVE hoặc null nếu chưa có. ID/trạng thái không còn đúng trả CONFLICT, không tự tạo hoặc thay lượt. Server giữ chỗ trước khi thay save theo transaction trong data. Thiếu chỗ/DB lỗi giữ lượt cũ; người chơi cần Save & Exit trước khi bắt đầu lượt mới.


Community/Room không nhận position/velocity/score/clock hoặc checkpoint từ client. Input chỉ xử lý khi đang chơi; paused/countdown/finished cancel, không enqueue movement. Chat chỉ là text.

Client nhận diện nhấn đúp khi cấu hình cho phép Fly Mode và gửi freeFlight là trạng thái bay mong muốn, không phải lệnh toggle mỗi frame. Server chỉ chấp nhận freeFlight=true khi features.flyEnabled=true; nếu không trả INVALID_INPUT. up/down điều khiển bay, giữ jump cũng bay lên; CANCEL_INPUT/timeout xóa movement/charge, không đảo trạng thái bay. Physics, thoát solid và kết quả vẫn do server xử lý theo gameplay.

## Server → client

| Type | Payload chính |
| --- | --- |
| ROOM_JOINED | {roomId,kind,playerId,reconnectToken,generation,playId}; token chỉ gửi owner |
| ROOM_STATE | {roomId,kind,state,visibility?,hostPlayerId,settings,members,currentPlay,result} |
| ROOM_LEFT | {roomId}; null nếu đã rời |
| GAME_STARTED | {playId,generation,countdownMs}; bắt đầu tải màn chơi; ROOM_STATE.currentPlay.countdownRemainingMs=0 khi chờ tải, >0 khi countdown chạy |
| GAME_SNAPSHOT | {roomId,serverTick,playId,generation,self,peers,players,spectating,elapsedTimeMs,remainingTimeMs} |
| COMMUNITY_RUN_STATE | {run:RunSummary,generation,paused,pausePending,saveStatus} |
| PLAYER_EFFECTS | {roomId,events:[{eventSeq,playerId,playId,screen,effect,terrain}]} |
| SPECTATE_STATE | {roomId,playerId:string hoặc null}; xác nhận mục tiêu, state hiển thị nhận qua snapshot |
| ADVENTURE_EVENTS | {roomId,playId,sourcePlayerId,events:[{eventSeq,kind,type,id}]}; owner hoặc người đang xem owner, kind=ADVENTURE/WORLD, nội dung hiển thị tra tại client |
| PLAYER_FINISHED | {playerId,playId,result,showEnding,ending:{screen,ravenDone}}; sau commit, riêng người Finish ở Community hoặc winners ở Room; result tương ứng RunSummary/MatchResult |
| GAME_FINISHED | {playId,mapLevel,reason,durationMs,results,saveStatus}; Room broadcast |
| SAVE_STATUS | {playId,revision,saveStatus}; chỉ owner checkpoint hoặc members của match |
| CHAT_MESSAGE / CHAT_HISTORY | {roomId,messages:[{id,playerId,nickname,text,sentAt,colorSlot}]}; client bỏ chat từ sảnh cũ |
| RECONNECT_OK | {roomId,playerId,generation,playId}; sau đó full state |
| PONG / ERROR | {nonce} / {code,message,playId?,generation?,seq?} |

kind COMMUNITY/ROOM; host/settings null cho Community. Member={playerId,nickname,username,colorSlot,connected,paused,nextMatchConfirmed}; nickname lấy từ username trên server; Room giữ tên lúc Join. Các tên là plain text; colorSlot trong khoảng capacity ở gameplay. paused thuộc Community, nextMatchConfirmed thuộc Room; trường không áp dụng là null.

Room state là WAITING/COUNTDOWN/PLAYING/FINISHED; Community state=PLAYING, Pause thuộc từng lượt. currentPlay chứa metadata và kết quả nếu đã finalize; chưa có membership thì fields null, members=[]. Xác nhận/Host theo [gameplay](gameplay.md#room-và-xếp-hạng).

self gồm lastProcessedInputSeq, status, metrics và full simulation để restore/replay: position/velocity, grounded/charge, direction/buffers, splat/knocked, terrain/wind, freeFlight/phasingFall, screen/ticks/jumps/falls/airChargeTicks và adventure. peers chỉ gồm người ở screen đang xem hoặc liền kề, mỗi người có {playerId,nickname,colorSlot,state,crowned,status}; không broadcast checkpoint/secrets. players vẫn gồm toàn phòng.

players=[{playerId,nickname,colorSlot,rank,currentProgress}] gồm các thành viên còn trong phòng, tối đa capacity. Server tính từ cùng state RAM với snapshot; Room dùng comparator mode, Community chỉ so độ cao hiện tại. Giữ đồng hạng, ID chỉ ổn định thứ tự; không truy vấn database theo tick.

adventure gồm ID/counters tiến độ hội thoại và state quạ riêng của owner; chỉ gửi state quạ cho người đang xem owner. Cue FLEE phát tiếng quạ một lần, không phát lại khi reconciliation. Vương miện là ngoại hình profile tự cấp theo data, không có lệnh trang bị. Client dựng nội dung theo [architecture](architecture.md#công-nghệ-và-trách-nhiệm); thay đổi state phải do server xác nhận.

Results={playerId,nickname,status,rank,currentProgress,maxProgress,isWinner,finishTimeMs}; nickname giữ lúc Join để Results vẫn hiển thị đúng người đã Leave. Status/reason/saveStatus theo data; SAVE_STATUS Room có revision=null. Server chốt metrics và showEnding theo gameplay.

Chat giữ trong RAM của từng sảnh, mất khi sảnh đóng/restart. Effects gồm JUMP/LAND/SPLAT/BUMP và NORMAL/ICE/SNOW; lọc screen, âm lượng và dedupe ở client.

## Prediction và lỗi

Client gửi full input frame mỗi tick, kể cả không đổi phím. Server xử lý tối đa một frame/player/tick FIFO; thiếu frame dùng input cuối và không tăng ACK. Hết input timeout xóa queue/cancel charge. Nếu vẫn nhận input mới nhưng frame cũ chờ quá input timeout (mặc định 500 ms), đóng socket với code 1013, hủy charge và dùng luồng reconnect để resync; không ACK frame bị hủy hoặc biến mất input thành release-jump.

ACK và state lấy cùng tick. Client restore snapshot mới hơn, bỏ frames đã ACK rồi replay frames còn lại. Peers dùng bộ đệm theo serverTick, mặc định trễ hiển thị 100 ms để hấp thụ jitter; hiệu chỉnh clock từ từ, không extrapolate, không nội suy xuyên screen/respawn. Các giá trị tập trung tại network/config.ts. Replay không phát lại âm thanh, hội thoại hoặc ending. Pause yêu cầu cancel/xóa queued input; pausePending không nhận movement mới. Resume Community trả full state và generation mới. Room không có Pause; menu chỉ hủy input cá nhân. Server vẫn xử lý heartbeat/chat/reconnect/Leave và deadlines. Đổi playId/generation phải xóa prediction buffers; heartbeat không tăng active clock. Vòng lặp heartbeat của client đo RTT (Round Trip Time), tính rolling average và jitter (|RTT_hiện_tại - RTT_trước|), đồng thời đếm số lần phản hồi vượt stall threshold (500 ms) do retransmission của tầng truyền tải để phân loại chất lượng kết nối và hiển thị HUD.

Control timeout: GET_ROOM_STATE/reconnect, không tự gửi lại Start/New Run/End. Duplicate requestId trả kết quả cũ; New Run kiểm tra thêm expectedRunId. Bỏ message socket/context cũ; đóng connection phải kết thúc pending promises.

Client hết chỗ chứa input chưa ACK phải đi qua cùng luồng mất kết nối như socket lỗi: dừng input, phát CONNECTION_CLOSED và mở menu Reconnect/Back to Menu. Không dùng Resume hoặc Save & Exit trên socket đã đóng. Back to Menu khi mất kết nối về màn hình chính mà không chờ Leave; giữ context reconnect và báo chưa xác nhận lưu. Không coi thao tác này là Leave thành công hoặc SAVED; Continue dùng checkpoint server. Reconnect thành công nhận state/generation mới trước khi Resume. `ROOM_LEFT` không kèm `requestId` là server chủ động đưa người chơi ra (Pause quá hạn, Start loại người chưa confirmed, v.v.): client về trang chủ và báo chung. Reconnect gặp `RECONNECT_EXPIRED`/`ROOM_NOT_FOUND`, hoặc Resume/Pause bị từ chối vì `GET_ROOM_STATE` trả `roomId` null, nghĩa là membership đã kết thúc: client về trang chủ và báo lý do, không giữ menu Resume/Reconnect. Context được xóa khi nhận ROOM_LEFT hoặc server xác nhận reconnect hết hạn. Thông báo không suy đoán nguyên nhân AFK hoặc khẳng định lần lưu mới nhất đã thành công; Continue đọc checkpoint server.

Nhóm error codes: INVALID_MESSAGE/INVALID_INPUT/INVALID_SETTINGS, AUTH_REQUIRED/ACCOUNT_REQUIRED, ROOM_NOT_FOUND/ROOM_FULL/ROOM_NOT_JOINABLE/ALREADY_IN_ROOM/HOST_ONLY/NOT_ENOUGH_PLAYERS, STALE_PLAY/STALE_INPUT, INVALID_RECONNECT/RECONNECT_EXPIRED, SAVE_FAILED/CONFLICT/RATE_LIMITED/INTERNAL_ERROR.

## Mở rộng dữ liệu hiển thị

Account/profile có `crownUnlocked`; public render state chỉ mang trạng thái vương miện, không nhận quyền mở từ input online. GAME_SNAPSHOT bổ sung Players ranking từ server RAM, giữ đồng hạng; Room theo mode, Community theo độ cao hiện tại. Không truy vấn DB theo tick để tạo bảng này. Leaderboard dùng HTTP theo [gameplay](gameplay.md#chat-và-bảng-trong-trận); bảng Players vẫn cập nhật qua snapshot.

Spectating=null hoặc {player,playId,elapsedTimeMs,paused,adventure,world}; player là public render state như peers, playId là lượt của mục tiêu. Self/playId/generation/ACK ở gốc snapshot luôn thuộc người nhận, không đổi thành của mục tiêu. Dữ liệu spectating chỉ dành cho renderer, không restore vào prediction hoặc checkpoint. Khi đổi mục tiêu xóa bộ đệm nội suy; không gửi lại animation/âm thanh từ snapshot. Effects/cues theo người và screen đang xem, không phát ending của mục tiêu.

SET_SPECTATE chỉ tồn tại trong RAM của membership; hủy khi reconnect, mục tiêu mất kết nối/rời/kết thúc hoặc Room không còn PLAYING. Target không hợp lệ trả INVALID_SPECTATE_TARGET. Khi xem, input không điều khiển nhân vật; Room vẫn chạy physics và clock, Community dùng Pause hiện có. Không thay đổi quyền owner, kết quả, save hoặc luật xếp hạng.

## Items Room

Settings có `itemsEnabled` boolean mặc định false, `itemCooldownMinutes` số nguyên 1–15 mặc định 3. Luật dùng/cấp/trúng theo [gameplay](gameplay.md#items-trong-room). USE_ITEM dùng requestId/dedup hiện có; sai context STALE_PLAY, item tắt hoặc trạng thái không cho dùng ITEM_UNAVAILABLE, chưa hồi ITEM_COOLDOWN, Banana chưa đứng nền INVALID_ITEM_POSITION, Rock không có mục tiêu NO_ITEM_TARGET. Lỗi không tiêu thụ vật phẩm. Chỉ thành viên PLAYING/ACTIVE, không spectating, được dùng.

GAME_SNAPSHOT của Room bật Items có `items={held:BANANA|ROCK|null,bananaArmed:boolean,cooldownMs,bananas:[{id,x,y,armedAtTick}],rocks:[{id,x,y,direction,tick}]}`. Held/hồi chiêu chỉ của người nhận; bẫy/cue đá chỉ screen đang xem và liền kề. Tọa độ world: Banana là tâm chân, Rock là tâm mục tiêu lúc trúng. Rocks là cue ngắn, không quyết định hit. `physics.slipping` chỉ gửi khi true trong self/peers; client replay trạng thái này để reconciliation đúng. Community không có items. Reconnect trả item state hiện tại, không random lại.
