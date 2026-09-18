# 📋 Kết Quả Code Review: Backend `recipes/api`

## 🌟 Đánh Giá Tổng Quan

- **Phạm vi**: app/server, config (db, redis, qstash), middlewares (auth, validate, errorHandler, upload, qstash), 4 lát cắt feature (recipe, user, category, upload), webhook, jobs, `db/schema.sql`.
- **Điểm mạnh**: kiến trúc 3 tầng khá kỷ luật; **100% query dùng parameterized `$1,$2`**; transaction có đủ `BEGIN/ROLLBACK/finally release`; refresh token rotation + reuse-detection rất tốt; OTP hash + lockout; helmet, payload limit 10kb, server timeouts chống Slowloris; Zod + OpenAPI đồng bộ; Redis cache-aside + batch view count.
- **Tình trạng chung**: **Cần cải thiện** — nền tảng tốt nhưng có 3 lỗi P0 về access control và rate limiting.

---

## 🚨 P0: Bảo Mật & Toàn Vẹn Dữ Liệu (Cần Sửa Ngay)

### 1. Rate limiter bypass 100% bằng header giả mạo — `app.ts:14`, `app.ts:71-80`, `logger.ts:26-38`

- **Vấn đề**: `app.set("trust proxy", true)` tin tưởng **mọi** hop, còn `getClientIp()` lấy phần tử **trái nhất** của `X-Forwarded-For` — giá trị client tự đặt được. `keyGenerator` của limiter dùng chính hàm này.
- **Rủi ro**:
  - Gửi `X-Forwarded-For: <random>` mỗi request → mỗi request là một "IP" mới → limiter vô hiệu hoàn toàn.
  - Tệ hơn: `skip: (req) => getClientIp(req) === "222.252.30.184"` — chỉ cần đặt `X-Forwarded-For: 222.252.30.184` là **bỏ qua rate limit tuyệt đối**. (IP cá nhân hardcode trong source cũng không nên.)
  - `validate: { trustProxy: false }` đang **tắt đúng cảnh báo** mà `express-rate-limit` dựng lên cho lỗi này.
  - Hệ quả dây chuyền: brute-force `/users/login`, dội OTP `/users/forgot-password`, spam `/upload`.
- **Cách sửa**:

  ```typescript
  // app.ts — chỉ tin số hop thực tế (Render/Cloudflare thường là 1..2)
  app.set("trust proxy", 1);

  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    // bỏ keyGenerator tuỳ biến -> dùng req.ip do Express tính theo trust proxy
    // bỏ hẳn skip theo IP hardcode; nếu cần allowlist thì dùng secret header/env
  });
  ```

  Giữ `getClientIp()` cho **logging** thì được, nhưng tuyệt đối không dùng làm khoá bảo mật.

### 2. Broken Access Control: `GET /api/recipes/:id` trả cả recipe chưa duyệt và đã xoá mềm — `recipe.repository.ts:78-127`, `recipe.router.ts:28`

- **Vấn đề**: route công khai (không `verifyToken`), nhưng `findRecipeById` **không lọc** `deleted_at IS NULL` và `status = 'approved'`.
- **Rủi ro**: bất kỳ ai đoán/duyệt id hoặc slug đều đọc được nội dung `pending` / `rejected` (kèm `rejection_reason`) và nội dung admin đã xoá → vô hiệu hoá toàn bộ quy trình kiểm duyệt.
- **Cách sửa**: truyền ngữ cảnh người xem xuống repository.
  ```typescript
  // repository
  const findRecipeById = async (id: string, viewer?: { id: number; role: string }) => {
    const isNumeric = /^\d+$/.test(id)
    const visibility =
      viewer?.role === "admin"
        ? ""
        : `AND r.deleted_at IS NULL AND (r.status = 'approved' OR r.author_id = $2)`
    const sql = `... WHERE ${isNumeric ? "r.id = $1" : "r.slug = $1"} ${visibility}`
    const params = viewer?.role === "admin" ? [id] : [id, viewer?.id ?? null]
    ...
  }
  ```
  Lưu ý `updateRecipe` trong service cũng gọi `findRecipeById` để check ownership → nhớ truyền `viewer` phù hợp (hoặc tách một hàm `findRecipeByIdRaw` dùng nội bộ).

