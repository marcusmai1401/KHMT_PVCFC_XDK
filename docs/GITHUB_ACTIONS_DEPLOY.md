# GitHub Actions Production Deploy

Workflow production nằm tại `.github/workflows/deploy.yml`.

## Luồng triển khai

- Workflow tự chạy khi có `push`/merge vào `main`.
- Có thể chạy lại thủ công bằng `workflow_dispatch`, nhưng mọi job đều kiểm tra `github.ref == refs/heads/main`; ref khác sẽ không deploy.
- Frontend test/build và toàn bộ backend test phải pass trước khi job deploy được chạy.
- Job deploy dùng GitHub Environment `production`, có concurrency lock và timeout.

Nên bật branch protection cho `main` và Required reviewers cho environment `production`.

## GitHub Environment secrets

Tạo các secret sau tại `Settings` → `Environments` → `production`:

| Secret | Bắt buộc | Nội dung |
|---|---:|---|
| `VPS_HOST` | Có | Host/IP VPS production |
| `VPS_PORT` | Không | SSH port; mặc định `22` |
| `VPS_USER` | Có | Tài khoản deploy qua SSH |
| `VPS_SSH_PRIVATE_KEY` | Có | Private key đầy đủ, không commit vào repo |
| `VPS_SSH_KEY_PASSPHRASE` | Không | Passphrase nếu private key được mã hóa |
| `VPS_REMOTE_DIR` | Không | Mặc định `/opt/okr-system` |
| `VPS_HOST_KEY` | Có | Dòng `known_hosts` đã được xác minh ngoài băng |

Không dùng `VPS_PASSWORD`. Workflow fail-closed nếu thiếu private key hoặc pinned host key và không tự chạy `ssh-keyscan`.

## Lấy và xác minh host key

Chạy từ một máy/mạng đáng tin cậy:

```bash
ssh-keyscan -p 22 YOUR_VPS_HOST > vps_known_hosts
ssh-keygen -lf vps_known_hosts
```

Đối chiếu fingerprint với fingerprint đọc trực tiếp trên VPS (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) qua kênh độc lập. Chỉ sau khi khớp mới lưu nguyên dòng `known_hosts` vào secret `VPS_HOST_KEY`. Không lấy host key ngay trong workflow vì kết quả đó chưa được xác thực và có thể bị MITM.

## Yêu cầu trên VPS

- Docker và Docker Compose plugin.
- File `/opt/okr-system/.env.production` chỉ đọc được bởi tài khoản phù hợp.
- `OKR_ENVIRONMENT=production`.
- `OKR_JWT_SECRET` ngẫu nhiên, tối thiểu 32 ký tự, không phải placeholder.
- `POSTGRES_PASSWORD` ngẫu nhiên, tối thiểu 16 ký tự, không phải placeholder.
- Tài khoản SSH nên là user deploy riêng, key-only, với quyền tối thiểu cần cho Docker và các thư mục `/opt/okr-system`, `/backup/okr`.

## Các kiểm soát trong deploy

- GitHub Actions chính chủ được pin bằng commit SHA.
- SSH chỉ dùng private key; tắt SSH agent/key discovery và từ chối host key không khớp.
- Archive remote dùng tên ngẫu nhiên 128-bit, permission `0600`, và được kiểm tra SHA-256 trước khi giải nén.
- Luôn backup PostgreSQL và `storage` trước khi thay source.
- Shell remote dùng `set -euo pipefail`, timestamp log, timeout ở job và cleanup archive/key bằng `trap`/`always()`.
- Deploy thường chỉ seed tài khoản mới; không reset hash của tài khoản đã tồn tại và không chạy password-hygiene dựa trên audit history.
- Health check chạy cả trên VPS và từ GitHub runner.

## Chạy lại thủ công

```bash
./deploy_github_actions.sh --watch
```

Script luôn dispatch workflow từ `main`. Việc reset mật khẩu hàng loạt không còn là option deploy; nếu thật sự cần reset, phải dùng quy trình quản trị riêng có danh sách tài khoản, phê duyệt và audit rõ ràng.
