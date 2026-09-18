---
name: express-api-reviewer
description: >-
  Standard operating procedure and architectural benchmark for conducting comprehensive code reviews on
  Node.js, Express 5, TypeScript and PostgreSQL backend code. Use this skill whenever reviewing routers,
  controllers, services, repositories, middlewares, Zod schemas, SQL queries or database migrations to
  identify issues categorized into clear priority levels (P0 Security & Data Integrity, P1 Architecture
  & Correctness, P2 Performance & Database, P3 Clean Code & DX).
---

# Express 5 & PostgreSQL Code Reviewer Skill

Quy trình chuẩn hóa và bộ tiêu chí đánh giá (Best Practices) để review, phát hiện lỗi và đề xuất tối ưu cho code Backend Node.js / Express 5 / TypeScript / PostgreSQL.

> Skill này là cặp đôi đối xứng của `express-api-craftsman`: craftsman dùng khi **viết** code, reviewer dùng khi **kiểm tra** code.

---

## 🎯 Phân Loại Thứ Tự Ưu Tiên (Priority Levels)

Mọi vấn đề phát hiện MUST được gắn nhãn theo 4 mức độ ưu tiên:

```text
🚨 P0: Critical (Security, SQL Injection, Rò rỉ dữ liệu, Mất toàn vẹn dữ liệu, Crash process)
   └── ⚠️ P1: High (Vi phạm kiến trúc 3 tầng, Sai logic nghiệp vụ, Thiếu validation, Error handling sai)
       └── ⚡ P2: Medium (Hiệu năng DB, N+1 query, Thiếu index, Connection leak, Caching)
           └── 💡 P3: Low (Clean Code, TypeScript strictness, Naming, OpenAPI docs, DX)
```

---

## 🔍 Bộ Tiêu Chí Review Theo Mức Độ Ưu Tiên

### 🚨 P0 - Critical (Bảo Mật & Toàn Vẹn Dữ Liệu)

1. **SQL Injection**:
   - Nối chuỗi trực tiếp biến vào câu SQL (`` `WHERE id = ${id}` ``, `"... " + name`) thay vì parameterized `$1, $2`.
   - Truyền tên cột / hướng `ORDER BY` / `LIMIT` từ `req.query` thẳng vào SQL mà không whitelist qua một map hằng số.
   - Dùng `LIKE '%' || $1 || '%'` mà không escape ký tự `%` và `_` do người dùng nhập (chấp nhận được nếu chỉ ảnh hưởng kết quả tìm kiếm, nâng P0 nếu có `ILIKE` trên cột nhạy cảm).

2. **Authentication & Authorization**:
   - Route ghi/xóa (`POST`, `PUT`, `PATCH`, `DELETE`) thiếu `verifyToken` hoặc thiếu `authAdmin` cho hành động quản trị.
   - **Broken Object Level Authorization (BOLA/IDOR)**: Service thao tác theo `id` từ params mà không kiểm tra `resource.user_id === req.user.id` (hoặc role admin).
   - Tin tưởng `role`, `userId`, `isAdmin` gửi lên từ `req.body` thay vì lấy từ token đã verify.
   - JWT: thiếu kiểm tra `expiresIn`, dùng secret hardcode trong source thay vì `env`, hoặc verify bằng thuật toán `none`.

3. **Rò Rỉ Dữ Liệu Nhạy Cảm (Sensitive Data Exposure)**:
   - `SELECT *` trên bảng `users` rồi trả thẳng về client kèm `password_hash`, `otp`, `refresh_token`, `reset_token`.
   - Log ra password, token, OTP, thông tin thẻ, hoặc toàn bộ `req.body` của route đăng nhập.
   - Trả stack trace / message lỗi gốc của PostgreSQL về client ở môi trường production.

4. **Mất Toàn Vẹn Dữ Liệu (Data Integrity)**:
   - Nhiều thao tác ghi phụ thuộc nhau (recipe + ingredients + steps) nhưng **không bọc trong Transaction** `BEGIN / COMMIT / ROLLBACK`.
   - Transaction có `client.connect()` nhưng thiếu `client.release()` trong `finally` ➔ cạn kiệt connection pool.
   - Thiếu `ROLLBACK` trong `catch` ➔ transaction treo giữ khóa bảng.
   - Read-modify-write không atomic (ví dụ: `SELECT views` ➔ `UPDATE views = value + 1`) thay vì `UPDATE ... SET views = views + 1`.