### 3. Rò rỉ thông điệp lỗi nội bộ ra client trên mọi lỗi 5xx — `errorHandler.ts:24-36`

- **Vấn đề**: `const message = err.message || "Internal Server Error"` được trả về **kể cả khi statusCode = 500** và lỗi không phải `AppError`.
- **Rủi ro**: lộ chi tiết PostgreSQL ra ngoài, ví dụ `duplicate key value violates unique constraint "recipes_slug_key"`, `column "xxx" does not exist`, `invalid input syntax for type integer: "NaN"` → vẽ đường cho kẻ tấn công lập bản đồ schema.
- **Cách sửa**:
  ```typescript
  const isOperational = err instanceof AppError;
  const message =
    isOperational || statusCode < 500
      ? err.message
      : "Đã có lỗi xảy ra. Vui lòng thử lại sau.";
  ```

---

## ⚠️ P1: Kiến Trúc, Validation & Error Handling

1. **TLS tới PostgreSQL bị tắt xác thực** — `db.ts:7`: `rejectUnauthorized: false` chấp nhận mọi certificate → MITM có thể đánh cắp credentials/dữ liệu. Nên nạp CA cert của nhà cung cấp qua env (`ssl: { ca: process.env.PG_CA_CERT }`).

2. **`src/config/env.ts` đang rỗng** — toàn bộ code đọc `process.env` rải rác (`user.service.ts:14`, `auth.ts:29`, app.ts, redis.ts...) với `JWT_SECRET as string` / `SECRET_KEY!`. Nếu thiếu biến, app vẫn khởi động rồi chết ở runtime. Cần Zod-validate env và fail-fast lúc boot.

3. **Thiếu rate limit riêng cho endpoint nhạy cảm** — `/users/login`, `POST /users`, `/forgot-password`, `/resend-verification`, `/upload` đều dùng chung limiter 200 req/5'. Thêm `authLimiter` (5–10 req/15') theo IP **và** theo email. Ngoài ra `user.service.ts:196-219` không đếm số lần **gửi** OTP (chỉ đếm số lần **nhập sai**) → có thể dội mail liên tục và ghi đè OTP của nạn nhân.

4. **`ORDER BY` nội suy chuỗi** — `recipe.repository.ts:60`: `ORDER BY ${sortBy} ${sortOrder}`. Hiện an toàn **chỉ vì** Zod enum chặn ở router, nhưng repository không tự phòng vệ. Whitelist ngay tại tầng DB:

   ```typescript
   const SORT_COLUMNS = {
     created_at: "created_at",
     view_count: "view_count",
   } as const;
   const ORDER = { asc: "ASC", desc: "DESC" } as const;
   const col = SORT_COLUMNS[sortBy] ?? "created_at";
   const dir = ORDER[sortOrder] ?? "DESC";
   ```

5. **Không route nào validate path params** — `/recipes/:id`, `/categories/:id`. `Number("abc")` → `NaN` → Postgres ném lỗi → **500 thay vì 400**. Bổ sung `validateParams(recipeIdParamSchema)` (schema đã có sẵn nhưng chưa dùng) và một `idParamSchema` dạng `z.coerce.number().int().positive()`.

6. **Không kiểm tra `rowCount` sau UPDATE** — `recipe.repository.ts:299-309` và `recipe.repository.ts:258-269` trả `200 OK` cho id không tồn tại (`deleteRecipe` trả `undefined`, service check `null` nên may mắn thoát, nhưng `updateRecipeStatus` thì không). Dùng `RETURNING id` + ném `AppError("Not Found", 404)`.

7. **Refresh token trả trong JSON body** — `user.controller.ts:60-70`: đã set httpOnly cookie rồi còn trả `refreshToken` trong body, khuyến khích frontend lưu vào `localStorage` → mất hết lợi ích chống XSS. Chỉ nên trả cookie (giữ body cho client mobile qua một flag riêng nếu thật sự cần).

