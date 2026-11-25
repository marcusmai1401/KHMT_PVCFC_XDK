import { test, expect, type Page } from "@playwright/test";

async function mockFiApi(
  page: Page,
  handler: (path: string, method: string, data: any, url: URL) => any,
) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const request = route.request();
    let body: any = null;
    try {
      body = request.postDataJSON();
    } catch {
      // Non-JSON payload (e.g. FormData or GET)
    }
    const result = await handler(url.pathname, request.method(), body, url);
    await route.fulfill({
      status: typeof result?.status === "number" ? result.status : 200,
      contentType: "application/json",
      body: JSON.stringify(result?.body ?? result ?? []),
    });
  });
}

function makeTeammateSk(overrides: Record<string, any> = {}) {
  return {
    id: "sk-tbhtdk-03",
    sk_code: "FI/07/2026-TBHTĐK-03",
    title: "Sử dụng nguồn khí Plant air để làm mát LCP K31101",
    author_name: "Nguyễn Mạnh Quỳnh",
    author_user_id: "quynhnm",
    submitted_by: "quynhnm",
    submitted_by_name: "Nguyễn Mạnh Quỳnh",
    team: "TBHTĐK",
    content_description: "Lắp cover nhựa cho nút Emergency Stop và cấp khí làm mát.",
    completion_plan: "Dự kiến hoàn thành 31/12/2026",
    status: "Approved",
    execution_status: "in_progress",
    execution_note: null,
    completed_at: null,
    consider_for_khmt: false,
    khmt_month: null,
    khmt_year: null,
    revision: 3,
    server_revision: 3,
    created_at: "2026-07-10T02:00:00Z",
    status_history: [
      {
        from_status: null,
        to_status: "Submitted",
        changed_by: "quynhnm",
        changed_at: "2026-07-10T02:00:00Z",
        reason: "web_registration",
        comments: { registration_month: 7, registration_year: 2026, submitted_by: "quynhnm" },
      },
    ],
    supporting_images: [
      {
        id: "img-reg-1",
        file_name: "hien-trang.png",
        stage: "registration",
        uploaded_by: "quynhnm",
      },
    ],
    execution_state: {
      status: "in_progress",
      raw_status: "in_progress",
      is_auto_done: false,
      applicable: true,
      due_date: "2026-12-31",
      completed_date: null,
      note: null,
      updated_at: null,
      updated_by: null,
      updated_by_name: null,
      can_update: true,
      update_blocked_reason: null,
      can_upload_completion_image: true,
    },
    ...overrides,
  };
}

test("Team_Account updates teammate Approved SK in Lịch sử FI end-to-end", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let record = makeTeammateSk();
  const executionWrites: any[] = [];

  await mockFiApi(page, (path, method, data) => {
    if (path.endsWith("/fi/history")) {
      return {
        items: [record],
        total: 1,
        page: 1,
        page_size: 25,
        total_pages: 1,
        has_next: false,
        summary: {
          total: 1,
          approved: 1,
          rejected: 0,
          deferred: 0,
          pending: 0,
          khmt_considered: 0,
          khmt_missing: 1,
          khmt_unassigned_approved: 1,
          completed_count: record.execution_status === "completed" ? 1 : 0,
          not_completed: record.execution_status === "completed" ? 0 : 1,
          approved_completed_count: record.execution_status === "completed" ? 1 : 0,
          approved_in_progress_count: record.execution_status === "completed" ? 0 : 1,
          approved_paused_count: 0,
          approved_auto_done_count: 0,
        },
        facets: {
          teams: [{ value: "TBHTĐK", count: 1 }],
          months: [{ value: 7, count: 1 }],
          decisions: { approved: 1, rejected: 2, deferred: 1, pending: 0 },
          khmt: { in: 0, out: 1 },
          periods: [],
          authors: [],
          submitters: [],
        },
      };
    }
    if (path.endsWith(`/fi/sk-ctkt/${record.id}/execution`) && method === "PUT") {
      executionWrites.push(data);
      record = {
        ...record,
        execution_status: data.execution_status,
        execution_note: data.execution_note,
        completion_plan: "Đã hoàn thành 24/11/2026",
        completed_at: "2026-11-24T00:00:00Z",
        revision: record.revision + 1,
        server_revision: record.revision + 1,
        execution_state: {
          ...record.execution_state,
          status: "completed",
          raw_status: "completed",
          is_auto_done: false,
          completed_date: data.completion_date,
          note: data.execution_note,
          updated_by: "minhvq",
          updated_by_name: "Võ Quang Minh",
        },
      };
      return record;
    }
    if (path.endsWith(`/fi/sk-ctkt/${record.id}`) && method === "GET") {
      return record;
    }
    if (path.endsWith("/fi/dashboard")) {
      return {
        generated_at: "2026-11-24T10:00:00Z",
        teams: [],
        totals: { total: 1, approved: 1, completed_count: 0, not_completed: 1 },
        khmt_by_month: [],
        status_order: [],
      };
    }
    return [];
  });

  await page.goto(
    "/e2e/fixture.html?mode=fi&role=Team_Account&user=minhvq&team=TBHT%C4%90K&name=V%C3%B5%20Quang%20Minh",
  );
  await page.getByRole("tab", { name: /Lịch sử FI/ }).click();

  // Quick-filter chip for own team is visible
  await expect(page.getByRole("button", { name: /Đang thực hiện đội TBHTĐK/ })).toBeVisible();

  // Expand inline detail ("Xem chi tiết")
  await page.getByRole("button", { name: "Xem chi tiết" }).click();

  // Prominent CTA inside inline detail + 2-stage image headers
  const cta = page.getByRole("button", { name: "Cập nhật tình hình thực hiện" });
  await expect(cta).toBeVisible();
  await expect(page.getByText(/Ảnh đăng ký/)).toBeVisible();
  await expect(page.getByText(/Ảnh hoàn thành/)).toBeVisible();

  // Click CTA -> pick "Đã hoàn thành" -> save
  await cta.click();
  const dialog = page.getByRole("dialog", { name: "Tiến độ thực hiện" });
  await expect(dialog).toBeVisible();
  // Only two states, and the current one (in progress) stays selected until the user picks another.
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("radio", { name: "Đang thực hiện" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "Đã hoàn thành" }).click();
  await dialog.getByRole("button", { name: "Lưu" }).click();

  await expect(dialog).toBeHidden();
  expect(executionWrites).toHaveLength(1);
  expect(executionWrites[0]).toMatchObject({
    execution_status: "completed",
    execution_note: null,
    expected_revision: 3,
  });
});

