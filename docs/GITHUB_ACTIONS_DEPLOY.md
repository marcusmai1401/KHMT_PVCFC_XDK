# GitHub Actions Production Deploy

File workflow: `.github/workflows/deploy-production.yml`

## Luồng làm việc đề xuất

1. Developer tạo branch riêng từ `main`.
2. Push branch lên GitHub và mở Pull Request.
3. GitHub Actions chạy CI cho frontend/backend.
4. Sau khi review xong, merge vào `main`.
5. Workflow trên `main` chạy CI lại, sau đó deploy lên VPS production.

Nên bật branch protection cho `main` để yêu cầu Pull Request và CI pass trước khi merge.

## GitHub Secrets cần tạo

Vào `Settings` -> `Secrets and variables` -> `Actions`, tạo các secret:

| Secret | Giá trị |
| --- | --- |
| `VPS_HOST` | IP VPS production, ví dụ `103.200.20.225` |
| `VPS_PORT` | Port SSH, thường là `22` |
| `VPS_USER` | User SSH, hiện tại là `root` |
| `VPS_PASSWORD` | Mật khẩu SSH production |
| `VPS_REMOTE_DIR` | Thư mục deploy, mặc định `/opt/okr-system` |
| `VPS_HOST_KEY` | Khuyến nghị. Output từ `ssh-keyscan -p 22 103.200.20.225` |

Nếu không có `VPS_HOST_KEY`, workflow sẽ tự chạy `ssh-keyscan`. Cách tốt hơn là lưu host key cố định vào secret để tránh tự tin host key mới.

## GitHub Environment

Nên tạo environment tên `production` trong `Settings` -> `Environments`.

Khuyến nghị bật `Required reviewers` để mỗi lần deploy production phải có người duyệt trong GitHub trước khi job deploy chạy.

## Server production cần có sẵn

- Docker và Docker Compose plugin.
- File `/opt/okr-system/.env.production`.
- Port `80` mở ra ngoài.
- Thư mục backup `/backup/okr` sẽ được script tạo nếu chưa có.

Workflow dùng lại `deploy_prod.py` trong GitHub Actions:

- Build archive source.
- Upload lên VPS.
- Backup PostgreSQL và storage.
- Rebuild Docker containers.
- Chạy Alembic migration.
- Seed user accounts nhưng mặc định không reset password.
- Kiểm tra `/health`.

## Chạy workflow thủ công

Trong tab `Actions`, chọn `CI and Production Deploy` -> `Run workflow`.

Các option manual:

- `reset_user_passwords`: mặc định tắt. Chỉ bật khi thật sự muốn reset password seed user.

## Bảo mật cần làm

Mật khẩu root đã từng được chia sẻ trong chat nội bộ, nên nên rotate password VPS. Sau đó nên tạo user deploy riêng, cấp quyền Docker cần thiết, và chuyển từ password sang SSH key trong một bước cải tiến tiếp theo.
