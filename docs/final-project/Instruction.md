# HƯỚNG DẪN THỰC HIỆN BÀI TẬP LỚN – LẬP TRÌNH MẠNG

**Năm học 2026–2027**

---

# 1. Mục tiêu

Bài tập lớn nhằm đánh giá khả năng vận dụng tổng hợp kiến thức môn **Lập trình mạng** để phân tích, thiết kế, triển khai và đánh giá một hệ thống phần mềm có giao tiếp qua mạng.

Project cần thể hiện được các năng lực:

* Phân tích bài toán;
* Thiết kế kiến trúc hệ thống;
* Thiết kế network communication;
* Thiết kế protocol/message format;
* Lập trình Client–Server hoặc Distributed System;
* Xử lý nhiều client/request đồng thời;
* Quản lý trạng thái và dữ liệu;
* Xử lý lỗi và các tình huống bất thường;
* Kiểm thử;
* Đo lường và đánh giá hiệu năng;
* Phân tích kết quả;
* Đề xuất và chứng minh điểm mới/cải tiến.

> **Một project chỉ có giao diện và database nhưng không thể hiện rõ bản chất của network programming sẽ không được xem là đáp ứng đầy đủ yêu cầu của bài tập lớn.**

---

# 2. Hình thức thực hiện

* Mỗi nhóm tối đa **05 sinh viên**.
* Có thể thực hiện cá nhân hoặc nhóm 02 sinh viên.
* Nhóm ít thành viên không đồng nghĩa với việc giảm yêu cầu kỹ thuật.
* Mỗi thành viên phải có phần việc kỹ thuật cụ thể.
* Tất cả thành viên phải hiểu được toàn bộ kiến trúc và phần code quan trọng của project.

Mỗi nhóm lựa chọn:

* 01 topic trong `topics.md`; hoặc
* 01 topic khác được giảng viên phê duyệt.

---

# 3. Yêu cầu chung của project

Project phải có tối thiểu:

### 3.1. Problem

Mô tả rõ vấn đề cần giải quyết.

### 3.2. Objective

Xác định rõ hệ thống cần đạt được điều gì.

### 3.3. System Architecture

Phải có sơ đồ kiến trúc thể hiện các thành phần chính.

Ví dụ:

```text
Client
   |
Network
   |
Server
   |
Database
```

hoặc kiến trúc phức tạp hơn:

```text
Clients
   |
API / Network Layer
   |
Server
   |
+--------+---------+
|        |         |
Queue   Service   Database
|
Workers
```

### 3.4. Network Communication

Phải mô tả:

* Thành phần nào giao tiếp với thành phần nào;
* Giao thức sử dụng;
* Connection được thiết lập như thế nào;
* Request/response hoặc message flow;
* Cách đóng connection;
* Cách xử lý lỗi.

### 3.5. Protocol / Message Format

Project phải mô tả rõ format của các message.

Ví dụ:

```text
REQUEST
{
    "type": "LOGIN",
    "username": "...",
    "password": "..."
}
```

hoặc một custom protocol:

```text
LOGIN|username|password
```

Không bắt buộc sử dụng JSON. Nhóm có thể thiết kế protocol phù hợp với project.

---

# 4. Công nghệ

Sinh viên có thể sử dụng:

* Java;
* Python;
* C/C++;
* C#;
* Go;
* Node.js;
* hoặc công nghệ khác nếu được phê duyệt.

Tuy nhiên, project phải thể hiện rõ kiến thức của môn học.

Các công nghệ có thể sử dụng:

* TCP Socket;
* UDP Socket;
* Multithreading;
* JDBC;
* HTTP/REST;
* Custom application protocol;
* Java NIO;
* Multicast;
* RMI;
* Database;
* Serialization;
* Worker/Queue;
* Streaming communication.

Việc sử dụng framework hoặc thư viện bên ngoài phải được ghi rõ trong README.

---

# 5. Yêu cầu về concurrency

Đối với các project phù hợp, hệ thống cần xem xét khả năng phục vụ nhiều client/request đồng thời.

Ví dụ:

* Multiple clients;
* Thread per connection;
* Thread pool;
* Worker queue;
* Concurrent requests;
* Shared state synchronization.

Nhóm phải giải thích cách hệ thống xử lý concurrency và các vấn đề có thể phát sinh.

---

# 6. Yêu cầu về error handling

Project cần xử lý hợp lý các tình huống như:

* Invalid request;
* Invalid data;
* Connection failure;
* Client disconnect;
* Server unavailable;
* Timeout;
* Duplicate request;
* Invalid state;
* Database error;
* Unexpected input.

Không nên để chương trình kết thúc đột ngột chỉ vì một client gửi dữ liệu không hợp lệ.

---

