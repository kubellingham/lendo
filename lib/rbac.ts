import { redirect } from 'next/navigation';
import { auth } from './auth';
import type { Role } from '@prisma/client';

export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return session.user;
}

export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new Error('Forbidden: insufficient role');
  }
  return user;
}

export function canManageUsers(role: Role) {
  return role === 'ADMIN';
}

export function canIssueLoans(role: Role) {
  return role === 'ADMIN' || role === 'LOAN_OFFICER';
}

export function canRecordPayments(role: Role) {
  return role === 'ADMIN' || role === 'LOAN_OFFICER';
}

export function canEditCustomers(role: Role) {
  return role === 'ADMIN' || role === 'LOAN_OFFICER';
}

export function canViewReports(_role: Role) {
  return true;
}
