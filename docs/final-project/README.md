# NETWORK PROGRAMMING – FINAL PROJECT

> **Academic Year 2026–2027**

---

# 1. Project Information

## 1.1. Project Name

**[Tên project]**

## 1.2. Topic

**[Mã topic – Tên topic]**

## 1.3. Group

| No. | Student ID | Full Name | Email | Main Responsibility | Contribution |
| --- | ---------- | --------- | ----- | ------------------- | -----------: |
| 1   | ...        | ...       | ...   | ...                 |         ...% |
| 2   | ...        | ...       | ...   | ...                 |         ...% |
| 3   | ...        | ...       | ...   | ...                 |         ...% |
|     |            |           |       | **Total**           |     **100%** |

## 1.4. Instructor

**[Tên giảng viên]**

---

# 2. Project Summary

## 2.1. Problem

[Mô tả bài toán cần giải quyết.]

## 2.2. Motivation

[Tại sao bài toán này cần được giải quyết?]

## 2.3. Objectives

Project hướng tới các mục tiêu:

1. ...
2. ...
3. ...

## 2.4. Scope

### In scope

* ...
* ...
* ...

### Out of scope

* ...
* ...
* ...

---

# 3. System Overview

## 3.1. System Description

[Mô tả tổng quan hệ thống.]

## 3.2. Target Users

[Đối tượng sử dụng hệ thống.]

## 3.3. Main Functions

| Function | Description | Status |
| -------- | ----------- | ------ |
| ...      | ...         | Done   |
| ...      | ...         | Done   |
| ...      | ...         | ...    |

---

# 4. System Architecture

## 4.1. Architecture Diagram

Đặt architecture diagram tại:

```text
statics/architecture.png
```

Hoặc chèn trực tiếp:

```text
![System Architecture](statics/architecture.png)
```

## 4.2. Components

| Component | Responsibility |
| --------- | -------------- |
| Client    | ...            |
| Server    | ...            |
| Database  | ...            |
| Service   | ...            |
| Worker    | ...            |

## 4.3. Data Flow

[Mô tả luồng dữ liệu.]

---

# 5. Network Communication Design

## 5.1. Communication Model

Ví dụ:

```text
Client
   |
 TCP
   |
Server
   |
Database
```

## 5.2. Protocol

**Protocol:** [TCP / UDP / HTTP / RMI / Custom Protocol / ...]

## 5.3. Message Format

Ví dụ:

```text
REQUEST:
{
    "type": "...",
    "data": "..."
}
```

## 5.4. Communication Sequence

```text
Client                Server
  |                      |
  |------ CONNECT ------>|
  |                      |
  |------ REQUEST ------->|
  |                      |
  |<----- RESPONSE -------|
  |                      |
  |------- CLOSE -------->|
```

## 5.5. Error Handling

Mô tả cách hệ thống xử lý:

* Invalid request;
* Timeout;
* Disconnect;
* Invalid data;
* Server error;
* Database error;
* Other exceptions.

---

# 6. Technology Stack

| Category   | Technology           |
| ---------- | -------------------- |
| Language   | Java / ...           |
| Network    | TCP / UDP / ...      |
| Database   | ...                  |
| Framework  | ...                  |
| Build Tool | Maven / Gradle / ... |
| IDE        | ...                  |
| OS         | ...                  |

---

# 7. Novelty and Contributions

## 7.1. Baseline

[Mô tả hệ thống/thuật toán/phương pháp baseline.]

## 7.2. Proposed Improvement

[Mô tả giải pháp của nhóm.]

## 7.3. Contributions

| No. | Contribution | Description | Evidence |
| --- | ------------ | ----------- | -------- |
| 1   | ...          | ...         | ...      |
| 2   | ...          | ...         | ...      |
| 3   | ...          | ...         | ...      |

## 7.4. Baseline vs Proposed

| Aspect        | Baseline | Proposed |
| ------------- | -------- | -------- |
| Architecture  | ...      | ...      |
| Algorithm     | ...      | ...      |
| Communication | ...      | ...      |
| Performance   | ...      | ...      |
| Functionality | ...      | ...      |

---

# 8. Project Structure

```text
project/
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
│   ├── dataset/
│   └── results/
│
└── source/
    ├── client/
    ├── server/
    ├── common/
    ├── service/
    └── ...
```

---

# 9. Requirements

## Hardware

* CPU: ...
* RAM: ...
* Disk: ...

## Software

* OS: ...
* Java: ...
* Maven/Gradle: ...
* Database: ...
* Other dependencies: ...

---

# 10. Installation

## 10.1. Clone / Download

```bash
git clone [repository-url]
```

hoặc download source code từ Google Drive.

## 10.2. Install Dependencies

