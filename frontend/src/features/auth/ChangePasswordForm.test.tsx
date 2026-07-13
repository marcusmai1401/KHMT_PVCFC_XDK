import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "./ChangePasswordForm";


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
});