test("FiExecutionUpdateModal opens ABOVE FiDetailDrawer (no z-index occlusion) and works on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const record = makeTeammateSk({
    author_user_id: "minhvq",
    author_name: "Võ Quang Minh",
    execution_status: "auto_completed",
    completed_at: "2026-10-15T00:00:00Z",
    completion_plan: "Đã hoàn thành 15/10/2026",
    execution_state: {
      status: "completed",
      raw_status: "auto_completed",
      is_auto_done: true,
      applicable: true,
      due_date: "2026-10-15",
      completed_date: "2026-10-15",
      note: null,
      updated_at: "2026-10-15T01:00:00Z",
      updated_by: "system",
      updated_by_name: "Hệ thống",
      can_update: true,
      update_blocked_reason: null,
      can_upload_completion_image: true,
    },
  });

  await mockFiApi(page, (path) => {
    if (path.endsWith("/fi/sk-ctkt")) return [record];
    if (path.endsWith(`/fi/sk-ctkt/${record.id}`)) return record;
    if (path.endsWith("/fi/dashboard")) {
      return {
        generated_at: "2026-11-24T10:00:00Z",
        teams: [],
        totals: { total: 1, approved: 1, completed_count: 1, not_completed: 0 },
        khmt_by_month: [],
        status_order: [],
        khmt_matrix: {
          year: 2026,
          okr_teams: ["TBCH", "TBĐL", "TBHTĐK", "TCĐK"],
          rows: [
            {
              team: "TBHTĐK",
              display_name: "TBHTĐK",
              months: Array.from({ length: 12 }, (_, i) => ({
                month: i + 1,
                count: i === 6 ? 1 : 0,
                kr_tier: i === 6 ? "ok" : "none",
                is_current_month: i === 10,
                is_future_month: i > 10,
                is_locked: false,
                lock_reason: null,
                allocation_status: null,
                report_assessment: null,
                assessment_source: null,
                required_count: null,
                quota_status: "no_report",
              })),
              year_khmt_total: 1,
              approved_total: 1,
              approved_unassigned_count: 1,
              pending_count: 0,
              deferred_count: 0,
              rejected_count: 0,
              total_sk: 1,
            },
          ],
          workshop_totals: {
            months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: i === 6 ? 1 : 0 })),
            year_khmt_total: 1,
            approved_total: 1,
            approved_unassigned_count: 1,
            pending_count: 0,
            deferred_count: 0,
            rejected_count: 0,
            total_sk: 1,
          },
          non_okr_summary: [],
        },
      };
    }
    if (path.endsWith("/fi/dashboard/pool")) {
      return {
        team: "TBHTĐK",
        display_name: "TBHTĐK",
        kind: "unassigned_approved",
        total: 1,
        can_edit_khmt: true,
        edit_blocked_reason: null,
        items: [record],
      };
    }
    return [];
  });

  await page.goto(
    "/e2e/fixture.html?mode=fi&role=Team_Account&user=minhvq&team=TBHT%C4%90K&name=V%C3%B5%20Quang%20Minh",
  );
  await page.getByRole("tab", { name: /FI Dashboard/ }).click();

  // Open pool drawer -> open FiDetailDrawer -> open FiExecutionUpdateModal
  await page.locator(".fi-matrix-stat-btn.tone-pool").first().click();
  await page.getByRole("button", { name: "Xem chi tiết" }).click();

  const detailDrawer = page.locator(".fi-detail-drawer");
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer.getByText("Tự ghi nhận").first()).toBeVisible();

  await detailDrawer.getByRole("button", { name: "Cập nhật tình hình thực hiện" }).click();
  const modal = page.locator(".fi-exec-sheet");
  await expect(modal).toBeVisible();

  // Verify hit-testing: modal is NOT occluded by FiDetailDrawer (z-index 200 > 160)
  const hitInsideModal = await modal.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(topEl && el.contains(topEl));
  });
  expect(hitInsideModal).toBe(true);

  // Escape closes ONLY modal and keeps FiDetailDrawer open
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(detailDrawer).toBeVisible();

  // Re-open on mobile 390x844 and check zero horizontal overflow
  await page.setViewportSize({ width: 390, height: 844 });
  await detailDrawer.getByRole("button", { name: "Cập nhật tình hình thực hiện" }).click();
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
