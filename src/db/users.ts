import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { auditEvents, roles, users } from './schema.ts';
import type { RoleCode } from '../lib/rbac.ts';

export interface AuthenticatedAppUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  badgeCode: string | null;
  jobTitle: string | null;
  department: string | null;
  roleCode: RoleCode;
  roleName: string;
  defaultShiftCode: string;
  isActive: boolean;
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string
): Promise<AuthenticatedAppUser> {
  try {
    const existing = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        badgeCode: users.badgeCode,
        jobTitle: users.jobTitle,
        department: users.department,
        defaultShiftCode: users.defaultShiftCode,
        isActive: users.isActive,
        roleCode: roles.code,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.uid, uid))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(users)
        .set({ lastLoginAt: new Date(), email })
        .where(eq(users.uid, uid));

      return {
        ...existing[0],
        email,
        roleCode: existing[0].roleCode as RoleCode,
      };
    }

    // Bootstrap role: first user in the system receives ADMIN so administration is immediately available;
    // subsequent users receive OPERADOR_MOEGA until promoted by an ADMIN.
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(users);
    const targetRoleCode: RoleCode = Number(totalUsers) === 0 ? 'ADMIN' : 'OPERADOR_MOEGA';

    const roleRows = await db
      .select()
      .from(roles)
      .where(eq(roles.code, targetRoleCode))
      .limit(1);

    if (roleRows.length === 0) {
      throw new Error('Base roles not initialized.');
    }

    const safeName = displayName?.trim() || email.split('@')[0] || 'Operador';

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: safeName,
        roleId: roleRows[0].id,
        defaultShiftCode: 'TURNO_1',
        isActive: true,
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    const createdUser = inserted[0];

    await db.insert(auditEvents).values({
      userId: createdUser.id,
      userEmail: createdUser.email,
      userName: createdUser.displayName,
      userRole: roleRows[0].code,
      action: 'USER_REGISTERED',
      entityType: 'users',
      entityId: String(createdUser.id),
      previousValue: null,
      newValue: JSON.stringify({ role: roleRows[0].code, email: createdUser.email }),
      reason:
        Number(totalUsers) === 0
          ? 'Primeiro acesso administrativo do ambiente'
          : 'Primeiro acesso autenticado',
      origin: 'AUTH_SESSION',
    });

    return {
      id: createdUser.id,
      uid: createdUser.uid,
      email: createdUser.email,
      displayName: createdUser.displayName,
      badgeCode: createdUser.badgeCode,
      jobTitle: createdUser.jobTitle,
      department: createdUser.department,
      roleCode: roleRows[0].code as RoleCode,
      roleName: roleRows[0].name,
      defaultShiftCode: createdUser.defaultShiftCode,
      isActive: createdUser.isActive,
    };
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Falha ao sincronizar perfil de usuário.', { cause: error });
  }
}

export async function listUsersWithRoles() {
  try {
    return await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        badgeCode: users.badgeCode,
        jobTitle: users.jobTitle,
        department: users.department,
        defaultShiftCode: users.defaultShiftCode,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        roleId: roles.id,
        roleCode: roles.code,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id));
  } catch (error) {
    console.error('Database query failed in listUsersWithRoles:', error);
    throw new Error('Falha ao listar usuários.', { cause: error });
  }
}

export async function updateUserAccount(
  targetUserId: number,
  updates: {
    roleCode?: RoleCode;
    isActive?: boolean;
    defaultShiftCode?: string;
    badgeCode?: string;
    jobTitle?: string | null;
    department?: string | null;
    displayName?: string;
  },
  actor: AuthenticatedAppUser,
  reason: string
) {
  try {
    return await db.transaction(async (tx) => {
      const currentRows = await tx
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          badgeCode: users.badgeCode,
          jobTitle: users.jobTitle,
          department: users.department,
          isActive: users.isActive,
          defaultShiftCode: users.defaultShiftCode,
          roleCode: roles.code,
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (currentRows.length === 0) {
        throw new Error('Usuário não encontrado.');
      }

      const prev = currentRows[0];
      let nextRoleId: number | undefined;
      if (updates.roleCode) {
        const r = await tx.select().from(roles).where(eq(roles.code, updates.roleCode)).limit(1);
        if (r.length === 0) throw new Error('Perfil inválido.');
        nextRoleId = r[0].id;
      }

      const [updated] = await tx
        .update(users)
        .set({
          ...(nextRoleId ? { roleId: nextRoleId } : {}),
          ...(typeof updates.isActive === 'boolean' ? { isActive: updates.isActive } : {}),
          ...(updates.defaultShiftCode ? { defaultShiftCode: updates.defaultShiftCode } : {}),
          ...(updates.badgeCode !== undefined ? { badgeCode: updates.badgeCode } : {}),
          ...(updates.jobTitle !== undefined ? { jobTitle: updates.jobTitle?.trim() || null } : {}),
          ...(updates.department !== undefined ? { department: updates.department?.trim() || null } : {}),
          ...(updates.displayName ? { displayName: updates.displayName } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetUserId))
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'USER_UPDATED',
        entityType: 'users',
        entityId: String(targetUserId),
        previousValue: JSON.stringify(prev),
        newValue: JSON.stringify(updates),
        reason: reason || 'Atualização administrativa de conta/perfil',
        origin: 'ADMIN_PANEL',
      });

      return updated;
    });
  } catch (error) {
    console.error('Database query failed in updateUserAccount:', error);
    throw new Error('Falha ao atualizar usuário.', { cause: error });
  }
}
