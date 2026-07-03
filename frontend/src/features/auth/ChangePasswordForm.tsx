import { useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, XCircle } from "lucide-react";
import { api, type LoginResponse } from "../../api/client";

type Props = {
  forced: boolean;
  displayName?: string | null;
  userId: string;
  onChanged: (response: LoginResponse) => void;
  onCancel?: () => void;
};

type Rule = {
  key: string;
  label: string;
  test: (newPw: string, oldPw: string) => boolean;
};

const RULES: Rule[] = [
  { key: "len", label: "Tối thiểu 8 ký tự", test: (p) => p.length >= 8 },
  { key: "letter", label: "Có chữ cái", test: (p) => /[A-Za-z]/.test(p) },
  { key: "digit", label: "Có chữ số", test: (p) => /[0-9]/.test(p) },
  { key: "diff", label: "Khác mật khẩu cũ", test: (p, o) => p.length > 0 && p !== o },
];

function scorePassword(pw: string, old: string): { score: number; label: string; tone: string } {
  if (!pw) return { score: 0, label: "Chưa nhập", tone: "" };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw === old) score = Math.min(score, 1);
  const map = [
    { label: "Quá yếu", tone: "danger" },
    { label: "Yếu", tone: "danger" },
    { label: "Trung bình", tone: "warning" },
    { label: "Khá", tone: "info" },
    { label: "Mạnh", tone: "success" },
    { label: "Rất mạnh", tone: "success" },
  ];
  return { score, ...map[Math.min(score, map.length - 1)] };
}

export function ChangePasswordForm({ forced, displayName, userId, onChanged, onCancel }: Props) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const ruleStatus = useMemo(
    () => RULES.map((rule) => ({ ...rule, ok: rule.test(newPassword, oldPassword) })),
    [newPassword, oldPassword]
  );
  const allRulesOk = ruleStatus.every((rule) => rule.ok);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const strength = useMemo(() => scorePassword(newPassword, oldPassword), [newPassword, oldPassword]);
  const canSubmit = !submitting && oldPassword.length > 0 && allRulesOk && !mismatch && confirmPassword.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await api.changePassword(oldPassword, newPassword);
      onChanged(response);
    } catch (err: any) {
      setError(err?.message ?? "Không đổi được mật khẩu");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-content auth-content-compact">
        <form className="auth-card auth-card-wide" onSubmit={submit}>
          <header className="auth-card-head">
            <div className="auth-card-icon">
              <KeyRound size={22} />
            </div>
            <h1>Đổi mật khẩu</h1>
            <p>
              <strong>{displayName ?? userId}</strong>
              {forced && (
                <span className="auth-pill warning">
                  <ShieldCheck size={12} /> Bắt buộc lần đầu
                </span>
              )}
            </p>
          </header>

          {forced && (
            <p className="auth-hint">
              Đây là lần đăng nhập đầu tiên của bạn. Vui lòng đặt mật khẩu mới (khác với mật khẩu mặc định) trước khi tiếp tục sử dụng hệ thống.
            </p>
          )}

          <label className="auth-field">
            <span>Mật khẩu hiện tại</span>
            <div className="auth-input">
              <KeyRound size={16} className="auth-input-icon" />
              <input
                autoComplete="current-password"
                type={showOld ? "text" : "password"}
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
              />
              <button
                type="button"
                className="auth-input-toggle"
                onClick={() => setShowOld((v) => !v)}
                aria-label={showOld ? "Ẩn" : "Hiện"}
              >
                {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="auth-field">
            <span>Mật khẩu mới</span>
            <div className="auth-input">
              <KeyRound size={16} className="auth-input-icon" />
              <input
                autoComplete="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="≥ 8 ký tự, có chữ + số"
              />
              <button
                type="button"
                className="auth-input-toggle"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Ẩn" : "Hiện"}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {newPassword.length > 0 && (
              <div className={`auth-strength ${strength.tone}`}>
                <div className="auth-strength-track">
                  <div className={`auth-strength-fill score-${strength.score}`} />
                </div>
                <span>Độ mạnh: <strong>{strength.label}</strong></span>
              </div>
            )}
          </label>

          <label className="auth-field">
            <span>Xác nhận mật khẩu mới</span>
            <div className="auth-input">
              <KeyRound size={16} className="auth-input-icon" />
              <input
                autoComplete="new-password"
                type={showNew ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Nhập lại mật khẩu mới"
              />
            </div>
            {mismatch && <small className="auth-mismatch">Xác nhận không khớp</small>}
          </label>

          {newPassword.length > 0 && (
            <ul className="auth-rules">
              {ruleStatus.map((rule) => (
                <li key={rule.key} className={rule.ok ? "ok" : "pending"}>
                  {rule.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  <span>{rule.label}</span>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <div className="auth-actions">
            <button className="auth-submit" type="submit" disabled={!canSubmit}>
              <KeyRound size={16} />
              {submitting ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
            </button>
            {!forced && onCancel && (
              <button type="button" className="auth-secondary" onClick={onCancel}>
                Hủy
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
