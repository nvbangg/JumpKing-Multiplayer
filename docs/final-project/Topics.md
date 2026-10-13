# Network Programming Project – Topics

## 1. Quy định lựa chọn chủ đề

Sinh viên chọn **01 trong 03 nhóm chủ đề** dưới đây và tiến hành phân tích, thiết kế, triển khai và đánh giá một ứng dụng mạng.

Mỗi project cần thể hiện rõ các nội dung cốt lõi của môn **Network Programming**, bao gồm:

* Kiến trúc ứng dụng mạng.
* Mô hình giao tiếp giữa các thành phần.
* Giao thức hoặc cơ chế trao đổi dữ liệu.
* Client/Server hoặc mô hình phân tán phù hợp.
* Xử lý đồng thời (concurrency/multithreading) khi cần thiết.
* Quản lý kết nối và trạng thái.
* Xử lý lỗi và các tình huống bất thường.
* Lưu trữ và quản lý dữ liệu nếu cần.
* Kiểm thử và đánh giá hoạt động của hệ thống.
* Một hoặc một số **điểm cải tiến/đóng góp kỹ thuật (Novelty & Contributions)**.

Sinh viên **không bắt buộc phải xây dựng một hệ thống có quy mô lớn**. Phạm vi project cần phù hợp với thời gian thực hiện nhưng phải thể hiện được kiến thức và kỹ năng lập trình mạng đã học.

---

# 2. Chủ đề 1 – Điều khiển mạng

## 2.1. Định hướng

**Điều khiển mạng quang (Optical Network Control)** là quá trình giám sát, cấu hình và điều khiển các tài nguyên trong mạng quang nhằm đáp ứng các yêu cầu truyền dẫn và sử dụng tài nguyên mạng hiệu quả.

Một hệ thống điều khiển mạng quang có thể liên quan đến một hoặc một số vấn đề như:

* Thu thập trạng thái mạng và tài nguyên.
* Giám sát các kết nối và trạng thái đường truyền.
* Định tuyến kết nối trong mạng.
* Phân bổ bước sóng hoặc phổ tần.
* Thiết lập, thay đổi và giải phóng kết nối.
* Quản lý tài nguyên mạng.
* Đánh giá chất lượng truyền dẫn (Quality of Transmission – QoT).
* Phát hiện hoặc xử lý sự cố.
* Tối ưu hóa việc sử dụng tài nguyên.
* Điều khiển mạng thông qua giao diện/API hoặc SDN controller.
* Ứng dụng thuật toán tối ưu hoặc Machine Learning trong điều khiển mạng.

Sinh viên **tự lựa chọn một bài toán cụ thể** trong phạm vi điều khiển mạng quang để triển khai.

## 2.2. Hai hướng triển khai

### Hướng A – Phát triển project mới

Sinh viên tự phân tích bài toán, thiết kế kiến trúc và xây dựng một project mới.

Ví dụ:

* Xây dựng hệ thống routing và resource allocation kết hợp QoT.
* Xây dựng hệ thống giám sát mạng quang.
* Xây dựng hệ thống QoT-aware network control.
* Ứng dụng Machine Learning vào một bài toán điều khiển mạng.
* GNN cho mạng quang.

### Hướng B – Phát triển dựa trên project có sẵn

Sinh viên được cung cấp hoặc lựa chọn một project/codebase có sẵn và **phát triển, mở rộng hoặc cải tiến** hệ thống.

Sinh viên cần xác định rõ:

* Chức năng hoặc kiến trúc ban đầu.
* Hạn chế của hệ thống hiện tại.
* Nội dung được kế thừa.
* Nội dung được phát triển thêm.
* Điểm cải tiến/đóng góp của project.
* Kết quả trước và sau khi cải tiến.

> Sinh viên không nên chỉ chạy lại hoặc sao chép project có sẵn. Phần phát triển mới phải thể hiện được vai trò của sinh viên trong việc thiết kế và triển khai hệ thống.

---

# 3. Chủ đề 2 – Phát triển game mạng

## 3.1. Định hướng

Sinh viên xây dựng một **game có khả năng chơi qua mạng**, trong đó nhiều người chơi hoặc các thành phần của hệ thống giao tiếp với nhau thông qua mạng.

Có thể sử dụng kiến trúc **Client/Server**, trong đó:

```text
              +----------------+
              |     Server     |
              | Game Logic     |
              | Game State     |
              | Player Manager |
              +-------+--------+
                      |
             Network Communication
              /       |       \
             /        |        \
      +------+    +---+---+    +------+
      |Client|    |Client |    |Client|
      +------+    +-------+    +------+
```