5. **Crash Process & Unhandled Errors**:
   - `async` handler không có `try/catch` và không `next(error)` ➔ unhandled rejection.
   - Lỗi ném ra bên trong callback/`setInterval`/job nền không được bắt.
   - Thiếu xử lý mật khẩu: lưu plaintext, hoặc dùng hash yếu (`md5`, `sha1`) thay vì `bcrypt`/`argon2`.

6. **Uploads & Input Nguy Hiểm**:
   - Upload file không giới hạn `fileSize`, không whitelist `mimetype`, hoặc dùng tên file gốc của user làm đường dẫn ghi đĩa (Path Traversal).
   - Body parser không giới hạn kích thước (`express.json({ limit })`) ➔ DoS.
   - Webhook không xác thực chữ ký (signature) người gửi.

---

### ⚠️ P1 - High (Kiến Trúc, Logic & Error Handling)

1. **Vi Phạm Kiến Trúc 3 Tầng (Strict Layering)**:
   - Controller gọi thẳng `query(...)` / repository, bỏ qua tầng Service.
   - Service import `Request`/`Response` của Express hoặc đọc `req.body` ➔ tầng nghiệp vụ bị dính HTTP.
   - Repository chứa logic nghiệp vụ (if/else quyết định trạng thái) thay vì chỉ truy vấn DB.
   - Router chứa logic xử lý inline thay vì trỏ tới controller.

2. **Validation Thiếu Hoặc Sai Chỗ**:
   - Route nhận body/query/params nhưng thiếu `validateBody` / `validateQuery` / `validateParams` với Zod.
   - Zod schema quá lỏng (`z.any()`, `z.string()` cho ID số, thiếu `.min()/.max()`, thiếu `coerce` cho query number).
   - Cho phép field thừa đi vào câu `UPDATE` (Mass Assignment) ➔ user tự set `role`, `is_verified`.
   - Validate thủ công bằng `if (!req.body.name)` rải rác trong controller thay vì dùng schema tập trung.

3. **Error Handling Chuẩn Hóa**:
   - Ném `throw new Error(...)` thô thay vì `AppError(message, statusCode)` ➔ mọi lỗi nghiệp vụ thành 500.
   - Trả lỗi trực tiếp `res.status(400).json(...)` trong service/controller thay vì đi qua `errorHandler` trung tâm.
   - HTTP status sai ngữ nghĩa: trả `200` khi tạo mới (đúng là `201`), trả `500` khi không tìm thấy (đúng là `404`), trả `404` khi thiếu quyền (đúng là `403`).
   - `errorHandler` không đặt cuối cùng sau tất cả routes, hoặc thiếu 4 tham số `(err, req, res, next)`.
   - Gọi `res.json()` rồi vẫn tiếp tục thực thi (thiếu `return`) ➔ `ERR_HTTP_HEADERS_SENT`.

4. **Logic Nghiệp Vụ & Hợp Đồng API**:
   - Thiếu kiểm tra tồn tại trước khi update/delete (repository trả `null` nhưng service không xử lý).
   - Thiếu kiểm tra trùng lặp (unique slug/email) trước khi insert, chỉ dựa vào lỗi constraint của Postgres.
   - Response không theo chuẩn `sendSuccess` / `{ success, data, ... }` ➔ phá vỡ contract với frontend.
   - Thay đổi shape response hoặc tên field mà không cập nhật schema OpenAPI và frontend tương ứng.

5. **Cấu Hình & Môi Trường**:
   - Đọc `process.env` rải rác thay vì qua `config/env.ts` đã validate bằng Zod.
   - Secret/API key hardcode trong source hoặc commit vào repo.
   - Thiếu `helmet`, cấu hình `cors` mở `origin: "*"` trên route có credentials.
   - Thiếu rate limit cho các endpoint nhạy cảm (login, register, forgot-password, OTP, upload).

---

### ⚡ P2 - Medium (Hiệu Năng Database & Tài Nguyên)

1. **N+1 Query**:
   - Vòng lặp `for` gọi `await repository.findById(...)` từng phần tử thay vì một câu `WHERE id = ANY($1)` hoặc `JOIN` / `LEFT JOIN LATERAL`.
   - Lấy danh sách rồi bắn thêm query đếm/quan hệ cho từng dòng thay vì gộp bằng `json_agg` / subquery.