8. **Swagger public ở production** — `app.ts:106-111`: `/docs` và `/docs.json` mở cho mọi người, đồng thời buộc CSP phải nới `script-src 'unsafe-inline'`. Nên chỉ mount khi `NODE_ENV !== "production"` hoặc đặt sau basic auth.

9. **Thiếu 404 handler** — request không khớp route rơi vào HTML mặc định của Express, phá vỡ contract `{ success, error }`. Thêm `app.use((req, res, next) => next(new AppError("Not Found", 404)))` trước `errorHandler`.

10. **`db/schema.sql` không chạy được từ trên xuống** — `schema.sql:50-52`: thiếu dấu `;` sau 2 lệnh `CREATE TYPE`; ngoài ra `recipes` (dòng 1) tham chiếu `users(id)` và type `recipe_status` được khai báo mãi ở dòng 50+. File hiện chỉ là "ghi chú", không phải nguồn sự thật tái lập được.

11. **Contract response không đồng nhất** — recipe/category dùng `sendSuccess` → `{ success, data, pagination }`, còn toàn bộ user endpoints trả thẳng `{ message, user }` không có `success` (`user.controller.ts:5-15`). Frontend phải xử lý 2 dạng.

---

## ⚡ P2: Hiệu Năng Database & Tài Nguyên

1. **Lỗi tiềm ẩn ở việc đánh số tham số** — `recipe.repository.ts:27-52` dùng `$${conditions.length + 1}`. Hiện đúng chỉ vì mỗi điều kiện có đúng 1 param và điều kiện không-param (`deleted_at IS NULL`) nằm cuối. Thêm một điều kiện không-param ở giữa là lệch toàn bộ. Đổi sang `$${params.length + 1}` — đúng về ngữ nghĩa và bất biến.

2. **`SELECT * FROM recipes` cho danh sách** — `recipe.repository.ts:58` kéo cả `description TEXT` và `rejection_reason` cho mọi trang list (và cache vào Redis). Chỉ select cột cần hiển thị.

3. **N+1 trong batch sync view count** — `recipe.repository.ts:338-347` lặp `UPDATE` từng recipe. Gộp 1 câu:

   ```sql
   UPDATE recipes r SET view_count = r.view_count + v.views
   FROM (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id int, views int)) v
   WHERE r.id = v.id
   ```

4. **`redis.keys()` để invalidate cache** — `recipe.service.ts:17`: `KEYS` là O(N) blocking trên Redis. Dùng **cache version tag**: giữ `recipes:public:ver`, `INCR` khi có thay đổi, nhúng version vào cache key → invalidate O(1).

5. **Thiếu index quan trọng** — db/schema.sql:
   - `recipes(author_id)` — `/my-recipes` lọc theo cột này, chưa có index.
   - `recipes(created_at DESC)` — sort mặc định của mọi list.
   - `recipes_categories(category_id)` — PK là `(recipe_id, category_id)` nên **không** phục vụ được `WHERE rc.category_id = ANY(...)`.
   - Index `unaccent(LOWER(title)) varchar_pattern_ops` **không dùng được** cho `LIKE '%...%'` (wildcard đầu chuỗi). Cần `pg_trgm` + GIN: `CREATE INDEX ... USING GIN (unaccent(lower(title)) gin_trgm_ops)`.
   - `unaccent()` mặc định **không IMMUTABLE** → lệnh tạo index này nhiều khả năng lỗi; cần wrapper `IMMUTABLE`.

6. **Pool chưa có `connectionTimeoutMillis`** — `db.ts:4-11`: khi DB treo, request sẽ chờ vô hạn và giữ chỗ trong pool (`max: 10`).

7. **CORS thiếu `Vary: Origin`** — `app.ts:50-70`: phản hồi có `Access-Control-Allow-Origin` thay đổi theo origin nhưng không khai báo `Vary` → CDN/proxy có thể cache nhầm header cho origin khác.

8. **`create/updateRecipe` trả object tự dựng, không phải bản ghi DB** — `recipe.repository.ts:176-181`, `recipe.repository.ts:243-246`: client nhận `created_at` do JS sinh, thiếu `status`, `view_count`, và không phản ánh giá trị `COALESCE` thật sự sau UPDATE. Dùng `result.rows[0]` từ `RETURNING *`.

