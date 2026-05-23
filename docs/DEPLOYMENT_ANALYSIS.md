# Phân tích & Đề xuất Deploy — Hệ thống OKR Xưởng Điều khiển

> **Mục đích**: Tài liệu này cung cấp thông tin chi tiết về cấu trúc repo, hạ tầng hiện tại, và các phương án deploy khả thi cho ~50 người dùng. Dùng để tham vấn với AI hoặc kỹ sư DevOps.

---

## 1. Tổng quan dự án

| Thuộc tính | Chi tiết |
|---|---|
| **Tên hệ thống** | Hệ thống Tự động hóa OKR — Xưởng Điều khiển |
| **Loại ứng dụng** | Full-stack web app (SPA + REST API) |
| **Đối tượng sử dụng** | ~55 nhân sự, 4 đội/tổ + 1 nhóm lãnh đạo |
| **Mục đích** | Báo cáo OKR hàng tháng, đăng ký sáng kiến SK-CTKT, đánh giá năng lực ET |

---

## 2. Tech Stack chi tiết

### 2.1 Backend

| Thành phần | Công nghệ | Phiên bản | Ghi chú |
|---|---|---|---|
| Ngôn ngữ | Python | 3.11+ | |
| Framework | FastAPI | — | ASGI, async |
| Server | Uvicorn | — | `uvicorn app.main:app` |
| ORM | SQLAlchemy | 2.0+ | Declarative mapping (`mapped_column`) |
| Migration | Alembic | — | 4 migration versions hiện tại |
| Auth | JWT (python-jose) + bcrypt | — | Role-based: Admin, Workshop_Leader, FI_Coordinator, Team_Account |
| Validation | Pydantic v2 + pydantic-settings | — | Config qua env vars |
| LLM Integration | OpenAI-compatible API | — | Endpoint: `danglamgiau.com/v1`, model: `deepseek-v4-pro` |
| Excel | openpyxl | — | Đọc/ghi `.xlsx` |
| Testing | pytest + hypothesis + httpx | — | Unit, integration, property-based |

### 2.2 Frontend

| Thành phần | Công nghệ | Phiên bản | Ghi chú |
|---|---|---|---|
| Framework | React | 18 | SPA, không dùng router library |
| Ngôn ngữ | TypeScript | — | ES2020 target |
| Build tool | Vite | — | Dev server port 5173 |
| Icons | lucide-react | — | |
| Screenshot | html2canvas | — | Dashboard PNG export |
| Testing | vitest | — | |

### 2.3 Database & Cache

| Thành phần | Dev | Production (target) |
|---|---|---|
| Database | SQLite (`storage/okr_automation.db`) | PostgreSQL 16 |
| Cache | Không dùng | Redis 7 (tùy chọn) |
| Connection | `sqlite:///path/to/db` | `postgresql://okr:okr@localhost:5432/okr_automation` |

### 2.4 Hạ tầng hiện có

| Thành phần | Trạng thái | File |
|---|---|---|
| Docker Compose (Postgres + Redis) | ✅ Có | `infra/docker-compose.yml` |
| Dockerfile (Backend) | ❌ Chưa có | — |
| Dockerfile (Frontend) | ❌ Chưa có | — |
| Nginx / Reverse Proxy | ❌ Chưa có | — |
| CI/CD Pipeline | ❌ Chưa có | — |
| Dev launcher | ✅ Có | `start-dev.ps1`, `start-dev.cmd` |

---

## 3. Cấu trúc Repo

