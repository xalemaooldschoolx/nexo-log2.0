import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { type AuthenticatedAppUser, getOrCreateUser } from '../db/users.ts';
import { ensureBaseCatalogSeeded } from '../db/seed-reference.ts';
import { hasPermission, type PermissionCode } from '../lib/rbac.ts';

export interface AuthRequest extends Request {
  firebaseUser?: DecodedIdToken;
  appUser?: AuthenticatedAppUser;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado: token ausente.' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.firebaseUser = decodedToken;

    await ensureBaseCatalogSeeded();
    const appUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@nexolog.local`,
      decodedToken.name
    );

    if (!appUser.isActive) {
      return res.status(403).json({
        error: 'Conta desativada pelo administrador. Solicite liberação.',
      });
    }

    req.appUser = appUser;
    next();
  } catch (error) {
    console.error('Erro na verificação de autenticação:', error);
    return res.status(401).json({ error: 'Não autorizado: sessão inválida ou expirada.' });
  }
};

export const requirePermission = (permission: PermissionCode) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.appUser) {
      return res.status(401).json({ error: 'Sessão não autenticada.' });
    }
    if (!hasPermission(req.appUser.roleCode, permission)) {
      return res.status(403).json({
        error: `Acesso negado: perfil ${req.appUser.roleName} não possui permissão (${permission}).`,
      });
    }
    next();
  };
};
