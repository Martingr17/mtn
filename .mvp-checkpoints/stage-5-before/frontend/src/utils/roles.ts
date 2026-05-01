import type { MvpRole, UserRole } from "@/types/domain";

const MVP_ROLE_ALIASES: Record<MvpRole, readonly UserRole[]> = {
  subscriber: ["user"],
  support: ["operator"],
  billing: ["billing"],
  noc_engineer: ["noc_engineer"],
  admin: ["admin", "super_admin"],
};

export function mvpRolesForUserRole(role: UserRole | null | undefined) {
  if (!role) {
    return [];
  }

  return Object.entries(MVP_ROLE_ALIASES)
    .filter(([, userRoles]) => userRoles.includes(role))
    .map(([mvpRole]) => mvpRole as MvpRole);
}

export function hasMvpRole(role: UserRole | null | undefined, allowedRoles: readonly MvpRole[]) {
  if (!role) {
    return false;
  }

  if (MVP_ROLE_ALIASES.admin.includes(role)) {
    return true;
  }

  const allowed = new Set(allowedRoles);
  return mvpRolesForUserRole(role).some((mvpRole) => allowed.has(mvpRole));
}

export function getRoleLabel(role: UserRole | null | undefined) {
  if (role === "super_admin") {
    return "Суперадминистратор";
  }
  if (role === "admin") {
    return "Администратор";
  }
  if (role === "operator") {
    return "Поддержка";
  }
  if (role === "billing") {
    return "Биллинг";
  }
  if (role === "noc_engineer") {
    return "NOC-инженер";
  }
  return "Абонент";
}