Server có thể chịu trách nhiệm:

* Quản lý người chơi.
* Quản lý phòng chơi.
* Xử lý trạng thái game.
* Kiểm tra và xử lý các hành động của người chơi.
* Đồng bộ trạng thái giữa các client.
* Xử lý kết nối/ngắt kết nối.
* Quản lý điểm số hoặc kết quả.

Client có thể chịu trách nhiệm:

* Giao diện người chơi.
* Gửi hành động tới server.
* Nhận và hiển thị trạng thái game.
* Xử lý tương tác với người chơi.

## 3.2. Một số hướng game có thể lựa chọn

Sinh viên có thể lựa chọn các game phù hợp với mô hình Client/Server, chẳng hạn:

* Card Game.
* Multiplayer Battle Game.
* Turn-based Strategy Game.
* Một game nhiều người chơi khác do sinh viên đề xuất.

Game không nhất thiết phải có đồ họa phức tạp. **Trọng tâm của project là kiến trúc mạng, giao tiếp Client/Server, đồng bộ trạng thái và xử lý nhiều người chơi.**

Sinh viên có thể sử dụng:

* TCP/UDP.
* Socket.
* Multithreading.
* NIO.
* WebSocket.
* Serialization/JSON hoặc custom protocol.
* Database.
* Các cơ chế đồng bộ và quản lý trạng thái phù hợp.

---

# 4. Chủ đề 3 – Ứng dụng mạng

## 4.1. Định hướng

Sinh viên xây dựng một **ứng dụng mạng theo mô hình Client/Server hoặc Distributed System**, trong đó Server và Client thực hiện các chức năng khác nhau và trao đổi dữ liệu thông qua mạng.

Có thể lựa chọn các bài toán trong nhiều lĩnh vực như:

* Giáo dục và đào tạo.
* Quản lý và giám sát.
* Truyền và chia sẻ dữ liệu.
* Làm việc cộng tác.
* Quản lý thiết bị.
* Kiểm tra và đánh giá.
* Giám sát hệ thống.
* Tự động hóa.
* Các bài toán thực tế khác.

**Trọng tâm của project là thiết kế và triển khai cơ chế giao tiếp giữa các thành phần trong hệ thống.** Sinh viên cần thể hiện rõ Server làm gì, Client làm gì, dữ liệu được trao đổi như thế nào và hệ thống xử lý nhiều Client/kết nối ra sao.

---

## 4.2. Server có thể làm gì?

Tùy bài toán, Server có thể đảm nhiệm một hoặc nhiều chức năng sau:

### Quản lý kết nối

* Chấp nhận kết nối từ nhiều Client.
* Xác thực và quản lý phiên làm việc.
* Theo dõi trạng thái Client.
* Xử lý Client kết nối/ngắt kết nối.
* Duy trì heartbeat hoặc keep-alive nếu cần.

### Quản lý dữ liệu

* Lưu trữ dữ liệu tập trung.
* Cung cấp dữ liệu cho Client.
* Nhận và xử lý dữ liệu từ Client.
* Đồng bộ dữ liệu giữa nhiều Client.
* Quản lý database.

### Xử lý nghiệp vụ

* Kiểm tra và xử lý request từ Client.
* Thực hiện các nghiệp vụ chính của ứng dụng.
* Kiểm tra quyền truy cập.
* Kiểm tra tính hợp lệ của dữ liệu.
* Quản lý trạng thái của hệ thống.

### Điều phối

Server có thể đóng vai trò **trung tâm điều phối**:

* Phân phối công việc cho Client.
* Phân phối dữ liệu.
* Quản lý phòng/nhóm/người dùng.
* Điều phối nhiều Client.
* Quản lý hàng đợi (queue).
* Phân công công việc cho Worker.

### Xử lý đồng thời

Server cần có khả năng xử lý nhiều Client hoặc nhiều request đồng thời bằng các cơ chế phù hợp như:

* Thread.
* Thread Pool.
* Asynchronous I/O.
* Non-blocking I/O.
* Worker Pool.
* Message Queue.

### Thông báo và đồng bộ thời gian thực

Server có thể gửi dữ liệu hoặc sự kiện tới Client khi trạng thái hệ thống thay đổi:

```text
Client A ──request──> Server
                       │
                       │ update state
                       ↓
                  Server State
                       │
             ┌─────────┴─────────┐
             ↓                   ↓
          Client B            Client C
        notification        notification
```