# 7. Yêu cầu về điểm mới – Novelty

**Mỗi project bắt buộc phải có phần “Novelty / Contributions”.**

Điểm mới không nhất thiết phải là một thuật toán hoàn toàn mới trên thế giới.

Điểm mới có thể là:

* Một cải tiến thuật toán;
* Một kiến trúc mới;
* Một protocol/message format;
* Một cơ chế concurrency;
* Một cơ chế fault tolerance;
* Một phương pháp tối ưu;
* Một cách tích hợp các thành phần;
* Một cơ chế adaptive;
* Một cách sử dụng ML;
* Một cơ chế giảm thời gian xử lý;
* Một cơ chế nâng cao reliability;
* Một cải tiến dựa trên baseline được cung cấp.

Ví dụ:

> Baseline sử dụng First-Fit Spectrum Assignment. Project đề xuất một heuristic có xét thêm QoT và so sánh kết quả với baseline.

Hoặc:

> Baseline là hệ thống optical network unicast được cung cấp. Project mở rộng hệ thống để hỗ trợ multicast và đánh giá sự thay đổi về routing và resource allocation.

Hoặc:

> Hệ thống chấm bài tuần tự được mở rộng thành mô hình queue + worker để xử lý đồng thời nhiều submission.

### Không được xem là novelty nếu chỉ:

* Thay đổi màu giao diện;
* Thêm logo;
* Thay đổi font;
* Thêm animation;
* Thêm một màn hình UI nhưng không có thay đổi kỹ thuật đáng kể.

---

# 8. Báo cáo

Báo cáo phải được viết theo cấu trúc gần với một **technical paper / research paper**, thay vì chỉ là hướng dẫn sử dụng phần mềm.

Báo cáo tối thiểu gồm:

## 8.1. Title

Tên project.

## 8.2. Abstract

Tóm tắt:

* Problem;
* Approach;
* Implementation;
* Main results;
* Contribution.

## 8.3. Keywords

Khoảng 4–6 từ khóa.

## 8.4. Introduction

Trình bày:

* Bối cảnh;
* Vấn đề;
* Motivation;
* Problem statement;
* Mục tiêu;
* Phạm vi;
* Đóng góp chính.

## 8.5. Background / Related Work

Trình bày:

* Kiến thức nền cần thiết;
* Các giải pháp liên quan;
* Các hệ thống/thuật toán tương tự;
* Hạn chế của các phương pháp liên quan.

Các nguồn tham khảo phải được trích dẫn đúng quy định.

## 8.6. Problem Definition

Mô tả bài toán một cách cụ thể.

Có thể bao gồm:

* Input;
* Output;
* Constraints;
* Assumptions;
* Network model;
* System requirements.

## 8.7. Proposed Approach

Trình bày giải pháp của nhóm.

Phải làm rõ:

* Ý tưởng;
* Algorithm;
* Architecture;
* Data flow;
* Communication flow;
* Protocol;
* Các quyết định thiết kế.

## 8.8. System Architecture

Bao gồm sơ đồ và giải thích:

* Client;
* Server;
* Service;
* Database;
* Network layer;
* Processing components.

## 8.9. Network Communication Design

Phải mô tả:

* Protocol;
* Message format;
* Connection;
* Request/response;
* Communication sequence;
* Error handling.

## 8.10. Implementation

Mô tả các thành phần chính của hệ thống.

Không cần đưa toàn bộ source code vào báo cáo.

Thay vào đó cần giải thích:

* Module;
* Class quan trọng;
* Algorithm;
* Data structure;
* Network components;
* Concurrency mechanism.

## 8.11. Experimental Setup

Mô tả:

* Hardware;
* Operating system;
* Programming language;
* Libraries;
* Network configuration;
* Dataset;
* Test cases;
* Test scenarios.

## 8.12. Results

Kết quả phải có số liệu thực tế.

Có thể sử dụng:

* Tables;
* Charts;
* Screenshots;
* Logs;
* Performance measurements.

Ví dụ:

| Metric               | Baseline | Proposed |
| -------------------- | -------: | -------: |
| Response time        |      ... |      ... |
| Throughput           |      ... |      ... |
| Blocking probability |      ... |      ... |
| Accepted requests    |      ... |      ... |

**Không được tự tạo hoặc làm giả số liệu thực nghiệm.**

## 8.13. Discussion

Không chỉ đưa bảng kết quả mà phải giải thích:

* Vì sao có kết quả đó;
* Ưu/nhược điểm;
* Trường hợp hệ thống hoạt động tốt;
* Trường hợp hệ thống còn hạn chế;
* Ý nghĩa của kết quả.

## 8.14. Novelty and Contributions

Đây là **phần bắt buộc**.

Phải trả lời:

> Project này khác gì so với baseline hoặc cách tiếp cận thông thường?

Nên trình bày dưới dạng:

| Contribution   | Description | Evidence |
| -------------- | ----------- | -------- |
| Contribution 1 | ...         | ...      |
| Contribution 2 | ...         | ...      |

Mỗi contribution cần có bằng chứng từ implementation hoặc experiment.

## 8.15. Limitations

Trình bày những vấn đề project chưa giải quyết được.

## 8.16. Future Work

Đề xuất hướng phát triển tiếp theo.

## 8.17. Conclusion

Tóm tắt:

* Bài toán;
* Giải pháp;
* Kết quả;
* Contribution.

## 8.18. References

Các tài liệu sử dụng phải được trích dẫn trong nội dung báo cáo.

## 8.19. Appendix

Có thể bao gồm:

* Protocol;
* Configuration;
* Additional results;
* Test cases;
* Database schema;
* Important code snippets.

---

# 9. Yêu cầu thực nghiệm

Mỗi project phải có ít nhất một nhóm thực nghiệm phù hợp với bài toán.

### Network application

Có thể đo:

* Response time;
* Throughput;
* Number of concurrent clients;
* Packet/message loss;
* Error rate;
* Connection time.

### File transfer

Có thể đo:

* Transfer time;
* Throughput;
* File integrity;
* Resume time;
* Parallel vs sequential transfer.

### Online Judge

Có thể đo:

* Number of concurrent submissions;
* Queue waiting time;
* Compilation time;
* Execution time;
* Throughput;
* Worker utilization.

### Game

Có thể đo:

* Latency;
* Number of concurrent players;
* Synchronization delay;
* Server response time;
* Packet/message rate.

### Optical Network

Có thể đo:

* Blocking probability;
* Spectrum utilization;
* Spectral efficiency;
* QoT prediction accuracy;
* Processing time;
* Number of accepted connections;
* Resource utilization.

---

# 10. Compilatio

Báo cáo phải được kiểm tra bằng **Compilatio** trước khi nộp.

### Quy định của học phần

> **Similarity + Plagiarism ≤ 20%: Đạt yêu cầu của học phần.**

Sinh viên cần lưu ý:

* Similarity không đồng nghĩa tuyệt đối với plagiarism;
* Nội dung được trích dẫn đúng vẫn có thể xuất hiện trong báo cáo similarity;
* Phải trích dẫn nguồn khi sử dụng ý tưởng, số liệu, hình ảnh, bảng biểu hoặc nội dung từ tài liệu khác;
* Không copy nguyên văn nội dung từ Internet hoặc báo cáo của nhóm khác;
* Không paraphrase nguồn mà không trích dẫn;
* Không sử dụng báo cáo của khóa trước làm báo cáo của nhóm mình.

Nhóm chịu trách nhiệm kiểm tra và chỉnh sửa báo cáo trước khi nộp.

---

# 11. Sử dụng AI

Sinh viên có thể sử dụng các công cụ AI phù hợp với quy định của nhà trường/học phần để hỗ trợ:

* Tìm hiểu khái niệm;
* Giải thích code;
* Debug;
* Gợi ý thiết kế;
* Kiểm tra lỗi;
* Cải thiện diễn đạt;
* Hỗ trợ tìm kiếm tài liệu.

Tuy nhiên:

> **Sinh viên chịu trách nhiệm hoàn toàn về source code, architecture, experiment, data, references và nội dung báo cáo.**

Sinh viên phải hiểu được phần code mình nộp.

Trong phần bảo vệ, giảng viên có thể yêu cầu:

* Giải thích một đoạn code;
* Giải thích packet/message flow;
* Vẽ lại architecture;
* Giải thích protocol;
* Sửa một chức năng nhỏ;
* Tìm và sửa lỗi;
* Giải thích kết quả experiment.

---

# 12. Cấu trúc project

Khuyến nghị:

```text
assignment-network-project/
│
├── README.md
├── INSTRUCTION.md
├── TOPICS.md
│
├── report/
│   └── report.pdf
│
├── statics/
│   ├── architecture.png
│   ├── protocol.png
│   ├── results/
│   └── dataset/
│
└── source/
    ├── client/
    ├── server/
    ├── common/
    ├── service/
    └── ...
```

Có thể thay đổi cấu trúc tùy project nhưng phải đảm bảo dễ đọc và dễ chạy.

---

# 13. README

README phải cho phép người khác hiểu và chạy project mà không cần nhóm giải thích trực tiếp.

README tối thiểu phải có:

* Project description;
* Architecture;
* Technology stack;
* Requirements;
* Installation;
* Configuration;
* Database setup;
* Run server;
* Run client;
* Test;
* Experimental results;
* Novelty;
* Limitations;
* References.

---