```
KHMT Hàng tháng/
├── backend/                          # Python FastAPI backend
│   ├── app/
│   │   ├── api/routes/               # 8 route modules
│   │   │   ├── admin.py              # Admin operations
│   │   │   ├── auth.py               # Login / JWT
│   │   │   ├── et.py                 # Competency assessment (ET)
│   │   │   ├── fi.py                 # SK-CTKT innovation workflow
│   │   │   ├── llm.py                # LLM integration endpoints
│   │   │   ├── notifications.py      # Notification system
│   │   │   ├── okr.py                # OKR dashboard, reports, upload
│   │   │   └── web_input.py          # Web-based data entry
│   │   ├── core/
│   │   │   ├── config.py             # Settings (pydantic-settings, env vars)
│   │   │   └── security.py           # JWT, bcrypt, RBAC
│   │   ├── db/
│   │   │   └── session.py            # SQLAlchemy engine, session factory
│   │   ├── models/
│   │   │   ├── domain.py             # 16 core tables
│   │   │   └── et_domain.py          # 8 ET tables
│   │   ├── schemas/                  # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── okr/                  # 22 modules (dashboard, extraction, validation...)
│   │   │   ├── fi/                   # SK-CTKT workflow
│   │   │   ├── llm/                  # AI integration (client, extractor, chatbot...)
│   │   │   ├── integration/          # BM01 import
│   │   │   ├── bootstrap.py          # Schema creation + seed data
│   │   │   ├── cache.py              # Redis caching
│   │   │   ├── et_service.py         # ET business logic
│   │   │   └── repositories.py       # Shared repo helpers
│   │   └── main.py                   # FastAPI app entry point
│   ├── alembic/                      # DB migrations (4 versions)
│   │   ├── alembic.ini
│   │   └── versions/
│   │       ├── 0001_initial.py
│   │       ├── 0002_web_input_fields.py
│   │       ├── 0003_add_et_tables.py
│   │       └── 0004_historical_snapshots.py
│   ├── scripts/                      # Utility scripts
│   ├── tests/                        # Unit + integration + property tests
│   ├── pyproject.toml                # Python dependencies, pytest/ruff config
│   ├── .env                          # Active env vars (CHỨA API KEY THẬT!)
│   └── .env.example                  # Template env
│
├── frontend/                         # React + TypeScript + Vite
│   ├── src/
│   │   ├── app/App.tsx               # Main app (auth, view routing)
│   │   ├── api/client.ts             # API client (~60+ endpoints)
│   │   ├── features/
│   │   │   ├── okr/                  # OKR Dashboard
│   │   │   ├── fi/                   # SK-CTKT workflow UI
│   │   │   ├── admin/                # Admin panel
│   │   │   ├── et/                   # Competency assessment
│   │   │   └── web-input/            # Web data entry form
│   │   ├── styles.css
│   │   └── main.tsx
│   ├── public/
│   ├── dist/                         # Build output
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── infra/
│   └── docker-compose.yml            # PostgreSQL 16 + Redis 7
│
├── storage/                          # Runtime data (uploads, exports, backups)
│   ├── okr_automation.db             # SQLite (dev only)
│   ├── uploads/
│   ├── exports/
│   ├── templates/
│   └── backups/
│
├── template_xlsx/                    # Excel templates cho 4 đội/tổ
├── KHMT_T1_T2_T3_T4/                # Historical OKR data
├── docs/                             # Technical docs
│
├── start-dev.ps1                     # Dev launcher (PowerShell)
├── start-dev.cmd                     # Dev launcher (batch)
└── README.md
```

---

## 4. Environment Variables cần thiết

### 4.1 Database

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_DATABASE_URL` | Connection string PostgreSQL | `postgresql://okr:okr@postgres:5432/okr_automation` |

### 4.2 Security

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_JWT_SECRET` | Secret key cho JWT (**PHẢI thay đổi**) | `<random-256-bit-hex>` |
| `OKR_ACCESS_TOKEN_MINUTES` | Thời hạn token (phút) | `480` (8h) hoặc `60` (1h) |
| `OKR_ALLOWED_ORIGINS` | CORS origins | `https://okr.your-domain.com` |

### 4.3 LLM Integration

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_LLM_ENABLED` | Bật/tắt AI | `true` / `false` |
| `OKR_DLG_API_KEY` | API key danglamgiau.com | `<your-api-key>` |
| `OKR_DLG_BASE_URL` | LLM endpoint | `https://danglamgiau.com/v1` |
| `OKR_DLG_MODEL` | Model name | `deepseek-v4-pro` |

### 4.4 Redis (tùy chọn)

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_REDIS_URL` | Redis connection string | `redis://redis:6379/0` |