```bash
[command]
```

## 10.3. Database Setup

```bash
[database command]
```

hoặc:

```text
Database script:
source/database/schema.sql
```

## 10.4. Configuration

[Mô tả các file configuration.]

---

# 11. Running the Project

## 11.1. Start Server

```bash
[command]
```

## 11.2. Start Client

```bash
[command]
```

## 11.3. Start Multiple Clients

```bash
[command]
```

## 11.4. Run Test

```bash
[command]
```

---

# 12. Main Features

| No. | Feature | Description | Test   |
| --- | ------- | ----------- | ------ |
| 1   | ...     | ...         | Passed |
| 2   | ...     | ...         | Passed |
| 3   | ...     | ...         | Passed |

---

# 13. Experimental Setup

## 13.1. Environment

[Mô tả môi trường thực nghiệm.]

## 13.2. Dataset

[Mô tả dataset nếu có.]

## 13.3. Test Scenarios

### Scenario 1

[Mô tả.]

### Scenario 2

[Mô tả.]

### Scenario 3

[Mô tả.]

## 13.4. Evaluation Metrics

Các metric sử dụng:

* Response time;
* Throughput;
* Error rate;
* Concurrent users;
* Resource utilization;
* hoặc metric đặc thù của project.

---

# 14. Experimental Results

## 14.1. Functional Results

![Demo](statics/results/demo.png)

## 14.2. Performance Results

| Scenario   | Metric 1 | Metric 2 | Metric 3 |
| ---------- | -------: | -------: | -------: |
| Scenario 1 |      ... |      ... |      ... |
| Scenario 2 |      ... |      ... |      ... |
| Scenario 3 |      ... |      ... |      ... |

## 14.3. Comparison

| Metric | Baseline | Proposed | Difference |
| ------ | -------: | -------: | ---------: |
| ...    |      ... |      ... |        ... |
| ...    |      ... |      ... |        ... |

> **Only report measured or reproducible results. Do not fabricate experimental data.**

---

# 15. Discussion

[Giải thích kết quả.]

Các câu hỏi nên được trả lời:

1. Kết quả có đạt mục tiêu không?
2. Vì sao hệ thống có kết quả như vậy?
3. Khi tăng số lượng client/request thì điều gì xảy ra?
4. Bottleneck nằm ở đâu?
5. Giải pháp có ưu điểm gì?
6. Giải pháp có hạn chế gì?

---

# 16. Limitations

Các hạn chế hiện tại:

1. ...
2. ...
3. ...

---

# 17. Future Work

Các hướng phát triển:

1. ...
2. ...
3. ...

---

# 18. Report

Báo cáo đầy đủ được đặt tại:

```text
report/report.pdf
```

Báo cáo phải tuân thủ cấu trúc được quy định trong `INSTRUCTION.md`.

Báo cáo phải được kiểm tra bằng **Compilatio**.

> **Similarity ≤ 20% là yêu cầu đạt của học phần.**

---

# 19. References

Các tài liệu tham khảo được sử dụng:

1. ...
2. ...
3. ...

Các tài liệu phải được trích dẫn trong nội dung báo cáo khi sử dụng.

---

# 20. Team Contribution

| Student   | Main Contribution | Percentage |
| --------- | ----------------- | ---------: |
| Student 1 | ...               |       ...% |
| Student 2 | ...               |       ...% |
| Student 3 | ...               |       ...% |
| **Total** |                   |   **100%** |

---

# 21. Demo

## Demo Environment

* Server machine: ...
* Client machine(s): ...
* Network: ...
* Number of clients: ...

## Demo Steps

### Step 1

...

### Step 2

...

### Step 3

...

---

# 22. Submission

## Source Code

Project source code được nộp thông qua **Google Drive**.

**Submission link sẽ được giảng viên thông báo sau.**

## Report

```text
report/report.pdf
```

## Required Contents

* Source code;
* README;
* Report;
* Configuration;
* Database script nếu có;
* Dataset/sample data nếu có;
* Test cases;
* Experimental results;
* Architecture diagrams.

---

# 23. Final Verification

Before submission:

```text
[ ] Project can run
[ ] Server can start
[ ] Client can connect
[ ] Network communication works
[ ] Protocol is documented
[ ] Multiple clients tested
[ ] Error handling tested
[ ] Experiments completed
[ ] Results are reproducible
[ ] Novelty is clearly stated
[ ] README is complete
[ ] Report is complete
[ ] References are included
[ ] Compilatio <= 20%
[ ] Google Drive link is accessible
[ ] All team members understand the project
```

---

# 24. Contact

For questions about:

* Topic selection;
* Architecture;
* Technical implementation;
* Project scope;
* Report structure;

contact the course instructor.