2. **Truy Vấn Không Tối Ưu**:
   - `SELECT *` khi chỉ cần vài cột (đặc biệt bảng có cột `TEXT` lớn).
   - Thiếu `LIMIT`/`OFFSET` cho endpoint danh sách ➔ trả toàn bộ bảng.
   - Đếm tổng bằng cách lấy hết rồi `rows.length` thay vì `COUNT(*)` hoặc `COUNT(*) OVER ()`.
   - Lọc/sắp xếp/phân trang ở tầng JavaScript thay vì đẩy xuống SQL.
   - `OFFSET` rất lớn cho infinite scroll thay vì keyset pagination (`WHERE id < $cursor`).
   - Query chạy `count` và `data` tuần tự bằng 2 `await` thay vì `Promise.all`.

3. **Index & Schema Database**:
   - Cột dùng trong `WHERE`, `JOIN`, `ORDER BY` thường xuyên (`slug`, `user_id`, `category_id`, `created_at`) thiếu index.
   - Thiếu `UNIQUE` constraint cho `email`, `slug`; thiếu `FOREIGN KEY` + `ON DELETE` rõ ràng.
   - Dùng kiểu dữ liệu sai: lưu tiền bằng `FLOAT` thay vì `NUMERIC`, thời gian bằng `TIMESTAMP` không timezone thay vì `TIMESTAMPTZ`.
   - Thiếu `NOT NULL` / `DEFAULT` cho cột bắt buộc.

4. **Connection Pool & Tài Nguyên**:
   - Tạo `new Pool()` nhiều lần / trong mỗi request thay vì singleton ở `config/db.ts`.
   - Không cấu hình `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` cho pool.
   - Job nền / `setInterval` không có cơ chế dừng hoặc chồng lấn khi chạy quá lâu.

5. **Caching & I/O**:
   - Dữ liệu ít thay đổi (categories, cấu hình) query DB mỗi request mà không dùng Redis / in-memory cache.
   - Cache ghi nhưng thiếu invalidation khi dữ liệu thay đổi ➔ stale data.
   - Gọi tuần tự nhiều I/O độc lập (upload, email, external API) thay vì `Promise.all`.
   - Tác vụ chậm (gửi email, xử lý ảnh) chạy đồng bộ trong request thay vì đẩy vào queue (QStash/job).
   - Thiếu `compression`, thiếu `ETag`/`Cache-Control` cho response tĩnh hoặc ít đổi.

---

### 💡 P3 - Low (Clean Code, TypeScript & Developer Experience)

1. **TypeScript Strictness**:
   - Dùng `any` cho `req.body`, kết quả query, hoặc `catch (error: any)`.
   - `result.rows[0]` ép kiểu bằng `as T` mà không có kiểm chứng; thiếu kiểu trả về `Promise<T | null>`.
   - Không tái sử dụng type từ `src/types/*.type.ts`, khai báo type trùng lặp ở nhiều nơi.
   - Relative import còn đuôi `.js` (dự án dùng `tsup`/`tsx` ➔ **bắt buộc bỏ `.js`**).

2. **Tài Liệu OpenAPI / Swagger**:
   - Endpoint mới chưa đăng ký `registry.registerPath(...)` ➔ Swagger `/docs` lệch với thực tế.
   - Thiếu khai báo `security: [{ BearerAuth: [] }]` cho route cần token.
   - Thiếu các mã response 400 / 401 / 403 / 404 / 500 trong tài liệu.
   - `README.md` chưa cập nhật danh sách endpoint.

3. **Clean Code & Cấu Trúc**:
   - Magic numbers / strings (`10`, `"pending"`, `3600`) rải rác thay vì hằng số (`DEFAULT_PAGE_SIZE`, `RECIPE_STATUS`).
   - Câu SQL dài lặp lại ở nhiều hàm thay vì tách thành helper/constant dùng chung.
   - Hàm service quá dài, ôm nhiều trách nhiệm (> 80 dòng) nên tách nhỏ.
   - Đặt tên không nhất quán: file phải theo `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`; cột DB dùng `snake_case`, biến TS dùng `camelCase` (kiểm tra việc map giữa 2 quy ước có nhất quán không).
   - Code chết, `console.log` debug còn sót lại thay vì dùng `logger`.