Có thể sử dụng:

* WebSocket.
* TCP persistent connection.
* Server Push.
* Publish/Subscribe.

---

## 4.3. Client có thể làm gì?

Client là thành phần tương tác trực tiếp với người dùng hoặc thiết bị đầu cuối.

### Gửi yêu cầu

Client có thể gửi tới Server:

* Login/logout.
* Request dữ liệu.
* Submit dữ liệu.
* Gửi kết quả.
* Gửi lệnh.
* Gửi trạng thái.
* Upload file.
* Gửi các thao tác của người dùng.

### Nhận dữ liệu

Client có thể nhận:

* Response từ Server.
* Dữ liệu được yêu cầu.
* Kết quả xử lý.
* Thông báo.
* Sự kiện thời gian thực.
* Trạng thái của hệ thống hoặc người dùng khác.

### Hiển thị và tương tác

Client có thể cung cấp:

* Giao diện người dùng.
* Dashboard.
* Form nhập dữ liệu.
* Bảng kết quả.
* Biểu đồ.
* Thông báo.
* Giao diện tương tác thời gian thực.

### Xử lý cục bộ

Một phần công việc có thể được thực hiện tại Client, chẳng hạn:

* Kiểm tra dữ liệu trước khi gửi.
* Xử lý giao diện.
* Mã hóa/giải mã dữ liệu.
* Xử lý dữ liệu cục bộ.
* Cache.
* Theo dõi trạng thái kết nối.
* Tự động gửi lại request khi mất kết nối.

---

## 4.4. Ví dụ phân chia Server/Client

Tùy bài toán, sinh viên có thể thiết kế sự phân chia chức năng khác nhau.

### Ví dụ 1 – Hệ thống quản lý dữ liệu

| Thành phần | Một số chức năng                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- |
| **Server** | Quản lý database, xử lý request, xác thực, tìm kiếm, cập nhật dữ liệu, quản lý nhiều Client |
| **Client** | Đăng nhập, gửi request, nhập dữ liệu, hiển thị kết quả                                      |

### Ví dụ 2 – Hệ thống cộng tác thời gian thực

| Thành phần | Một số chức năng                                                               |
| ---------- | ------------------------------------------------------------------------------ |
| **Server** | Quản lý room, người dùng, trạng thái chung, đồng bộ dữ liệu, broadcast sự kiện |
| **Client** | Tham gia room, gửi thao tác, nhận thay đổi từ Server, hiển thị trạng thái      |

### Ví dụ 3 – Hệ thống giám sát

| Thành phần | Một số chức năng                                                      |
| ---------- | --------------------------------------------------------------------- |
| **Server** | Thu thập dữ liệu, lưu trữ, phân tích, phát hiện sự kiện, gửi cảnh báo |
| **Client** | Thu thập dữ liệu từ thiết bị hoặc hiển thị dashboard giám sát         |

### Ví dụ 4 – Hệ thống xử lý công việc

| Thành phần | Một số chức năng                                                                  |
| ---------- | --------------------------------------------------------------------------------- |
| **Server** | Nhận yêu cầu, đưa công việc vào Queue, phân phối cho Worker, xử lý và lưu kết quả |
| **Client** | Gửi yêu cầu, theo dõi trạng thái, nhận kết quả                                    |

---

# 4.5. Ví dụ định hướng 1 – Networked Auto-Grader

Một ví dụ điển hình là hệ thống **Networked Automated Code Grading System**, cho phép sinh viên gửi bài lập trình qua mạng và hệ thống tự động thực hiện chấm bài.

### Server có thể đảm nhiệm

* Quản lý tài khoản và người dùng.
* Quản lý môn học/bài tập.
* Nhận source code từ Client.
* Kiểm tra submission.
* Đưa submission vào Queue.
* Phân phối submission cho Judge Worker.
* Biên dịch và chạy chương trình.
* Thực hiện test cases.
* Tính điểm.
* Lưu lịch sử submission.
* Gửi kết quả về Client.
* Thông báo kết quả theo thời gian thực.
* Quản lý nhiều submission đồng thời.

### Client có thể đảm nhiệm

* Đăng nhập.
* Xem danh sách bài tập.
* Xem yêu cầu và test information phù hợp.
* Nhập hoặc upload source code.
* Gửi bài tới Server.
* Theo dõi trạng thái submission.
* Nhận kết quả chấm.
* Xem kết quả từng test case.
* Xem lịch sử submission.
* Hiển thị điểm và feedback.

Có thể mở rộng với:

