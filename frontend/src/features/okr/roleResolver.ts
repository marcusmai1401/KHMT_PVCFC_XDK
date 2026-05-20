export type TechnicalRole = "Business_User" | "Admin_User" | "Mixed_Role_User";

const technicalRoles = new Set(["Admin", "Workshop_Leader", "FI_Coordinator"]);

export function resolveTechnicalRole(roles: string[]): TechnicalRole {
  const normalized = roles.filter(Boolean);
  if (!normalized.length) return "Business_User";
  const technicalCount = normalized.filter((role) => technicalRoles.has(role)).length;
  if (technicalCount === 0) return "Business_User";
  if (technicalCount < normalized.length || normalized.length > 1) return "Mixed_Role_User";
  return "Admin_User";
}