### 4.5 Bootstrap Admin

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_BOOTSTRAP_ADMIN_ID` | Admin username | `admin` |
| `OKR_BOOTSTRAP_ADMIN_PASSWORD` | Admin password | `<strong-password>` |

### 4.6 Other

| Variable | Mô tả | Giá trị mẫu |
|---|---|---|
| `OKR_ENVIRONMENT` | Môi trường | `production` |
| `OKR_STORAGE_DIR` | Thư mục storage | `/app/storage` |

---

## 5. Database Schema hiện tại

### 5.1 Core Tables (16 bảng)

| Bảng | Mô tả | Liên quan |
|---|---|---|
| `users` | Tài khoản người dùng | Auth, RBAC |
| `kr_mapping` | Mapping 37 KR chuẩn | OKR Dashboard |
| `team_reports` | Báo cáo tháng từ các đội | OKR workflow |
| `warnings` | Cảnh báo lỗi dữ liệu | Validation |
| `team_monthly_summaries` | Tổng hợp theo tháng | Dashboard |
| `historical_snapshots` | Snapshot dữ liệu lịch sử | Báo cáo |
| `sk_ctkt` | Đăng ký sáng kiến | SK-CTKT workflow |
| `sk_images` | Hình ảnh sáng kiến | Upload |
| `notifications` | Thông báo hệ thống | Real-time |
| `audit_logs` | Nhật ký thay đổi | Admin |
| `team_headcounts` | Sĩ số từng đội | Tính toán |
| `vhdn_exemptions` | Danh sách miễn trừ VHDN | OKR |
| `system_config` | Cấu hình hệ thống | Admin |
| `templates` | File template báo cáo | Upload |
| `sk_code_sequences` | Sequence mã sáng kiến | Auto-increment |

### 5.2 ET Tables (8 bảng)

| Bảng | Mô tả |
|---|---|
| `competency_frameworks` | Khung năng lực |
| `competency_items` | Tiêu chí năng lực |
| `personnel` | Danh sách nhân sự |
| `competency_assessments` | Đánh giá năng lực |
| `assessment_items` | Chi tiết đánh giá |
| `learning_plans` | Kế hoạch đào tạo |
| `learning_plan_items` | Chi tiết kế hoạch |

**Tổng cộng**: 24 bảng, dùng Alembic migration (4 versions).

---

## 6. API Endpoints

| Prefix | Router | Chức năng |
|---|---|---|
| `/api/v1/auth/` | `auth.py` | Login, JWT token |
| `/api/v1/admin/` | `admin.py` | Admin operations, headcount, audit log |
| `/api/v1/okr/` | `okr.py` | Dashboard, reports, uploads, warnings, historical |
| `/api/v1/web-input/` | `web_input.py` | Web-based OKR data entry |
| `/api/v1/fi/` | `fi.py` | SK-CTKT workflow |
| `/api/v1/et/` | `et.py` | Competency assessment |
| `/api/v1/notifications/` | `notifications.py` | Notifications |
| `/api/v1/llm/` | `llm.py` | LLM integration |
| `/health` | (main.py) | Health check |

---

## 7. Yêu cầu phi chức năng cho Production

| Yêu cầu | Mức độ | Ghi chú |
|---|---|---|
| **Bảo mật** | CAO | JWT secret phải đổi, HTTPS bắt buộc, CORS restrict |
| **Backup** | CAO | Database backup định kỳ (hàng ngày) |
| **Availability** | TRUNG BÌNH | 50 users, nội bộ, downtime ngắn được chấp nhận |
| **Performance** | THẤP | 50 users, tải thấp, không cần auto-scale |
| **Monitoring** | TRUNG BÌNH | Log lỗi, health check, cảnh báo |
| **Chi phí** | CAO | Ngân sách thấp (nội bộ doanh nghiệp) |

---

## 8. Các phương án Deploy khả thi

### 8.1 Phương án A: Docker Compose trên máy chủ nội bộ (Đề xuất chính)

**Mô hình**: Single server, Docker Compose chạy tất cả services.

```
┌─────────────────────────────────────────────────┐
│                 Máy chủ nội bộ                    │
│              (Windows/Linux server)               │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Nginx   │  │ Backend  │  │ Frontend │       │
│  │  :80/:443│──│  :8000   │  │  (static)│       │
│  └──────────┘  └──────────┘  └──────────┘       │
│       │              │                             │
│  ┌──────────┐  ┌──────────┐                      │
│  │PostgreSQL│  │  Redis   │                      │
│  │  :5432   │  │  :6379   │                      │
│  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘
```

**Cần tạo thêm**:
- `Dockerfile` cho backend (Python 3.11 + FastAPI)
- `Dockerfile` cho frontend (Node build → Nginx serve static)
- `docker-compose.prod.yml` (full stack: nginx + backend + frontend + postgres + redis)
- `nginx.conf` (reverse proxy + static file serving + SSL)

**Ưu điểm**:
- ✅ Đơn giản nhất, dễ bảo trì
- ✅ Chi phí thấp (chỉ 1 máy chủ)
- ✅ Phù hợp với 50 users (tải rất thấp)
- ✅ Backup đơn giản (dump DB + copy files)
- ✅ Có thể chạy trên máy Windows hiện có hoặc Linux

**Nhược điểm**:
- ❌ Single point of failure (1 máy chủ)
- ❌ Không có auto-scaling
- ❌ Phải tự quản lý server

**Yêu cầu máy chủ**:
- CPU: 2-4 cores
- RAM: 4-8 GB
- Storage: 50-100 GB SSD
- OS: Ubuntu 22.04 LTS hoặc Windows Server
- Network: Nội bộ, có thể mở port 80/443

**Chi phí ước tính**:
- Nếu dùng máy có sẵn: **0 VNĐ/tháng**
- Nếu thuê VPS nội địa: **200k-500k VNĐ/tháng**

---

### 8.2 Phương án B: Cloud VPS (DigitalOcean / Vultr / Linode / AWS Lightsail)

**Mô hình**: Tương tự Phương án A nhưng chạy trên cloud VPS.

```
┌─────────────────────────────────────────────────┐
│              Cloud VPS (Ubuntu 22.04)             │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Nginx   │──│ Backend  │  │ Frontend │       │
│  │  + SSL   │  │  FastAPI │  │  (static)│       │
│  └──────────┘  └──────────┘  └──────────┘       │
│       │              │                             │
│  ┌──────────┐  ┌──────────┐                      │
│  │PostgreSQL│  │  Redis   │                      │
│  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────┘
```

**Ưu điểm**:
- ✅ Không phụ thuộc hạ tầng nội bộ
- ✅ Có thể truy cập từ bên ngoài (nếu cần)
- ✅ Backup snapshot tự động
- ✅ Uptime cao hơn

**Nhược điểm**:
- ❌ Chi phí hàng tháng
- ❌ Cần quản lý server từ xa
- ❌ Độ trễ mạng (nếu người dùng ở VN, server ở nước ngoài)

**Chi phí ước tính**:
- DigitalOcean Droplet (2 vCPU, 4GB RAM): **$24/tháng (~600k VNĐ)**
- Vultr (2 vCPU, 4GB RAM): **$24/tháng (~600k VNĐ)**
- AWS Lightsail (2 vCPU, 4GB RAM): **$20/tháng (~500k VNĐ)**
- VPS Việt Nam (Viettel IDC, VNPT, FPT): **300k-800k VNĐ/tháng**

---

### 8.3 Phương án C: PaaS — Railway / Render / Fly.io

**Mô hình**: Deploy trực tiếp lên Platform-as-a-Service, không cần quản lý server.

```
┌─────────────────────────────────────────────┐
│            PaaS (Railway/Render)              │
│                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Frontend │  │ Backend  │  │PostgreSQL│  │
│  │ (static) │  │ (Python) │  │ (managed)│  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                    ┌──────┐ │
│                                    │Redis │ │
│                                    └──────┘ │
└─────────────────────────────────────────────┘
```

**Ưu điểm**:
- ✅ Không cần quản lý server
- ✅ Auto-deploy từ Git push
- ✅ SSL tự động
- ✅ Scaling tự động (nếu cần)
- ✅ Free tier có thể dùng thử

**Nhược điểm**:
- ❌ Chi phí tăng khi dùng nhiều
- ❌ Ít control hơn
- ❌ Có thể bị giới hạn vùng deploy (không có region VN)

**Chi phí ước tính**:
- Railway: **$5-15/tháng** (Hobby plan)
- Render: **$7-25/tháng** (Web Service + DB)
- Fly.io: **$5-15/tháng** (shared CPU)

---

### 8.4 Phương án D: Vercel (Frontend) + Cloud Run / Lambda (Backend)

**Mô hình**: Tách frontend và backend, deploy lên các platform khác nhau.

```
┌──────────────┐     ┌──────────────────────┐
│   Vercel     │     │   Google Cloud Run   │
│  (Frontend)  │────▶│   (Backend FastAPI)  │
│  CDN global  │     │   Auto-scaling       │
└──────────────┘     └──────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │  Cloud SQL (Postgres)  │
                    │  + Memorystore (Redis) │
                    └───────────────────────┘