* WebSocket.
* Multithreading/Worker Pool.
* Docker/Sandbox.
* Code quality analysis.
* Code similarity detection.
* Leaderboard.
* Learning Path/Gamification.
* Performance analysis.

Kiến trúc minh họa:

```text
+------------------+
|  Student Client  |
|                  |
| - Login          |
| - View Assignment|
| - Write/Upload   |
| - Submit         |
| - View Result    |
+--------+---------+
         |
         | HTTP/TCP/WebSocket
         ↓
+--------+---------+
| Submission Server|
|                  |
| - Authentication |
| - Assignment     |
| - Submission     |
| - Result         |
+--------+---------+
         |
         | Queue
         ↓
+--------+---------+
|   Judge Worker   |
|                  |
| - Compile        |
| - Execute        |
| - Test           |
| - Score          |
+--------+---------+
         |
         ↓
+------------------+
| Test/Sandbox Env |
+------------------+
```

---

# 4.6. Ví dụ định hướng 2 – Hệ thống thi qua mạng

Một hướng khác là xây dựng **hệ thống tổ chức thi trên máy tính theo mô hình Client/Server**.

Trong mô hình này, Server đóng vai trò trung tâm quản lý kỳ thi, trong khi mỗi Client đại diện cho một máy thi.

### Server có thể đảm nhiệm

* Quản lý kỳ thi.
* Quản lý danh sách thí sinh.
* Quản lý tài khoản và quyền truy cập.
* Quản lý ngân hàng câu hỏi.
* Phân phối đề thi tới Client.
* Quản lý thời gian thi.
* Theo dõi trạng thái của các Client.
* Nhận câu trả lời từ Client.
* Lưu bài làm.
* Nhận bài nộp.
* Tự động thu bài khi hết giờ.
* Chấm điểm nếu phù hợp.
* Ghi log hoạt động.
* Phát hiện Client mất kết nối.
* Gửi thông báo tới Client.
* Quản lý nhiều Client đồng thời.

### Client có thể đảm nhiệm

* Đăng nhập vào kỳ thi.
* Nhận đề thi từ Server.
* Hiển thị câu hỏi.
* Cho phép thí sinh trả lời.
* Lưu tạm bài làm.
* Gửi câu trả lời tới Server.
* Hiển thị thời gian còn lại.
* Nhận thông báo từ Server.
* Nộp bài.
* Tự động gửi bài khi hết giờ.
* Thông báo trạng thái kết nối.

Có thể mở rộng với:

* Real-time monitoring.
* WebSocket.
* Heartbeat/Keep-alive.
* Authentication.
* Encryption.
* Fault tolerance.
* Concurrent Client Management.
* Centralized Logging.
* Automatic Submission.

Kiến trúc minh họa:

```text
                         +----------------------+
                         |      Exam Server     |
                         |                      |
                         | - Exam Management    |
                         | - Question Bank      |
                         | - Candidate Mgmt     |
                         | - Device Management  |
                         | - Submission         |
                         | - Monitoring         |
                         +----------+-----------+
                                    |
                              Network
                  +-----------------+-----------------+
                  |                 |                 |
                  ↓                 ↓                 ↓
           +-------------+   +-------------+   +-------------+
           |   Client 1  |   |   Client 2  |   |   Client N  |
           |             |   |             |   |             |
           | - Exam UI   |   | - Exam UI   |   | - Exam UI   |
           | - Answer    |   | - Answer    |   | - Answer    |
           | - Submit    |   | - Submit    |   | - Submit    |
           +-------------+   +-------------+   +-------------+
```

---

## 4.7. Yêu cầu đối với ứng dụng được lựa chọn

Dù lựa chọn bài toán nào, nhóm cần xác định rõ:

```text
                  APPLICATION
                       |
          +------------+------------+
          |                         |
        SERVER                    CLIENT
          |                         |
    Does what?                 Does what?
          |                         |
          +------------+------------+
                       |
              NETWORK COMMUNICATION
                       |
          +------------+------------+
          |            |            |
       Protocol     Messages    Concurrency
```

Trong đề xuất project, nhóm cần mô tả tối thiểu:

