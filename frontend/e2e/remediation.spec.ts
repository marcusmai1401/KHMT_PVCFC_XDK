import {test, expect, type Page} from "@playwright/test";
const assessment = (id = "assessment-1") => ({id, revision: 0, notes: "", training_content: "", assessment_period: "2026-Q3", status: "draft", personnel_level_at_assessment: 1, personnel: {full_name: id}, summary: {total_items: 1, scored_items: 0}, items: [{id: "item-1", stt: 1, competency_name: "Synthetic competency", nlcm_code: "C1", required_score: 3, actual_score: null, notes: ""}]});
async function mock(page: Page, handler: (path: string, method: string, data: any) => any) {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const request = route.request();
    let body: any = null; try {body = request.postDataJSON();} catch {}
    const result = url.pathname.endsWith("/et/dashboard") ? {aggregate: {}, rows: [], top_gap_items: [], top_gap_personnel: []} : await handler(url.pathname, request.method(), body);
    await route.fulfill({status: typeof result?.status === "number" ? result.status : 200, contentType: "application/json", body: JSON.stringify(result?.body ?? result ?? [])});
  });
}
test("ET slow save preserves B and uses the acknowledged revision", async ({page}) => {
  let row = assessment(); const writes: any[] = [];
  await mock(page, async (path, method, data) => {
    if (path.endsWith("/assessments")) return [row, assessment("assessment-2")];
    if (path.includes("/assessments/")) {
      if (method === "PUT") {
        writes.push(data); await new Promise(r => setTimeout(r, 1600));
        if (data.expected_revision !== row.revision) return {status: 409, body: {detail: {code: "VERSION_CONFLICT"}}};
        row = {...row, notes: data.notes, revision: row.revision + 1};
      }
      return row;
    }
    return [];
  });
  await page.goto("/e2e/fixture.html?mode=et");
  await page.getByRole("tab", {name: "Đánh giá", exact: true}).click();
  await page.getByRole("button", {name: /assessment-1/}).click();
  const notes = page.getByPlaceholder("Nhận xét / đánh giá");
  await notes.fill("A");
  await expect.poll(() => writes.length).toBe(1);
  await notes.fill("B");
  await expect.poll(() => writes.length).toBe(2);
  await expect(notes).toHaveValue("B");
  expect(writes[1].expected_revision).toBe(1);
  await expect.poll(() => row.notes).toBe("B");
  await page.screenshot({path: "../output/review-2026-09-10/et-after.png", fullPage: true});
});
test("ET conflict and failed save keep navigation blocked", async ({page}) => {
  let writes = 0;
  await mock(page, (path, method) => {
    if (path.endsWith("/assessments")) return [assessment()];
    if (path.includes("/assessments/")) {
      if (method === "PUT") { writes++; return {status: 409, body: {detail: {code: "VERSION_CONFLICT", message: "Synthetic conflict"}}}; }
      return assessment();
    }
    return [];
  });
  await page.goto("/e2e/fixture.html?mode=et");
  await page.getByRole("tab", {name: "Đánh giá", exact: true}).click();
  await page.getByRole("button", {name: /assessment-1/}).click();
  await page.getByPlaceholder("Nhận xét / đánh giá").fill("Local content");
  await expect(page.getByRole("button", {name: "Xem bản máy chủ"})).toBeVisible();
  await page.getByPlaceholder("Nhận xét / đánh giá").fill("Local merged content");
  await page.getByRole("tab", {name: "Kế hoạch học tập"}).click();
  await page.getByRole("button", {name: "Lưu và đi"}).click();
  await expect(page.getByPlaceholder("Nhận xét / đánh giá")).toHaveValue("Local merged content");
  expect(writes).toBe(1);
});
test("FI text survives reload and recovery remains explicit on mobile", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mock(page, path => path.endsWith("/dashboard") ? {total: 0, by_status: {}, by_team: {}, monthly_trend: []} : []);
  await page.goto("/e2e/fixture.html?mode=fi");
  const fields = page.locator("textarea");
  await fields.first().fill("Synthetic long registration draft");
  await page.reload();
  await expect(page.getByRole("button", {name: "Khôi phục bản này"})).toBeVisible();
  await page.getByRole("button", {name: "Khôi phục bản này"}).click();
  await expect(fields.first()).toHaveValue("Synthetic long registration draft");
  await page.screenshot({path: "../output/review-2026-09-10/fi-recovery-mobile.png", fullPage: true});
});

test("FI mobile filters collapse and searching does not download the full list", async ({page}) => {
  await page.setViewportSize({width: 320, height: 568});
  let fullListCalls = 0;
  await mock(page, path => {
    if (path.endsWith("/sk-ctkt")) fullListCalls++;
    if (path.endsWith("/history")) return {items: [], total: 0, page: 1, page_size: 25, total_pages: 1, summary: {}};
    return path.endsWith("/dashboard") ? {total: 0, by_status: {}, by_team: {}, monthly_trend: []} : [];
  });
  await page.goto("/e2e/fixture.html?mode=fi");
  await page.getByRole("tab", {name: /Lịch sử/}).click();
  const toggle = page.locator(".fi-history-filter-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#fi-history-toolbar")).toBeHidden();
  await toggle.click();
  const before = fullListCalls;
  await page.getByPlaceholder("Tìm mã, tên, nội dung, tác giả…").fill("missing synthetic FI");
  await expect(page.getByText(/Không có kết quả phù hợp với 1 bộ lọc/)).toBeVisible();
  expect(fullListCalls).toBe(before);
  await toggle.click();
  await expect(page.locator("#fi-history-toolbar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: "../output/review-2026-09-10/fi-history-320.png", fullPage: true});
});

test("FI first result is visible on a narrow phone without scrolling", async ({page}) => {
  await page.setViewportSize({width: 320, height: 568});
  await mock(page, path => {
    if (path.endsWith("/history")) return {items: [{id: "fi-visible", sk_code: "FI/09/2026-TBCH-1", title: "Synthetic first FI", team: "TBCH", author_name: "Synthetic", status: "Approved", content_description: "Synthetic only", completion_plan: "T10/2026", created_at: "2026-09-01T00:00:00Z", status_history: []}], total: 1, page: 1, page_size: 25, total_pages: 1, summary: {total: 1, approved: 1, rejected: 0, deferred: 0, pending: 0, completed_count: 0, not_completed: 1, khmt_considered: 0, khmt_missing: 1}};
    return path.endsWith("/dashboard") ? {total: 0, by_status: {}, by_team: {}, monthly_trend: []} : [];
  });
  await page.goto("/e2e/fixture.html?mode=fi");
  await page.getByRole("tab", {name: /Lịch sử/}).click();
  await expect(page.getByText("Synthetic first FI", {exact: true})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: "../output/review-2026-09-10/fi-history-result-320.png", fullPage: true});
});