9. **`PATCH /recipes/:id/view-count` công khai, không throttle riêng** — `recipe.router.ts:48`: view count có thể bị thổi phồng tuỳ ý (và `sort_by=view_count` phụ thuộc vào nó).

10. **Cron in-process** — `syncViewCounts.job.ts:73-92`: `node-cron` chạy trong app; scale >1 instance sẽ sync trùng (`rename` giúp giảm rủi ro nhưng không phải khoá phân tán). Dự án đã có QStash — nên chuyển job này sang webhook có xác thực chữ ký.

---

## 💡 P3: Clean Code, TypeScript & Tài Liệu

1. **`any` còn nhiều**: `query(text, params?: any[])` (`db.ts:13`) không generic nên mọi `result.rows` là `any`; `jsonContent(schema: any)`; `catch (error: any)` (`qstash.middleware.ts:45`); `(req: any)` trong verify của `express.json`. Nên `export const query = <T extends QueryResultRow>(text: string, params?: unknown[]) => pool.query<T>(text, params)`.
2. **Kiểu trả về "nói dối"**: `deleteRecipe(): Promise<Recipe>` và `restoreRecipe(): Promise<Recipe>` có thể trả `undefined` — service đang check `null` nên TypeScript không giúp gì được ở đây.
3. **Magic values**: `200`/`5*60*1000` trong limiter, `"222.252.30.184"`, `salt = 10`, `15m`/`7 days` nằm rải rác ở service và controller — nên gom vào hằng số/env.
4. **Log không có cấu trúc**: `console.log/console.error` khắp service & job, không có `requestId` để trace; `utils/logger.ts` mới chỉ bọc morgan.
5. **Thiếu graceful shutdown** — `server.ts:8-29`: không bắt `SIGTERM` để `server.close()` + `pool.end()`; `/wake-up` cũng chưa kiểm tra DB nên không dùng làm health check thật được.
6. **`updateRecipePayloadSchema = createRecipePayloadSchema`** — PUT bắt buộc gửi đủ mọi field kể cả khi chỉ sửa tiêu đề; tương tự `POST /users/login` tái dùng `createUserSchema`. Nên tách schema riêng (`.partial()` cho update).
7. **Quy ước đặt tên chưa nhất quán**: `user.route.ts` (các file khác là `*.router.ts`); recipe dùng `export default RecipeController` + `import * as RecipeRepository`, trong khi user/category dùng object named export.
8. **Chưa có test và chưa có công cụ migration** — `db/schema.sql` thủ công, không có lịch sử thay đổi schema.

---

## ✅ Thứ Tự Hành Động Đề Xuất

1. Sửa **P0-1**: bỏ `skip` hardcode IP, đổi `trust proxy` thành số hop, dùng `req.ip` làm key, bật lại `validate`.
2. Sửa **P0-2**: thêm filter `deleted_at IS NULL` + `status = 'approved'` (trừ admin/chủ sở hữu) cho `findRecipeById`.
3. Sửa **P0-3**: che message lỗi 5xx không phải `AppError`.
4. Thêm `authLimiter` cho login/register/forgot-password + giới hạn tần suất gửi OTP (P1-3).
5. Điền `config/env.ts` (Zod fail-fast) và bỏ mọi `process.env` trực tiếp + `!`/`as string` (P1-2).
6. Thêm `validateParams` cho `/:id` và kiểm tra `rowCount` sau UPDATE (P1-5, P1-6).
7. Dọn `db/schema.sql` (dấu `;`, thứ tự) rồi bổ sung index `author_id`, `created_at`, `recipes_categories(category_id)`, pg_trgm (P1-10, P2-5).
8. Tối ưu query: bỏ `SELECT *`, gộp batch update, thay `redis.keys` bằng version tag (P2-2,3,4).

Chạy `npm run build` trong `api` sau mỗi nhóm thay đổi để chắc chắn TypeScript vẫn compile sạch.

Created 3 todos