1. **Problem** – Bài toán cần giải quyết.
2. **Objective** – Mục tiêu của hệ thống.
3. **Server** – Server thực hiện những chức năng gì?
4. **Client** – Client thực hiện những chức năng gì?
5. **Network Communication** – Server và Client trao đổi dữ liệu như thế nào?
6. **Protocol** – Sử dụng TCP, UDP, HTTP, WebSocket hoặc protocol tự thiết kế?
7. **Data Format** – JSON, XML, binary, serialization hoặc format khác?
8. **Concurrency** – Hệ thống xử lý nhiều Client/request như thế nào?
9. **Error Handling** – Xử lý mất kết nối, timeout, dữ liệu không hợp lệ như thế nào?
10. **Novelty & Contributions** – Nhóm tự thiết kế, phát triển hoặc cải tiến điểm gì?
11. **Evaluation** – Hệ thống được kiểm thử và đánh giá bằng những tiêu chí nào?

> **Lưu ý:** Không bắt buộc Server và Client phải có số lượng chức năng bằng nhau. Việc phân chia chức năng phụ thuộc vào bài toán và kiến trúc được lựa chọn. Tuy nhiên, project phải thể hiện rõ **vai trò của giao tiếp mạng và sự phối hợp giữa các thành phần**.
---

# 5. Yêu cầu chung đối với project

Bất kể lựa chọn chủ đề nào, project cần thể hiện được các nội dung sau:

### 5.1. Problem

Trình bày rõ bài toán thực tế cần giải quyết.

### 5.2. Objective

Xác định mục tiêu cụ thể của hệ thống.

### 5.3. System Architecture

Mô tả các thành phần chính và mối quan hệ giữa chúng.

### 5.4. Network Communication

Phải mô tả rõ:

* Client và Server.
* Cách thiết lập kết nối.
* Protocol sử dụng.
* Message/request/response.
* Data format.
* Connection management.
* Error handling.
* Concurrency.

### 5.5. Implementation

Triển khai hệ thống bằng công nghệ phù hợp.

Có thể sử dụng:

* Java.
* Python.
* C/C++.
* C#.
* Go.
* Node.js.
* Hoặc công nghệ phù hợp khác.

### 5.6. Testing & Evaluation

Project phải được kiểm thử và đánh giá bằng các kịch bản phù hợp.

Có thể đánh giá:

* Correctness.
* Response time.
* Throughput.
* Concurrent users/connections.
* Resource utilization.
* Reliability.
* Error rate.
* Network performance.

### 5.7. Novelty & Contributions

Project phải xác định rõ những nội dung mà nhóm **tự thiết kế, phát triển hoặc cải tiến**.

Novelty có thể đến từ:

* Thuật toán.
* Kiến trúc.
* Protocol.
* Cơ chế xử lý đồng thời.
* Cơ chế quản lý kết nối.
* Hiệu năng.
* Khả năng mở rộng.
* Fault tolerance.
* Real-time processing.
* Security.
* Cách thức tích hợp các thành phần.
* Cải tiến từ một project/baseline có sẵn.

**Thay đổi giao diện đơn thuần không được xem là đóng góp kỹ thuật chính.**

---

# 6. Lựa chọn project có sẵn

Đối với các nhóm muốn phát triển từ một project/codebase có sẵn, nhóm phải xác định:

1. Project/baseline ban đầu.
2. Chức năng đã có.
3. Kiến trúc ban đầu.
4. Những hạn chế hoặc vấn đề cần giải quyết.
5. Phần nhóm kế thừa.
6. Phần nhóm phát triển thêm.
7. Cách đánh giá sự cải tiến.

Trong báo cáo cần phân biệt rõ:

```text
Existing / Baseline
        +
Student's Development
        =
Final System
```

---

# 7. Đề xuất chủ đề khác

Sinh viên **có thể đề xuất một topic khác** ngoài ba nhóm trên.

Tuy nhiên, trước khi bắt đầu triển khai, nhóm phải **trao đổi và được giảng viên xác nhận chủ đề**.

Đề xuất cần trình bày tối thiểu:

* Project Title.
* Problem.
* Objective.
* Proposed Architecture.
* Network Communication.
* Main Functions.
* Technology.
* Expected Novelty/Contribution.
* Evaluation Plan.

Sau khi được xác nhận, nhóm mới tiến hành triển khai project.

---

# 8. Lưu ý

Project của môn học **không đánh giá quy mô sản phẩm**, mà tập trung vào khả năng:

> **Phân tích bài toán → thiết kế hệ thống mạng → triển khai giao tiếp mạng → xử lý đồng thời/trạng thái → kiểm thử → đánh giá → xác định đóng góp kỹ thuật.**

Một project có phạm vi vừa phải nhưng thể hiện tốt các vấn đề của **Network Programming** có giá trị hơn một project lớn nhưng phần network chỉ đóng vai trò phụ trợ.
