import {useState} from "react";
import {useDialogFocus} from "./useDialogFocus";
export function ReauthDialog({userId, onLogin, onDismiss}: {userId: string; onLogin: (password: string) => Promise<void>; onDismiss: () => void}) {
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const ref = useDialogFocus<HTMLFormElement>(() => { if (!busy) onDismiss(); });
  return <div className="editing-dialog-backdrop"><form ref={ref} className="editing-dialog" role="dialog" aria-modal="true" aria-labelledby="reauth-title" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try { await onLogin(password); } catch(error) {setError((error as Error).message);} finally {setBusy(false);}
  }}>
    <h2 id="reauth-title">Đăng nhập lại để tiếp tục</h2>
    <p>Phiên của {userId} đã hết hạn. Bản khôi phục được giữ theo tài khoản; bạn sẽ được xem trước khi gửi lại.</p>
    <label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} type="submit">{busy ? "Đang đăng nhập…" : "Đăng nhập lại"}</button>
    <button disabled={busy} type="button" onClick={onDismiss}>Để sau, giữ bản nháp</button>
  </form></div>;
}
