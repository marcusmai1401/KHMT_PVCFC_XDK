import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChangePasswordForm, isTypingSafePassword } from "./ChangePasswordForm";


describe("ChangePasswordForm", () => {
  it("offers logout instead of cancel while password change is mandatory", () => {
    const html = renderToStaticMarkup(
      <ChangePasswordForm
        forced
        userId="pending-user"
        onChanged={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain("Đăng xuất");
    expect(html).not.toContain(">Hủy<");
  });

  it("names the account so the browser updates the right saved password", () => {
    const html = renderToStaticMarkup(
      <ChangePasswordForm forced={false} userId="thanhdq" onChanged={vi.fn()} />,
    );

    expect(html).toMatch(/<input[^>]*autoComplete="username"[^>]*value="thanhdq"/i);
  });

  it("rejects passwords a Vietnamese input method would rewrite", () => {
    expect(isTypingSafePassword("Pvcfc@2026")).toBe(true);
    expect(isTypingSafePassword("my pass 123")).toBe(true);
    expect(isTypingSafePassword("pasưord123")).toBe(false);
    expect(isTypingSafePassword("Pvcfc@2026 ")).toBe(false);
    expect(isTypingSafePassword("")).toBe(false);
  });
});