# 14. Nộp source code

Source code của project được nộp thông qua **Google Drive**.

**Link và quy định cụ thể sẽ được thông báo sau.**

Nhóm phải đảm bảo:

* Source code đầy đủ;
* Không thiếu dependency cần thiết;
* Có README;
* Có configuration/sample data nếu cần;
* Có thể kiểm tra và chạy project.

GitHub/GitLab được khuyến khích sử dụng trong quá trình phát triển để quản lý source code và lịch sử commit, nhưng hình thức nộp chính thức thực hiện theo hướng dẫn của giảng viên.

---

# 15. Quy trình thực hiện

### Bước 1 – Chọn topic

Chọn topic trong `TOPICS.md` hoặc đề xuất topic riêng.

### Bước 2 – Phân tích

Xác định:

* Problem;
* Objective;
* Requirement;
* Architecture;
* Network communication;
* Protocol.

### Bước 3 – Thiết kế

Thiết kế:

* Architecture;
* Data flow;
* Message flow;
* Database;
* Algorithm;
* Concurrency.

### Bước 4 – Implementation

Triển khai từng module và kiểm thử thường xuyên.

### Bước 5 – Integration

Tích hợp Client, Server, Database và các service.

### Bước 6 – Experiment

Thiết kế test cases và thu thập số liệu.

### Bước 7 – Analysis

Phân tích kết quả, so sánh và xác định contribution.

### Bước 8 – Report

Hoàn thiện báo cáo theo cấu trúc paper.

### Bước 9 – Compilatio

Kiểm tra similarity.

**Similarity ≤ 20% là yêu cầu đạt của học phần.**

### Bước 10 – Final Test

Kiểm tra:

* Source;
* README;
* Installation;
* Run;
* Demo;
* Report;
* Google Drive.

---

# 16. Đánh giá đề xuất

| Nội dung                                       | Tỷ trọng |
| ---------------------------------------------- | -------: |
| Problem, idea và functionality                 |      20% |
| Network programming & technical implementation |      25% |
| Novelty & technical contribution               |      15% |
| Experiment & evaluation                        |      15% |
| Report & documentation                         |      10% |
| Demo & oral defense                            |      15% |
| **Tổng**                                       | **100%** |

Trong phần đánh giá cá nhân, sinh viên cần chứng minh phần đóng góp thực tế của mình.

---

# 17. Kiểm tra và bảo vệ

Giảng viên có thể kiểm tra:

### Project

* Có chạy được không?
* Architecture có đúng với README không?
* Client và Server giao tiếp thế nào?
* Protocol là gì?
* Xử lý nhiều client thế nào?
* Database được sử dụng thế nào?
* Error handling ra sao?

### Code

Sinh viên có thể được yêu cầu:

* Giải thích một class;
* Giải thích một method;
* Giải thích network flow;
* Giải thích thread;
* Giải thích protocol;
* Sửa một lỗi;
* Bổ sung một chức năng nhỏ.

### Experiment

Sinh viên phải giải thích:

* Test như thế nào;
* Metric là gì;
* Vì sao lựa chọn metric;
* Kết quả có ý nghĩa gì;
* Hạn chế của experiment.

---

# 18. Final Checklist

Trước khi nộp, nhóm cần kiểm tra:

* [ ] Đã chọn topic hợp lệ;
* [ ] Problem được xác định rõ;
* [ ] Objective rõ ràng;
* [ ] Có architecture diagram;
* [ ] Có network communication;
* [ ] Có protocol/message format;
* [ ] Có concurrency nếu phù hợp;
* [ ] Có error handling;
* [ ] Project chạy được;
* [ ] README đầy đủ;
* [ ] Có test cases;
* [ ] Có experiment;
* [ ] Có số liệu thực tế;
* [ ] Có discussion;
* [ ] Có Novelty/Contributions;
* [ ] Có limitations;
* [ ] Có references;
* [ ] Compilatio ≤ 20%;
* [ ] Source code đầy đủ;
* [ ] Google Drive link hoạt động;
* [ ] Tất cả thành viên hiểu project và source code.

---

# 19. Nguyên tắc quan trọng nhất

Một project tốt không chỉ được đánh giá bằng số lượng chức năng.

Một project có giá trị cần trả lời được bốn câu hỏi:

> **1. Bài toán là gì?**

> **2. Hệ thống giải quyết bài toán như thế nào?**

> **3. Điểm cải tiến/đóng góp của nhóm là gì?**

> **4. Có bằng chứng thực nghiệm nào cho thấy giải pháp hoạt động như thế nào?**

Sinh viên được khuyến khích lựa chọn những bài toán có khả năng mở rộng, có thể đo lường được và có giá trị thực tiễn hoặc kỹ thuật rõ ràng.