4. **Vận Hành (Operability)**:
   - Thiếu log có cấu trúc (level, requestId) cho lỗi 5xx.
   - Thiếu endpoint `/health` hoặc graceful shutdown (đóng pool khi nhận `SIGTERM`).

---

## 📝 Quy Trình Review

### Bước 1: Xác Định Phạm Vi & Đọc Theo Chiều Dọc

Với mỗi tính năng cần review, đọc **trọn vẹn một lát cắt dọc** theo thứ tự luồng dữ liệu để đánh giá đúng ngữ cảnh:

```text
routes/<feature>.router.ts  ➔ middleware & quyền
schemas/<feature>.schema.ts ➔ validation & OpenAPI
controllers/*.controller.ts ➔ I/O HTTP
services/*.service.ts       ➔ nghiệp vụ & AppError
repositories/*.repository.ts➔ SQL & transaction
db/schema.sql               ➔ kiểu dữ liệu, index, constraint
```

### Bước 2: Đối Chiếu Với Bộ Tiêu Chí P0 ➔ P3

Quét lần lượt từng nhóm tiêu chí ở trên. Với mỗi phát hiện, ghi rõ: **file + số dòng**, **lý do vì sao sai**, và **cách sửa cụ thể (kèm code)**.

### Bước 3: Tổng Hợp Báo Cáo

Trình bày kết quả theo đúng mẫu dưới đây:

````markdown
# 📋 Kết Quả Code Review: [Tên Feature/File]

## 🌟 Đánh Giá Tổng Quan

- **Phạm vi review**: [Danh sách file đã đọc]
- **Điểm mạnh**: [1-2 điểm làm tốt]
- **Tình trạng chung**: [Xuất sắc / Cần cải thiện / Có lỗi nghiêm trọng]

---

## 🚨 P0: Bảo Mật & Toàn Vẹn Dữ Liệu (Cần Sửa Ngay)

### 1. [Tiêu đề lỗi] — `src/...ts:42`

- **Vấn đề**: [Mô tả ngắn gọn]
- **Rủi ro**: [SQL Injection / IDOR / Rò rỉ dữ liệu / Mất dữ liệu...]
- **Cách sửa**:
  ```typescript
  // trước
  // sau
  ```
````

## ⚠️ P1: Kiến Trúc, Validation & Error Handling

- [Mô tả hoặc "✅ Không phát hiện vấn đề P1"]

## ⚡ P2: Hiệu Năng Database & Tài Nguyên

- [Mô tả N+1, index, transaction, caching...]

## 💡 P3: Clean Code, TypeScript & Tài Liệu

- [Mô tả type safety, naming, OpenAPI, magic values...]

---

## ✅ Thứ Tự Hành Động Đề Xuất

1. [Việc cần làm trước tiên]
2. [...]

```

---

## ✅ Checklist Nhanh Trước Khi Kết Thúc Review

- [ ] Mọi câu SQL đều dùng parameterized `$1, $2`; không có chuỗi nối từ input người dùng?
- [ ] Mọi route ghi/xóa đều có `verifyToken` (+ `authAdmin` nếu cần) và kiểm tra quyền sở hữu bản ghi?
- [ ] Không có `password_hash` / token / OTP nào lọt ra response hoặc log?
- [ ] Thao tác nhiều bảng đã bọc transaction với `ROLLBACK` + `client.release()` trong `finally`?
- [ ] Mọi async controller đều `try/catch` ➔ `next(error)`; lỗi nghiệp vụ dùng `AppError` với status đúng?
- [ ] Mọi input (body/query/params) đều qua Zod schema, không có mass assignment?
- [ ] Endpoint danh sách có phân trang + `LIMIT`; không có N+1 query trong vòng lặp?
- [ ] Cột dùng cho `WHERE`/`JOIN`/`ORDER BY` đã có index trong `db/schema.sql`?
- [ ] Tầng Service không import gì từ `express`; Controller không gọi trực tiếp repository?
- [ ] Relative imports đã bỏ đuôi `.js`; không còn `any` không cần thiết?
- [ ] OpenAPI `registry.registerPath` và `README.md` đã khớp với endpoint thực tế?
- [ ] Đã chạy `npm run build` trong `/api` để chắc chắn TypeScript compile thành công?
```