```

**Ưu điểm**:
- ✅ Frontend load nhanh (CDN)
- ✅ Backend scale theo demand
- ✅ Free tier lớn cho frontend

**Nhược điểm**:
- ❌ Phức tạp hơn trong setup
- ❌ Chi phí Cloud SQL cao (~$7-15/tháng)
- ❌ Vendor lock-in

**Chi phí ước tính**:
- Vercel: **$0** (Hobby plan, đủ cho 50 users)
- Cloud Run: **$5-15/tháng** (theo usage)
- Cloud SQL: **$7-15/tháng** (shared CPU)
- Tổng: **$12-30/tháng (~300k-750k VNĐ)**

---

### 8.5 Phương án E: Azure App Service / AWS ECS (Enterprise)

**Mô hình**: Deploy lên cloud enterprise, phù hợp nếu tổ chức đã có Azure/AWS account.

**Ưu điểm**:
- ✅ SLA cao
- ✅ Tích hợp với hệ thống IT doanh nghiệp
- ✅ Backup, monitoring tích hợp

**Nhược điểm**:
- ❌ Chi phí cao hơn
- ❌ Phức tạp trong cấu hình
- ❌ Overkill cho 50 users

**Chi phí ước tính**:
- Azure App Service (B1): **$13/tháng**
- Azure Database for PostgreSQL (B1ms): **$12/tháng**
- Tổng: **$25-50/tháng (~625k-1.25M VNĐ)**

---

## 9. So sánh các phương án

| Tiêu chí | A: Docker nội bộ | B: Cloud VPS | C: PaaS | D: Vercel+Cloud Run | E: Azure/AWS |
|---|---|---|---|---|---|
| **Độ phức tạp setup** | Trung bình | Trung bình | Thấp | Trung bình | Cao |
| **Chi phí/tháng** | 0đ (máy có sẵn) | 500k-800k VNĐ | 150k-400k VNĐ | 300k-750k VNĐ | 625k-1.25M VNĐ |
| **Bảo trì** | Tự quản lý | Tự quản lý | Gần như tự động | Gần như tự động | Tự quản lý |
| **Hiệu năng** | Tốt | Tốt | Tốt | Rất tốt | Rất tốt |
| **Scalability** | Không | Không | Tự động | Tự động | Tự động |
| **Backup** | Tự cấu hình | Snapshot tự động | Tự động | Tự động | Tự động |
| **SSL** | Tự cấu hình (Let's Encrypt) | Tự cấu hình | Tự động | Tự động | Tự cấu hình |
| **Phù hợp nhất** | Nội bộ, máy có sẵn | Cần truy cập từ xa | Demo/nhanh | Production nhỏ | Enterprise |

---

## 10. Những việc CẦN LÀM trước khi deploy (tất cả phương án)

### 10.1 Bảo mật (BẮT BUỘC)

- [ ] **Đổi JWT secret**: `OKR_JWT_SECRET` phải là random string ≥ 256 bits
- [ ] **Đổi DB password**: Không dùng `okr/okr` cho production
- [ ] **Rotate API key**: API key trong `.env` đã bị expose, cần tạo key mới
- [ ] **Xóa `.env` khỏi git history**: Dùng `git filter-branch` hoặc BFG Repo-Cleaner
- [ ] **Restrict CORS**: Chỉ cho phép domain thực tế trong `OKR_ALLOWED_ORIGINS`
- [ ] **HTTPS bắt buộc**: Dùng Let's Encrypt hoặc cloud SSL
- [ ] **Giảm token expiry**: `OKR_ACCESS_TOKEN_MINUTES=60` thay vì 480

### 10.2 Tạo Dockerfile (BẮT BUỘC cho Phương án A, B, C)

**Backend Dockerfile** cần tạo:
```
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Frontend Dockerfile** cần tạo:
```
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### 10.3 Nginx config cần tạo

```nginx
server {
    listen 80;
    server_name okr.your-domain.com;

    # Frontend static files
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # Health check
    location /health {
        proxy_pass http://backend:8000;
    }
}
```

### 10.4 Docker Compose Production cần tạo

File `infra/docker-compose.prod.yml` cần chứa:
- Service `postgres` (PostgreSQL 16)
- Service `redis` (Redis 7)
- Service `backend` (FastAPI app)
- Service `frontend` (Nginx serve static + reverse proxy)
- Volume cho data persistence
- Health checks
- Restart policy

### 10.5 Database Migration

```bash
# Chạy migration trên production database
cd backend
alembic upgrade head
```

### 10.6 Backup Strategy

| Đối tượng | Tần suất | Phương pháp |
|---|---|---|
| PostgreSQL | Hàng ngày | `pg_dump` cron job |
| Storage (uploads, exports) | Hàng tuần | `rsync` hoặc cloud backup |
| Full system | Hàng tháng | Snapshot toàn bộ |

---

## 11. Kiến trúc đề xuất chi tiết (Phương án A — Docker Compose)

```
                    ┌─────────────────────────────────────────┐
                    │           Máy chủ / VPS                   │
                    │         (Ubuntu 22.04 LTS)                │
                    │                                           │
    User ────────▶  │  ┌─────────────────────────────────────┐ │
    (Browser)       │  │         Nginx (Port 80/443)         │ │
                    │  │   - Static files (Frontend build)   │ │
                    │  │   - Reverse proxy → Backend         │ │
                    │  │   - SSL termination (Let's Encrypt) │ │
                    │  │   - Rate limiting                   │ │
                    │  └──────────┬──────────────────────────┘ │
                    │             │                              │
                    │  ┌──────────▼──────────────────────────┐ │
                    │  │     Backend (FastAPI + Uvicorn)      │ │
                    │  │     Port 8000 (internal only)        │ │
                    │  │     Workers: 2-4                     │ │
                    │  └──────────┬──────────────────────────┘ │
                    │             │                              │
                    │  ┌──────────▼──────┐  ┌───────────────┐  │
                    │  │  PostgreSQL 16  │  │   Redis 7     │  │
                    │  │  Port 5432      │  │   Port 6379   │  │
                    │  │  (internal only)│  │  (internal)   │  │
                    │  └─────────────────┘  └───────────────┘  │
                    │                                           │
                    │  ┌─────────────────────────────────────┐ │
                    │  │  Docker Network (bridge)             │ │
                    │  │  - frontend ↔ backend ↔ postgres    │ │
                    │  │  - backend ↔ redis                   │ │
                    │  └─────────────────────────────────────┘ │
                    │                                           │
                    │  ┌─────────────────────────────────────┐ │
                    │  │  Volumes (persistent data)           │ │
                    │  │  - postgres_data (database)          │ │
                    │  │  - storage_data (uploads, exports)   │ │
                    │  │  - ssl_certs (Let's Encrypt)         │ │
                    │  └─────────────────────────────────────┘ │
                    └─────────────────────────────────────────┘
```

---

## 12. Resource Estimate cho 50 users

| Metric | Giá trị ước tính |
|---|---|
| Concurrent users (peak) | 10-20 |
| Requests/second (peak) | 5-20 |
| Database size (1 năm) | 100-500 MB |
| Storage (uploads, 1 năm) | 1-5 GB |
| RAM usage (Backend) | 200-500 MB |
| RAM usage (Frontend/Nginx) | 50-100 MB |
| RAM usage (PostgreSQL) | 256-512 MB |
| RAM usage (Redis) | 64-128 MB |
| **Tổng RAM cần** | **~1-2 GB** |
| **CPU cần** | **2 cores** |

**Kết luận**: Với 50 users, một máy chủ 2 CPU / 4GB RAM là quá đủ. Không cần auto-scaling hay load balancer.

---

## 13. Quy trình Deploy (Phương án A)

```
Bước 1: Chuẩn bị máy chủ
    - Cài Docker + Docker Compose
    - Cấu hình firewall (mở port 80, 443)
    - Cấu hình domain DNS (nếu có)

Bước 2: Clone repo lên server
    git clone <repo-url> /opt/okr-system

Bước 3: Cấu hình environment
    - Tạo .env.production với các biến bảo mật
    - Đổi JWT secret, DB password, API key

Bước 4: Build và chạy
    cd /opt/okr-system/infra
    docker compose -f docker-compose.prod.yml up -d --build

Bước 5: Chạy database migration
    docker compose exec backend alembic upgrade head

Bước 6: Cấu hình SSL (Let's Encrypt)
    apt install certbot
    certbot --nginx -d okr.your-domain.com

Bước 7: Cấu hình backup cron
    0 2 * * * pg_dump -U okr okr_automation | gzip > /backup/db_$(date +%Y%m%d).sql.gz

Bước 8: Kiểm tra
    - Truy cập https://okr.your-domain.com
    - Đăng nhập với tài khoản admin
    - Test các chức năng chính
```

---

## 14. Rủi ro & Lưu ý

| Rủi ro | Mức độ | Mitigation |
|---|---|---|
| Mất dữ liệu | CAO | Backup hàng ngày + test restore |
| API key bị lộ | CAO | Rotate key, xóa khỏi git history |
| Server crash | TRUNG BÌNH | Docker restart policy, monitoring |
| LLM service down | THẤP | Feature degrade gracefully (tắt AI) |
| SQLite lock (nếu quên migrate) | TRUNG BÌNH | Đảm bảo dùng PostgreSQL cho production |
| CORS blocked | THẤP | Cấu hình đúng `OKR_ALLOWED_ORIGINS` |

---

## 15. Tóm tắt đề xuất

**Phương án推荐: A — Docker Compose trên máy chủ nội bộ**

Lý do:
1. 50 users là tải rất thấp, không cần cloud infrastructure phức tạp
2. Chi phí = 0 nếu dùng máy có sẵn trong công ty
3. Dễ bảo trì, dễ backup
4. Có thể triển khai trong 1-2 ngày
5. Phù hợp với tính chất nội bộ của hệ thống OKR

**Nếu cần truy cập từ xa**: Kết hợp VPN nội bộ hoặc dùng Phương án B (Cloud VPS).

**Nếu muốn demo nhanh trước**: Dùng Phương án C (Railway/Render) với free tier.

---

## 16. Files cần tạo mới

| File | Mục đích | Priority |
|---|---|---|
| `backend/Dockerfile` | Container hóa backend | BẮT BUỘC |
| `frontend/Dockerfile` | Container hóa frontend + Nginx | BẮT BUỘC |
| `frontend/nginx.conf` | Nginx config cho production | BẮT BUỘC |
| `infra/docker-compose.prod.yml` | Full stack production | BẮT BUỘC |
| `.env.production.example` | Template env vars production | NÊN CÓ |
| `scripts/backup.sh` | Script backup database | NÊN CÓ |
| `scripts/deploy.sh` | Script deploy tự động | NÊN CÓ |
| `.github/workflows/deploy.yml` | CI/CD pipeline (tùy chọn) | TÙY CHỌN |

---

*Tài liệu này được tạo để tham vấn với AI/DevOps engineer về phương án deploy phù hợp.*
